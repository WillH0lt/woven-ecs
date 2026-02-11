import type { EntityId } from '@woven-ecs/core'
import { describe, expect, it } from 'vitest'
import { diffComponent, diffFields } from '../src/diff'

describe('diffFields', () => {
  it('returns null when both are deleted', () => {
    expect(diffFields({ _exists: false }, { _exists: false })).toBe(null)
  })

  it('returns next when prev is deleted', () => {
    const next = { x: 10, y: 20 }
    expect(diffFields({ _exists: false }, next)).toEqual(next)
  })

  it('returns null when next is deleted', () => {
    expect(diffFields({ x: 10 }, { _exists: false })).toBe(null)
  })

  it('returns null when no fields changed', () => {
    const data = { x: 10, y: 20 }
    expect(diffFields(data, { ...data })).toBe(null)
  })

  it('returns changed fields only', () => {
    const prev = { x: 10, y: 20, z: 30 }
    const next = { x: 10, y: 25, z: 30 }
    expect(diffFields(prev, next)).toEqual({ y: 25 })
  })

  it('returns multiple changed fields', () => {
    const prev = { x: 10, y: 20 }
    const next = { x: 15, y: 25 }
    expect(diffFields(prev, next)).toEqual({ x: 15, y: 25 })
  })

  it('skips _exists flag when diffing', () => {
    const prev = { x: 10 }
    const next = { _exists: true as const, x: 10 }
    expect(diffFields(prev, next)).toBe(null)
  })

  it('detects changes in nested arrays', () => {
    const prev = { position: [0, 0] }
    const next = { position: [10, 20] }
    expect(diffFields(prev, next)).toEqual({ position: [10, 20] })
  })

  it('returns null when nested arrays are equal', () => {
    const prev = { position: [10, 20] }
    const next = { position: [10, 20] }
    expect(diffFields(prev, next)).toBe(null)
  })

  it('handles new fields in next', () => {
    const prev = { x: 10 }
    const next = { x: 10, y: 20 }
    expect(diffFields(prev, next)).toEqual({ y: 20 })
  })
})

describe('diffComponent', () => {
  const entityId = 'uuid-123' as unknown as EntityId
  const componentName = 'Position'

  it('returns deletion patch when next is deleted and prev exists', () => {
    const prev = { x: 10, y: 20 }
    expect(diffComponent(prev, { _exists: false }, entityId, componentName)).toEqual({
      'uuid-123/Position': { _exists: false },
    })
  })

  it('returns addition patch with _exists when prev is deleted', () => {
    const next = { x: 10, y: 20 }
    expect(diffComponent({ _exists: false }, next, entityId, componentName)).toEqual({
      'uuid-123/Position': { _exists: true, x: 10, y: 20 },
    })
  })

  it('returns null when both are deleted', () => {
    expect(diffComponent({ _exists: false }, { _exists: false }, entityId, componentName)).toBe(null)
  })

  it('returns null when no fields changed', () => {
    const data = { x: 10, y: 20 }
    expect(diffComponent(data, { ...data }, entityId, componentName)).toBe(null)
  })

  it('returns partial update patch when fields changed', () => {
    const prev = { x: 10, y: 20 }
    const next = { x: 10, y: 30 }
    expect(diffComponent(prev, next, entityId, componentName)).toEqual({
      'uuid-123/Position': { y: 30 },
    })
  })

  it('uses correct key format with entityId/componentName', () => {
    const prev = { value: 1 }
    const next = { value: 2 }
    const result = diffComponent(prev, next, 'abc-456' as unknown as EntityId, 'Health')
    expect(result).toEqual({
      'abc-456/Health': { value: 2 },
    })
  })
})
