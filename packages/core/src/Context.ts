import type { ComponentDef } from './Component'
import { readRef } from './Component/fields/ref'
import type { ComponentSchema, InferComponentInput } from './Component/types'
import { getComponentCurrentQuery } from './Query/CurrentQuery'
import type { Context, EntityId } from './types'

/**
 * Create a new entity
 * @param ctx - The context
 * @returns Newly created entity ID
 * @throws Error if entity pool exhausted
 * @example
 * ```typescript
 * const entityId = createEntity(ctx);
 * ```
 */
export function createEntity(ctx: Context): EntityId {
  const entityId = ctx.pool.get()

  ctx.entityBuffer.create(entityId)
  ctx.eventBuffer.pushAdded(entityId)

  return entityId
}

/**
 * Get entities that reference a target entity via a ref field.
 * Useful for finding "children" or related entities.
 * @param ctx - The context
 * @param targetEntity - Entity being referenced
 * @param componentDef - Component containing the ref field
 * @param fieldName - Name of the ref field
 * @param checkExistence - If false, skips the existence check (but still validates generation).
 *                         Useful for finding refs to recently deleted entities.
 * @returns Array of entity IDs that reference the target
 * @example
 * ```typescript
 * const Child = defineComponent("Child", {
 *   parent: field.ref(),
 * });
 *
 * const childrenIds = getBackrefs(ctx, parentId, Child, "parent");
 * ```
 */
export function getBackrefs<T extends ComponentSchema>(
  ctx: Context,
  targetEntity: EntityId,
  componentDef: ComponentDef<T>,
  fieldName: keyof T & string,
  checkExistence = true,
): EntityId[] {
  const component = componentDef._getInstance(ctx)
  const query = getComponentCurrentQuery(componentDef)
  const buffer = component.buffer[fieldName] as Uint32Array

  const results: EntityId[] = []

  // Iterate only entities with this component (cached query)
  for (const eid of query.current(ctx)) {
    const refValue = readRef(buffer[eid], ctx.entityBuffer, checkExistence)
    if (refValue === targetEntity) {
      results.push(eid)
    }
  }

  return results
}

/**
 * Remove an entity.
 * The entity is marked as dead but component data is preserved until ID reclamation.
 * This allows .removed() queries to read component data from recently deleted entities.
 * Refs use lazy validation - refs to deleted entities are nullified on read.
 * @param ctx - The context
 * @param entityId - Entity ID to remove
 * @example
 * ```typescript
 * removeEntity(ctx, entityId);
 * ```
 */
export function removeEntity(ctx: Context, entityId: EntityId): void {
  if (!ctx.entityBuffer.has(entityId)) {
    return
  }

  ctx.eventBuffer.pushRemoved(entityId)

  // Mark entity as dead but preserve component data
  // The ID will be reclaimed later
  ctx.entityBuffer.markDead(entityId)
}

/**
 * Add a component to an entity
 * @param ctx - The context
 * @param entityId - Entity ID
 * @param component - Component to add
 * @param data - Optional initial component data
 * @param checkExistence - Whether to check if the entity exists before adding
 * @throws Error if entity doesn't exist (when checkExistence is true)
 * @example
 * ```typescript
 *   addComponent(ctx, entityId, Position, { x: 0, y: 0 });
 * ```
 */
export function addComponent<T extends ComponentSchema>(
  ctx: Context,
  entityId: EntityId,
  componentDef: ComponentDef<T>,
  data: Partial<InferComponentInput<T>> = {} as any,
  checkExistence = true,
): void {
  if (checkExistence && !ctx.entityBuffer.has(entityId)) {
    throw new Error(`Entity with ID ${entityId} does not exist.`)
  }

  const component = componentDef._getInstance(ctx)

  if (ctx.entityBuffer.hasComponent(entityId, component.componentId)) {
    throw new Error(
      `Entity ${entityId} already has component. Use removeComponent() first or update the existing component.`,
    )
  }

  ctx.entityBuffer.addComponentToEntity(entityId, component.componentId)
  ctx.eventBuffer.pushComponentAdded(entityId, component.componentId)
  component.copy(entityId, data as any)
}

