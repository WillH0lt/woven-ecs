import type { ComponentDef } from '../Component'
import type { ComponentSchema } from '../Component/types'
import { EventType } from '../EventBuffer'
import type { Context } from '../types'
import { buildQuery, QueryBuilder } from './Builder'
import { QueryCache } from './Cache'
import type { QueryMasks } from './Masks'

/**
 * A simplified query that only supports current().
 * Skips added/removed/changed tracking for better performance.
 * Uses a smart update strategy: processes events if few, rebuilds from EntityBuffer if many.
 *
 * @internal - Not exported from the package
 */
class CurrentQueryInstance {
  private cache: QueryCache
  private lastIndex: number = 0
  private masks: QueryMasks

  constructor(ctx: Context, masks: QueryMasks) {
    this.masks = masks
    this.cache = new QueryCache(ctx.maxEntities)
  }

  /**
   * Get all matching entities.
   * Uses smart update strategy based on event count vs cache size.
   */
  current(ctx: Context): Uint32Array {
    const currentIndex = ctx.currEventIndex ?? ctx.eventBuffer.getWriteIndex()

    // Already up to date
    if (currentIndex === this.lastIndex) {
      return this.cache.getDenseView()
    }

    const eventCount = currentIndex - this.lastIndex
    const cacheCount = this.cache.count
    const maxEvents = ctx.maxEvents

    // Check for overflow - must rebuild
    const overflow = eventCount > maxEvents

    // Choose the cheaper path:
    // - If overflow or cache is empty, rebuild from EntityBuffer
    // - If events < current cache size, process events incrementally
    // - Otherwise, rebuild from EntityBuffer
    if (overflow || cacheCount === 0 || eventCount >= cacheCount) {
      this.rebuildFromEntityBuffer(ctx)
    } else {
      this.processEvents(ctx, currentIndex)
    }

    this.lastIndex = currentIndex
    return this.cache.getDenseView()
  }

  /**
   * Rebuild cache by scanning EntityBuffer.
   * O(maxEntities) but simple and cache-friendly.
   */
  private rebuildFromEntityBuffer(ctx: Context): void {
    const entityBuffer = ctx.entityBuffer
    const maxEntities = ctx.maxEntities
    const masks = this.masks
    const cache = this.cache

    cache.clear()

    for (let entityId = 0; entityId < maxEntities; entityId++) {
      if (entityBuffer.has(entityId) && entityBuffer.matches(entityId, masks)) {
        cache.add(entityId)
      }
    }
  }

  /**
   * Process events incrementally to update cache.
   * O(events) - faster when few events since last call.
   */
  private processEvents(ctx: Context, currentIndex: number): void {
    const maxEvents = ctx.maxEvents
    const entityBuffer = ctx.entityBuffer
    const dataView = ctx.eventBuffer.getDataView()
    const masks = this.masks
    const cache = this.cache

    const fromIndex = this.lastIndex
    const fromSlot = fromIndex % maxEvents
    const toSlot = currentIndex % maxEvents

    const eventsToScan = toSlot >= fromSlot ? toSlot - fromSlot : maxEvents - fromSlot + toSlot

    for (let i = 0; i < eventsToScan; i++) {
      const slot = (fromSlot + i) % maxEvents
      const dataIndex = slot * 2

      const entityId = Atomics.load(dataView, dataIndex)
      const packedData = Atomics.load(dataView, dataIndex + 1)
      const eventType = packedData & 0xff

      if (eventType === EventType.REMOVED) {
        cache.remove(entityId)
      } else if (
        eventType === EventType.ADDED ||
        eventType === EventType.COMPONENT_ADDED ||
        eventType === EventType.COMPONENT_REMOVED
      ) {
        const stillExists = entityBuffer.has(entityId)
        const matchesNow = stillExists && entityBuffer.matches(entityId, masks)
        const wasInCache = cache.has(entityId)

        if (matchesNow && !wasInCache) {
          cache.add(entityId)
        } else if (!matchesNow && wasInCache) {
          cache.remove(entityId)
        }
      }
      // CHANGED events don't affect cache membership
    }
  }
}

/**
 * Definition for a current-only query.
 * Lazily creates per-context instances.
 *
 * @internal - Not exported from the package
 */
export class CurrentQueryDef {
  private readonly builder: (q: QueryBuilder) => QueryBuilder
  private instances: Record<string, CurrentQueryInstance> = {}

  private static queryCounter = 0
  readonly id: string

  constructor(builder: (q: QueryBuilder) => QueryBuilder) {
    this.builder = builder
    this.id = `current_query_${CurrentQueryDef.queryCounter++}`
  }

  private getName(ctx: Context): string {
    return `${this.id}_${ctx.readerId}`
  }

  private _getInstance(ctx: Context): CurrentQueryInstance {
    const name = this.getName(ctx)

    let instance = this.instances[name]
    if (instance) {
      return instance
    }

    const queryBuilder = new QueryBuilder(ctx.componentCount, ctx)
    const configuredBuilder = this.builder(queryBuilder)
    const masks = configuredBuilder[buildQuery]()

    instance = new CurrentQueryInstance(ctx, masks)
    this.instances[name] = instance

    return instance
  }

  /**
   * Get the current matching entities.
   */
  current(ctx: Context): Uint32Array {
    return this._getInstance(ctx).current(ctx)
  }
}

/**
 * Define a current-only query.
 * Only supports current() - no added/removed/changed tracking.
 * Uses smart update strategy for better performance.
 *
 * @internal - Not exported from the package. Used internally by getBackrefs.
 */
export function defineCurrentQuery(builder: (q: QueryBuilder) => QueryBuilder): CurrentQueryDef {
  return new CurrentQueryDef(builder)
}

/**
 * Create a current-only query for a specific component.
 * Caches the query definition per component.
 *
 * @internal
 */
const componentCurrentQueries = new Map<number, CurrentQueryDef>()

export function getComponentCurrentQuery<T extends ComponentSchema>(componentDef: ComponentDef<T>): CurrentQueryDef {
  const defId = componentDef._defId

  let query = componentCurrentQueries.get(defId)
  if (!query) {
    query = defineCurrentQuery((q) => q.with(componentDef))
    componentCurrentQueries.set(defId, query)
  }

  return query
}
