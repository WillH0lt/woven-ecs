import type { Adapter } from '../Adapter'
import { Origin, PROTOCOL_VERSION } from '../constants'
import type { AnyEditorComponentDef } from '../EditorComponentDef'
import type { AnyEditorSingletonDef } from '../EditorSingletonDef'
import { migratePatch } from '../migrations'
import { merge, strip } from '../mutations'
import { type KeyValueStore, openStore } from '../storage'
import type { ClientMessage, Mutation, Patch, ServerMessage } from '../types'

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
  /** Called when the server reports a protocol version mismatch. */
  onVersionMismatch?: (serverProtocolVersion: number) => void
  components: AnyEditorComponentDef[]
  singletons: AnyEditorSingletonDef[]
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
  private messageCounter = 0

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
  /** Timestamp of the last flush (ms). */
  private lastSendTime = 0
  /** Accumulated ephemeral state we've sent, used to resync on reconnect. */
  private localEphemeralState: Patch = {}
  /** Accumulated ephemeral state received from remote clients, used to emit deletions on disconnect. */
  private remoteEphemeralState: Patch = {}

  private token?: string
  private onVersionMismatch?: (serverProtocolVersion: number) => void
  private componentsByName: ReadonlyMap<string, AnyEditorComponentDef | AnyEditorSingletonDef>

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

    const componentMap = new Map<string, AnyEditorComponentDef | AnyEditorSingletonDef>()
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
        if (savedBuffer) this.offlineBuffer = savedBuffer
        if (savedTimestamp) this.lastTimestamp = savedTimestamp
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
      url.searchParams.set('clientId', this.clientId)
      if (this.token) url.searchParams.set('token', this.token)
      const ws = new WebSocket(url.toString())

      ws.addEventListener('open', () => {
        this.ws = ws
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
        this.clearRemoteEphemeral()
        if (!this.intentionallyClosed) {
          this.scheduleReconnect()
        }
      })
    })
  }

  push(mutations: Mutation[]): void {
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

    const messageId = `${this.clientId}-${++this.messageCounter}`
    if (docPatches.length > 0) {
      this.inFlight.set(messageId, merge(...docPatches))
    }

    const msg: ClientMessage = {
      type: 'patch',
      messageId,
      ...(docPatches.length > 0 && { documentPatches: docPatches }),
      ...(ephPatches.length > 0 && { ephemeralPatches: ephPatches }),
    }
    this.ws!.send(JSON.stringify(msg))
    this.lastSendTime = performance.now()
  }

  pull(): Mutation[] {
    const results: Mutation[] = []

    if (this.pendingDocumentPatches.length > 0) {
      const serverPatch = merge(...this.pendingDocumentPatches)
      this.pendingDocumentPatches = []

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
        this.lastTimestamp = msg.timestamp
        this.persistTimestamp()
        if (msg.documentPatches && msg.documentPatches.length > 0) {
          const filtered = this.stripInFlightFields(msg.documentPatches)
          this.pendingDocumentPatches.push(...filtered)
        }
        if (msg.ephemeralPatches && msg.ephemeralPatches.length > 0) {
          this.pendingEphemeralPatches.push(...msg.ephemeralPatches)
          this.remoteEphemeralState = merge(this.remoteEphemeralState, ...msg.ephemeralPatches)
        }
        break
      }

      case 'ack':
        this.lastTimestamp = msg.timestamp
        this.persistTimestamp()
        this.inFlight.delete(msg.messageId)
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

  private clearPersistedOfflineBuffer(): void {
    if (Object.keys(this.offlineBuffer).length === 0) return
    this.offlineBuffer = {}
    if (!this.store || !this.usePersistence) return
    this.store.delete('offlineBuffer')
  }
}