/**
 * Remove a component from an entity
 * @param ctx - The context
 * @param entityId - Entity ID
 * @param component - Component to remove
 * @param checkExistence - Whether to check if the entity exists before removing
 * @throws Error if entity doesn't exist (when checkExistence is true)
 * @example
 * ```typescript
 * removeComponent(ctx, entityId, Position);
 * ```
 */
export function removeComponent<T extends ComponentSchema>(
  ctx: Context,
  entityId: EntityId,
  componentDef: ComponentDef<T>,
  checkExistence = true,
): void {
  if (checkExistence && !ctx.entityBuffer.has(entityId)) {
    throw new Error(`Entity with ID ${entityId} does not exist.`)
  }

  const component = componentDef._getInstance(ctx)
  ctx.entityBuffer.removeComponentFromEntity(entityId, component.componentId)
  ctx.eventBuffer.pushComponentRemoved(entityId, component.componentId)
}

/**
 * Check if an entity has a component
 * @param ctx - The context
 * @param entityId - Entity ID to check
 * @param component - Component to check for
 * @param checkExistence - Whether to check if the entity exists
 * @returns True if entity has the component
 * @throws Error if entity doesn't exist (when checkExistence is true)
 * @example
 * ```typescript
 * if (hasComponent(ctx, entityId, Position)) {
 *   // Entity has Position
 * }
 * ```
 */
export function hasComponent<T extends ComponentSchema>(
  ctx: Context,
  entityId: EntityId,
  componentDef: ComponentDef<T>,
  checkExistence = true,
): boolean {
  if (checkExistence && !ctx.entityBuffer.has(entityId)) {
    throw new Error(`Entity with ID ${entityId} does not exist.`)
  }

  const component = componentDef._getInstance(ctx)
  return ctx.entityBuffer.hasComponent(entityId, component.componentId)
}

/**
 * Get typed resources from the context.
 * Resources are user-defined data passed to the World constructor.
 * @typeParam R - The expected resources type
 * @param ctx - The context
 * @returns The resources cast to type R
 * @example
 * ```typescript
 * interface Resources {
 *   maxParticles: number;
 *   debugMode: boolean;
 * }
 *
 * const world = new World([Position], {
 *   resources: { maxParticles: 1000, debugMode: true }
 * });
 *
 * const mySystem = defineSystem((ctx) => {
 *   const resources = getResources<Resources>(ctx);
 *   console.log(resources.maxParticles); // 1000
 * });
 * ```
 */
export function getResources<R>(ctx: Context): R {
  return ctx.resources as R
}

/**
 * Check if an entity is alive (not removed)
 * @param ctx - The context
 * @param entityId - Entity ID to check
 * @returns True if the entity is alive
 * @example
 * ```typescript
 * if (isAlive(ctx, entityId)) {
 *   // Entity is alive
 * }
 * ```
 */
export function isAlive(ctx: Context, entityId: EntityId): boolean {
  return ctx.entityBuffer.has(entityId)
}

/**
 * Advance the context to the next frame for testing purposes.
 * Updates prevEventIndex and currEventIndex so queries process new events.
 * @param ctx - The context to advance
 * @example
 * ```typescript
 * createEntity(ctx);
 * nextFrame(ctx);  // Query will now see the new entity in added()
 * const added = myQuery.added(ctx);
 * ```
 */
export function nextFrame(ctx: Context): void {
  const currentWriteIndex = ctx.eventBuffer.getWriteIndex()
  // prevEventIndex marks where the previous frame ended (start of current range)
  // currEventIndex marks where the current frame ends (end of current range)
  ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex
  ctx.currEventIndex = currentWriteIndex
}
