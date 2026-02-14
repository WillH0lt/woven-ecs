import type { Mutation } from './types'

/**
 * Adapter interface for syncing mutations.
 * Adapters handle sending local mutations to and receiving mutations
 * from external systems (IndexedDB, WebSocket, etc).
 */
export interface Adapter {
  /**
   * Initialize the adapter (e.g. open connections, load persisted state).
   */
  init(): Promise<void>

  /**
   * Push local mutations through this adapter.
   */
  push(mutations: Mutation[]): void

  /**
   * Pull and return any received mutations.
   * Returns an empty array if none pending.
   */
  pull(): Mutation[]

  /**
   * Close the adapter and clean up resources.
   */
  close(): void
}
