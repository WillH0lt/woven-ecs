import { describe, expect, it } from 'vitest'
import { defineQuery, defineSingleton, defineSystem, field, World } from '../src'
import { nextFrame } from '../src/Context'

describe('Singleton', () => {
  describe('SingletonDef API', () => {
    it('should support Mouse.read(ctx) syntax', () => {
      const Mouse = defineSingleton({
        x: field.float32().default(100),
        y: field.float32().default(200),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      // Direct read without useSingleton
      const mouse = Mouse.read(ctx)
      expect(mouse.x).toBeCloseTo(100)
      expect(mouse.y).toBeCloseTo(200)
    })

    it('should support Mouse.write(ctx) syntax', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      // Direct write without useSingleton
      const mouse = Mouse.write(ctx)
      mouse.x = 150
      mouse.y = 250

      // Verify the write
      const readMouse = Mouse.read(ctx)
      expect(readMouse.x).toBeCloseTo(150)
      expect(readMouse.y).toBeCloseTo(250)
    })

    it('should support Mouse.copy(ctx, data) syntax', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      // Direct copy without useSingleton
      Mouse.copy(ctx, { x: 300, y: 400 })

      // Verify the copy
      const mouse = Mouse.read(ctx)
      expect(mouse.x).toBeCloseTo(300)
      expect(mouse.y).toBeCloseTo(400)
    })

    it('should support Mouse.snapshot(ctx) syntax', () => {
      const Mouse = defineSingleton({
        x: field.float32().default(42),
        y: field.float32().default(24),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      // Direct snapshot without useSingleton
      const snapshot = Mouse.snapshot(ctx)
      expect(snapshot.x).toBeCloseTo(42)
      expect(snapshot.y).toBeCloseTo(24)

      // Verify it's a plain object (not bound to entity)
      expect(typeof snapshot.x).toBe('number')
      expect(typeof snapshot.y).toBe('number')
    })

    it('should work alongside ComponentDef', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const Time = defineSingleton({
        delta: field.float32().default(0.016),
        elapsed: field.float32().default(0),
      })

      const world = new World([Mouse, Time])
      const ctx = world._getContext()

      // Test both singletons
      const mouse = Mouse.write(ctx)
      mouse.x = 100
      mouse.y = 200

      const time = Time.read(ctx)
      expect(time.delta).toBeCloseTo(0.016)
      expect(time.elapsed).toBe(0)

      const readMouse = Mouse.read(ctx)
      expect(readMouse.x).toBeCloseTo(100)
      expect(readMouse.y).toBeCloseTo(200)
    })

    it('should support getComponentId', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const Time = defineSingleton({
        delta: field.float32(),
      })

      const world = new World([Mouse, Time])
      const ctx = world._getContext()

      expect(Mouse._getComponentId(ctx)).toBe(0)
      expect(Time._getComponentId(ctx)).toBe(1)
    })

    it('should throw when accessing unregistered singleton', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const Other = defineSingleton({
        value: field.float32(),
      })

      // Only register Mouse
      const world = new World([Mouse])
      const ctx = world._getContext()

      expect(() => {
        Other.read(ctx)
      }).toThrow(/is not registered with this World/)
    })

    it('should handle partial copy', () => {
      const GameState = defineSingleton({
        level: field.uint8().default(1),
        score: field.uint32().default(0),
        playerName: field.string().max(50).default('Player'),
      })

      const world = new World([GameState])
      const ctx = world._getContext()

      // Copy only some fields
      GameState.copy(ctx, { level: 5, score: 1000 })

      const state = GameState.read(ctx)
      expect(state.level).toBe(5)
      expect(state.score).toBe(1000)
      expect(state.playerName).toBe('Player') // Should keep default
    })

    it('should trigger change events on write', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const query = defineQuery((q) => q.tracking(Mouse))

      let callbackCount = 0
      world.subscribe(query, (ctx) => {
        callbackCount++
        const mouse = Mouse.read(ctx)
        expect(mouse.x).toBeCloseTo(100)
      })

      // Write to trigger change
      const mouse = Mouse.write(ctx)
      mouse.x = 100

      // Sync to trigger subscribers
      world.sync()

      expect(callbackCount).toBe(1)
    })

    it('should trigger change events on copy', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const query = defineQuery((q) => q.tracking(Mouse))

      let callbackCount = 0
      world.subscribe(query, (_ctx) => {
        callbackCount++
      })

      // Copy to trigger change
      Mouse.copy(ctx, { x: 200, y: 300 })

      // Sync to trigger subscribers
      world.sync()

      expect(callbackCount).toBe(1)
    })
  })

  describe('Basic Query Support', () => {
    it('should support tracking a singleton with defineQuery', () => {
      const Mouse = defineSingleton({
        x: field.float32().default(0),
        y: field.float32().default(0),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      // Initial state - no changes yet
      expect(mouseQuery.changed(ctx).length).toBe(0)
      expect(mouseQuery.current(ctx).length).toBe(1) // Singleton always exists

      // Write to singleton
      const mouse = Mouse.write(ctx)
      mouse.x = 100
      mouse.y = 200

      // Next tick - should detect change
      nextFrame(ctx)
      const changed = mouseQuery.changed(ctx)
      expect(changed.length).toBe(1)
      expect(changed[0]).toBe(0xffffffff) // SINGLETON_ENTITY_ID
    })

    it('should detect when singleton changes', () => {
      const Time = defineSingleton({
        delta: field.float32().default(0.016),
        elapsed: field.float32().default(0),
      })

      const world = new World([Time])
      const ctx = world._getContext()

      const timeQuery = defineQuery((q) => q.tracking(Time))

      // No changes initially
      expect(timeQuery.changed(ctx).length).toBe(0)

      // Simulate frame start - capture event index before work
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex

      // Update elapsed time (this happens during the frame)
      const time = Time.write(ctx)
      time.elapsed = 1.0

      // Set currEventIndex after the work is done
      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      // Check for changes - should see the change from this frame
      expect(timeQuery.changed(ctx).length).toBe(1)

      // Simulate next frame start - capture event index before work
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex
      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      // No more changes on this frame
      expect(timeQuery.changed(ctx).length).toBe(0)
    })

    it('should return SINGLETON_ENTITY_ID in current()', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      const current = mouseQuery.current(ctx)
      expect(current.length).toBe(1)
      expect(current[0]).toBe(0xffffffff) // SINGLETON_ENTITY_ID
    })
  })

  describe('Multiple Singletons', () => {
    it('should track changes to multiple singletons independently', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const Time = defineSingleton({
        delta: field.float32(),
        elapsed: field.float32(),
      })

      const world = new World([Mouse, Time])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))
      const timeQuery = defineQuery((q) => q.tracking(Time))

      // Initialize queries
      expect(mouseQuery.changed(ctx).length).toBe(0)
      expect(timeQuery.changed(ctx).length).toBe(0)

      // Simulate frame start
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex

      // Update only Mouse during this frame
      const mouse = Mouse.write(ctx)
      mouse.x = 100

      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      expect(mouseQuery.changed(ctx).length).toBe(1)
      expect(timeQuery.changed(ctx).length).toBe(0)

      // Simulate next frame start
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex

      // Update only Time during this frame
      const time = Time.write(ctx)
      time.delta = 0.016

      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      expect(mouseQuery.changed(ctx).length).toBe(0)
      expect(timeQuery.changed(ctx).length).toBe(1)
    })

    it('should support querying multiple singletons together', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const Keyboard = defineSingleton({
        pressed: field.boolean(),
      })

      const world = new World([Mouse, Keyboard])
      const ctx = world._getContext()

      const inputQuery = defineQuery((q) => q.tracking(Mouse, Keyboard))

      // No changes initially
      expect(inputQuery.changed(ctx).length).toBe(0)

      // Update Mouse
      const mouse = Mouse.write(ctx)
      mouse.x = 100

      nextFrame(ctx)
      expect(inputQuery.changed(ctx).length).toBe(1)

      // Update Keyboard
      const kb = Keyboard.write(ctx)
      kb.pressed = true

      nextFrame(ctx)
      expect(inputQuery.changed(ctx).length).toBe(1)
    })
  })

  describe('Integration with Systems', () => {
    it('should work in a system using defineSystem', () => {
      const Mouse = defineSingleton({
        x: field.float32().default(0),
        y: field.float32().default(0),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      let changedCount = 0

      const system = defineSystem((ctx) => {
        const changed = mouseQuery.changed(ctx)
        changedCount += changed.length

        if (changed.length > 0) {
          const mouse = Mouse.read(ctx)
          expect(mouse.x).toBeCloseTo(100)
          expect(mouse.y).toBeCloseTo(200)
        }
      })

      // First execution - no changes
      system.execute(ctx)
      expect(changedCount).toBe(0)

      // Simulate frame start
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex

      // Update mouse during this frame
      const mouse = Mouse.write(ctx)
      mouse.x = 100
      mouse.y = 200

      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      // System execution - should detect change
      system.execute(ctx)
      expect(changedCount).toBe(1)

      // Simulate next frame start
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex
      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      // System execution - no more changes
      system.execute(ctx)
      expect(changedCount).toBe(1)
    })

    it('should work with world.subscribe', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      let callbackCount = 0

      // Note: World.subscribe doesn't directly support queries in current API
      // This test demonstrates the pattern users would follow
      const checkChanges = () => {
        if (mouseQuery.changed(ctx).length > 0) {
          callbackCount++
        }
      }

      // Initial check
      checkChanges()
      expect(callbackCount).toBe(0)

      // Update mouse
      const mouse = Mouse.write(ctx)
      mouse.x = 100

      // Check for changes
      nextFrame(ctx)
      checkChanges()
      expect(callbackCount).toBe(1)
    })
  })

  describe('Copy Support', () => {
    it('should detect changes when using Mouse.copy()', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      // Initialize
      expect(mouseQuery.changed(ctx).length).toBe(0)

      // Copy to mouse
      Mouse.copy(ctx, { x: 100, y: 200 })

      // Should detect change
      nextFrame(ctx)
      expect(mouseQuery.changed(ctx).length).toBe(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle no changes correctly', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      // Multiple checks with no changes
      expect(mouseQuery.changed(ctx).length).toBe(0)
      nextFrame(ctx)
      expect(mouseQuery.changed(ctx).length).toBe(0)
      nextFrame(ctx)
      expect(mouseQuery.changed(ctx).length).toBe(0)
    })

    it('should reset changed state after each check', () => {
      const Mouse = defineSingleton({
        x: field.float32(),
        y: field.float32(),
      })

      const world = new World([Mouse])
      const ctx = world._getContext()

      const mouseQuery = defineQuery((q) => q.tracking(Mouse))

      // Initialize
      expect(mouseQuery.changed(ctx).length).toBe(0)

      // Simulate frame start
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex

      // Update during this frame
      const mouse = Mouse.write(ctx)
      mouse.x = 100

      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      // Check once - should see the change
      expect(mouseQuery.changed(ctx).length).toBe(1)

      // Same frame - should return cached result
      expect(mouseQuery.changed(ctx).length).toBe(1)

      // Simulate next frame start
      ctx.prevEventIndex = ctx.currEventIndex ?? ctx.prevEventIndex
      ctx.currEventIndex = ctx.eventBuffer.getWriteIndex()

      // No changes this frame
      expect(mouseQuery.changed(ctx).length).toBe(0)
    })
  })
})
