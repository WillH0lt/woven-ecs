import type { ComponentDef, SingletonDef } from '../Component'
import type { ComponentSchema } from '../Component/types'
import type { Context } from '../types'
import { QueryMasks } from './Masks'

/**
 * Symbol for building query masks.
 * Hidden from users to keep the QueryBuilder API clean.
 */
export const buildQuery = Symbol('buildQuery')

function createEmptyMask(bytes: number): Uint8Array {
  return new Uint8Array(bytes)
}

/** Set a component bit in a bitmask (8 components per byte) */
function setComponentBit(mask: Uint8Array, componentId: number): void {
  const byteIndex = Math.floor(componentId / 8)
  const bitIndex = componentId % 8

  if (byteIndex < mask.length) {
    mask[byteIndex] |= 1 << bitIndex
  }
}

/** Query builder for constructing component filters using bitmask operations */
export class QueryBuilder {
  private withMask: Uint8Array
  private withoutMask: Uint8Array
  private anyMask: Uint8Array
  private trackingMask: Uint8Array
  private ctx: Context

  constructor(componentCount: number, ctx: Context) {
    const bytes = Math.ceil(componentCount / 8)

    this.withMask = createEmptyMask(bytes)
    this.withoutMask = createEmptyMask(bytes)
    this.anyMask = createEmptyMask(bytes)
    this.trackingMask = createEmptyMask(bytes)
    this.ctx = ctx
  }

  /**
   * Get the component ID from the context for a given ComponentDef or SingletonDef
   */
  private _getComponentId(componentDef: ComponentDef<ComponentSchema> | SingletonDef<ComponentSchema>): number {
    const component = this.ctx.components[componentDef._defId]
    if (!component) {
      throw new Error(`Component "${componentDef.constructor.name}" is not registered with this World.`)
    }
    return component.componentId
  }

  /**
   * Require entities to have ALL specified components.
   * Entities must have every component in the list to match the query.
   *
   * @param componentDefs - Component definitions that must all be present
   * @returns This builder for method chaining
   *
   * @example
   * ```typescript
   * import { defineQuery } from '@woven-ecs/core';
   * import { Position, Velocity } from './components';
   *
   * // Match entities that have both Position AND Velocity
   * const movingEntities = defineQuery((q) => q.with(Position, Velocity));
   * ```
   */
  with(...componentDefs: ComponentDef<any>[]): this {
    for (const componentDef of componentDefs) {
      setComponentBit(this.withMask, this._getComponentId(componentDef))
    }
    return this
  }

  /**
   * Require entities to NOT have any specified components.
   * Entities must have NONE of the listed components to match the query.
   *
   * @param componentDefs - Component definitions that must not be present
   * @returns This builder for method chaining
   *
   * @example
   * ```typescript
   * import { defineQuery } from '@woven-ecs/core';
   * import { Position, Dead } from './components';
   *
   * // Match entities that have Position but NOT Dead
   * const aliveEntities = defineQuery((q) => q.with(Position).without(Dead));
   * ```
   */
  without(...componentDefs: ComponentDef<any>[]): this {
    for (const componentDef of componentDefs) {
      setComponentBit(this.withoutMask, this._getComponentId(componentDef))
    }
    return this
  }

  /**
   * Require entities to have AT LEAST ONE specified component.
   * Entities must have one or more of the listed components to match the query.
   *
   * @param componentDefs - Component definitions where at least one must be present
   * @returns This builder for method chaining
   *
   * @example
   * ```typescript
   * import { defineQuery } from '@woven-ecs/core';
   * import { Player, Enemy, NPC } from './components';
   *
   * // Match entities that are Player OR Enemy OR NPC
   * const characters = defineQuery((q) => q.any(Player, Enemy, NPC));
   * ```
   */
  any(...componentDefs: ComponentDef<any>[]): this {
    for (const componentDef of componentDefs) {
      setComponentBit(this.anyMask, this._getComponentId(componentDef))
    }
    return this
  }

  /**
   * Require entities to have specified components AND track changes to them.
   * Combines the functionality of with() and change tracking.
   * When a tracked component is modified, the entity appears in query.changed().
   *
   * @param componentDefs - Component/singleton definitions to require and track
   * @returns This builder for method chaining
   *
   * @example
   * ```typescript
   * import { defineQuery } from '@woven-ecs/core';
   * import { Position, Velocity } from './components';
   *
   * // Match entities with Position (required) and track Velocity changes
   * const query = defineQuery((q) => q.with(Position).tracking(Velocity));
   *
   * function mySystem(ctx: Context) {
   *   // Entities with changed Velocity component
   *   for (const eid of query.changed(ctx)) {
   *     console.log('Velocity changed for entity', eid);
   *   }
   * }
   * ```
   */
  tracking(...componentDefs: (ComponentDef<any> | SingletonDef<any>)[]): this {
    for (const componentDef of componentDefs) {
      const componentId = this._getComponentId(componentDef)
      setComponentBit(this.withMask, componentId)
      setComponentBit(this.trackingMask, componentId)
    }
    return this
  }

  /**
   * Build query masks
   * @internal
   */
  [buildQuery](): QueryMasks {
    // Pre-compute whether masks have non-zero values for fast-path skipping
    const hasTracking = !this.trackingMask.every((byte) => byte === 0)
    const hasWith = !this.withMask.every((byte) => byte === 0)
    const hasWithout = !this.withoutMask.every((byte) => byte === 0)
    const hasAny = !this.anyMask.every((byte) => byte === 0)

    return new QueryMasks(
      this.trackingMask,
      this.withMask,
      this.withoutMask,
      this.anyMask,
      hasTracking,
      hasWith,
      hasWithout,
      hasAny,
    )
  }
}
