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
  /** Per-session value attached at connect or via `onTokenRefresh`. */
  metadata?: unknown
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

/**
 * Sent by a client to swap the auth token on a live connection without
 * dropping the socket. The server should re-verify the token and update
 * the session's permissions; closing the socket on failure is acceptable.
 */
export interface AuthRefreshRequest {
  type: 'auth-refresh'
  token: string
}

export type ClientMessage = PatchRequest | ReconnectRequest | AuthRefreshRequest

// --- Server -> Client messages ---

export interface AckResponse {
  type: 'ack'
  messageId: string
  timestamp: number
}

/**
 * Server → client broadcast carrying document and/or ephemeral (cursor/presence)
 * changes in one frame. `timestamp` is the document high-water mark, present only
 * with `documentPatches` — ephemeral state has none and never advances the cursor.
 */
export interface PatchBroadcast {
  type: 'patch'
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
  clientId: string
  timestamp?: number
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

/**
 * Sent by the server when it detects, on reconnect, that the client has seen a
 * higher timestamp than the server currently holds — i.e. the server lost ops
 * (e.g. it crashed and reloaded a throttled snapshot). The client replies with a
 * normal `patch` containing everything it has after `since`, healing the gap.
 */
export interface ResyncRequest {
  type: 'resync'
  /** The restored server's current timestamp (T_s). Client sends ops after this. */
  since: number
}

export type ServerMessage =
  | AckResponse
  | PatchBroadcast
  | ClientCountBroadcast
  | VersionMismatchResponse
  | ResyncRequest
