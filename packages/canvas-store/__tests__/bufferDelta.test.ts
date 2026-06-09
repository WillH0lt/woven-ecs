import { describe, expect, it } from 'vitest'
import {
  applyBufferDelta,
  type BufferDelta,
  composeBufferDeltas,
  encodeBufferDelta,
  isBufferDelta,
  materializeFields,
  mergeBufferValue,
} from '../src/bufferDelta'
import { diffFields } from '../src/diff'
import { merge } from '../src/mutations'

describe('isBufferDelta', () => {
  it('detects deltas and rejects plain values', () => {
    expect(isBufferDelta({ __buf: 1, len: 0, runs: [] })).toBe(true)
    expect(isBufferDelta([1, 2, 3])).toBe(false)
    expect(isBufferDelta(null)).toBe(false)
    expect(isBufferDelta({ x: 1 })).toBe(false)
    expect(isBufferDelta(5)).toBe(false)
  })
})

describe('encodeBufferDelta', () => {
  it('returns null when nothing changed', () => {
    expect(encodeBufferDelta([1, 2, 3], [1, 2, 3])).toBe(null)
  })

  it('encodes a pure append as a single tail run', () => {
    const prev = [0, 1, 2, 3, 4, 5, 6, 7]
    const d = encodeBufferDelta(prev, [...prev, 8, 9]) as BufferDelta
    expect(isBufferDelta(d)).toBe(true)
    expect(d.len).toBe(10)
    expect(d.runs).toEqual([[8, [8, 9]]])
  })

  it('encodes a changed tail (sliding point) as one run', () => {
    const d = encodeBufferDelta([0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 9, 8]) as BufferDelta
    expect(d.len).toBe(8)
    expect(d.runs).toEqual([[6, [9, 8]]])
  })

  it('encodes disjoint changes as multiple runs', () => {
    const prev = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const next = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3]
    const d = encodeBufferDelta(prev, next) as BufferDelta
    expect(d.runs).toEqual([
      [0, [1]],
      [10, [2, 3]],
    ])
  })

  it('falls back to a full array when the change is large', () => {
    const next = [9, 9, 9, 9, 9]
    const result = encodeBufferDelta([0, 0, 0, 0, 0], next)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual(next)
    expect(result).not.toBe(next) // copied
  })

  it('treats an undefined prev as an append from empty', () => {
    const d = encodeBufferDelta(undefined, [5, 6]) as BufferDelta | number[]
    // Whole array changed from empty → full replace is chosen.
    expect(d).toEqual([5, 6])
  })

  it('encodes truncation via a shorter len', () => {
    const d = encodeBufferDelta([1, 2, 3, 4], [1, 2]) as BufferDelta
    expect(d.len).toBe(2)
    expect(d.runs).toEqual([])
  })
})

describe('applyBufferDelta', () => {
  it('applies an append onto a base', () => {
    expect(applyBufferDelta([1, 2], { __buf: 1, len: 4, runs: [[2, [3, 4]]] })).toEqual([1, 2, 3, 4])
  })

  it('only uses the base prefix when the base is longer than len (fixed capacity)', () => {
    // Simulates a 512-capacity typed array with 2 logical points.
    const capacity = new Float32Array([1, 2, 0, 0, 0, 0])
    expect(applyBufferDelta(capacity, { __buf: 1, len: 4, runs: [[2, [3, 4]]] })).toEqual([1, 2, 3, 4])
  })

  it('zero-fills grown indices not covered by runs', () => {
    expect(applyBufferDelta([1], { __buf: 1, len: 3, runs: [[2, [9]]] })).toEqual([1, 0, 9])
  })

  it('truncates when len is shorter than the base', () => {
    expect(applyBufferDelta([1, 2, 3, 4], { __buf: 1, len: 2, runs: [] })).toEqual([1, 2])
  })
})

describe('composeBufferDeltas', () => {
  it('composes two sequential appends', () => {
    const a: BufferDelta = { __buf: 1, len: 3, runs: [[2, [3]]] }
    const b: BufferDelta = { __buf: 1, len: 4, runs: [[3, [4]]] }
    const composed = composeBufferDeltas(a, b)
    // Applying the composition to the shared base must equal a-then-b.
    expect(applyBufferDelta([1, 2], composed)).toEqual([1, 2, 3, 4])
  })

  it('lets the later delta win on overlapping indices', () => {
    const a: BufferDelta = { __buf: 1, len: 3, runs: [[2, [3]]] } // append index 2 = 3
    const b: BufferDelta = { __buf: 1, len: 3, runs: [[2, [9]]] } // overwrite index 2 = 9
    const composed = composeBufferDeltas(a, b)
    expect(applyBufferDelta([1, 2], composed)).toEqual([1, 2, 9])
  })

  it('drops indices past the later deltaʼs truncated length', () => {
    const a: BufferDelta = { __buf: 1, len: 4, runs: [[2, [3, 4]]] }
    const b: BufferDelta = { __buf: 1, len: 2, runs: [] }
    const composed = composeBufferDeltas(a, b)
    expect(composed.len).toBe(2)
    expect(applyBufferDelta([1, 2], composed)).toEqual([1, 2])
  })
})

