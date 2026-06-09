import type { EntityId } from '@woven-ecs/core'
import { encodeBufferDelta } from './bufferDelta'
import { type ComponentData, componentKey, type Patch } from './types'
import { isEqual } from './utils'

/**
 * Compare two component snapshots and return the changed fields.
 * Returns null if there are no changes.
 *
 * Fields named in `bufferFields` are diffed element-wise and emitted as a sparse
 * {@link encodeBufferDelta} (or a full array when a delta wouldn't save space)
 * instead of always re-sending the whole array.
 */
export function diffFields(
  prev: ComponentData,
  next: ComponentData,
  bufferFields?: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (prev._exists === false && next._exists === false) return null
  if (prev._exists === false) return next
  if (next._exists === false) return null

  const changes: Record<string, unknown> = {}
  let hasChanges = false

  for (const key in next) {
    // Skip internal _exists flag when diffing
    if (key === '_exists') continue

    const prevValue = prev[key]
    const nextValue = next[key]

    if (bufferFields?.has(key) && Array.isArray(nextValue)) {
      const delta = encodeBufferDelta(
        Array.isArray(prevValue) ? (prevValue as number[]) : undefined,
        nextValue as number[],
      )
      if (delta !== null) {
        changes[key] = delta
        hasChanges = true
      }
      continue
    }

    if (!isEqual(prevValue, nextValue)) {
      changes[key] = nextValue
      hasChanges = true
    }
  }

  return hasChanges ? changes : null
}

/**
 * Generate a merge mutation from a component diff.
 * Returns null if there are no changes.
 *
 * @param prev - Previous component state ({ _exists: false } if didn't exist)
 * @param next - Current component state ({ _exists: false } if deleted)
 * @param entityId - Stable entity ID
 * @param componentName - Component name
 */
export function diffComponent(
  prev: ComponentData,
  next: ComponentData,
  entityId: EntityId,
  componentName: string,
): Patch | null {
  const key = componentKey(entityId, componentName)

  // Deleted
  if (next._exists === false && prev._exists !== false) {
    return { [key]: { _exists: false } }
  }

  // Added - include _exists: true and all fields
  if (prev._exists === false && next._exists !== false) {
    return { [key]: { _exists: true, ...next } as ComponentData }
  }

  // Both deleted - no op
  if (prev._exists === false && next._exists === false) {
    return null
  }

  // Changed - compute diff (partial update, no _exists)
  const changes = diffFields(prev, next)
  if (changes === null) return null

  return { [key]: changes as ComponentData }
}
