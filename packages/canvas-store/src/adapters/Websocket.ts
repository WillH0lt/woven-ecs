import type { Adapter } from '../Adapter'
import { materializeFields } from '../bufferDelta'
import type { AnyCanvasComponentDef } from '../CanvasComponentDef'
import type { AnyCanvasSingletonDef } from '../CanvasSingletonDef'
import { Origin, PROTOCOL_VERSION } from '../constants'
import { migratePatch } from '../migrations'
import { merge, strip } from '../mutations'
import { type KeyValueStore, openStore } from '../storage'
import type { ClientMessage, ComponentData, FieldTimestamps, Mutation, Patch, ServerMessage } from '../types'

/** Send interval when multiple clients are connected (~30 fps). */
const MULTI_CLIENT_INTERVAL = 1000 / 30
/** Send interval when editing solo (~1 fps). */
const SOLO_INTERVAL = 1000

export interface WebsocketAdapterOptions {
  url: string
  clientId: string
  documentId: string
  usePersistence: boolean
  startOffline?: boolean
  token?: string
  onVersionMismatch?: (serverProtocolVersion: number) => void
  onConnectivityChange?: (isOnline: boolean) => void
  onSynced?: () => void
  components: AnyCanvasComponentDef[]
  singletons: AnyCanvasSingletonDef[]
}

/**
 * WebSocket adapter for real-time multiplayer sync.
 *
 * Sends local mutations to a server and receives remote mutations
 * from other clients. The server acknowledges our patches with an
 * ack (containing the assigned timestamp) and broadcasts them to
 * other clients separately.
 *
 * On reconnect, sends the last known timestamp so the server can
 * send a patch with missed operations.
 *
 * When `usePersistence` is true, the offline buffer and lastTimestamp
 * are persisted to IndexedDB so they survive page reloads.
 */
export class WebsocketAdapter implements Adapter {
  private url: string
  private clientId: string
  private ws: WebSocket | null = null
  private pendingDocumentPatches: Patch[] = []
  private pendingEphemeralPatches: Patch[] = []
  private lastTimestamp = 0
  /**
   * Highest document timestamp received but not yet applied. {@link lastTimestamp}
   * catches up to this in {@link pull} (on apply), never on receipt — so the
   * persisted cursor can't run ahead of the stored document if a reload
   * interrupts a load.
   */
  private pendingTimestamp = 0
  private messageCounter = 0

  /**
   * Mirror of the server's per-field timestamp map (key → field → timestamp),
   * built from acks (our own writes) and broadcasts (remote writes). Used to
   * compute the reverse diff that heals a rolled-back server. Document-scoped:
   * only ever updated from document patches, never ephemeral/local.
   */
  private timestamps: Record<string, FieldTimestamps> = {}

  /**
   * Mirror of the document state, maintained from every document mutation that
   * flows through {@link push} (any origin), the same way the ECS and persistence
   * adapters track their own state. Buffer deltas are materialized into full
   * arrays and tombstones are kept, so it can supply current values — including
   * deletions — for the reverse diff on a resync.
   */
  private state: Record<string, ComponentData> = {}

  /** Patches sent but not yet acknowledged, keyed by messageId. */
  private inFlight = new Map<string, Patch>()

  private startOffline: boolean
  private usePersistence: boolean
  private documentId: string
  private store: KeyValueStore | null = null

  /** Patches accumulated while disconnected, merged into one. */
  private offlineBuffer: Patch = {}

  private connectedUsers = 0

  /** True when the user intentionally disconnected (no auto-reconnect). */
  private intentionallyClosed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 500
  private static readonly MIN_RECONNECT_DELAY = 500
  private static readonly MAX_RECONNECT_DELAY = 10_000

  /** Document patches buffered between sends for throttling. */
  private documentSendBuffer: Patch[] = []
  /** Ephemeral patches buffered between sends for throttling. */
  private ephemeralSendBuffer: Patch[] = []
  /**
   * Timestamp of the last flush (ms). Starts at -Infinity so the first push
   * always flushes immediately: `performance.now()` is relative to process /
   * page start, so a `0` sentinel would gate the first flush behind the send
   * interval for any push within the first second of page load.
   */
  private lastSendTime = Number.NEGATIVE_INFINITY
  /** Accumulated ephemeral state we've sent, used to resync on reconnect. */
  private localEphemeralState: Patch = {}
  /** Accumulated ephemeral state received from remote clients, used to emit deletions on disconnect. */
  private remoteEphemeralState: Patch = {}

