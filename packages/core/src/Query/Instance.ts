import { SINGLETON_ENTITY_ID } from '../Component'
import type { Context } from '../types'
import { QueryCache } from './Cache'
import type { QueryMasks } from './Masks'
import { QueryReader } from './Reader'
import type { QueryOptions } from './types'

const EMPTY_NUMBER_ARRAY: number[] = []

/** Per-context query instance with cached matching entities */
export class QueryInstance {
  readonly masks: QueryMasks
  readonly cache: QueryCache | null = null
  private reader: QueryReader
  private readonly isSingletonQuery: boolean

  /**
   * @internal - Use QueryDef._getInstance(ctx) instead
   */
  constructor(ctx: Context, masks: QueryMasks) {
    this.masks = masks

    this.isSingletonQuery = masks.usesSingleton(ctx)

    if (!this.isSingletonQuery) {
      this.cache = new QueryCache(ctx.maxEntities)
    }

    this.reader = new QueryReader(0)
  }

  /** Get all matching entities (partitioned based on options or context) */
  current(ctx: Context, options?: QueryOptions): Uint32Array | number[] {
    if (this.isSingletonQuery) {
      return [SINGLETON_ENTITY_ID]
    }

    this.reader.updateCache(ctx, this.cache!, this.masks)
    const allEntities = this.cache!.getDenseView()

    if (options?.partitioned) {
      return this.partitionEntities(allEntities, ctx.threadIndex, ctx.threadCount)
    }

    return allEntities
  }

  /** Get entities added since last check (partitioned based on options or context) */
  added(ctx: Context, options?: QueryOptions): number[] {
    if (this.isSingletonQuery) {
      return EMPTY_NUMBER_ARRAY
    }

    this.reader.updateCache(ctx, this.cache!, this.masks)
    const result = this.reader.added

    if (options?.partitioned) {
      return this.partitionEntities(result, ctx.threadIndex, ctx.threadCount)
    }

    return result
  }

  /** Get entities removed since last check */
  removed(ctx: Context, options?: QueryOptions): number[] {
    if (this.isSingletonQuery) {
      return EMPTY_NUMBER_ARRAY
    }

    this.reader.updateCache(ctx, this.cache!, this.masks)
    const result = this.reader.removed

    if (options?.partitioned) {
      return this.partitionEntities(result, ctx.threadIndex, ctx.threadCount)
    }
    return result
  }

  /** Get entities with tracked component changes since last check */
  changed(ctx: Context, options?: QueryOptions): number[] {
    if (this.isSingletonQuery) {
      this.reader.updateSingletonChanged(ctx, this.masks)
      return this.reader.changed
    }

    this.reader.updateCache(ctx, this.cache!, this.masks)
    const result = this.reader.changed

    if (options?.partitioned) {
      return this.partitionEntities(result, ctx.threadIndex, ctx.threadCount)
    }

    return result
  }

  /** Get entities added or changed since last check */
  addedOrChanged(ctx: Context, options?: QueryOptions): number[] {
    return [...this.added(ctx, options), ...this.changed(ctx, options)]
  }

  /** Get entities added or removed since last check */
  addedOrRemoved(ctx: Context, options?: QueryOptions): number[] {
    return [...this.added(ctx, options), ...this.removed(ctx, options)]
  }

  /** Get entities removed or changed since last check */
  removedOrChanged(ctx: Context, options?: QueryOptions): number[] {
    return [...this.removed(ctx, options), ...this.changed(ctx, options)]
  }

  /** Get entities added, removed, or changed since last check */
  addedOrChangedOrRemoved(ctx: Context, options?: QueryOptions): number[] {
    return [...this.added(ctx, options), ...this.removed(ctx, options), ...this.changed(ctx, options)]
  }

  private partitionEntities(entities: Uint32Array | number[], threadIndex: number, threadCount: number): number[] {
    if (entities.length === 0 || threadCount <= 1) {
      return entities as number[]
    }

    const result: number[] = []
    for (let i = 0; i < entities.length; i++) {
      if (entities[i] % threadCount === threadIndex) {
        result.push(entities[i])
      }
    }
    return result.length > 0 ? result : EMPTY_NUMBER_ARRAY
  }
}
