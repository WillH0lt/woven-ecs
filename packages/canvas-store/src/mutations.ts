import type { ComponentData, Patch } from './types'
import { isEqual } from './utils'

/**
 * Merge multiple mutations into a single mutation.
 * Later mutations override earlier ones for the same key.
 * For component data, fields are merged (later values override earlier).
 *
 * Create-then-delete sequences are detected and removed as no-ops:
 * if an entity is created (_exists: true) and later deleted (_exists: false)
 * within the same merge, the key is removed entirely.
 *
 * @example
 * merge(
 *   { "e1/Position": { x: 10 } },
 *   { "e1/Position": { y: 20 } }
 * )
 * // Returns: { "e1/Position": { x: 10, y: 20 } }
 *
 * @example
 * merge(
 *   { "e1/Position": { x: 10 } },
 *   { "e1/Position": { _exists: false } }
 * )
 * // Returns: { "e1/Position": { _exists: false } }
 *
 * @example
 * merge(
 *   { "e1/Position": { _exists: true, x: 10 } },
 *   { "e1/Position": { _exists: false } }
 * )
 * // Returns: {} (create-then-delete is a no-op)
 */
export function merge(...mutations: Patch[]): Patch {
  const result: Patch = {}
  const createdWithin = new Set<string>()

  for (const mutation of mutations) {
    for (const [key, value] of Object.entries(mutation)) {
      const existing = result[key]

      if (value._exists === false) {
        // Deletion
        if (createdWithin.has(key)) {
          // Entity was created and now deleted within this merge - remove as no-op
          delete result[key]
          createdWithin.delete(key)
        } else {
          result[key] = { _exists: false }
        }
      } else if (existing === undefined || existing._exists === false) {
        // New value or replacing a deletion
        if (existing === undefined && value._exists === true) {
          // Track that this entity was created within this merge
          createdWithin.add(key)
        }
        result[key] = { ...value }
      } else {
        // Merge component data fields
        result[key] = { ...existing, ...value }
      }
    }
  }

  return result
}

/**
 * Subtract mutation `b` from mutation `a`, removing redundant updates.
 * Returns a new mutation containing only the changes in `a` that differ from `b`.
 *
 * Use case: When comparing local changes against already-synced state,
 * subtract removes fields that have already been applied.
 *
 * @example
 * subtract(
 *   { "e1/Position": { x: 10, y: 20 } },
 *   { "e1/Position": { x: 10 } }
 * )
 * // Returns: { "e1/Position": { y: 20 } }
 *
 * @example
 * subtract(
 *   { "e1/Position": { x: 10 }, "e2/Velocity": { vx: 5 } },
 *   { "e1/Position": { x: 10 } }
 * )
 * // Returns: { "e2/Velocity": { vx: 5 } }
 */
export function subtract(a: Patch, b: Patch): Patch {
  const result: Patch = {}

  for (const [key, aValue] of Object.entries(a)) {
    const bValue = b[key]

    if (aValue._exists === false) {
      // Deletion in a
      if (bValue === undefined || bValue._exists !== false) {
        // b doesn't have the deletion, keep it
        result[key] = { _exists: false }
      }
      // If b also has deletion, it's redundant - skip
      continue
    }

    if (bValue === undefined || bValue._exists === false) {
      // a has data but b doesn't or b deletes - keep all of a's data
      result[key] = { ...aValue }
      continue
    }

    // Both have component data - compare fields
    const diff = subtractComponentData(aValue, bValue)
    if (diff !== null) {
      result[key] = diff
    }
  }

  return result
}

/**
 * Strip keys and fields from patch `a` that are present in `mask`.
 * Unlike subtract (which compares values), strip removes by key existence.
 *
 * @example
 * strip(
 *   { "e1/Position": { x: 5, y: 20 } },
 *   { "e1/Position": { x: 10 } }
 * )
 * // Returns: { "e1/Position": { y: 20 } }
 *
 * @example
 * strip(
 *   { "e1/Position": { _exists: false } },
 *   { "e1/Position": { x: 10 } }
 * )
 * // Returns: { "e1/Position": { _exists: false } }  (deletions always pass through)
 */
export function strip(a: Patch, mask: Patch): Patch {
  if (Object.keys(mask).length === 0) return a

  const result: Patch = {}

  for (const [key, aValue] of Object.entries(a)) {
    const maskValue = mask[key]

    if (maskValue === undefined) {
      // Key not in mask — keep as-is
      result[key] = aValue
      continue
    }

    if (aValue._exists === false) {
      // Deletions always pass through — a delete can never be masked
      result[key] = aValue
      continue
    }

    if (maskValue._exists === false) {
      // Mask is a deletion — drop the key
      continue
    }

    // Both are component data — keep only fields not in mask
    const kept: ComponentData = {}
    let hasFields = false
    for (const [field, fieldVal] of Object.entries(aValue)) {
      if (!(field in maskValue)) {
        kept[field] = fieldVal
        hasFields = true
      }
    }
    if (hasFields) {
      result[key] = kept
    }
  }

  return result
}

/**
 * Subtract component data b from a, returning only differing fields.
 * Returns null if all fields are redundant (equal).
 */
function subtractComponentData(a: ComponentData, b: ComponentData): ComponentData | null {
  const result: ComponentData = {}
  let hasChanges = false

  for (const [field, aFieldValue] of Object.entries(a)) {
    const bFieldValue = b[field]

    if (!isEqual(aFieldValue, bFieldValue)) {
      result[field] = aFieldValue
      hasChanges = true
    }
  }

  return hasChanges ? result : null
}
