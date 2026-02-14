import { describe, expect, it } from 'vitest'
import { merge, strip, subtract } from '../src/mutations'
import type { Patch } from '../src/types'

describe('merge', () => {
  it('returns empty patch for no input', () => {
    expect(merge()).toEqual({})
  })

  it('returns a copy of a single patch', () => {
    const patch: Patch = { 'e1/Position': { x: 10 } }
    const result = merge(patch)
    expect(result).toEqual({ 'e1/Position': { x: 10 } })
    // Ensure it's a copy, not the same reference
    expect(result['e1/Position']).not.toBe(patch['e1/Position'])
  })

  it('merges fields from same key across patches', () => {
    expect(merge({ 'e1/Position': { x: 10 } }, { 'e1/Position': { y: 20 } })).toEqual({
      'e1/Position': { x: 10, y: 20 },
    })
  })

  it('later values override earlier ones for same field', () => {
    expect(merge({ 'e1/Position': { x: 10 } }, { 'e1/Position': { x: 50 } })).toEqual({
      'e1/Position': { x: 50 },
    })
  })

  it('deletion overrides existing data', () => {
    expect(merge({ 'e1/Position': { x: 10 } }, { 'e1/Position': { _exists: false } })).toEqual({
      'e1/Position': { _exists: false },
    })
  })

  it('new data replaces a deletion', () => {
    expect(merge({ 'e1/Position': { _exists: false } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e1/Position': { x: 10 },
    })
  })

  it('merges different keys independently', () => {
    expect(merge({ 'e1/Position': { x: 10 } }, { 'e2/Velocity': { vx: 5 } })).toEqual({
      'e1/Position': { x: 10 },
      'e2/Velocity': { vx: 5 },
    })
  })

  it('handles multiple patches', () => {
    expect(merge({ 'e1/Position': { x: 10 } }, { 'e1/Position': { y: 20 } }, { 'e1/Position': { z: 30 } })).toEqual({
      'e1/Position': { x: 10, y: 20, z: 30 },
    })
  })

  it('handles _exists flag merge', () => {
    expect(merge({ 'e1/Position': { _exists: true, x: 0, y: 0 } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e1/Position': { _exists: true, x: 10, y: 0 },
    })
  })

  it('handles complex multi-key multi-patch merge', () => {
    expect(
      merge(
        { 'e1/Pos': { x: 1 }, 'e2/Pos': { x: 2 } },
        { 'e1/Pos': { y: 10 }, 'e3/Vel': { vx: 5 } },
        { 'e2/Pos': { _exists: false } },
      ),
    ).toEqual({
      'e1/Pos': { x: 1, y: 10 },
      'e2/Pos': { _exists: false },
      'e3/Vel': { vx: 5 },
    })
  })
})

describe('subtract', () => {
  it('returns empty patch when a and b are identical', () => {
    const patch: Patch = { 'e1/Position': { x: 10, y: 20 } }
    expect(subtract(patch, patch)).toEqual({})
  })

  it('returns a fields that differ from b', () => {
    expect(subtract({ 'e1/Position': { x: 10, y: 20 } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e1/Position': { y: 20 },
    })
  })

  it('keeps keys in a that are not in b', () => {
    expect(subtract({ 'e1/Position': { x: 10 }, 'e2/Velocity': { vx: 5 } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e2/Velocity': { vx: 5 },
    })
  })

  it('keeps deletion in a if b does not have deletion', () => {
    expect(subtract({ 'e1/Position': { _exists: false } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e1/Position': { _exists: false },
    })
  })

  it('removes redundant deletions (both deleted)', () => {
    expect(subtract({ 'e1/Position': { _exists: false } }, { 'e1/Position': { _exists: false } })).toEqual({})
  })

  it('keeps all of a data when b has deletion for same key', () => {
    expect(subtract({ 'e1/Position': { x: 10, y: 20 } }, { 'e1/Position': { _exists: false } })).toEqual({
      'e1/Position': { x: 10, y: 20 },
    })
  })

  it('keeps all of a data when b has no matching key', () => {
    expect(subtract({ 'e1/Position': { x: 10 } }, { 'e2/Velocity': { vx: 5 } })).toEqual({
      'e1/Position': { x: 10 },
    })
  })

  it('returns empty patch when all fields are redundant', () => {
    expect(subtract({ 'e1/Position': { x: 10, y: 20 } }, { 'e1/Position': { x: 10, y: 20 } })).toEqual({})
  })

  it('handles nested value comparisons (arrays)', () => {
    expect(
      subtract({ 'e1/Shape': { pos: [10, 20], size: [50, 50] } }, { 'e1/Shape': { pos: [10, 20], size: [100, 100] } }),
    ).toEqual({
      'e1/Shape': { size: [50, 50] },
    })
  })

  it('keeps deletion when key is absent from b', () => {
    expect(subtract({ 'e1/Position': { _exists: false } }, {})).toEqual({
      'e1/Position': { _exists: false },
    })
  })
})

describe('strip', () => {
  it('returns empty patch when all fields overlap', () => {
    expect(strip({ 'e1/Position': { x: 5 } }, { 'e1/Position': { x: 10 } })).toEqual({})
  })

  it('keeps fields not present in mask', () => {
    expect(strip({ 'e1/Position': { x: 5, y: 20 } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e1/Position': { y: 20 },
    })
  })

  it('keeps keys not present in mask', () => {
    expect(strip({ 'e1/Position': { x: 5 }, 'e2/Velocity': { vx: 3 } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e2/Velocity': { vx: 3 },
    })
  })

  it('keeps deletion even when mask has the key', () => {
    expect(strip({ 'e1/Position': { _exists: false } }, { 'e1/Position': { x: 10 } })).toEqual({
      'e1/Position': { _exists: false },
    })
  })

  it('strips data when mask has deletion for the key', () => {
    expect(strip({ 'e1/Position': { x: 5 } }, { 'e1/Position': { _exists: false } })).toEqual({})
  })

  it('keeps deletion even when mask also deletes', () => {
    expect(strip({ 'e1/Position': { _exists: false } }, { 'e1/Position': { _exists: false } })).toEqual({
      'e1/Position': { _exists: false },
    })
  })

  it('returns patch as-is when mask is empty', () => {
    expect(strip({ 'e1/Position': { x: 5 } }, {})).toEqual({
      'e1/Position': { x: 5 },
    })
  })

  it('returns empty patch when input is empty', () => {
    expect(strip({}, { 'e1/Position': { x: 10 } })).toEqual({})
  })
})