  private token?: string
  private onVersionMismatch?: (serverProtocolVersion: number) => void
  private onConnectivityChange?: (isOnline: boolean) => void
  private onSynced?: () => void
  private pendingSynced = false
  private componentsByName: ReadonlyMap<string, AnyCanvasComponentDef | AnyCanvasSingletonDef>

  get isOnline(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  constructor(options: WebsocketAdapterOptions) {
    this.url = options.url
    this.clientId = options.clientId
    this.startOffline = options.startOffline ?? false
    this.usePersistence = options.usePersistence
    this.documentId = options.documentId
    this.token = options.token
    this.onVersionMismatch = options.onVersionMismatch
    this.onConnectivityChange = options.onConnectivityChange
    this.onSynced = options.onSynced

    const componentMap = new Map<string, AnyCanvasComponentDef | AnyCanvasSingletonDef>()
    for (const def of [...options.components, ...options.singletons]) {
      componentMap.set(def.name, def)
    }
    this.componentsByName = componentMap
  }

  async init(): Promise<void> {
    if (this.usePersistence) {
      try {
        this.store = await openStore(`${this.documentId}-ws`, 'meta')
        const savedBuffer = await this.store.get<Patch>('offlineBuffer')
        const savedTimestamp = await this.store.get<number>('lastTimestamp')
        const savedTimestamps = await this.store.get<Record<string, FieldTimestamps>>('timestamps')
        if (savedBuffer) this.offlineBuffer = savedBuffer
        if (savedTimestamp) this.lastTimestamp = savedTimestamp
        // Restore the per-field timestamp map so a resync can heal a rolled-back
        // server even after a reload (the document state mirror is rebuilt
        // separately from the persistence adapter via the mutation router).
        if (savedTimestamps) this.timestamps = savedTimestamps
      } catch (err) {
        console.error('Failed to load websocket offline state:', err)
      }
    }

    if (this.startOffline) {
      this.intentionallyClosed = true
      return
    }
    this.intentionallyClosed = false

    try {
      await this.connectWs()
    } catch (err) {
      console.warn('WebSocket connection failed:', err)
      this.scheduleReconnect()
    }

    return
  }

  private connectWs(): Promise<void> {
    this.inFlight.clear()
    return new Promise<void>((resolve, reject) => {
      const url = new URL(this.url)
      url.searchParams.set('roomId', this.documentId)
      url.searchParams.set('clientId', this.clientId)
      if (this.token) url.searchParams.set('token', this.token)
      const ws = new WebSocket(url.toString())

      ws.addEventListener('open', () => {
        this.ws = ws
        this.onConnectivityChange?.(true)
        // Request missed ops since last sync
        const msg: ClientMessage = {
          type: 'reconnect',
          lastTimestamp: this.lastTimestamp,
          protocolVersion: PROTOCOL_VERSION,
          ...(Object.keys(this.offlineBuffer).length > 0 && {
            documentPatches: [this.offlineBuffer],
          }),
          ...(Object.keys(this.localEphemeralState).length > 0 && {
            ephemeralPatches: [this.localEphemeralState],
          }),
        }

        ws.send(JSON.stringify(msg))
        resolve()
      })

      ws.addEventListener('error', () => {
        reject(new Error(`WebSocket failed to connect to ${this.url}`))
      })

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data as string)
      })

      ws.addEventListener('close', () => {
        this.ws = null
        this.onConnectivityChange?.(false)
        this.clearRemoteEphemeral()
        if (!this.intentionallyClosed) {
          this.scheduleReconnect()
        }
      })
    })
  }

  /**
   * Replace the auth token used for this connection.
   *
   * Updates the token used for future reconnect URLs and, if the socket is
   * currently open, sends an `auth-refresh` frame so the server can swap
   * credentials without dropping the connection. Pass `undefined` to clear.
   */
  setToken(token: string | undefined): void {
    this.token = token
    if (token && this.isOnline) {
      const msg: ClientMessage = { type: 'auth-refresh', token }
      this.ws!.send(JSON.stringify(msg))
    }
  }

  push(mutations: Mutation[]): void {
    // Keep our document mirror current from every document mutation, regardless
    // of origin (local edits, remote changes we pulled, persisted/initial state).
    // This is independent of what we forward to the server below.
    for (const m of mutations) {
      if (m.syncBehavior === 'document') this.applyToState(m.patch)
    }

    const docPatches: Patch[] = []
    const ephPatches: Patch[] = []
    for (const m of mutations) {
      if (m.origin === Origin.Websocket) continue
      if (m.origin === Origin.Persistence) continue
      if (m.syncBehavior === 'local') continue // Local data is not synced
      if (m.syncBehavior === 'ephemeral') {
        ephPatches.push(m.patch)
      } else {
        docPatches.push(m.patch)
      }
    }

    if (!this.isOnline) {
      if (docPatches.length > 0) {
        this.offlineBuffer = merge(this.offlineBuffer, ...docPatches)
        this.persistOfflineBuffer()
      }
      // Track ephemeral state so it can be restored on reconnect
      if (ephPatches.length > 0) {
        this.localEphemeralState = merge(this.localEphemeralState, ...ephPatches)
      }
      return
    }

    if (docPatches.length > 0) {
      this.documentSendBuffer.push(...docPatches)
    }
    if (ephPatches.length > 0) {
      this.ephemeralSendBuffer.push(...ephPatches)
    }

    this.flushIfReady()
  }

  /** Target send interval based on current client count. */
  private get sendInterval(): number {
    return this.connectedUsers > 1 ? MULTI_CLIENT_INTERVAL : SOLO_INTERVAL
  }

  /** Flush the send buffer if enough time has elapsed since the last send. */
  private flushIfReady(): void {
    const elapsed = performance.now() - this.lastSendTime
    if (elapsed >= this.sendInterval) {
      this.flush()
    }
  }

  /** Send all buffered patches to the server in a single message. */
  private flush(): void {
    if (!this.isOnline) return

    // Document patches
    const docPatches: Patch[] = []

    if (Object.keys(this.offlineBuffer).length > 0) {
      docPatches.push(this.offlineBuffer)
      this.offlineBuffer = {}
    }

    docPatches.push(...this.documentSendBuffer)
    this.documentSendBuffer = []

    // Ephemeral patches (fire-and-forget, no inFlight tracking)
    const ephPatches = this.ephemeralSendBuffer
    this.ephemeralSendBuffer = []

    // Track sent ephemeral state for reconnect
    if (ephPatches.length > 0) {
      this.localEphemeralState = merge(this.localEphemeralState, ...ephPatches)
    }

    if (docPatches.length === 0 && ephPatches.length === 0) return

    // Coalesce everything buffered since the last flush into a single patch
    // each (composing buffer deltas), so a burst of per-frame edits goes out as
    // one compact patch instead of N. The receiver merges on pull anyway, and
    // the server applies a single merged patch identically to the sequence.
    const mergedDoc = docPatches.length > 0 ? merge(...docPatches) : {}
    const mergedEph = ephPatches.length > 0 ? merge(...ephPatches) : {}
    const hasDoc = Object.keys(mergedDoc).length > 0
    const hasEph = Object.keys(mergedEph).length > 0

    if (!hasDoc && !hasEph) return

    const messageId = `${this.clientId}-${++this.messageCounter}`
    if (hasDoc) {
      this.inFlight.set(messageId, mergedDoc)
    }

    const msg: ClientMessage = {
      type: 'patch',
      messageId,
      ...(hasDoc && { documentPatches: [mergedDoc] }),
      ...(hasEph && { ephemeralPatches: [mergedEph] }),
    }
    this.ws!.send(JSON.stringify(msg))
    this.lastSendTime = performance.now()
  }

  pull(): Mutation[] {
    const results: Mutation[] = []

    if (this.pendingDocumentPatches.length > 0) {
      const serverPatch = merge(...this.pendingDocumentPatches)
      this.pendingDocumentPatches = []

      // Advance the cursor on apply (here), not receipt — see pendingTimestamp.
      if (this.pendingTimestamp > this.lastTimestamp) {
        this.lastTimestamp = this.pendingTimestamp
        this.persistTimestamp()
      }

      // Migrate server patches first (they might be from older clients)
      const migratedServer = migratePatch(serverPatch, this.componentsByName)

      // Migrate offline buffer in case it's from an old persisted session
      const migratedBuffer = migratePatch(this.offlineBuffer, this.componentsByName)

      // Strip fields we already have locally from the offline buffer.
      // Both are now at the same version, so strip can compare correctly.
      const diff = strip(migratedServer, migratedBuffer)
      this.clearPersistedOfflineBuffer()

      if (Object.keys(diff).length > 0) {
        results.push({
          patch: diff,
          origin: Origin.Websocket,
          syncBehavior: 'document',
        })
      }
    }

    if (this.pendingEphemeralPatches.length > 0) {
      const ephPatch = merge(...this.pendingEphemeralPatches)
      this.pendingEphemeralPatches = []
      results.push({
        patch: ephPatch,
        origin: Origin.Websocket,
        syncBehavior: 'ephemeral',
      })
    }

    // Any document received before the `synced` marker was drained above, so the
    // initial state is now applied — fire the signal.
    if (this.pendingSynced) {
      this.pendingSynced = false
      this.onSynced?.()
    }

    return results
  }

  disconnect(): void {
    this.intentionallyClosed = true
    this.clearReconnectTimer()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  close(): void {
    this.disconnect()
    if (this.store) {
      this.store.close()
      this.store = null
    }
  }

  /**
   * Attempt to reconnect, requesting missed ops since last timestamp.
   */
  async reconnect(): Promise<void> {
    this.intentionallyClosed = false
    this.reconnectDelay = WebsocketAdapter.MIN_RECONNECT_DELAY
    this.clearReconnectTimer()
    await this.connectWs()
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.connectWs()
        // Success — reset delay (reconnect message sent inside connectWs)
        this.reconnectDelay = WebsocketAdapter.MIN_RECONNECT_DELAY
      } catch {
        // Connection failed — back off and retry (close handler will fire)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, WebsocketAdapter.MAX_RECONNECT_DELAY)
        this.scheduleReconnect()
      }
    }, this.reconnectDelay)
  }

  private handleMessage(data: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(data) as ServerMessage
    } catch {
      return
    }

    switch (msg.type) {
      case 'patch': {
        // `timestamp` rides with documentPatches only, so the cursor never moves
        // for ephemeral state bundled in the same message.
        if (msg.documentPatches && msg.documentPatches.length > 0 && msg.timestamp !== undefined) {
          // Record the (filtered) remote writes in the timestamp mirror. Stripped
          // fields are ones our in-flight patch overwrites — recorded at our ack
          // instead. This mirror is not the resume cursor.
          const filtered = this.stripInFlightFields(msg.documentPatches)
          for (const patch of filtered) this.recordTimestamps(patch, msg.timestamp)
          this.pendingDocumentPatches.push(...filtered)
          // Cursor advances on apply (pull), so just track how far we've received.
          this.pendingTimestamp = Math.max(this.pendingTimestamp, msg.timestamp)
        }
        if (msg.ephemeralPatches && msg.ephemeralPatches.length > 0) {
          this.pendingEphemeralPatches.push(...msg.ephemeralPatches)
          this.remoteEphemeralState = merge(this.remoteEphemeralState, ...msg.ephemeralPatches)
        }
        break
      }

      case 'ack': {
        // Only document writes are tracked in-flight; an ack with no match is an
        // ephemeral ack and must not move the cursor (else the next reconnect
        // asks for an empty diff). Our own document write is already applied, so
        // its ack may advance it.
        const sent = this.inFlight.get(msg.messageId)
        if (sent) {
          this.lastTimestamp = msg.timestamp
          this.persistTimestamp()
          this.recordTimestamps(sent, msg.timestamp)
          this.inFlight.delete(msg.messageId)
        }
        break
      }

      case 'synced':
        // The document we needed arrived just before this (ordered). Defer the
        // signal to pull(), where those patches are actually applied — so
        // "synced" means loaded-into-the-world, not merely received.
        this.pendingSynced = true
        break

      case 'resync':
        this.handleResync(msg.since)
        break

      case 'clientCount':
        this.connectedUsers = msg.count
        break

      case 'version-mismatch':
        this.disconnect()
        this.onVersionMismatch?.(msg.serverProtocolVersion)
        break
    }
  }

  /**
   * Strip fields from incoming patches that overlap with in-flight
   * patches. Broadcasts that arrive before our ack were processed
   * before our patch on the server — our patch overwrites them, so
   * applying them locally would cause divergence. TCP ordering
   * guarantees broadcasts processed after ours arrive after the ack,
   * when inFlight is already cleared.
   */
  private stripInFlightFields(patches: Patch[]): Patch[] {
    if (this.inFlight.size === 0) return patches

    const mask = merge(...Array.from(this.inFlight.values()))
    const result: Patch[] = []

    for (const patch of patches) {
      const filtered = strip(patch, mask)
      if (Object.keys(filtered).length > 0) {
        result.push(filtered)
      }
    }

    return result
  }

  // --- Rollback recovery (reverse resync) ---

  /**
   * Merge a document patch into the local mirror, mirroring the server's
   * `applyPatch`: deletions become tombstones (kept, so they can be re-asserted)
   * and buffer deltas materialize against the existing full array.
   */
  private applyToState(patch: Patch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value._exists === false) {
        this.state[key] = { _exists: false }
        continue
      }
      const existing = this.state[key]
      const base = existing && existing._exists !== false ? existing : undefined
      this.state[key] = materializeFields(base, value) as ComponentData
    }
  }

  /**
   * Record server-confirmed field writes into the mirrored timestamp map.
   * Mirrors the server's `updateTimestamps`: a deletion (`_exists:false`) resets
   * the key's field map first, so stale field timestamps don't linger past it.
   * Overwrites (does not `max`) so that after a server rollback the map re-adopts
   * the restored, lower timestamp domain instead of pinning stale-high values.
   */
  private recordTimestamps(patch: Patch, ts: number): void {
    for (const [key, fields] of Object.entries(patch)) {
      let existing = this.timestamps[key]
      if (!existing || fields._exists === false) {
        existing = {}
        this.timestamps[key] = existing
      }
      for (const field of Object.keys(fields)) {
        existing[field] = ts
      }
    }
    this.persistTimestamps()
  }

  /**
   * Build the reverse diff that heals a rolled-back server: every field we've
   * seen confirmed at a timestamp after `since`, taken from current document
   * state, plus any still-unconfirmed local edits (which are by definition ahead
   * of the restored server). This is the mirror image of the server's
   * `buildDiff`, run on the client.
   */
  private buildResyncPatch(since: number): Patch {
    const diff: Patch = {}

    for (const [key, fieldTs] of Object.entries(this.timestamps)) {
      const value = this.state[key]
      if (!value) continue
      const entry: ComponentData = {}
      let hasFields = false
      for (const [field, ts] of Object.entries(fieldTs)) {
        if (ts > since && field in value) {
          entry[field] = value[field]
          hasFields = true
        }
      }
      if (hasFields) diff[key] = entry
    }

    // Fold in unconfirmed local edits — offline buffer, buffered sends, and
    // anything still in flight — none of which the restored server can have.
    const unconfirmed: Patch[] = []
    if (Object.keys(this.offlineBuffer).length > 0) unconfirmed.push(this.offlineBuffer)
    unconfirmed.push(...this.documentSendBuffer)
    for (const patch of this.inFlight.values()) unconfirmed.push(patch)

    if (unconfirmed.length === 0) return diff
    return merge(diff, ...unconfirmed)
  }

  /**
   * Respond to a server resync request by sending our reverse diff as a normal
   * `patch`, so it is tracked in-flight, acked, persisted, and broadcast to other
   * clients through the usual path.
   */
  private handleResync(since: number): void {
    if (!this.isOnline) return
    const patch = this.buildResyncPatch(since)
    if (Object.keys(patch).length === 0) return

    const messageId = `${this.clientId}-resync-${++this.messageCounter}`
    this.inFlight.set(messageId, patch)
    const msg: ClientMessage = { type: 'patch', messageId, documentPatches: [patch] }
    this.ws!.send(JSON.stringify(msg))
  }

  /**
   * Emit deletion patches for all tracked remote ephemeral keys.
   * Called on disconnect so the ECS world drops other users' ephemeral state.
   */
  private clearRemoteEphemeral(): void {
    const keys = Object.keys(this.remoteEphemeralState)
    if (keys.length === 0) return

    const deletionPatch: Patch = {}
    for (const key of keys) {
      deletionPatch[key] = { _exists: false }
    }
    this.pendingEphemeralPatches.push(deletionPatch)
    this.remoteEphemeralState = {}
  }

  // --- Persistence helpers ---

  private persistOfflineBuffer(): void {
    if (!this.store || !this.usePersistence) return
    this.store.put('offlineBuffer', this.offlineBuffer)
  }

  private persistTimestamp(): void {
    if (!this.store || !this.usePersistence) return
    this.store.put('lastTimestamp', this.lastTimestamp)
  }

  private persistTimestamps(): void {
    if (!this.store || !this.usePersistence) return
    // The store buffers writes and collapses repeats to the same key into one
    // flush per interval, so calling this on every confirmed write is cheap.
    this.store.put('timestamps', this.timestamps)
  }

  private clearPersistedOfflineBuffer(): void {
    if (Object.keys(this.offlineBuffer).length === 0) return
    this.offlineBuffer = {}
    if (!this.store || !this.usePersistence) return
    this.store.delete('offlineBuffer')
  }
}
