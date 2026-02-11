/**
 * Component data with existence flag.
 * _exists: false indicates deletion (tombstone).
 */
export type ComponentData = Record<string, unknown> & { _exists?: boolean }

/**
 * A patch is a map of keys to component data.
 * Keys are "stableId/componentName" or "SINGLETON/singletonName".
 */
export type Patch = Record<string, ComponentData>

/** Per-field modification timestamps for a single component key. */
export type FieldTimestamps = Record<string, number>

/** Serializable snapshot of a room's persistent state. */
export interface RoomSnapshot {
  timestamp: number
  state: Record<string, ComponentData>
  timestamps: Record<string, FieldTimestamps>
}

/** Permission level for a connected session. */
export type SessionPermission = 'readonly' | 'readwrite'

/** Info about a connected session. */
export interface SessionInfo {
  sessionId: string
  clientId: string
  permissions: SessionPermission
}

// --- Client -> Server messages ---

export interface PatchRequest {
  type: 'patch'
  messageId: string
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
}

export interface ReconnectRequest {
  type: 'reconnect'
  lastTimestamp: number
  protocolVersion: number
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
}

export type ClientMessage = PatchRequest | ReconnectRequest

// --- Server -> Client messages ---

export interface AckResponse {
  type: 'ack'
  messageId: string
  timestamp: number
}

export interface PatchBroadcast {
  type: 'patch'
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
  clientId: string
  timestamp: number
}

export interface ClientCountBroadcast {
  type: 'clientCount'
  count: number
}

/** Sent by the server when the client's protocol version doesn't match. */
export interface VersionMismatchResponse {
  type: 'version-mismatch'
  serverProtocolVersion: number
}

export type ServerMessage = AckResponse | PatchBroadcast | ClientCountBroadcast | VersionMismatchResponse
