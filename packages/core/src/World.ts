import { Component, type ComponentDef, type SingletonDef } from './Component'
import { EntityBuffer } from './EntityBuffer'
import { EventBuffer, EventType } from './EventBuffer'
import { History } from './History'
import { Pool } from './Pool'
import type { QueryDef } from './Query'
import { BaseSystem, type System } from './System'
import type { Context, SystemFunction } from './types'
import { WorkerManager } from './WorkerManager'

/** Query subscription callback */
export type QuerySubscribeCallback = (
  ctx: Context,
  result: {
    added: number[]
    changed: number[]
    removed: number[]
  },
) => void

/** Internal subscriber state */
interface Subscriber {
  queryDef: QueryDef
  callback: QuerySubscribeCallback
  readerId: string
  prevEventIndex: number
}

const priorityOrder = { high: 2, medium: 1, low: 0 }

/** Callback for deferred execution */
export type NextSyncCallback = (ctx: Context) => void

export interface WorldOptions {
  /**
   * Number of worker threads to use for parallel execution
   * @default navigator.hardwareConcurrency
   */
  threads?: number
  /**
   * Maximum number of entities the world can contain
   * @default 10_000
   */
  maxEntities?: number
  /**
   * Maximum number of events in the event ring buffer
   * Should be large enough to hold all events between query reads
   * @default 131_072
   */
  maxEvents?: number
  /**
   * User-defined resources accessible from systems via getResources<T>(ctx).
   * Use this to share application state, configuration, or services.
   */
  resources?: unknown
}

/**
 * World manages entities, components, and systems.
 * Create one per independent simulation/game world.
 */
export class World {
  private static worldCounter = 0

  private componentIndex = 0
  private workerManager: WorkerManager
  private context: Context

  private readonly worldId: number
  private subscriberCounter = 0

  private subscribers: Subscriber[] = []
  private componentIdToDef: Map<number, ComponentDef<any> | SingletonDef<any>> = new Map()
  private nextSyncCallbacks: NextSyncCallback[] = []
  private prevSyncEventIndex = 0

  private history: History

  /**
   * Create a new world instance
   * @param componentDefs - Array of component and singleton definitions to register
   * @param options - Configuration options for the world
   * @example
   * ```typescript
   * import { Position, Velocity } from "./components";
   * import { Mouse, Time } from "./singletons";
   * const world = new World([Position, Velocity, Mouse, Time], {
   *   threads: 4,
   *   maxEntities: 50_000
   * });
   * ```
   */
  constructor(componentDefs: (ComponentDef<any> | SingletonDef<any>)[], options: WorldOptions = {}) {
    const threads =
      options.threads ?? (typeof navigator !== 'undefined' ? Math.max(1, navigator.hardwareConcurrency ?? 4) : 3)

    const maxEntities = options.maxEntities ?? 10_000
    const maxEvents = options.maxEvents ?? 131_072

    // Count the number of components
    const componentCount = componentDefs.length

    this.workerManager = new WorkerManager(threads)

    const eventBuffer = new EventBuffer(maxEvents)
    const entityBuffer = new EntityBuffer(maxEntities, componentCount)

    // Create Component instances from defs and initialize them
    const componentMap: Record<number, Component<any>> = {}
    for (const def of componentDefs) {
      const component = Component.fromDef(def)
      component.initialize(this.componentIndex++, maxEntities, eventBuffer, entityBuffer)
      componentMap[def._defId] = component
      this.componentIdToDef.set(this.componentIndex - 1, def)
    }

    this.worldId = World.worldCounter++
    this.history = new History(maxEvents)

    this.context = {
      entityBuffer,
      eventBuffer,
      components: componentMap,
      maxEntities,
      maxEvents,
      componentCount,
      pool: Pool.create(maxEntities),
      threadIndex: 0,
      threadCount: 1,
      readerId: `world_${this.worldId}`,
      prevEventIndex: 0,
      resources: options.resources,
    }
  }

  /**
   * Get the world context (for advanced usage only)
   * @returns The world context
   */
  _getContext(): Context {
    return this.context
  }

