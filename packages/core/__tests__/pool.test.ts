import { describe, expect, it } from 'vitest'
import { Pool } from '../src/Pool'

describe('Pool', () => {
  describe('create', () => {
    it('should create a pool with the specified size', () => {
      const pool = Pool.create(100)
      expect(pool).toBeDefined()
      expect(pool.getBucketCount()).toBe(4) // ceil(100/32) = 4
    })

    it('should create a pool with exact 32-bit boundary', () => {
      const pool = Pool.create(32)
      expect(pool.getBucketCount()).toBe(1)
    })

    it('should create a pool with size requiring multiple buckets', () => {
      const pool = Pool.create(1000)
      expect(pool.getBucketCount()).toBe(32) // ceil(1000/32) = 32
    })
  })

  describe('get', () => {
    it('should return sequential indices starting from 0', () => {
      const pool = Pool.create(100)
      expect(pool.get()).toBe(0)
      expect(pool.get()).toBe(1)
      expect(pool.get()).toBe(2)
    })

    it('should return all indices in a small pool', () => {
      const pool = Pool.create(32)
      const indices: number[] = []
      for (let i = 0; i < 32; i++) {
        indices.push(pool.get())
      }
      // All indices from 0 to 31 should be present
      expect(indices.sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i))
    })

    it('should throw error when pool is exhausted', () => {
      const pool = Pool.create(32)
      // Exhaust the pool
      for (let i = 0; i < 32; i++) {
        pool.get()
      }
      expect(() => pool.get()).toThrow('Entity pool exhausted: maximum of 32 entities reached')
    })

    it('should handle pool exhaustion across bucket boundaries', () => {
      const pool = Pool.create(64)
      // Exhaust both buckets
      for (let i = 0; i < 64; i++) {
        const idx = pool.get()
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(64)
      }
      expect(() => pool.get()).toThrow('Entity pool exhausted')
    })
  })

  describe('free', () => {
    it('should make an index available again', () => {
      const pool = Pool.create(100)
      const first = pool.get()
      expect(first).toBe(0)

      pool.get() // 1
      pool.get() // 2

      pool.free(first)

      // The freed index should be available again
      const reused = pool.get()
      expect(reused).toBe(0)
    })

    it('should allow freeing and reusing multiple indices', () => {
      const pool = Pool.create(100)
      const indices = [pool.get(), pool.get(), pool.get()]
      expect(indices).toEqual([0, 1, 2])

      // Free all
      pool.free(0)
      pool.free(1)
      pool.free(2)

      // Get them back (order may vary due to hint optimization)
      const reused = [pool.get(), pool.get(), pool.get()]
      expect(reused.sort()).toEqual([0, 1, 2])
    })

    it('should handle free after pool exhaustion', () => {
      const pool = Pool.create(32)
      // Exhaust the pool
      for (let i = 0; i < 32; i++) {
        pool.get()
      }
      expect(() => pool.get()).toThrow('Entity pool exhausted')

      // Free an index
      pool.free(15)

      // Should be able to get it back
      expect(pool.get()).toBe(15)
    })

    it('should update hint when freeing to earlier bucket', () => {
      const pool = Pool.create(100)
      // Get indices from first bucket
      for (let i = 0; i < 32; i++) {
        pool.get()
      }
      // Get some from second bucket
      const idx32 = pool.get()
      expect(idx32).toBe(32)

      // Free an index from first bucket
      pool.free(5)

      // Next get should return the freed index from first bucket
      expect(pool.get()).toBe(5)
    })
  })

  describe('fromTransfer', () => {
    it('should create a pool from a transferred buffer', () => {
      const pool1 = Pool.create(100)
      pool1.get() // 0
      pool1.get() // 1

      const buffer = pool1.getBuffer()
      const bucketCount = pool1.getBucketCount()
      const size = pool1.getSize()

      const pool2 = Pool.fromTransfer(buffer, bucketCount, size)

      // pool2 should see the same state - next should be 2
      expect(pool2.get()).toBe(2)
    })

    it('should share state between original and transferred pools', () => {
      const pool1 = Pool.create(100)
      const buffer = pool1.getBuffer()
      const bucketCount = pool1.getBucketCount()
      const size = pool1.getSize()
      const pool2 = Pool.fromTransfer(buffer, bucketCount, size)

      // Get from pool1
      expect(pool1.get()).toBe(0)

      // pool2 should see the change
      expect(pool2.get()).toBe(1)

      // Free from pool2
      pool2.free(0)

      // pool1 should be able to get it
      expect(pool1.get()).toBe(0)
    })
  })

  describe('getBuffer and getBucketCount', () => {
    it('should return the underlying SharedArrayBuffer', () => {
      const pool = Pool.create(100)
      const buffer = pool.getBuffer()
      expect(buffer).toBeInstanceOf(SharedArrayBuffer)
    })

    it('should return correct bucket count', () => {
      const pool = Pool.create(100)
      expect(pool.getBucketCount()).toBe(4)
    })
  })

  describe('stress test', () => {
    it('should handle many allocations and frees', () => {
      const pool = Pool.create(1000)
      const allocated: number[] = []

      // Allocate 500
      for (let i = 0; i < 500; i++) {
        allocated.push(pool.get())
      }

      // Free every other one
      for (let i = 0; i < allocated.length; i += 2) {
        pool.free(allocated[i])
      }

      // Allocate 300 more - should reuse freed slots first
      const newAllocs: number[] = []
      for (let i = 0; i < 300; i++) {
        newAllocs.push(pool.get())
      }

      // Should have gotten some freed indices back
      const freedIndices = allocated.filter((_, i) => i % 2 === 0)
      const reusedCount = newAllocs.filter((idx) => freedIndices.includes(idx)).length
      expect(reusedCount).toBeGreaterThan(0)
    })

    it('should not return duplicate indices', () => {
      const pool = Pool.create(500)
      const seen = new Set<number>()

      for (let i = 0; i < 500; i++) {
        const idx = pool.get()
        expect(idx).not.toBe(-1)
        expect(seen.has(idx)).toBe(false)
        seen.add(idx)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle size of 1', () => {
      const pool = Pool.create(1)
      expect(pool.get()).toBe(0)
      expect(() => pool.get()).toThrow('Entity pool exhausted')
      pool.free(0)
      expect(pool.get()).toBe(0)
    })

    it('should handle freeing the same index twice', () => {
      const pool = Pool.create(100)
      pool.get() // 0
      pool.get() // 1

      pool.free(0)
      pool.free(0) // Double free - should not break

      // Should only get 0 once
      expect(pool.get()).toBe(0)
      expect(pool.get()).toBe(2) // Next should be 2, not 0 again
    })

    it('should handle index at bucket boundary', () => {
      const pool = Pool.create(64)

      // Get all of first bucket
      for (let i = 0; i < 32; i++) {
        expect(pool.get()).toBe(i)
      }

      // Get first of second bucket
      expect(pool.get()).toBe(32)

      // Free last of first bucket
      pool.free(31)
      expect(pool.get()).toBe(31)

      // Free first of second bucket
      pool.free(32)
      expect(pool.get()).toBe(32)
    })
  })
})
