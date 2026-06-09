/**
 * Server-side handling for sparse buffer-field deltas.
 *
 * Clients may send a buffer field (e.g. a pen stroke's flat point array) as a
 * {@link BufferDelta} encoding only the changed runs instead of the whole array.
 * The room materializes these back into full arrays when applying patches, so
 * stored state, snapshots, and reconnect diffs always carry whole arrays — the
 * delta is purely a wire optimization. The encoder lives client-side
 * (`@woven-ecs/canvas-store`); the server only needs to detect and apply.
 */

/** A run of consecutive values to overwrite, starting at `offset`. */
export type BufferRun = [offset: number, values: number[]]

/** Sparse delta for a numeric buffer field. Mirrors the client encoding. */
export interface BufferDelta {
  __buf: 1
  len: number
  runs: BufferRun[]
}

/** Type guard: is this field value an encoded buffer delta (vs. a full array)? */
export function isBufferDelta(value: unknown): value is BufferDelta {
  return typeof value === 'object' && value !== null && (value as { __buf?: unknown }).__buf === 1
}

/**
 * Materialize a delta against a base buffer, returning a new `number[]`.
 * Indices beyond the base default to 0 before runs are applied.
 */
export function applyBufferDelta(base: ArrayLike<number> | undefined, delta: BufferDelta): number[] {
  const out = new Array<number>(delta.len)
  const carry = base ? Math.min(base.length, delta.len) : 0
  for (let i = 0; i < carry; i++) out[i] = base![i]
  for (let i = carry; i < delta.len; i++) out[i] = 0
  for (const [offset, values] of delta.runs) {
    for (let j = 0; j < values.length; j++) {
      const idx = offset + j
      if (idx >= 0 && idx < delta.len) out[idx] = values[j]
    }
  }
  return out
}

/**
 * Merge patch `value` fields into a full-state `base`, materializing any buffer
 * deltas against the base's current arrays. Returns a new object; `base` is not
 * mutated.
 */
export function materializeFields(
  base: Record<string, unknown> | undefined,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = base ? { ...base } : {}
  for (const field in value) {
    const v = value[field]
    if (isBufferDelta(v)) {
      out[field] = applyBufferDelta(base?.[field] as ArrayLike<number> | undefined, v)
    } else {
      out[field] = v
    }
  }
  return out
}
