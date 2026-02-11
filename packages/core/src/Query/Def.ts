import type { Context } from '../types'
import { buildQuery, QueryBuilder } from './Builder'
import { QueryInstance } from './Instance'
import type { QueryMasks } from './Masks'
import type { QueryOptions } from './types'

/**
 * Query descriptor that can be reused across multiple Worlds.
 * Created via defineQuery(). Lazily creates per-context Query instances.
 */
export class QueryDef {
  private readonly builder: (q: QueryBuilder) => QueryBuilder

  private instances: Record<string, QueryInstance> = {}

  readonly id: string

  private static queryCounter = 0

  /**
   * @internal
   */
  constructor(builder: (q: QueryBuilder) => QueryBuilder) {
    this.builder = builder
    this.id = `query_${QueryDef.queryCounter++}`
  }

  private getName(ctx: Context): string {
    return `${this.id}_${ctx.readerId}`
  }

  /**
   * Get or create the Query instance for a context
   * @internal
   */
  _getInstance(ctx: Context): QueryInstance {
    const name = this.getName(ctx)

    // Check if already created for this context
    let query = this.instances[name]
    if (query) {
      return query
    }

    // Build masks with component IDs from context
    const masks = this._getMasks(ctx)

    // Create the Query instance
    query = new QueryInstance(ctx, masks)

    // Store in context for reuse
    this.instances[name] = query

    return query
  }

  /**
   * Get query masks without creating a Query instance
   * @internal
   */
  _getMasks(ctx: Context): QueryMasks {
    const queryBuilder = new QueryBuilder(ctx.componentCount, ctx)
    const configuredBuilder = this.builder(queryBuilder)
    return configuredBuilder[buildQuery]()
  }

  /**
   * Get the current matching entities.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs matching the query criteria
   */
  current(ctx: Context, options?: QueryOptions): Uint32Array | number[] {
    return this._getInstance(ctx).current(ctx, options)
  }

  /**
   * Get entities that were added since the last check.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs that were added
   */
  added(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).added(ctx, options)
  }

  /**
   * Get entities that were removed since the last check.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs that were removed
   */
  removed(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).removed(ctx, options)
  }

  /**
   * Get entities whose tracked components have changed.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs with changed tracked components
   */
  changed(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).changed(ctx, options)
  }

  /**
   * Get entities that were added or changed since the last check.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs that were added or changed
   */
  addedOrChanged(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).addedOrChanged(ctx, options)
  }

  /**
   * Get entities that were added or removed since the last check.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs that were added or removed
   */
  addedOrRemoved(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).addedOrRemoved(ctx, options)
  }

  /**
   * Get entities that were removed or changed since the last check.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs that were removed or changed
   */
  removedOrChanged(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).removedOrChanged(ctx, options)
  }

  /**
   * Get entities that were added, changed, or removed since the last check.
   *
   * @param ctx - The context object
   * @param options - Optional query options to control behavior
   * @returns An array of entity IDs that were added, changed, or removed
   */
  addedOrChangedOrRemoved(ctx: Context, options?: QueryOptions): number[] {
    return this._getInstance(ctx).addedOrChangedOrRemoved(ctx, options)
  }
}

/**
 * Define a query that lazily connects to or creates a query cache on first use.
 * This allows defining queries at module scope before the context is available.
 *
 * @param builder - Function that configures the query using with/without/any methods on QueryBuilder
 * @param options - Optional configuration for default query behavior
 * @returns A QueryDef object with current(ctx), added(ctx), removed(ctx), changed(ctx) methods
 *
 * @example
 * import { setupWorker, defineQuery, type Context } from "@woven-ecs/core";
 * import { Position, Velocity } from "./components";
 *
 * setupWorker(execute);
 *
 * // Define query at module scope
 * const movingEntities = defineQuery((q) => q.with(Position, Velocity));
 *
 * // Define query with singleton tracking
 * const singletonQuery = defineQuery((q) => q.tracking(Singleton));
 *
 * function execute(ctx: Context) {
 *   // Query lazily initializes on first call to current()
 *   for (const eid of movingEntities.current(ctx)) {
 *     const pos = Position.read(ctx, eid);
 *     console.log(`Entity ${eid} Position: (${pos.x}, ${pos.y})`);
 *   }
 * }
 */
export function defineQuery(builder: (q: QueryBuilder) => QueryBuilder): QueryDef {
  return new QueryDef(builder)
}
