import { PROTOCOL_VERSION } from './constants'
import type { Storage } from './storage/Storage'
import type {
  AckResponse,
  ClientCountBroadcast,
  ComponentData,
  FieldTimestamps,
  Patch,
  PatchBroadcast,
  PatchRequest,
  ReconnectRequest,
  RoomSnapshot,
  SessionInfo,
  SessionPermission,
  VersionMismatchResponse,
} from './types'
import type { WebSocketLike } from './WebSocketLike'

export interface RoomOptions {
  /** Restore from a previous snapshot. */
  initialSnapshot?: RoomSnapshot
  /** Pluggable persistence backend. */
  storage?: Storage
  /** Called when document state changes (for manual persistence). */
  onDataChange?: (room: Room) => void
  /** Called when a session disconnects. */
  onSessionRemoved?: (room: Room, info: { sessionId: string; remaining: number }) => void
  /** Minimum ms between persistence saves. Defaults to 10000 (10s). */
  saveThrottleMs?: number
}

interface Session {
  sessionId: string
  clientId: string
  socket: WebSocketLike
  permissions: SessionPermission
}

export class Room {
  // --- persistent document state ---
  private timestamp = 0
  private state: Record<string, ComponentData> = {}
  private timestamps: Record<string, FieldTimestamps> = {}

  // --- ephemeral state (per client) ---
  private ephemeralState: Record<string, Record<string, ComponentData>> = {}

  // --- sessions ---
  private sessions = new Map<string, Session>()

  // --- options ---
  private storage?: Storage
  private onDataChange?: (room: Room) => void
  private onSessionRemoved?: (room: Room, info: { sessionId: string; remaining: number }) => void

  // --- throttled save ---
  private saveThrottleMs: number
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(options: RoomOptions = {}) {
    this.storage = options.storage
    this.onDataChange = options.onDataChange
    this.onSessionRemoved = options.onSessionRemoved
    this.saveThrottleMs = options.saveThrottleMs ?? 10_000

    if (options.initialSnapshot) {
      this.timestamp = options.initialSnapshot.timestamp
      this.state = { ...options.initialSnapshot.state }
      this.timestamps = { ...options.initialSnapshot.timestamps }
    }
  }

  /**
   * Load state from storage. Call this once before connecting clients
   * if you're using a storage backend and didn't pass initialSnapshot.
   */
  async load(): Promise<void> {
    if (!this.storage) return
    const snapshot = await this.storage.load()
    if (snapshot) {
      this.timestamp = snapshot.timestamp
      this.state = { ...snapshot.state }
      this.timestamps = { ...snapshot.timestamps }
    }
  }

  // ---------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------

  handleSocketConnect(options: { socket: WebSocketLike; clientId: string; permissions: SessionPermission }): string {
    const { socket, clientId, permissions } = options
    const sessionId = crypto.randomUUID()

    const session: Session = { sessionId, clientId, socket, permissions }
    this.sessions.set(sessionId, session)

    // Send existing ephemeral state from other clients
    const snapshot = this.buildEphemeralSnapshot(clientId)
    if (Object.keys(snapshot).length > 0) {
      const msg: PatchBroadcast = {
        type: 'patch',
        ephemeralPatches: [snapshot],
        clientId: '',
        timestamp: this.timestamp,
      }
      this.sendTo(session, msg)
    }

    this.broadcastClientCount()

    return sessionId
  }

  handleSocketMessage(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.handleRawMessage(session, data)
  }

  handleSocketClose(sessionId: string): void {
    this.removeSession(sessionId)
  }

  handleSocketError(sessionId: string): void {
    this.removeSession(sessionId)
  }

  // ---------------------------------------------------------------
  // State access
  // ---------------------------------------------------------------

  getSnapshot(): RoomSnapshot {
    // Filter out tombstones from the snapshot
    const filteredState: Record<string, ComponentData> = {}
    const filteredTimestamps: Record<string, FieldTimestamps> = {}
    for (const [key, value] of Object.entries(this.state)) {
      if (value._exists !== false) {
        filteredState[key] = value
        if (this.timestamps[key]) {
          filteredTimestamps[key] = this.timestamps[key]
        }
      }
    }
    return {
      timestamp: this.timestamp,
      state: filteredState,
      timestamps: filteredTimestamps,
    }
  }

  getSessionCount(): number {
    return this.sessions.size
  }

  getSessionPermissions(sessionId: string): SessionPermission | undefined {
    return this.sessions.get(sessionId)?.permissions
  }

  setSessionPermissions(sessionId: string, permissions: SessionPermission): void {
    const session = this.sessions.get(sessionId)
    if (session) session.permissions = permissions
  }

