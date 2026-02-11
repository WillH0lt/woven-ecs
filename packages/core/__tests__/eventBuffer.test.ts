import { beforeEach, describe, expect, it } from 'vitest'
import { EventBuffer, EventType } from '../src/EventBuffer'

describe('EventBuffer', () => {
  let eventBuffer: EventBuffer

  beforeEach(() => {
    eventBuffer = new EventBuffer(1000)
  })

  describe('initialization', () => {
    it('should initialize with write index 0', () => {
      expect(eventBuffer.getWriteIndex()).toBe(0)
    })
  })

  describe('push events', () => {
    it('should push ADDED event', () => {
      eventBuffer.pushAdded(42)

      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(entities.size).toBe(1)
      expect(entities.has(42)).toBe(true)
    })

    it('should push REMOVED event', () => {
      eventBuffer.pushRemoved(123)

      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.REMOVED)
      expect(entities.size).toBe(1)
      expect(entities.has(123)).toBe(true)
    })

    it('should push CHANGED event with componentId', () => {
      eventBuffer.pushChanged(99, 5)

      // Create mask for component 5
      const componentMask = new Uint8Array([0b00100000]) // bit 5
      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.CHANGED, componentMask)
      expect(entities.size).toBe(1)
      expect(entities.has(99)).toBe(true)
    })

    it('should increment write index on each push', () => {
      eventBuffer.pushAdded(1)
      expect(eventBuffer.getWriteIndex()).toBe(1)

      eventBuffer.pushAdded(2)
      expect(eventBuffer.getWriteIndex()).toBe(2)

      eventBuffer.pushRemoved(3)
      expect(eventBuffer.getWriteIndex()).toBe(3)
    })
  })

  describe('collectEntitiesInRange', () => {
    it('should return entities in a range of indices', () => {
      eventBuffer.pushAdded(1)
      eventBuffer.pushAdded(2)
      eventBuffer.pushAdded(3)
      eventBuffer.pushAdded(4)

      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(entities.size).toBe(4)
      expect([...entities].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    })

    it('should filter by event type', () => {
      eventBuffer.pushAdded(1)
      eventBuffer.pushRemoved(2)
      eventBuffer.pushChanged(3, 0)

      const { entities: addedEntities } = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(addedEntities.size).toBe(1)
      expect(addedEntities.has(1)).toBe(true)

      const { entities: removedEntities } = eventBuffer.collectEntitiesInRange(0, EventType.REMOVED)
      expect(removedEntities.size).toBe(1)
      expect(removedEntities.has(2)).toBe(true)

      const { entities: changedEntities } = eventBuffer.collectEntitiesInRange(0, EventType.CHANGED)
      expect(changedEntities.size).toBe(1)
      expect(changedEntities.has(3)).toBe(true)
    })

    it('should filter CHANGED events by componentMask', () => {
      eventBuffer.pushChanged(1, 0) // component 0
      eventBuffer.pushChanged(2, 1) // component 1
      eventBuffer.pushChanged(3, 2) // component 2

      // Mask for component 0 (bit 0)
      const { entities: comp0Entities } = eventBuffer.collectEntitiesInRange(
        0,
        EventType.CHANGED,
        new Uint8Array([0b001]),
      )
      expect(comp0Entities.size).toBe(1)
      expect(comp0Entities.has(1)).toBe(true)

      // Mask for component 1 (bit 1)
      const { entities: comp1Entities } = eventBuffer.collectEntitiesInRange(
        0,
        EventType.CHANGED,
        new Uint8Array([0b010]),
      )
      expect(comp1Entities.size).toBe(1)
      expect(comp1Entities.has(2)).toBe(true)

      // Mask for components 0 and 2 (bits 0 and 2)
      const { entities: comp02Entities } = eventBuffer.collectEntitiesInRange(
        0,
        EventType.CHANGED,
        new Uint8Array([0b101]),
      )
      expect(comp02Entities.size).toBe(2)
    })

    it('should return empty when no new events', () => {
      eventBuffer.pushAdded(1)

      const result1 = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(result1.newIndex).toBe(1)

      // No new events
      const result2 = eventBuffer.collectEntitiesInRange(result1.newIndex, EventType.ADDED)
      expect(result2.entities.size).toBe(0)
      expect(result2.newIndex).toBe(1)
    })

    it('should collect entities from a range of indices', () => {
      eventBuffer.pushAdded(1)
      eventBuffer.pushAdded(2)
      eventBuffer.pushAdded(3)

      const { entities, newIndex } = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(entities.size).toBe(3)
      expect([...entities].sort()).toEqual([1, 2, 3])
      expect(newIndex).toBe(3)
    })

    it('should only scan new events on subsequent calls', () => {
      eventBuffer.pushAdded(1)
      eventBuffer.pushAdded(2)

      // First call
      const result1 = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(result1.entities.size).toBe(2)
      expect(result1.newIndex).toBe(2)

      // Add more events
      eventBuffer.pushAdded(3)
      eventBuffer.pushAdded(4)

      // Second call starting from where we left off
      const result2 = eventBuffer.collectEntitiesInRange(result1.newIndex, EventType.ADDED)
      expect(result2.entities.size).toBe(2)
      expect([...result2.entities].sort()).toEqual([3, 4])
      expect(result2.newIndex).toBe(4)
    })

    it('should return empty when no new events', () => {
      eventBuffer.pushAdded(1)

      const result1 = eventBuffer.collectEntitiesInRange(0, EventType.ADDED)
      expect(result1.newIndex).toBe(1)

      // No new events
      const result2 = eventBuffer.collectEntitiesInRange(result1.newIndex, EventType.ADDED)
      expect(result2.entities.size).toBe(0)
      expect(result2.newIndex).toBe(1)
    })

    it('should deduplicate entities', () => {
      eventBuffer.pushChanged(1, 0)
      eventBuffer.pushChanged(1, 1) // Same entity, different component
      eventBuffer.pushChanged(1, 2) // Same entity, different component
      eventBuffer.pushChanged(2, 0)

      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.CHANGED)
      expect(entities.size).toBe(2)
      expect([...entities].sort()).toEqual([1, 2])
    })

    it('should filter by component mask', () => {
      eventBuffer.pushChanged(1, 0) // component 0
      eventBuffer.pushChanged(2, 1) // component 1
      eventBuffer.pushChanged(3, 2) // component 2

      // Only get changes for component 1
      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.CHANGED, new Uint8Array([0b010]))
      expect(entities.size).toBe(1)
      expect(entities.has(2)).toBe(true)
    })
  })

  describe('ring buffer wrapping', () => {
    it('should wrap around when buffer is full', () => {
      const smallBuffer = new EventBuffer(10)

      // Push more events than the buffer can hold
      for (let i = 0; i < 15; i++) {
        smallBuffer.pushAdded(i)
      }

      // Write index should continue incrementing (not wrap)
      expect(smallBuffer.getWriteIndex()).toBe(15)

      // collectEntitiesInRange handles wrapping internally
      // Starting from index 6 should collect entities 6-14 (the ones still in buffer)
      const { entities } = smallBuffer.collectEntitiesInRange(6, EventType.ADDED)
      // Entities 6-14 should be collected (9 unique entities)
      expect(entities.size).toBe(9)
    })
  })

  describe('fromTransfer', () => {
    it('should create EventBuffer from shared buffer', () => {
      eventBuffer.pushAdded(42)
      eventBuffer.pushRemoved(99)

      const buffer = eventBuffer.getBuffer()
      const transferred = EventBuffer.fromTransfer(buffer, 1000)

      // Should see same data
      expect(transferred.getWriteIndex()).toBe(2)

      const { entities } = transferred.collectEntitiesInRange(0, EventType.ADDED)
      expect(entities.size).toBe(1)
      expect(entities.has(42)).toBe(true)
    })

    it('should allow writes from transferred buffer', () => {
      const buffer = eventBuffer.getBuffer()
      const transferred = EventBuffer.fromTransfer(buffer, 1000)

      transferred.pushChanged(123, 5)

      // Create mask for component 5
      const componentMask = new Uint8Array([0b00100000]) // bit 5
      const { entities } = eventBuffer.collectEntitiesInRange(0, EventType.CHANGED, componentMask)
      expect(entities.size).toBe(1)
      expect(entities.has(123)).toBe(true)
    })
  })

  describe('readEvent', () => {
    it('should return event data for any slot', () => {
      // Even unwritten slots return an event object
      const event = eventBuffer.readEvent(0)
      expect(event).toBeDefined()
    })

    it('should return event for filled slot', () => {
      eventBuffer.pushAdded(42)

      const event = eventBuffer.readEvent(0)
      expect(event).toBeDefined()
      expect(event.entityId).toBe(42)
      expect(event.eventType).toBe(EventType.ADDED)
    })
  })
})
