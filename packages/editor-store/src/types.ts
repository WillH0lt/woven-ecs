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
 * Returned by `EditorComponentDef.snapshot()` and `EditorSingletonDef.snapshot()`.
 */
export type InferEditorComponentType<T extends ComponentSchema> = InferComponentType<T> & {
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

export type ClientMessage = PatchRequest | ReconnectRequest

// --- Server responses ---

/** Sent back to the sender to confirm a patch was applied. */
export interface AckResponse {
  type: 'ack'
  messageId: string
  timestamp: number
}

/** Sent to other clients when state changes. May contain document and/or ephemeral patches. */
export interface PatchBroadcast {
  type: 'patch'
  documentPatches?: Patch[]
  ephemeralPatches?: Patch[]
  clientId: string
  timestamp: number
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

export type ServerMessage = AckResponse | PatchBroadcast | ClientCountBroadcast | VersionMismatchResponse