  getSessions(): SessionInfo[] {
    const result: SessionInfo[] = []
    for (const session of this.sessions.values()) {
      result.push({
        sessionId: session.sessionId,
        clientId: session.clientId,
        permissions: session.permissions,
      })
    }
    return result
  }

  close(): void {
    this.closed = true
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    // Flush any pending save synchronously-ish
    this.flushSave()
    for (const session of this.sessions.values()) {
      try {
        session.socket.close()
      } catch {
        // ignore
      }
    }
    this.sessions.clear()
  }

  // ---------------------------------------------------------------
  // Protocol handling
  // ---------------------------------------------------------------

  private handleRawMessage(session: Session, raw: string): void {
    let envelope: { type: string }
    try {
      envelope = JSON.parse(raw)
    } catch {
      return
    }

    switch (envelope.type) {
      case 'patch':
        this.handlePatch(session, JSON.parse(raw) as PatchRequest)
        break
      case 'reconnect':
        this.handleReconnect(session, JSON.parse(raw) as ReconnectRequest)
        break
    }
  }

  private handlePatch(session: Session, req: PatchRequest): void {
    const hasDoc = !!(req.documentPatches && req.documentPatches.length > 0)
    const hasEph = !!(req.ephemeralPatches && req.ephemeralPatches.length > 0)

    // Empty patches are ignored entirely (no ack)
    if (!hasDoc && !hasEph) return

    // Readonly clients get an ack but patches are dropped
    if (session.permissions !== 'readonly') {
      this.applyAndBroadcast(session, req)
    }

    const ack: AckResponse = {
      type: 'ack',
      messageId: req.messageId,
      timestamp: this.timestamp,
    }
    this.sendTo(session, ack)
  }

  private handleReconnect(session: Session, req: ReconnectRequest): void {
    // Check protocol version for all clients (including readonly)
    if (req.protocolVersion !== PROTOCOL_VERSION) {
      const mismatch: VersionMismatchResponse = {
        type: 'version-mismatch',
        serverProtocolVersion: PROTOCOL_VERSION,
      }
      this.sendTo(session, mismatch)
      // Continue processing - still send document diff
    }

    // Apply patches only for readwrite clients
    if (session.permissions !== 'readonly') {
      this.applyAndBroadcast(session, req)
    }

    // Send document diff since client's last known timestamp (for all clients)
    const diff = this.buildDiff(req.lastTimestamp)
    const othersEph = this.buildEphemeralSnapshot(session.clientId)

    const response: PatchBroadcast = {
      type: 'patch',
      clientId: '',
      timestamp: this.timestamp,
    }
    if (Object.keys(diff).length > 0) {
      response.documentPatches = [diff]
    }
    if (Object.keys(othersEph).length > 0) {
      response.ephemeralPatches = [othersEph]
    }
    if (response.documentPatches || response.ephemeralPatches) {
      this.sendTo(session, response)
    }
  }

  /**
   * Shared logic: apply document & ephemeral patches, broadcast to
   * other clients, and schedule persistence when needed.
   */
  private applyAndBroadcast(session: Session, req: { documentPatches?: Patch[]; ephemeralPatches?: Patch[] }): void {
    const hasDoc = !!(req.documentPatches && req.documentPatches.length > 0)
    const hasEph = !!(req.ephemeralPatches && req.ephemeralPatches.length > 0)

    if (hasDoc) {
      this.timestamp++
      for (const patch of req.documentPatches!) {
        this.applyDocumentPatch(patch, this.timestamp)
      }
    }

    if (hasEph) {
      this.applyEphemeralPatch(session.clientId, req.ephemeralPatches!)
    }

    if (hasDoc || hasEph) {
      const broadcast: PatchBroadcast = {
        type: 'patch',
        clientId: session.clientId,
        timestamp: this.timestamp,
      }
      if (hasDoc) broadcast.documentPatches = req.documentPatches
      if (hasEph) broadcast.ephemeralPatches = req.ephemeralPatches
      this.broadcastExcept(session.sessionId, broadcast)
    }

    if (hasDoc) this.scheduleSave()
  }

  // ---------------------------------------------------------------
  // State mutation helpers (ported from Go room controller)
  // ---------------------------------------------------------------

  private applyDocumentPatch(patch: Patch, ts: number): void {
    const modified = applyPatch(this.state, patch)
    for (const [key, fields] of Object.entries(modified)) {
      this.updateTimestamps(key, fields, ts)
    }
  }

