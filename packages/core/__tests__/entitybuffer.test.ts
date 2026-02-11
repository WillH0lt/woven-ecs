import { beforeEach, describe, expect, it } from 'vitest'

import { EntityBuffer } from '../src/EntityBuffer'
import type { QueryMasks } from '../src/types'

// Helper to create a mock QueryMasks for testing
// Uses Uint8Array for byte-based component masks
function masks(withMask: number, withoutMask: number, anyMask: number): QueryMasks {
  return {
    with: new Uint8Array([withMask]),
    without: new Uint8Array([withoutMask]),
    any: new Uint8Array([anyMask]),
    tracking: new Uint8Array([0]),
    hasTracking: false,
    hasWith: withMask !== 0,
    hasWithout: withoutMask !== 0,
    hasAny: anyMask !== 0,
  }
}

describe('EntityBuffer', () => {
  let buffer: EntityBuffer

  beforeEach(() => {
    // Create buffer with 8 components (1 byte for component bits)
    buffer = new EntityBuffer(100, 8)
  })

  describe('constructor', () => {
    it('should create a buffer with default capacity', () => {
      expect(buffer).toBeInstanceOf(EntityBuffer)
      expect(buffer.getBuffer()).toBeDefined()
    })

    it('should use SharedArrayBuffer by default if available', () => {
      if (typeof SharedArrayBuffer !== 'undefined') {
        expect(buffer.getBuffer()).toBeInstanceOf(SharedArrayBuffer)
      } else {
        expect(buffer.getBuffer()).toBeInstanceOf(ArrayBuffer)
      }
    })
  })

  describe('fromTransfer', () => {
    it('should create a buffer from existing ArrayBuffer', () => {
      const originalBuffer = buffer.getBuffer()
      const transferredBuffer = EntityBuffer.fromTransfer(originalBuffer, 8)

      expect(transferredBuffer).toBeInstanceOf(EntityBuffer)
      expect(transferredBuffer.getBuffer()).toBe(originalBuffer)
    })

    it('should share state with original buffer', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // component ID 0

      const transferredBuffer = EntityBuffer.fromTransfer(buffer.getBuffer(), 8)
      expect(transferredBuffer.has(1)).toBe(true)
      expect(transferredBuffer.hasComponent(1, 0)).toBe(true)
    })
  })

  describe('create', () => {
    it('should create an entity (mark as alive)', () => {
      buffer.create(1)
      expect(buffer.has(1)).toBe(true)
    })

    it('should create entity with no components', () => {
      buffer.create(1)
      // Check that entity has no components (component IDs 0-7)
      for (let i = 0; i < 8; i++) {
        expect(buffer.hasComponent(1, i)).toBe(false)
      }
    })

    it('should handle multiple entities independently', () => {
      buffer.create(1)
      buffer.create(2)

      expect(buffer.has(1)).toBe(true)
      expect(buffer.has(2)).toBe(true)
    })
  })

  describe('addComponentToEntity', () => {
    it('should add a component to an entity', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // component ID 0

      expect(buffer.hasComponent(1, 0)).toBe(true)
    })

    it('should add multiple components', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // component ID 0
      buffer.addComponentToEntity(1, 1) // component ID 1
      buffer.addComponentToEntity(1, 2) // component ID 2

      expect(buffer.hasComponent(1, 0)).toBe(true)
      expect(buffer.hasComponent(1, 1)).toBe(true)
      expect(buffer.hasComponent(1, 2)).toBe(true)
    })

    it('should handle many component IDs', () => {
      // Create buffer with 64 components
      const largeBuffer = new EntityBuffer(100, 64)
      largeBuffer.create(1)

      // Add component IDs across multiple bytes
      largeBuffer.addComponentToEntity(1, 0) // byte 1, bit 0
      largeBuffer.addComponentToEntity(1, 7) // byte 1, bit 7
      largeBuffer.addComponentToEntity(1, 8) // byte 2, bit 0
      largeBuffer.addComponentToEntity(1, 63) // byte 8, bit 7

      expect(largeBuffer.hasComponent(1, 0)).toBe(true)
      expect(largeBuffer.hasComponent(1, 7)).toBe(true)
      expect(largeBuffer.hasComponent(1, 8)).toBe(true)
      expect(largeBuffer.hasComponent(1, 63)).toBe(true)
    })
  })

  describe('removeComponentFromEntity', () => {
    it('should remove a component from an entity', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      expect(buffer.hasComponent(1, 0)).toBe(true)

      buffer.removeComponentFromEntity(1, 0)
      expect(buffer.hasComponent(1, 0)).toBe(false)
    })

    it('should remove specific component without affecting others', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.addComponentToEntity(1, 1)
      buffer.addComponentToEntity(1, 2)

      buffer.removeComponentFromEntity(1, 1)

      expect(buffer.hasComponent(1, 0)).toBe(true)
      expect(buffer.hasComponent(1, 1)).toBe(false)
      expect(buffer.hasComponent(1, 2)).toBe(true)
    })

    it('should preserve alive flag when removing components', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.addComponentToEntity(1, 1)
      buffer.addComponentToEntity(1, 2)
      buffer.removeComponentFromEntity(1, 0)
      buffer.removeComponentFromEntity(1, 1)
      buffer.removeComponentFromEntity(1, 2)

      expect(buffer.has(1)).toBe(true)
      expect(buffer.hasComponent(1, 0)).toBe(false)
      expect(buffer.hasComponent(1, 1)).toBe(false)
      expect(buffer.hasComponent(1, 2)).toBe(false)
    })
  })

  describe('hasComponent', () => {
    it('should return true for components that entity has', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.addComponentToEntity(1, 2)

      expect(buffer.hasComponent(1, 0)).toBe(true)
      expect(buffer.hasComponent(1, 2)).toBe(true)
    })

    it("should return false for components entity doesn't have", () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)

      expect(buffer.hasComponent(1, 1)).toBe(false)
    })

    it('should work with multiple component IDs', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.addComponentToEntity(1, 1)

      expect(buffer.hasComponent(1, 0)).toBe(true)
      expect(buffer.hasComponent(1, 1)).toBe(true)
      expect(buffer.hasComponent(1, 2)).toBe(false)
    })
  })

  describe('matches', () => {
    it('should match entities with required components (with)', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // bit 0
      buffer.addComponentToEntity(1, 1) // bit 1

      // Has component 0
      expect(buffer.matches(1, masks(0b001, 0, 0))).toBe(true)
      // Has components 0 and 1
      expect(buffer.matches(1, masks(0b011, 0, 0))).toBe(true)
      // Doesn't have component 2
      expect(buffer.matches(1, masks(0b100, 0, 0))).toBe(false)
    })

    it('should exclude entities with forbidden components (without)', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // bit 0
      buffer.addComponentToEntity(1, 1) // bit 1

      // Doesn't have component 2, so passes
      expect(buffer.matches(1, masks(0, 0b100, 0))).toBe(true)
      // Has component 0, so fails
      expect(buffer.matches(1, masks(0, 0b001, 0))).toBe(false)
    })

    it('should match entities with any of specified components (any)', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // bit 0

      // Has component 0
      expect(buffer.matches(1, masks(0, 0, 0b001))).toBe(true)
      // Has component 0 (any of 0 or 1)
      expect(buffer.matches(1, masks(0, 0, 0b011))).toBe(true)
      // Doesn't have component 2
      expect(buffer.matches(1, masks(0, 0, 0b100))).toBe(false)
    })

    it('should return false for dead entities', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.delete(1)

      expect(buffer.matches(1, masks(0b001, 0, 0))).toBe(false)
    })

    it('should combine all criteria correctly', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0) // bit 0
      buffer.addComponentToEntity(1, 1) // bit 1
      buffer.addComponentToEntity(1, 2) // bit 2
      buffer.addComponentToEntity(1, 3) // bit 3

      // Has 0b11 (components 0,1), doesn't have 0b10000 (component 4), has any of 0b1000 (component 3)
      expect(buffer.matches(1, masks(0b11, 0b10000, 0b1000))).toBe(true)

      // Fails 'with' check - doesn't have component 5
      expect(buffer.matches(1, masks(0b100000, 0, 0))).toBe(false)

      // Fails 'without' check - has component 1
      expect(buffer.matches(1, masks(0, 0b0010, 0))).toBe(false)

      // Fails 'any' check - doesn't have component 5
      expect(buffer.matches(1, masks(0, 0, 0b100000))).toBe(false)
    })
  })

  describe('delete', () => {
    it('should mark entity as dead', () => {
      buffer.create(1)
      expect(buffer.has(1)).toBe(true)

      buffer.delete(1)
      expect(buffer.has(1)).toBe(false)
    })

    it('should clear all component data', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.addComponentToEntity(1, 1)
      buffer.addComponentToEntity(1, 2)
      expect(buffer.hasComponent(1, 0)).toBe(true)

      buffer.delete(1)
      expect(buffer.has(1)).toBe(false)
      expect(buffer.hasComponent(1, 0)).toBe(false)
    })

    it('should allow re-creating deleted entities', () => {
      buffer.create(1)
      buffer.addComponentToEntity(1, 0)
      buffer.delete(1)
      expect(buffer.has(1)).toBe(false)

      buffer.create(1)
      expect(buffer.has(1)).toBe(true)
      expect(buffer.hasComponent(1, 0)).toBe(false) // New entity has no components
    })
  })

  describe('has', () => {
    it('should return true for alive entities', () => {
      buffer.create(1)
      expect(buffer.has(1)).toBe(true)
    })

    it('should return false for dead entities', () => {
      expect(buffer.has(1)).toBe(false)

      buffer.create(1)
      expect(buffer.has(1)).toBe(true)

      buffer.delete(1)
      expect(buffer.has(1)).toBe(false)
    })
  })

  describe('getBuffer', () => {
    it('should return the underlying ArrayBuffer', () => {
      const underlyingBuffer = buffer.getBuffer()
      expect(underlyingBuffer).toBeInstanceOf(
        typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer,
      )
    })

    it('should allow sharing buffer state across instances', () => {
      buffer.create(5)
      buffer.addComponentToEntity(5, 0)
      buffer.addComponentToEntity(5, 2)

      const sharedBuffer = buffer.getBuffer()
      const newBuffer = EntityBuffer.fromTransfer(sharedBuffer, 8)

      expect(newBuffer.has(5)).toBe(true)
      expect(newBuffer.hasComponent(5, 0)).toBe(true)
      expect(newBuffer.hasComponent(5, 2)).toBe(true)
    })
  })

  describe('multi-byte component support', () => {
    it('should support many components across multiple bytes', () => {
      const largeBuffer = new EntityBuffer(100, 64)
      largeBuffer.create(1)

      // Add components across multiple bytes
      // Byte 1: components 0-7
      // Byte 2: components 8-15
      // etc.
      largeBuffer.addComponentToEntity(1, 0) // byte 1, bit 0
      largeBuffer.addComponentToEntity(1, 7) // byte 1, bit 7
      largeBuffer.addComponentToEntity(1, 8) // byte 2, bit 0
      largeBuffer.addComponentToEntity(1, 31) // byte 4, bit 7
      largeBuffer.addComponentToEntity(1, 32) // byte 5, bit 0
      largeBuffer.addComponentToEntity(1, 63) // byte 8, bit 7

      expect(largeBuffer.hasComponent(1, 0)).toBe(true)
      expect(largeBuffer.hasComponent(1, 7)).toBe(true)
      expect(largeBuffer.hasComponent(1, 8)).toBe(true)
      expect(largeBuffer.hasComponent(1, 31)).toBe(true)
      expect(largeBuffer.hasComponent(1, 32)).toBe(true)
      expect(largeBuffer.hasComponent(1, 63)).toBe(true)
      expect(largeBuffer.hasComponent(1, 1)).toBe(false)
      expect(largeBuffer.hasComponent(1, 50)).toBe(false)
    })

    it('should match with multi-byte masks', () => {
      const largeBuffer = new EntityBuffer(100, 16)
      largeBuffer.create(1)

      // Add component 8 (goes to byte 2, bit 0)
      largeBuffer.addComponentToEntity(1, 8)

      // Match using multi-byte mask
      const multiWordMask: QueryMasks = {
        with: new Uint8Array([0, 1]), // bit 0 of byte 2 = component 8
        without: new Uint8Array([0, 0]),
        any: new Uint8Array([0, 0]),
        tracking: new Uint8Array([0, 0]),
        hasTracking: false,
        hasWith: true,
        hasWithout: false,
        hasAny: false,
      }

      expect(largeBuffer.matches(1, multiWordMask)).toBe(true)
    })
  })

  describe('metadata byte', () => {
    it('should reserve first byte for metadata (alive flag)', () => {
      buffer.create(1)

      // Entity should be alive
      expect(buffer.has(1)).toBe(true)

      // Adding component 0 should not affect alive status
      buffer.addComponentToEntity(1, 0)
      expect(buffer.has(1)).toBe(true)

      // Removing all components should not affect alive status
      buffer.removeComponentFromEntity(1, 0)
      expect(buffer.has(1)).toBe(true)

      // Only delete should clear alive flag
      buffer.delete(1)
      expect(buffer.has(1)).toBe(false)
    })
  })
})
