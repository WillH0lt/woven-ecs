import type { Context } from '@woven-ecs/core'
import type { Adapter } from './Adapter'
import { EcsAdapter } from './adapters/ECS'
import { HistoryAdapter } from './adapters/History'
import { PersistenceAdapter } from './adapters/Persistence'
import { WebsocketAdapter } from './adapters/Websocket'
import type { AnyCanvasComponentDef } from './CanvasComponentDef'
import type { AnyCanvasSingletonDef } from './CanvasSingletonDef'
import type { Mutation } from './types'

export interface CanvasStoreInitOptions {
  components: AnyCanvasComponentDef[]
  singletons: AnyCanvasSingletonDef[]
}

export interface PersistenceOptions {
  documentId: string
}

export interface HistoryOptions {
  /** Number of quiet frames before committing pending changes to history. Default: 60 */
  commitCheckpointAfterFrames?: number
  /** Maximum number of undo steps to keep in history. Default: 100 */
  maxHistoryStackSize?: number
}

export interface WebsocketOptions {
  documentId: string
  url: string
  clientId: string
  startOffline?: boolean
  token?: string
  onVersionMismatch?: (serverProtocolVersion: number) => void
  onConnectivityChange?: (isOnline: boolean) => void
}

/**
 * Options for CanvasStore
 */
export interface CanvasStoreOptions {
  persistence?: PersistenceOptions
  /** Pass `true` to enable with defaults, or an object to customize options */
  history?: HistoryOptions | true
  websocket?: WebsocketOptions
}

/**
 * Generic mutation router between adapters.
 *
 * Each frame:
 * 1. Pulls mutations from every adapter
 * 2. Pushes the full list to every adapter (including the adapter's own)
 *
 * Every adapter sees the same mutations in the same order, guaranteeing
 * state convergence.  Each adapter is responsible for skipping its own
 * side-effects (e.g. ECS won't re-write to the world, WS won't re-send
 * to the server) while still updating internal state to match.
 */
export class CanvasStore {
  private ecsAdapter!: EcsAdapter
  private historyAdapter: HistoryAdapter | null = null
  private websocketAdapter: WebsocketAdapter | null = null
  private persistenceAdapter: PersistenceAdapter | null = null
  private adapters: Adapter[] = []
  private options: CanvasStoreOptions

  constructor(options: CanvasStoreOptions) {
    this.options = options
  }

  async initialize({ components, singletons }: CanvasStoreInitOptions): Promise<void> {
    this.ecsAdapter = new EcsAdapter({
      components,
      singletons,
    })
    this.adapters.push(this.ecsAdapter)

    if (this.options.persistence) {
      this.persistenceAdapter = new PersistenceAdapter({
        documentId: this.options.persistence.documentId,
        components,
        singletons,
      })
      this.adapters.push(this.persistenceAdapter)
    }

    if (this.options.history) {
      const historyOpts = this.options.history === true ? {} : this.options.history
      this.historyAdapter = new HistoryAdapter({
        components,
        singletons,
        commitCheckpointAfterFrames: historyOpts.commitCheckpointAfterFrames,
        maxHistoryStackSize: historyOpts.maxHistoryStackSize,
      })
      this.adapters.push(this.historyAdapter)
    }

    if (this.options.websocket) {
      this.websocketAdapter = new WebsocketAdapter({
        documentId: this.options.websocket.documentId,
        url: this.options.websocket.url,
        clientId: this.options.websocket.clientId,
        startOffline: this.options.websocket.startOffline,
        token: this.options.websocket.token,
        usePersistence: !!this.options.persistence,
        onVersionMismatch: this.options.websocket.onVersionMismatch,
        onConnectivityChange: this.options.websocket.onConnectivityChange,
        components,
        singletons,
      })
      this.adapters.push(this.websocketAdapter)
    }

    await Promise.all(this.adapters.map((adapter) => adapter.init()))
  }

  /**
   * Synchronize mutations across all adapters.
   * Call this every frame or tick.
   */
  sync(ctx: Context): void {
    // Set the ECS context for this frame
    this.ecsAdapter.ctx = ctx

    // Phase 1: Pull mutations from each adapter
    const allMutations: Mutation[] = []
    for (const adapter of this.adapters) {
      allMutations.push(...adapter.pull())
    }

    // Phase 2: Push the same list to every adapter
    for (const adapter of this.adapters) {
      adapter.push(allMutations)
    }
  }

  undo(): boolean {
    return this.historyAdapter?.undo() ?? false
  }

  redo(): boolean {
    return this.historyAdapter?.redo() ?? false
  }

  canUndo(): boolean {
    return this.historyAdapter?.canUndo() ?? false
  }

  canRedo(): boolean {
    return this.historyAdapter?.canRedo() ?? false
  }

  /**
   * Create a checkpoint at the current position in history.
   * Use with revertToCheckpoint() to discard changes or squashToCheckpoint()
   * to combine all changes since into a single undo step.
   */
  createCheckpoint(): string | null {
    return this.historyAdapter?.createCheckpoint() ?? null
  }

  /**
   * Revert all changes since the checkpoint and discard them.
   */
  revertToCheckpoint(checkpointId: string): boolean {
    return this.historyAdapter?.revertToCheckpoint(checkpointId) ?? false
  }

  /**
   * Squash all changes since the checkpoint into a single undo step.
   */
  squashToCheckpoint(checkpointId: string): boolean {
    return this.historyAdapter?.squashToCheckpoint(checkpointId) ?? false
  }

  /**
   * Register a callback to be called after N consecutive frames with no ECS mutations.
   * Useful for waiting for state to settle before performing operations like squash.
   */
  onSettled(callback: () => void, options: { frames: number }): void {
    this.historyAdapter?.onSettled(callback, options)
  }

  /**
   * Connect the websocket (or reconnect if it was previously connected).
   */
  async connect(): Promise<void> {
    if (!this.websocketAdapter) return
    await this.websocketAdapter.reconnect()
  }

  /**
   * Disconnect the websocket while keeping all other adapters running.
   */
  disconnect(): void {
    if (!this.websocketAdapter) return
    this.websocketAdapter.disconnect()
  }

  /**
   * Close all adapters and clean up.
   */
  close(): void {
    for (const adapter of this.adapters) {
      adapter.close()
    }
  }
}