  /**
   * Execute one or more systems or functions in sequence.
   * Main thread systems and plain functions run synchronously (functions first, then systems). Worker systems run in parallel.
   * @param items - Systems or functions to execute
   * @example
   * ```typescript
   * await world.execute(movementSystem, renderSystem);
   * ```
   */
  async execute(...items: (System | SystemFunction)[]): Promise<void> {
    const ctx = this.context
    const currentEventIndex = ctx.eventBuffer.getWriteIndex()

    // Separate plain functions from systems
    const systems: System[] = []
    const functions: SystemFunction[] = []

    for (const item of items) {
      if (item instanceof BaseSystem) {
        systems.push(item)
      } else {
        functions.push(item)
      }
    }

    // Execute plain functions immediately on main thread
    for (const fn of functions) {
      fn({
        ...ctx,
        prevEventIndex: this.prevSyncEventIndex,
        currEventIndex: currentEventIndex,
      })
    }

    // if (systems.length === 0) return

    // Record execution for all systems
    for (const system of systems) {
      this.history.recordExecution(system.id, currentEventIndex)
    }

    const workerSystems = systems.filter((system) => system.type === 'worker')
    const mainThreadSystems = systems.filter((system) => system.type === 'main')

    const sortedWorkerSystems = [...workerSystems].sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority])

    const promises = sortedWorkerSystems.map((system) => this.workerManager.execute(system, ctx, currentEventIndex))

    for (const system of mainThreadSystems) {
      // Set readerId for this system's query instances
      const readerId = `world_${this.worldId}_system_${system.id}`
      const prevEventIndex = this.history.getPrevIndex(system.id)
      system.execute({
        ...ctx,
        readerId,
        prevEventIndex,
        currEventIndex: currentEventIndex,
      })
    }

    // Wait for all worker systems to complete
    await Promise.all(promises)

    // Reclaim entity IDs from REMOVED events that are old enough
    const watermark = this.history.calculateWatermark(currentEventIndex)
    if (watermark !== null) {
      this.reclaimRemovedEntityIds(this.history.getLastReclaimIndex(), watermark)
      this.history.markReclaimed(watermark)
    }
  }

  /**
   * Reclaim entity IDs from REMOVED events between fromIndex and toIndex
   */
  private reclaimRemovedEntityIds(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return
    }

    const ctx = this.context

    const { entities } = ctx.eventBuffer.collectEntitiesInRange(fromIndex, EventType.REMOVED, undefined, toIndex)

    for (const entityId of entities) {
      if (!ctx.entityBuffer.has(entityId)) {
        ctx.pool.free(entityId)
        ctx.entityBuffer.delete(entityId)
      }
    }
  }

  /**
   * Subscribe to world events for entities matching a query.
   * Callbacks are invoked when sync() is called.
   * @param queryDef - The query to filter events by
   * @param callback - Function called with { added, removed, changed } arrays
   * @returns Unsubscribe function
   * @example
   * ```typescript
   * const query = defineQuery((q) => q.with(Position).tracking(Velocity));
   * const unsubscribe = world.subscribe(query, (ctx, { added, removed, changed }) => {
   *   for (const entityId of added) {
   *     console.log(`Entity ${entityId} entered the query`);
   *   }
   *   for (const entityId of removed) {
   *     console.log(`Entity ${entityId} left the query`);
   *   }
   *   for (const entityId of changed) {
   *     console.log(`Entity ${entityId} had a tracked component change`);
   *   }
   * });
   *
   * // Later, to stop receiving events:
   * unsubscribe();
   * ```
   */
  subscribe(queryDef: QueryDef, callback: QuerySubscribeCallback): () => void {
    const ctx = this.context

    // Generate unique reader ID for this subscriber
    const subscriberId = this.subscriberCounter++
    const readerId = `world_${this.worldId}_subscriber_${subscriberId}`

    let subscriber: Subscriber

    // Eagerly initialize QueryInstance to start tracking from current write index
    queryDef._getInstance({
      ...ctx,
      readerId,
    })

    subscriber = {
      queryDef,
      callback: callback as QuerySubscribeCallback,
      readerId,
      prevEventIndex: ctx.eventBuffer.getWriteIndex(),
    }

    this.subscribers.push(subscriber)

    return () => {
      const index = this.subscribers.indexOf(subscriber)
      if (index !== -1) {
        this.subscribers.splice(index, 1)
      }
    }
  }

  /**
   * Execute deferred callbacks and notify subscribers of entity changes.
   * Executes world.subscribe() callbacks and world.nextSync() callbacks.
   * Usually called once per frame in the main loop.
   * @example
   * ```typescript
   * // in your game loop:
   * world.sync();
   * await world.execute(movementSystem, renderSystem);
   * ```
   */
  sync(): void {
    const currEventIndex = this.context.eventBuffer.getWriteIndex()

    if (this.nextSyncCallbacks.length > 0) {
      const callbacks = this.nextSyncCallbacks
      this.nextSyncCallbacks = []
      for (const callback of callbacks) {
        callback({
          ...this.context,
          prevEventIndex: this.prevSyncEventIndex,
          currEventIndex,
        })
      }

      this.prevSyncEventIndex = currEventIndex
    }

    if (this.subscribers.length === 0) {
      return
    }

    for (const subscriber of this.subscribers) {
      const ctx = {
        ...this.context,
        readerId: subscriber.readerId,
        prevEventIndex: subscriber.prevEventIndex,
        currEventIndex,
      }

      // Update subscriber's event index for next sync
      subscriber.prevEventIndex = currEventIndex

      const queryDef = subscriber.queryDef

      const results = {
        added: queryDef.added(ctx),
        removed: queryDef.removed(ctx),
        changed: queryDef.changed(ctx),
      }

      if (results.added.length === 0 && results.removed.length === 0 && results.changed.length === 0) {
        continue
      }

      subscriber.callback(ctx, results)
    }
  }

  /**
   * Schedule a callback to run at the next sync() call.
   * Use this to safely modify entities and components from outside the ECS execution context
   * (e.g., from UI event handlers, network callbacks, etc.).
   *
   * @param callback - Function to execute at the next sync, receives the context
   * @returns A cancel function that removes the callback from the queue
   * @example
   * ```typescript
   * // From a click handler in your UI:
   * function onClick(entityId: number) {
   *   const cancel = world.nextSync((ctx) => {
   *     const color = Color.write(ctx, entityId);
   *     color.red = 255;
   *   });
   *
   *   // If needed, cancel before sync runs:
   *   cancel();
   * }
   *
   * // In your game loop:
   * world.sync();  // Executes the callback
   * await world.execute(renderSystem);
   * ```
   */
  nextSync(callback: NextSyncCallback): () => void {
    this.nextSyncCallbacks.push(callback)
    return () => {
      const index = this.nextSyncCallbacks.indexOf(callback)
      if (index !== -1) {
        this.nextSyncCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Clean up world resources
   * Terminates all workers, clears subscribers, and resets internal state
   */
  dispose(): void {
    this.workerManager.dispose()
    this.subscribers = []
    this.nextSyncCallbacks = []
    this.componentIdToDef.clear()
    this.history.clear()

    // Note: SharedArrayBuffers (Pool, EntityBuffer, EventBuffer) are managed by garbage collection
    // and will be freed when no references remain
  }
}