describe('mergeBufferValue', () => {
  it('lets a full array replace anything', () => {
    expect(mergeBufferValue({ __buf: 1, len: 1, runs: [[0, [5]]] }, [7, 8])).toEqual([7, 8])
  })

  it('materializes a delta onto an existing full array', () => {
    expect(mergeBufferValue([1, 2], { __buf: 1, len: 3, runs: [[2, [3]]] })).toEqual([1, 2, 3])
  })

  it('composes a delta onto an existing delta', () => {
    const existing: BufferDelta = { __buf: 1, len: 3, runs: [[2, [3]]] }
    const incoming: BufferDelta = { __buf: 1, len: 4, runs: [[3, [4]]] }
    const result = mergeBufferValue(existing, incoming) as BufferDelta
    expect(isBufferDelta(result)).toBe(true)
    expect(applyBufferDelta([1, 2], result)).toEqual([1, 2, 3, 4])
  })

  it('keeps a delta as-is when there is no existing value', () => {
    const incoming: BufferDelta = { __buf: 1, len: 2, runs: [[0, [1, 2]]] }
    expect(mergeBufferValue(undefined, incoming)).toBe(incoming)
  })
})

describe('encode → apply roundtrip', () => {
  it('reconstructs next from prev for a simulated stroke', () => {
    let prev: number[] = []
    let materialized: number[] = []
    // Grow a stroke point-by-point, occasionally rewriting the tail (slide).
    const frames: number[][] = [
      [0, 0],
      [0, 0, 1, 1],
      [0, 0, 1, 1, 2, 2],
      [0, 0, 1, 1, 2, 2, 3, 3], // append
      [0, 0, 1, 1, 2, 2, 9, 9], // slide tail
      [0, 0, 1, 1, 2, 2, 9, 9, 4, 4], // append
    ]
    for (const next of frames) {
      const encoded = encodeBufferDelta(prev, next)
      if (encoded === null) {
        // unchanged — materialized already equals next
      } else if (isBufferDelta(encoded)) {
        materialized = applyBufferDelta(prev, encoded)
      } else {
        materialized = encoded
      }
      expect(materialized).toEqual(next)
      prev = next
    }
  })
})

describe('diffFields with buffer fields', () => {
  it('emits a delta for a registered buffer field but a full value otherwise', () => {
    const base = [0, 1, 2, 3, 4, 5, 6, 7]
    const prev = { _exists: true, points: base, pointCount: 4 }
    const next = { _exists: true, points: [...base, 8, 9], pointCount: 5 }
    const changes = diffFields(prev, next, new Set(['points']))
    expect(changes).not.toBeNull()
    expect(isBufferDelta(changes!.points)).toBe(true)
    expect(changes!.pointCount).toBe(5)
  })

  it('diffs the buffer field as a whole array when not registered', () => {
    const prev = { _exists: true, points: [1, 2] }
    const next = { _exists: true, points: [1, 2, 3, 4] }
    const changes = diffFields(prev, next)
    expect(changes).toEqual({ points: [1, 2, 3, 4] })
  })
})

describe('merge composes buffer deltas', () => {
  it('collapses an add + delta into a materialized full array', () => {
    const add = { 'e1/PenStroke': { _exists: true, points: [0, 0], pointCount: 1 } }
    const delta = { 'e1/PenStroke': { points: { __buf: 1, len: 4, runs: [[2, [1, 1]]] }, pointCount: 2 } }
    const merged = merge(add, delta)
    expect(merged['e1/PenStroke']).toEqual({ _exists: true, points: [0, 0, 1, 1], pointCount: 2 })
  })

  it('composes two deltas into one delta', () => {
    const d1 = { 'e1/PenStroke': { points: { __buf: 1, len: 4, runs: [[2, [1, 1]]] } } }
    const d2 = { 'e1/PenStroke': { points: { __buf: 1, len: 6, runs: [[4, [2, 2]]] } } }
    const merged = merge(d1, d2)
    const points = merged['e1/PenStroke'].points
    expect(isBufferDelta(points)).toBe(true)
    expect(applyBufferDelta([9, 9], points as BufferDelta)).toEqual([9, 9, 1, 1, 2, 2])
  })
})

describe('materializeFields (state stores full arrays)', () => {
  it('applies a delta onto stored full state', () => {
    const state = { _exists: true, points: [0, 0], pointCount: 1 }
    const next = materializeFields(state, { points: { __buf: 1, len: 4, runs: [[2, [5, 6]]] }, pointCount: 2 })
    expect(next).toEqual({ _exists: true, points: [0, 0, 5, 6], pointCount: 2 })
  })

  it('passes non-buffer fields through unchanged', () => {
    const next = materializeFields({ x: 1 }, { y: 2 })
    expect(next).toEqual({ x: 1, y: 2 })
  })
})
