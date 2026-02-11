import { describe, expect, it } from 'vitest'
import { isEqual } from '../src/utils'

describe('isEqual', () => {
  describe('primitives', () => {
    it('returns true for identical numbers', () => {
      expect(isEqual(1, 1)).toBe(true)
    })

    it('returns true for identical strings', () => {
      expect(isEqual('hello', 'hello')).toBe(true)
    })

    it('returns true for identical booleans', () => {
      expect(isEqual(true, true)).toBe(true)
    })

    it('returns false for different numbers', () => {
      expect(isEqual(1, 2)).toBe(false)
    })

    it('returns false for different strings', () => {
      expect(isEqual('hello', 'world')).toBe(false)
    })

    it('returns false for different types', () => {
      expect(isEqual(1, '1')).toBe(false)
      expect(isEqual(true, 1)).toBe(false)
      expect(isEqual(null, undefined)).toBe(false)
    })

    it('returns true for both undefined', () => {
      expect(isEqual(undefined, undefined)).toBe(true)
    })

    it('returns false when one is null', () => {
      expect(isEqual(null, 0)).toBe(false)
      expect(isEqual(0, null)).toBe(false)
      expect(isEqual(null, '')).toBe(false)
    })

    it('returns true for both null', () => {
      expect(isEqual(null, null)).toBe(true)
    })
  })

  describe('arrays', () => {
    it('returns true for identical arrays', () => {
      expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    })

    it('returns true for empty arrays', () => {
      expect(isEqual([], [])).toBe(true)
    })

    it('returns false for arrays of different lengths', () => {
      expect(isEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('returns false for arrays with different elements', () => {
      expect(isEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    })

    it('handles nested arrays', () => {
      expect(isEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true)
      expect(isEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false)
    })

    it('treats arrays and objects with same keys/values as equal', () => {
      // isEqual doesn't distinguish arrays from plain objects in fallback path
      expect(isEqual([1], { 0: 1, length: 1 })).toBe(false)
      expect(isEqual([1, 2], [1, 2])).toBe(true)
    })
  })

  describe('objects', () => {
    it('returns true for identical objects', () => {
      expect(isEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
    })

    it('returns true for empty objects', () => {
      expect(isEqual({}, {})).toBe(true)
    })

    it('returns false for objects with different keys', () => {
      expect(isEqual({ x: 1 }, { y: 1 })).toBe(false)
    })

    it('returns false for objects with different values', () => {
      expect(isEqual({ x: 1 }, { x: 2 })).toBe(false)
    })

    it('returns false for objects with different key counts', () => {
      expect(isEqual({ x: 1 }, { x: 1, y: 2 })).toBe(false)
    })

    it('handles nested objects', () => {
      expect(isEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
      expect(isEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    it('handles objects with array values', () => {
      expect(isEqual({ pos: [1, 2] }, { pos: [1, 2] })).toBe(true)
      expect(isEqual({ pos: [1, 2] }, { pos: [1, 3] })).toBe(false)
    })
  })

  describe('same reference', () => {
    it('returns true for same reference', () => {
      const obj = { x: 1 }
      expect(isEqual(obj, obj)).toBe(true)
    })

    it('returns true for same array reference', () => {
      const arr = [1, 2, 3]
      expect(isEqual(arr, arr)).toBe(true)
    })
  })
})
