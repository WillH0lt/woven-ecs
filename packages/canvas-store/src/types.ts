import type { ComponentSchema, EntityId, InferComponentType } from '@woven-ecs/core'
import type { Origin } from './constants'

/**
 * Sync determines how component changes propagate
 */
export type SyncBehavior =
  | 'document' // Persisted to database, synced to all clients
  | 'ephemeral' // Synced via websocket for ephemeral (cursors, selections)
  | 'local' // Persisted locally only, not synced (preferences, camera position)
  | 'none' // Not synced or stored anywhere

/**
 * Component snapshot extended with sync metadata.
 * Returned by `CanvasComponentDef.snapshot()` and `CanvasSingletonDef.snapshot()`.
 */
export type InferCanvasComponentType<T extends ComponentSchema> = InferComponentType<T> & {
  _exists: true
  _version: string | null
}

/**
 * Component data with existence flag.
 * _exists: true indicates the component exists (used when adding).
 * _exists: false indicates the component is deleted (tombstone).
 * Other fields are the partial component data to merge.
 */
export type ComponentData = Record<string, unknown> & {
  _exists?: boolean
  _version?: string
}

/**
 * A patch is a map of keys to values representing component changes.
 *
 * Key format:
 * - Components: "<entityId>/<componentName>"
 * - Singletons: "<SINGLETON_ENTITY_ID>/<singletonName>"
 *
 * Value:
 * - Partial data to merge (with _exists: true for new components)
 * - { _exists: false } to delete the component
 *
 * Examples:
 * - Add component: { "uuid-123/Position": { _exists: true, x: 0, y: 0 } }
 * - Update component: { "uuid-123/Position": { x: 10 } }
 * - Delete component: { "uuid-123/Position": { _exists: false } }
 * - Update singleton: { "4294967295/Camera": { zoom: 1.5 } }
 * - Multiple changes: { "uuid-123/Position": { x: 10 }, "uuid-456/Velocity": { _exists: false } }
 */
export type Patch = Record<string, ComponentData>

/**
 * A mutation wraps a patch with an origin tag.
 * The origin indicates which system produced the mutation,
 * allowing adapters (e.g. HistoryAdapter) to selectively
 * process mutations (e.g. only undo changes with origin 'ecs').
 */
export interface Mutation {
  patch: Patch
  origin: Origin
  syncBehavior: SyncBehavior
}

/**
 * Stable ID used for singleton mutation keys.
 * Singleton keys follow the format: "SINGLETON/<singletonName>"
 */
export const SINGLETON_STABLE_ID = 'SINGLETON'

/**
 * Create a merge key for a component
 */
export function componentKey(entityId: EntityId, componentName: string): string {
  return `${entityId}/${componentName}`
}

// --- Client requests ---

/** Sent by a client to apply mutations. May contain document and/or ephemeral patches. */
export interface PatchRequest {
  type: 'patch'
  messageId: string
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
}

/** Sent by a client to catch up after a disconnect. */
export interface ReconnectRequest {
  type: 'reconnect'
  lastTimestamp: number
  protocolVersion: number
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
}

/**
 * Sent by a client to replace the auth token on a live connection.
 *
 * The connection is established with `?token=…` in the URL, but tokens are
 * short-lived; sending this lets the client refresh its credential without
 * dropping the socket. The server is expected to re-verify the token and
 * update the session's permissions accordingly. No ack is required — if the
 * new token is invalid the server may close the socket.
 */
export interface AuthRefreshRequest {
  type: 'auth-refresh'
  token: string
}

export type ClientMessage = PatchRequest | ReconnectRequest | AuthRefreshRequest

// --- Server responses ---

/** Sent back to the sender to confirm a patch was applied. */
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
  /** Document high-water mark; present iff `documentPatches` is. */
  timestamp?: number
}

/** Sent to all clients when the connected client count changes. */
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
 * Sent by the server when it detects, on reconnect, that this client has seen a
 * higher timestamp than the server currently holds — i.e. the server lost ops
 * (e.g. it crashed and reloaded a throttled snapshot). The client replies with a
 * normal `patch` containing everything it has after `since`, healing the gap.
 */
export interface ResyncRequest {
  type: 'resync'
  /** The restored server's current timestamp (T_s). Client sends ops after this. */
  since: number
}

/**
 * Sent right after the reconnect response, once the server has delivered our
 * document state — always, even for an empty room. Lets us tell "still loading"
 * apart from "genuinely empty". See {@link CanvasStore.isSynced}.
 */
export interface SyncedResponse {
  type: 'synced'
  timestamp: number
}

export type ServerMessage =
  | AckResponse
  | PatchBroadcast
  | ClientCountBroadcast
  | VersionMismatchResponse
  | ResyncRequest
  | SyncedResponse

/** Per-field modification timestamps for a single component key. Mirrors the server. */
export type FieldTimestamps = Record<string, number>
