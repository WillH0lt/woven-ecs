/**
 * Sparse deltas for numeric buffer fields.
 *
 * Buffer fields (e.g. a pen stroke's flat point array) can be large, and most
 * updates change only a small contiguous region — typically appending to or
 * rewriting the tail. Sending the whole array on every change is O(N) per frame
 * and O(N²) over the life of a stroke.
 *
 * A {@link BufferDelta} encodes just the changed runs plus the resulting length,
 * so the wire cost is proportional to what actually changed. Deltas are a
 * transport/coalescing optimization only: every place that *stores* state
 * (server room state, IndexedDB persistence, history) materializes them back
 * into full arrays, so snapshots and reconnect diffs stay whole and old
 * documents keep loading unchanged.
 *
 * On the wire a buffer field value is therefore either a plain `number[]`
 * (full replace) or a `BufferDelta` object, distinguished by the `__buf`
 * sentinel.
 */

/** A run of consecutive values to overwrite, starting at `offset`. */
export type BufferRun = [offset: number, values: number[]]

/**
 * Sparse delta for a numeric buffer field.
 *
 * - `len` — the resulting logical length (captures growth and truncation).
 * - `runs` — contiguous regions whose values changed, applied in order.
 */
export interface BufferDelta {
  /** Sentinel/version tag used to detect a delta on the wire. */
  __buf: 1
  len: number
  runs: BufferRun[]
}

/** Type guard: is this field value an encoded buffer delta (vs. a full array)? */
export function isBufferDelta(value: unknown): value is BufferDelta {
  return typeof value === 'object' && value !== null && (value as { __buf?: unknown }).__buf === 1
}

/**
 * Encode the change from `prev` → `next`.
 *
 * Returns `null` when nothing changed, a `BufferDelta` when a sparse encoding is
 * smaller, or the full `next` array (copied) when the change is large enough that
 * a delta wouldn't save space.
 */
export function encodeBufferDelta(
  prev: ArrayLike<number> | undefined,
  next: ArrayLike<number>,
): BufferDelta | number[] | null {
  const prevLen = prev ? prev.length : 0
  const nextLen = next.length

  const runs: BufferRun[] = []
  let changed = 0
  let i = 0
  while (i < nextLen) {
    const differs = i >= prevLen || prev![i] !== next[i]
    if (!differs) {
      i++
      continue
    }
    const start = i
    const values: number[] = []
    while (i < nextLen && (i >= prevLen || prev![i] !== next[i])) {
      values.push(next[i])
      i++
    }
    runs.push([start, values])
    changed += values.length
  }

  // No element changed and the length is unchanged → nothing to send.
  if (runs.length === 0 && nextLen === prevLen) return null

  // If the delta would cover most of the array, a full replace is smaller and
  // simpler (roughly two numbers of framing overhead per run, plus `len`).
  const deltaCost = changed + runs.length * 2 + 1
  if (deltaCost >= nextLen) return toArray(next)

  return { __buf: 1, len: nextLen, runs }
}

/**
 * Materialize a delta against a base buffer, returning a new `number[]`.
 *
 * `base` may be longer than `delta.len` (e.g. a fixed-capacity typed array); only
 * its prefix is used. Indices beyond the base default to 0 before runs are applied.
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
 * Compose two deltas that are both relative to the same base: applying the result
 * to that base equals applying `a` then `b`. `b` wins on overlapping indices and
 * `b.len` is the final length (indices from `a` past it are dropped).
 *
 * This is sound for append-style edits because an append always carries values
 * for every index it grows into, so the composed runs never leave a hole.
 */
export function composeBufferDeltas(a: BufferDelta, b: BufferDelta): BufferDelta {
  const sparse = new Map<number, number>()
  const absorb = (d: BufferDelta): void => {
    for (const [offset, values] of d.runs) {
      for (let j = 0; j < values.length; j++) {
        const idx = offset + j
        if (idx < b.len) sparse.set(idx, values[j])
      }
    }
  }
  absorb(a)
  absorb(b)

  const indices = Array.from(sparse.keys()).sort((x, y) => x - y)
  const runs: BufferRun[] = []
  let k = 0
  while (k < indices.length) {
    const start = indices[k]
    const values: number[] = [sparse.get(start)!]
    let prevIdx = start
    k++
    while (k < indices.length && indices[k] === prevIdx + 1) {
      values.push(sparse.get(indices[k])!)
      prevIdx = indices[k]
      k++
    }
    runs.push([start, values])
  }

  return { __buf: 1, len: b.len, runs }
}

/**
 * Combine an existing buffer field value with an `incoming` one when coalescing
 * patches that have *not* yet been applied to a base (e.g. in a send buffer).
 * Either side may be a full array or a delta.
 */
export function mergeBufferValue(existing: unknown, incoming: BufferDelta | number[]): BufferDelta | number[] {
  // A full array replaces whatever came before.
  if (Array.isArray(incoming)) return incoming
  // `incoming` is a delta:
  if (Array.isArray(existing)) return applyBufferDelta(existing as number[], incoming)
  if (isBufferDelta(existing)) return composeBufferDeltas(existing, incoming)
  return incoming
}

/**
 * Merge patch `value` fields into a full-state `base` object, materializing any
 * buffer deltas against the base's current full arrays. Returns a new object;
 * `base` is not mutated. Used by every state-storing layer (server room state,
 * persistence, history).
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

function toArray(values: ArrayLike<number>): number[] {
  const out = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) out[i] = values[i]
  return out
}
