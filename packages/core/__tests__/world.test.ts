import { describe, expect, it } from 'vitest'
import {
  addComponent,
  createEntity,
  defineComponent,
  defineQuery,
  defineSystem,
  field,
  hasComponent,
  removeComponent,
  removeEntity,
  World,
} from '../src'

import { nextFrame } from '../src/Context'

describe('World', () => {
  describe('World Creation', () => {
    it('should initialize components with unique componentIds', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })
      const Health = defineComponent({
        current: field.uint16().default(100),
        max: field.uint16().default(100),
      })

      const world = new World([Position, Velocity, Health])
      const ctx = world._getContext()
      expect(Position._getComponentId(ctx)).toBe(0)
      expect(Velocity._getComponentId(ctx)).toBe(1)
      expect(Health._getComponentId(ctx)).toBe(2)
    })
  })

  describe('Entity Management', () => {
    it('should create entities', () => {
      const world = new World([])
      const ctx = world._getContext()
      const eid = createEntity(ctx)

      expect(typeof eid).toBe('number')
    })

    it('should create multiple entities with sequential IDs', () => {
      const world = new World([])
      const ctx = world._getContext()
      const e1 = createEntity(ctx)
      const e2 = createEntity(ctx)
      const e3 = createEntity(ctx)

      expect(e1).toBe(0)
      expect(e2).toBe(1)
      expect(e3).toBe(2)
    })

    it('should remove entities', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 10, y: 20 })

      removeEntity(ctx, entity)

      expect(() => hasComponent(ctx, entity, Position)).toThrow()
    })
  })

  describe('Component Operations', () => {
    it('should add components to entities', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()
      const entity = createEntity(ctx)

      addComponent(ctx, entity, Position, { x: 10, y: 20 })
      addComponent(ctx, entity, Velocity, { dx: 1, dy: 2 })

      expect(hasComponent(ctx, entity, Position)).toBe(true)
      expect(hasComponent(ctx, entity, Velocity)).toBe(true)
    })

    it('should add components with default values', () => {
      const Health = defineComponent({
        current: field.uint16().default(100),
        max: field.uint16().default(100),
      })

      const world = new World([Health])
      const ctx = world._getContext()
      const entity = createEntity(ctx)

      addComponent(ctx, entity, Health, {})

      expect(hasComponent(ctx, entity, Health)).toBe(true)
      expect(Health.read(ctx, entity).current).toBe(100)
      expect(Health.read(ctx, entity).max).toBe(100)
    })

    it('should remove components from entities', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()
      const entity = createEntity(ctx)

      addComponent(ctx, entity, Position, { x: 10, y: 20 })
      addComponent(ctx, entity, Velocity, { dx: 1, dy: 2 })

      expect(hasComponent(ctx, entity, Position)).toBe(true)
      expect(hasComponent(ctx, entity, Velocity)).toBe(true)

      removeComponent(ctx, entity, Position)

      expect(hasComponent(ctx, entity, Position)).toBe(false)
      expect(hasComponent(ctx, entity, Velocity)).toBe(true)
    })

    it('should check for component existence', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()
      const entity = createEntity(ctx)

      expect(hasComponent(ctx, entity, Position)).toBe(false)

      addComponent(ctx, entity, Position, { x: 10, y: 20 })

      expect(hasComponent(ctx, entity, Position)).toBe(true)
      expect(hasComponent(ctx, entity, Velocity)).toBe(false)
    })

    it('should throw when checking component on non-existent entity', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      expect(() => hasComponent(ctx, 999, Position)).toThrow('Entity with ID 999 does not exist')
    })

    it('should throw when removing component from non-existent entity', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      expect(() => removeComponent(ctx, 999, Position)).toThrow('Entity with ID 999 does not exist')
    })
  })

  describe('Component Data Access', () => {
    it('should read component data', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 100, y: 200 })

      const pos = Position.read(ctx, entity)

      expect(pos.x).toBeCloseTo(100)
      expect(pos.y).toBeCloseTo(200)
    })

    it('should write component data', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      const pos = Position.write(ctx, entity)
      pos.x = 50
      pos.y = 75

      expect(Position.read(ctx, entity).x).toBeCloseTo(50)
      expect(Position.read(ctx, entity).y).toBeCloseTo(75)
    })

    it('should handle multiple components per entity', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })
      const Health = defineComponent({
        current: field.uint16(),
        max: field.uint16(),
      })

      const world = new World([Position, Velocity, Health])
      const ctx = world._getContext()
      const entity = createEntity(ctx)

      addComponent(ctx, entity, Position, { x: 100, y: 200 })
      addComponent(ctx, entity, Velocity, { dx: 5, dy: 10 })
      addComponent(ctx, entity, Health, { current: 75, max: 100 })

      const pos = Position.read(ctx, entity)
      const vel = Velocity.read(ctx, entity)
      const health = Health.read(ctx, entity)

      expect(pos.x).toBeCloseTo(100)
      expect(pos.y).toBeCloseTo(200)
      expect(vel.dx).toBeCloseTo(5)
      expect(vel.dy).toBeCloseTo(10)
      expect(health.current).toBe(75)
      expect(health.max).toBe(100)
    })

    it('should update component values independently', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()
      const entity = createEntity(ctx)

      addComponent(ctx, entity, Position, { x: 0, y: 0 })
      addComponent(ctx, entity, Velocity, { dx: 5, dy: 3 })

      // Simulate 10 frames of movement
      for (let i = 0; i < 10; i++) {
        const pos = Position.write(ctx, entity)
        const vel = Velocity.read(ctx, entity)
        pos.x += vel.dx
        pos.y += vel.dy
      }

      expect(Position.read(ctx, entity).x).toBeCloseTo(50)
      expect(Position.read(ctx, entity).y).toBeCloseTo(30)
      expect(Velocity.read(ctx, entity).dx).toBeCloseTo(5)
      expect(Velocity.read(ctx, entity).dy).toBeCloseTo(3)
    })
  })

  describe('Multiple Entities', () => {
    it('should handle multiple entities with different component combinations', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })
      const Health = defineComponent({
        current: field.uint16(),
        max: field.uint16(),
      })

      const world = new World([Position, Velocity, Health])
      const ctx = world._getContext()

      const e1 = createEntity(ctx)
      addComponent(ctx, e1, Position, { x: 10, y: 20 })
      addComponent(ctx, e1, Velocity, { dx: 1, dy: 2 })

      const e2 = createEntity(ctx)
      addComponent(ctx, e2, Position, { x: 30, y: 40 })

      const e3 = createEntity(ctx)
      addComponent(ctx, e3, Velocity, { dx: 5, dy: 5 })
      addComponent(ctx, e3, Health, { current: 50, max: 100 })

      expect(hasComponent(ctx, e1, Position)).toBe(true)
      expect(hasComponent(ctx, e1, Velocity)).toBe(true)
      expect(hasComponent(ctx, e1, Health)).toBe(false)

      expect(hasComponent(ctx, e2, Position)).toBe(true)
      expect(hasComponent(ctx, e2, Velocity)).toBe(false)
      expect(hasComponent(ctx, e2, Health)).toBe(false)

      expect(hasComponent(ctx, e3, Position)).toBe(false)
      expect(hasComponent(ctx, e3, Velocity)).toBe(true)
      expect(hasComponent(ctx, e3, Health)).toBe(true)
    })

    it('should keep entity data isolated', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const e1 = createEntity(ctx)
      const e2 = createEntity(ctx)

      addComponent(ctx, e1, Position, { x: 10, y: 20 })
      addComponent(ctx, e2, Position, { x: 30, y: 40 })

      Position.write(ctx, e1).x = 100

      expect(Position.read(ctx, e1).x).toBeCloseTo(100)
      expect(Position.read(ctx, e2).x).toBeCloseTo(30)
    })
  })

  describe('World Disposal', () => {
    it('should dispose of world resources', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 10, y: 20 })

      expect(() => world.dispose()).not.toThrow()
    })
  })

  describe('Multiple Worlds', () => {
    it('should allow multiple worlds to use the same ComponentDefs without interference', () => {
      // Define components once
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      // Create two separate worlds using the same component definitions
      const world1 = new World([Position, Velocity])
      const ctx1 = world1._getContext()

      const world2 = new World([Position, Velocity])
      const ctx2 = world2._getContext()

      // Create entities in world1
      const e1 = createEntity(ctx1)
      addComponent(ctx1, e1, Position, { x: 100, y: 200 })
      addComponent(ctx1, e1, Velocity, { dx: 1, dy: 2 })

      // Create entities in world2
      const e2 = createEntity(ctx2)
      addComponent(ctx2, e2, Position, { x: 300, y: 400 })
      addComponent(ctx2, e2, Velocity, { dx: 5, dy: 6 })

      // Verify data in world1 is independent
      expect(Position.read(ctx1, e1).x).toBeCloseTo(100)
      expect(Position.read(ctx1, e1).y).toBeCloseTo(200)
      expect(Velocity.read(ctx1, e1).dx).toBeCloseTo(1)
      expect(Velocity.read(ctx1, e1).dy).toBeCloseTo(2)

      // Verify data in world2 is independent
      expect(Position.read(ctx2, e2).x).toBeCloseTo(300)
      expect(Position.read(ctx2, e2).y).toBeCloseTo(400)
      expect(Velocity.read(ctx2, e2).dx).toBeCloseTo(5)
      expect(Velocity.read(ctx2, e2).dy).toBeCloseTo(6)

      // Modify data in world1 and verify world2 is unaffected
      Position.write(ctx1, e1).x = 999
      expect(Position.read(ctx1, e1).x).toBeCloseTo(999)
      expect(Position.read(ctx2, e2).x).toBeCloseTo(300) // world2 unchanged

      // Modify data in world2 and verify world1 is unaffected
      Velocity.write(ctx2, e2).dx = 888
      expect(Velocity.read(ctx2, e2).dx).toBeCloseTo(888)
      expect(Velocity.read(ctx1, e1).dx).toBeCloseTo(1) // world1 unchanged
    })

    it('should assign independent componentIds per world', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world1 = new World([Position, Velocity])
      const ctx1 = world1._getContext()

      const world2 = new World([Velocity, Position]) // Different order
      const ctx2 = world2._getContext()

      // Each world assigns componentIds based on its own registration order
      expect(Position._getComponentId(ctx1)).toBe(0)
      expect(Velocity._getComponentId(ctx1)).toBe(1)

      expect(Velocity._getComponentId(ctx2)).toBe(0)
      expect(Position._getComponentId(ctx2)).toBe(1)
    })

    it('should allow entity creation in both worlds independently', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world1 = new World([Position])
      const ctx1 = world1._getContext()

      const world2 = new World([Position])
      const ctx2 = world2._getContext()

      // Create multiple entities in each world
      const w1e1 = createEntity(ctx1)
      const w1e2 = createEntity(ctx1)
      const w1e3 = createEntity(ctx1)

      const w2e1 = createEntity(ctx2)
      const w2e2 = createEntity(ctx2)

      // Entity IDs are per-world and start from 0
      expect(w1e1).toBe(0)
      expect(w1e2).toBe(1)
      expect(w1e3).toBe(2)

      expect(w2e1).toBe(0)
      expect(w2e2).toBe(1)

      // Add components with different values
      addComponent(ctx1, w1e1, Position, { x: 1, y: 1 })
      addComponent(ctx2, w2e1, Position, { x: 100, y: 100 })

      // Same entity ID (0) in different worlds has different data
      expect(Position.read(ctx1, w1e1).x).toBeCloseTo(1)
      expect(Position.read(ctx2, w2e1).x).toBeCloseTo(100)
    })

    it('should support queries on multiple worlds independently', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world1 = new World([Position, Velocity])
      const ctx1 = world1._getContext()

      const world2 = new World([Position, Velocity])
      const ctx2 = world2._getContext()

      // Create different entity configurations in each world
      // World1: 3 entities with Position, 2 with Velocity
      for (let i = 0; i < 3; i++) {
        const e = createEntity(ctx1)
        addComponent(ctx1, e, Position, { x: i, y: i })
        if (i < 2) {
          addComponent(ctx1, e, Velocity, { dx: i, dy: i })
        }
      }

      // World2: 5 entities with Position, all with Velocity
      for (let i = 0; i < 5; i++) {
        const e = createEntity(ctx2)
        addComponent(ctx2, e, Position, { x: i * 10, y: i * 10 })
        addComponent(ctx2, e, Velocity, { dx: i, dy: i })
      }

      // Single query definition works across multiple worlds
      // Each world gets its own Query instance stored in ctx.queries
      const movingQuery = defineQuery((q) => q.with(Position, Velocity))

      // Query results are per-context
      const world1Results = movingQuery.current(ctx1)
      const world2Results = movingQuery.current(ctx2)

      expect(world1Results).toHaveLength(2)
      expect(world2Results).toHaveLength(5)
    })
  })

  describe('Subscribe and Sync', () => {
    it("should emit 'added' when entity enters the query", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const query = defineQuery((q) => q.with(Position))
      const receivedAdded: number[] = []
      world.subscribe(query, (_ctx, { added }) => {
        receivedAdded.push(...added)
      })

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })
      world.sync()

      // Should receive 'added' when entity enters the query
      expect(receivedAdded).toHaveLength(1)
      expect(receivedAdded[0]).toBe(entity)
    })

    it('should not fire events for entities that do not match the query', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      // Query only for entities with Velocity
      const query = defineQuery((q) => q.with(Velocity))
      const receivedAdded: number[] = []
      world.subscribe(query, (_ctx, { added }) => {
        receivedAdded.push(...added)
      })

      // Create entity with only Position (should not match)
      const entity1 = createEntity(ctx)
      addComponent(ctx, entity1, Position, { x: 0, y: 0 })

      // Create entity with Velocity (should match)
      const entity2 = createEntity(ctx)
      addComponent(ctx, entity2, Velocity, { dx: 1, dy: 1 })

      world.sync()

      // Should only receive events for entity2
      expect(receivedAdded).toHaveLength(1)
      expect(receivedAdded[0]).toBe(entity2)
    })

    it("should emit 'removed' when entity leaves the query (entity deleted)", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      const query = defineQuery((q) => q.with(Position))

      const receivedRemoved: number[] = []
      world.subscribe(query, (_ctx, { removed }) => {
        console.log('removed callback', removed)
        receivedRemoved.push(...removed)
      })

      // advance tick
      world.sync()

      removeEntity(ctx, entity)
      world.sync()

      expect(receivedRemoved).toHaveLength(1)
      expect(receivedRemoved[0]).toBe(entity)
    })

    it("should emit 'removed' when entity leaves the query (component removed)", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })
      addComponent(ctx, entity, Velocity, { dx: 1, dy: 1 })

      // Query for entities with both Position AND Velocity
      const query = defineQuery((q) => q.with(Position, Velocity))

      const receivedRemoved: number[] = []
      world.subscribe(query, (_ctx, { removed }) => {
        receivedRemoved.push(...removed)
      })

      world.sync() // Advnance tick

      // Remove Velocity - entity should leave the query
      removeComponent(ctx, entity, Velocity)
      world.sync()

      expect(receivedRemoved).toHaveLength(1)
      expect(receivedRemoved[0]).toBe(entity)
    })

    it("should emit 'added' when entity enters the query (component added)", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      const receivedAdded: number[] = []
      const query = defineQuery((q) => q.with(Position, Velocity))
      world.subscribe(query, (_ctx, { added }) => {
        receivedAdded.push(...added)
      })

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      world.sync() // Advnance tick

      expect(receivedAdded).toHaveLength(0)

      // Add Velocity - entity should enter the query
      addComponent(ctx, entity, Velocity, { dx: 1, dy: 1 })

      world.sync()

      expect(receivedAdded).toHaveLength(1)
      expect(receivedAdded[0]).toBe(entity)
    })

    it("should emit 'changed' when tracked component changes", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      // Use tracking() to track Position changes
      const query = defineQuery((q) => q.tracking(Position))

      const receivedChanged: number[] = []
      world.subscribe(query, (_ctx, { changed }) => {
        receivedChanged.push(...changed)
      })

      // Initial sync to advnace tick
      world.sync()

      // Modify the component
      const pos = Position.write(ctx, entity)
      pos.x = 100

      world.sync()

      expect(receivedChanged).toHaveLength(1)
      expect(receivedChanged[0]).toBe(entity)
    })

    it("should not emit 'changed' for non-tracked components", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })
      addComponent(ctx, entity, Velocity, { dx: 1, dy: 1 })

      // Query with Position but only track Velocity
      const query = defineQuery((q) => q.with(Position, Velocity).tracking(Velocity))
      world.sync() // Clear the initial events

      const receivedChanged: number[] = []
      world.subscribe(query, (_ctx, { changed }) => {
        receivedChanged.push(...changed)
      })

      // Modify Position (not tracked) - should not emit
      const pos = Position.write(ctx, entity)
      pos.x = 100
      world.sync()

      expect(receivedChanged).toHaveLength(0)

      // Modify Velocity (tracked) - should emit
      const vel = Velocity.write(ctx, entity)
      vel.dx = 50
      world.sync()

      expect(receivedChanged).toHaveLength(1)
      expect(receivedChanged[0]).toBe(entity)
    })

    it('should support multiple subscribers with different queries', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      const positionQuery = defineQuery((q) => q.with(Position))
      const velocityQuery = defineQuery((q) => q.with(Velocity))

      const positionAdded: number[] = []
      const velocityAdded: number[] = []

      world.subscribe(positionQuery, (_ctx, { added }) => {
        positionAdded.push(...added)
      })
      world.subscribe(velocityQuery, (_ctx, { added }) => {
        velocityAdded.push(...added)
      })

      // Create entity with only Position
      const e1 = createEntity(ctx)
      addComponent(ctx, e1, Position, { x: 0, y: 0 })

      // Create entity with only Velocity
      const e2 = createEntity(ctx)
      addComponent(ctx, e2, Velocity, { dx: 1, dy: 1 })

      world.sync()

      // Position subscriber should only see e1
      expect(positionAdded).toHaveLength(1)
      expect(positionAdded[0]).toBe(e1)

      // Velocity subscriber should only see e2
      expect(velocityAdded).toHaveLength(1)
      expect(velocityAdded[0]).toBe(e2)
    })

    it('should support unsubscribing', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const query = defineQuery((q) => q.with(Position))
      const receivedAdded: number[] = []
      const unsubscribe = world.subscribe(query, (_ctx, { added }) => {
        receivedAdded.push(...added)
      })

      const e1 = createEntity(ctx)
      addComponent(ctx, e1, Position, { x: 0, y: 0 })
      world.sync()
      expect(receivedAdded).toHaveLength(1)

      unsubscribe()

      const e2 = createEntity(ctx)
      addComponent(ctx, e2, Position, { x: 0, y: 0 })
      world.sync()
      // Should still be 1 since we unsubscribed
      expect(receivedAdded).toHaveLength(1)
    })

    it('should not call subscribers if no matching events occurred', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      // Subscribe only to Velocity entities
      const query = defineQuery((q) => q.with(Velocity))
      let callCount = 0
      world.subscribe(query, (_ctx) => {
        callCount++
      })

      // Create entity with only Position (doesn't match query)
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      world.sync()
      world.sync()
      world.sync()

      expect(callCount).toBe(0)
    })

    it("should batch multiple 'added' events in a single sync call", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const query = defineQuery((q) => q.with(Position))
      const receivedBatches: number[][] = []
      world.subscribe(query, (_ctx, { added }) => {
        receivedBatches.push([...added])
      })

      // Create multiple entities before syncing
      const e1 = createEntity(ctx)
      const e2 = createEntity(ctx)
      const e3 = createEntity(ctx)
      addComponent(ctx, e1, Position, { x: 0, y: 0 })
      addComponent(ctx, e2, Position, { x: 0, y: 0 })
      addComponent(ctx, e3, Position, { x: 0, y: 0 })

      world.sync()

      // Should have received one batch with 3 'added' entities
      expect(receivedBatches).toHaveLength(1)
      expect(receivedBatches[0]).toHaveLength(3)
    })

    it("should only emit 'added' once per entity even with multiple component adds", () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      // Query that matches when entity has Position
      const query = defineQuery((q) => q.with(Position))
      const receivedAdded: number[] = []
      world.subscribe(query, (_ctx, { added }) => {
        receivedAdded.push(...added)
      })

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })
      addComponent(ctx, entity, Velocity, { dx: 1, dy: 1 }) // Adding more components
      world.sync()

      // Should only get one 'added' entity
      expect(receivedAdded).toHaveLength(1)
    })
  })

  describe('nextSync', () => {
    it('should execute callback on next sync', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const _ctx = world._getContext()

      let callbackExecuted = false
      world.nextSync(() => {
        callbackExecuted = true
      })

      expect(callbackExecuted).toBe(false)
      world.sync()
      expect(callbackExecuted).toBe(true)
    })

    it('should execute multiple callbacks in order', () => {
      const world = new World([])
      const order: number[] = []

      world.nextSync(() => order.push(1))
      world.nextSync(() => order.push(2))
      world.nextSync(() => order.push(3))

      world.sync()
      expect(order).toEqual([1, 2, 3])
    })

    it('should allow entity and component modifications in callback', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      // Create entity outside callback
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      // Schedule modification for next sync
      world.nextSync((syncCtx) => {
        const pos = Position.write(syncCtx, entity)
        pos.x = 100
        pos.y = 200
      })

      // Values unchanged before sync
      expect(Position.read(ctx, entity).x).toBe(0)
      expect(Position.read(ctx, entity).y).toBe(0)

      world.sync()

      // Values updated after sync
      expect(Position.read(ctx, entity).x).toBe(100)
      expect(Position.read(ctx, entity).y).toBe(200)
    })

    it('should clear callbacks after execution', () => {
      const world = new World([])
      let callCount = 0

      world.nextSync(() => {
        callCount++
      })

      world.sync()
      expect(callCount).toBe(1)

      // Second sync should not re-execute the callback
      world.sync()
      expect(callCount).toBe(1)
    })

    it('should allow scheduling new callbacks from within a callback', () => {
      const world = new World([])
      const executions: string[] = []

      world.nextSync(() => {
        executions.push('first')
        world.nextSync(() => {
          executions.push('nested')
        })
      })

      world.sync()
      expect(executions).toEqual(['first'])

      // Nested callback should execute on next sync
      world.sync()
      expect(executions).toEqual(['first', 'nested'])
    })

    it('should execute callbacks before subscriber notifications', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const query = defineQuery((q) => q.tracking(Position))

      // Initial sync to register entity
      world.subscribe(query, (_ctx, { added }) => {
        console.log('subscriber callback', added)
        if (added.includes(entity)) {
          xValueInSubscriber = Position.read(ctx, entity).x
        }
      })

      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 0, y: 0 })

      let xValueInSubscriber = 0

      // Schedule a write for next sync
      world.nextSync((syncCtx) => {
        const pos = Position.write(syncCtx, entity)
        pos.x = 999
        console.log('nextSync callback', pos.x)
      })

      world.sync()

      // Subscriber should see the value written by nextSync callback
      expect(xValueInSubscriber).toBe(999)
    })
  })

  describe('Entity ID Reclamation', () => {
    it('should not reclaim entity IDs until RECLAIM_DELAY executions have passed', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      // Create and remove an entity
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 10, y: 20 })
      expect(entity).toBe(0)

      removeEntity(ctx, entity)

      const system = defineSystem(() => {
        // no-op system to drive execute cycles
      })

      // Execute once - entity should NOT be reclaimed yet (need RECLAIM_DELAY = 3 executions)
      await world.execute(system)
      const e1 = createEntity(ctx)
      expect(e1).toBe(1) // Should get new ID, not reclaimed 0

      // Execute twice more
      await world.execute(system)
      const e2 = createEntity(ctx)
      expect(e2).toBe(2) // Still getting new IDs

      await world.execute(system)

      // After 3 executions, the removed entity ID should be reclaimable
      // Next entity creation should reuse ID 0
      const e3 = createEntity(ctx)
      expect(e3).toBe(0) // Reclaimed ID
    })

    it('should track reclaim watermark per system independently', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const systemA = defineSystem(() => {
        // No-op system for testing reclaim delay
      })
      const systemB = defineSystem(() => {
        // No-op system for testing reclaim delay
      })

      // Create and remove an entity
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 10, y: 20 })
      removeEntity(ctx, entity)

      // Execute both systems together - both need to build up history
      // After 1 execution, neither has enough history (need 3)
      await world.execute(systemA, systemB)
      const e1 = createEntity(ctx)
      expect(e1).toBe(1) // New ID, not reclaimed yet

      // After 2 executions, still not enough
      await world.execute(systemA, systemB)
      const e2 = createEntity(ctx)
      expect(e2).toBe(2) // Still new IDs

      // After 3 executions, both have enough history
      await world.execute(systemA, systemB)

      // Now entity should be reclaimable
      const e3 = createEntity(ctx)
      expect(e3).toBe(0) // Reclaimed ID
    })

    it('should allow systems to see removed entities via removed() in the frame after removal', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      // Create an entity
      const entity = createEntity(ctx)
      addComponent(ctx, entity, Position, { x: 10, y: 20 })

      const positionQuery = defineQuery((q) => q.with(Position))
      const removedEntities: number[][] = []

      const system = defineSystem((ctx) => {
        removedEntities.push([...positionQuery.removed(ctx)])
      })

      // First execute to register the system
      await world.execute(system)
      expect(removedEntities[0]).toHaveLength(0) // Nothing removed yet

      // Remove the entity
      removeEntity(ctx, entity)

      // Execute - should see the removed entity in removed() query
      await world.execute(system)
      expect(removedEntities[1]).toContain(entity)

      // Next execute - the removal event is now outside the [prev, curr] window
      // so removed() no longer reports it (this is expected query behavior)
      await world.execute(system)
      expect(removedEntities[2]).not.toContain(entity)
    })

    it('should reclaim multiple entity IDs in correct order', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      // Create several entities
      const e0 = createEntity(ctx)
      const e1 = createEntity(ctx)
      const e2 = createEntity(ctx)
      addComponent(ctx, e0, Position, { x: 0, y: 0 })
      addComponent(ctx, e1, Position, { x: 1, y: 1 })
      addComponent(ctx, e2, Position, { x: 2, y: 2 })

      // Remove them in order
      removeEntity(ctx, e0)
      removeEntity(ctx, e1)
      removeEntity(ctx, e2)

      const system = defineSystem(() => {
        // No-op system for testing reclaim delay
      })

      // Execute RECLAIM_DELAY times
      await world.execute(system)
      await world.execute(system)
      await world.execute(system)

      // All IDs should now be reclaimable
      // Pool returns them in LIFO order (last freed = first allocated)
      const newE0 = createEntity(ctx)
      const newE1 = createEntity(ctx)
      const newE2 = createEntity(ctx)

      // Should reuse the freed IDs (order depends on pool implementation)
      expect([newE0, newE1, newE2].sort()).toEqual([0, 1, 2])
    })

    it('should not reclaim IDs for entities that are still alive', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      // Create two entities, remove only one
      const e0 = createEntity(ctx)
      const e1 = createEntity(ctx)
      addComponent(ctx, e0, Position, { x: 0, y: 0 })
      addComponent(ctx, e1, Position, { x: 1, y: 1 })

      removeEntity(ctx, e0) // Only remove e0

      const system = defineSystem(() => {
        // No-op system for testing reclaim delay
      })

      // Execute RECLAIM_DELAY times
      await world.execute(system)
      await world.execute(system)
      await world.execute(system)

      // Create new entity - should reuse e0's ID
      const newEntity = createEntity(ctx)
      expect(newEntity).toBe(0) // Reclaimed from e0

      // e1 should still be alive and accessible
      expect(hasComponent(ctx, e1, Position)).toBe(true)
      expect(Position.read(ctx, e1).x).toBe(1)
    })
  })

  describe('currEventIndex - System isolation within execute batch', () => {
    it('should prevent systems from seeing entities in added() created by earlier systems in the same execute batch', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const _ctx = world._getContext()

      const positionQuery = defineQuery((q) => q.with(Position))

      // Track what each system sees in added()
      const system1Added: number[] = []
      const system2Added: number[] = []

      // System 1: Creates an entity
      const system1 = defineSystem((ctx) => {
        // Record what we see BEFORE creating
        system1Added.length = 0
        system1Added.push(...positionQuery.added(ctx))

        // Create a new entity
        const e = createEntity(ctx)
        addComponent(ctx, e, Position, { x: 100, y: 200 })
      })

      // System 2: Should NOT see the entity created by system1 in added()
      const system2 = defineSystem((ctx) => {
        system2Added.length = 0
        system2Added.push(...positionQuery.added(ctx))
      })

      // Execute both systems in the same batch
      await world.execute(system1, system2)

      // System 1 should see nothing in added() (no entities existed before this frame)
      expect(system1Added).toHaveLength(0)

      // System 2 should ALSO see nothing in added() - the entity created by system1
      // should not be visible in added() until the NEXT execute batch
      expect(system2Added).toHaveLength(0)

      // Now execute again - both systems should see the entity in added()
      await world.execute(system1, system2)

      // System 1 should now see 1 entity in added() (created in previous batch)
      expect(system1Added).toHaveLength(1)

      // System 2 should see the same entity in added() (from previous batch)
      expect(system2Added).toHaveLength(1)
    })

    it('should allow queries called after execute to see entities created during execute', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const positionQuery = defineQuery((q) => q.with(Position))

      // System that creates an entity
      const creatorSystem = defineSystem((ctx) => {
        const e = createEntity(ctx)
        addComponent(ctx, e, Position, { x: 50, y: 50 })
      })

      // Before execute, no entities
      expect(positionQuery.current(ctx)).toHaveLength(0)

      // Execute the system
      await world.execute(creatorSystem)

      // After execute, the entity should be visible via direct query on ctx
      // (currEventIndex should be updated to allow seeing new entities)
      expect(positionQuery.current(ctx)).toHaveLength(1)
    })

    it('should prevent removed() from seeing removals within the same execute batch', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      // Create an entity before the systems run
      const existingEntity = createEntity(ctx)
      addComponent(ctx, existingEntity, Position, { x: 0, y: 0 })

      const positionQuery = defineQuery((q) => q.with(Position))

      // Track what system sees in removed()
      const systemRemoved: number[] = []

      // Initialize the query so it tracks the existing entity
      world.sync()

      // System that checks removed() and then removes the entity
      const system = defineSystem((ctx) => {
        systemRemoved.length = 0
        systemRemoved.push(...positionQuery.removed(ctx))

        // Remove the entity
        removeEntity(ctx, existingEntity)
      })

      // Execute the system
      await world.execute(system)

      // Should not report it as removed yet (removal event is after currEventIndex)
      expect(systemRemoved).toHaveLength(0)

      // Next execute batch should see the removal in removed()
      await world.execute(system)

      expect(systemRemoved).toHaveLength(1)
    })

    it('should not allow sync() callbacks to see entities created within the callback', () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const positionQuery = defineQuery((q) => q.with(Position))

      let entityCreatedInCallback: number = -1
      let queryResultsInCallback: number[] = []

      // Schedule a callback that creates an entity
      world.nextSync((ctx) => {
        entityCreatedInCallback = createEntity(ctx)
        addComponent(ctx, entityCreatedInCallback, Position, { x: 10, y: 20 })

        // Query immediately after creation within the same callback
        queryResultsInCallback = [...positionQuery.current(ctx)]
      })

      // Before sync, nothing exists
      expect(positionQuery.current(ctx)).toHaveLength(0)

      // Run sync
      world.sync()

      // The callback should have been able to see the entity it created
      // because currEventIndex is set to the current write index for sync
      expect(queryResultsInCallback).toHaveLength(0)

      // After sync, the entity should also be visible from outside
      nextFrame(ctx)
      expect(positionQuery.current(ctx)).toHaveLength(1)
    })

    it('should handle multiple systems creating entities - added() shows only previous batch entities', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })
      const Velocity = defineComponent({
        dx: field.float32(),
        dy: field.float32(),
      })

      const world = new World([Position, Velocity])

      const positionOnlyQuery = defineQuery((q) => q.with(Position).without(Velocity))
      const movingQuery = defineQuery((q) => q.with(Position, Velocity))

      const results: {
        positionOnlyAdded: number[]
        movingAdded: number[]
      }[] = []

      // System 1: Creates position-only entities
      const system1 = defineSystem((ctx) => {
        const e = createEntity(ctx)
        addComponent(ctx, e, Position, { x: 1, y: 1 })
      })

      // System 2: Creates moving entities (Position + Velocity)
      const system2 = defineSystem((ctx) => {
        const e = createEntity(ctx)
        addComponent(ctx, e, Position, { x: 2, y: 2 })
        addComponent(ctx, e, Velocity, { dx: 1, dy: 1 })
      })

      // System 3: Records added() results
      const system3 = defineSystem((ctx) => {
        results.push({
          positionOnlyAdded: [...positionOnlyQuery.added(ctx)],
          movingAdded: [...movingQuery.added(ctx)],
        })
      })

      // Execute all systems 3 times
      await world.execute(system1, system2, system3)
      await world.execute(system1, system2, system3)
      await world.execute(system1, system2, system3)

      // Frame 1: system3 sees nothing in added() (entities created this frame not visible)
      expect(results[0].positionOnlyAdded).toHaveLength(0)
      expect(results[0].movingAdded).toHaveLength(0)

      // Frame 2: system3 sees 1 entity each in added() (from frame 1)
      expect(results[1].positionOnlyAdded).toHaveLength(1)
      expect(results[1].movingAdded).toHaveLength(1)

      // Frame 3: system3 sees 1 entity each in added() (from frame 2 only, not cumulative)
      expect(results[2].positionOnlyAdded).toHaveLength(1)
      expect(results[2].movingAdded).toHaveLength(1)
    })

    it('should prevent changed() from seeing changes made by earlier systems in the same batch', async () => {
      const TrackedPosition = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([TrackedPosition])
      const ctx = world._getContext()

      // Create an entity before systems run
      const entity = createEntity(ctx)
      addComponent(ctx, entity, TrackedPosition, { x: 0, y: 0 })

      const trackedQuery = defineQuery((q) => q.tracking(TrackedPosition))

      // Initialize the query
      world.sync()

      const system1Changes: number[] = []
      const system2Changes: number[] = []

      // System 1: Modifies the component
      const system1 = defineSystem((ctx) => {
        system1Changes.push(...trackedQuery.changed(ctx))
        const writer = TrackedPosition.write(ctx, entity)
        writer.x = 999
      })

      // System 2: Should NOT see the change from system1
      const system2 = defineSystem((ctx) => {
        system2Changes.push(...trackedQuery.changed(ctx))
      })

      // Execute both systems
      await world.execute(system1, system2)

      // Neither system should see changes (changes happened during this batch)
      expect(system1Changes).toHaveLength(0)
      expect(system2Changes).toHaveLength(0)

      // Next batch should see the change
      await world.execute(system1, system2)

      // Now both should see the change from the previous batch
      expect(system1Changes).toHaveLength(1)
      expect(system2Changes).toHaveLength(1)
    })

    it('should correctly handle currEventIndex across sync and execute', async () => {
      const Position = defineComponent({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Position])
      const ctx = world._getContext()

      const positionQuery = defineQuery((q) => q.with(Position))

      // Create entity via nextSync
      world.nextSync((ctx) => {
        const e = createEntity(ctx)
        addComponent(ctx, e, Position, { x: 1, y: 1 })
      })

      // Before sync, query sees nothing
      expect(positionQuery.current(ctx)).toHaveLength(0)

      // After sync, query sees the entity
      world.sync()
      expect(positionQuery.current(ctx)).toHaveLength(1)

      let systemResult: number[] = []
      const system = defineSystem((ctx) => {
        systemResult = [...positionQuery.current(ctx)]
      })

      // Execute should also see the entity
      await world.execute(system)
      expect(systemResult).toHaveLength(1)

      // Create another entity during execute
      const creatorSystem = defineSystem((ctx) => {
        const e = createEntity(ctx)
        addComponent(ctx, e, Position, { x: 2, y: 2 })
      })

      await world.execute(creatorSystem, system)

      // System in same batch should still see only 1 entity
      expect(systemResult).toHaveLength(1)

      // After execute, direct query should see 2 entities
      expect(positionQuery.current(ctx)).toHaveLength(2)
    })
  })
})