  private updateTimestamps(key: string, fields: ComponentData, ts: number): void {
    let existing = this.timestamps[key]
    if (!existing || fields._exists === false) {
      existing = {}
      this.timestamps[key] = existing
    }
    for (const k of Object.keys(fields)) {
      existing[k] = ts
    }
  }

  private applyEphemeralPatch(clientId: string, patches: Patch[]): void {
    let clientState = this.ephemeralState[clientId]
    if (!clientState) {
      clientState = {}
      this.ephemeralState[clientId] = clientState
    }
    for (const patch of patches) {
      applyPatch(clientState, patch)
    }
  }

  private buildEphemeralSnapshot(excludeClientId: string): Patch {
    const merged: Patch = {}
    for (const [clientId, state] of Object.entries(this.ephemeralState)) {
      if (clientId === excludeClientId) continue
      for (const [key, value] of Object.entries(state)) {
        merged[key] = value
      }
    }
    return merged
  }

  private buildDiff(since: number): Patch {
    const diff: Patch = {}
    for (const [key, fieldTs] of Object.entries(this.timestamps)) {
      const componentState = this.state[key]
      if (!componentState) continue

      const fieldDiff: ComponentData = {}
      let hasChanges = false
      for (const [field, ts] of Object.entries(fieldTs)) {
        if (ts > since) {
          fieldDiff[field] = componentState[field]
          hasChanges = true
        }
      }
      if (hasChanges) {
        diff[key] = fieldDiff
      }
    }
    return diff
  }

  // ---------------------------------------------------------------
  // Session helpers
  // ---------------------------------------------------------------

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)

    // Clean up ephemeral state
    const ephState = this.ephemeralState[session.clientId]
    if (ephState) {
      const deletionPatch: Patch = {}
      for (const key of Object.keys(ephState)) {
        deletionPatch[key] = { _exists: false }
      }
      delete this.ephemeralState[session.clientId]

      if (Object.keys(deletionPatch).length > 0) {
        const broadcast: PatchBroadcast = {
          type: 'patch',
          ephemeralPatches: [deletionPatch],
          clientId: session.clientId,
          timestamp: this.timestamp,
        }
        this.broadcastAll(broadcast)
      }
    }

    this.broadcastClientCount()

    this.onSessionRemoved?.(this, {
      sessionId,
      remaining: this.sessions.size,
    })
  }

  // ---------------------------------------------------------------
  // Transport helpers
  // ---------------------------------------------------------------

  private sendTo(session: Session, msg: object): void {
    try {
      session.socket.send(JSON.stringify(msg))
    } catch {
      // Client likely disconnected
    }
  }

  private broadcastAll(msg: object): void {
    const data = JSON.stringify(msg)
    for (const session of this.sessions.values()) {
      try {
        session.socket.send(data)
      } catch {
        // ignore slow/disconnected clients
      }
    }
  }

  private broadcastExcept(excludeSessionId: string, msg: object): void {
    const data = JSON.stringify(msg)
    for (const session of this.sessions.values()) {
      if (session.sessionId === excludeSessionId) continue
      try {
        session.socket.send(data)
      } catch {
        // ignore slow/disconnected clients
      }
    }
  }

  private broadcastClientCount(): void {
    const msg: ClientCountBroadcast = {
      type: 'clientCount',
      count: this.sessions.size,
    }
    this.broadcastAll(msg)
  }

  // ---------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------

  private scheduleSave(): void {
    this.onDataChange?.(this)
    if (!this.storage || this.closed) return
    if (this.saveTimer !== null) return // already scheduled
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flushSave()
    }, this.saveThrottleMs)
  }

  private flushSave(): void {
    if (!this.storage) return
    this.storage.save(this.getSnapshot()).catch(() => {
      // Swallow persistence errors to avoid crashing the room
    })
  }
}

// ---------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------

/**
 * Merges a patch into a state map. Returns the keys/fields that were modified.
 * Handles _exists: false for deletions and field-level merging for updates.
 */
function applyPatch(state: Record<string, ComponentData>, patch: Patch): Record<string, ComponentData> {
  const modified: Record<string, ComponentData> = {}

  for (const [key, value] of Object.entries(patch)) {
    // _exists: false means delete/tombstone — keep it in state so
    // buildDiff can send the deletion to reconnecting clients.
    if (value._exists === false) {
      state[key] = { _exists: false }
      modified[key] = value
      continue
    }

    const existing = state[key]
    if (!existing || existing._exists === false) {
      state[key] = { ...value }
      modified[key] = value
      continue
    }

    // Merge new fields into existing
    for (const [k, v] of Object.entries(value)) {
      existing[k] = v
    }
    modified[key] = value
  }

  return modified
}
