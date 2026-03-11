import type { Context } from '@woven-ecs/core'
import { addComponent, createEntity, field, World } from '@woven-ecs/core'
import { afterEach, describe, expect, it } from 'vitest'
import { defineCanvasComponent } from '../src/CanvasComponentDef'
import { defineCanvasSingleton } from '../src/CanvasSingletonDef'
import { CanvasStore } from '../src/CanvasStore'
import { Synced } from '../src/components/Synced'

// ── Test definitions ────────────────────────────────────────────────────────

const Position = defineCanvasComponent(
  { name: 'Position', sync: 'document' },
  {
    x: field.float64().default(0),
    y: field.float64().default(0),
  },
)

const Color = defineCanvasComponent(
  { name: 'Color', sync: 'document' },
  {
    r: field.float64().default(0),
    g: field.float64().default(0),
    b: field.float64().default(0),
  },
)

const Camera = defineCanvasSingleton(
  { name: 'Camera', sync: 'document' },
  {
    zoom: field.float64().default(1),
  },
)

const ALL_COMPONENTS = [Position, Color]
const ALL_SINGLETONS = [Camera]

// ── Helpers ─────────────────────────────────────────────────────────────────

function setup() {
  const world = new World([Synced, Position, Color, Camera], {
    maxEntities: 1000,
    maxEvents: 4096,
  })
  return { world }
}

function executeSync(world: World, store: CanvasStore) {
  world.execute((ctx: Context) => {
    store.sync(ctx)
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CanvasStore', () => {
  let store: CanvasStore

  afterEach(() => {
    store?.close()
  })

  describe('initialState', () => {
    it('applies initialState snapshot on the first sync', async () => {
      const { world } = setup()
      store = new CanvasStore({
        initialState: {
          'entity-1/Position': { _exists: true, x: 10, y: 20 },
          'entity-2/Position': { _exists: true, x: 30, y: 40 },
        },
      })
      await store.initialize({ components: ALL_COMPONENTS, singletons: ALL_SINGLETONS })

      // First sync should apply the initial state
      executeSync(world, store)

      const state = store.getState()
      expect(state['entity-1/Position']).toMatchObject({ x: 10, y: 20 })
      expect(state['entity-2/Position']).toMatchObject({ x: 30, y: 40 })
    })

    it('applies initialState only once', async () => {
      const { world } = setup()
      store = new CanvasStore({
        initialState: {
          'entity-1/Position': { _exists: true, x: 10, y: 20 },
        },
      })
      await store.initialize({ components: ALL_COMPONENTS, singletons: ALL_SINGLETONS })

      // First sync applies it
      executeSync(world, store)
      expect(store.getState()['entity-1/Position']).toMatchObject({ x: 10, y: 20 })

      // Mutate via ECS to change position
      world.execute((ctx: Context) => {
        const eid = createEntity(ctx)
        addComponent(ctx, eid, Synced, { id: 'entity-3' })
        addComponent(ctx, eid, Position, { x: 99, y: 99 })
      })

      // Second sync should NOT re-inject initialState
      executeSync(world, store)
      const state = store.getState()
      expect(state['entity-3/Position']).toMatchObject({ x: 99, y: 99 })
      // entity-1 should still exist from first sync
      expect(state['entity-1/Position']).toBeDefined()
    })

    it('works with singleton data in initialState', async () => {
      const { world } = setup()
      store = new CanvasStore({
        initialState: {
          'SINGLETON/Camera': { _exists: true, zoom: 2.5 },
        },
      })
      await store.initialize({ components: ALL_COMPONENTS, singletons: ALL_SINGLETONS })

      executeSync(world, store)

      const state = store.getState()
      expect(state['SINGLETON/Camera']).toMatchObject({ zoom: 2.5 })
    })

    it('works with multiple component types in initialState', async () => {
      const { world } = setup()
      store = new CanvasStore({
        initialState: {
          'entity-1/Position': { _exists: true, x: 5, y: 10 },
          'entity-1/Color': { _exists: true, r: 255, g: 0, b: 0 },
        },
      })
      await store.initialize({ components: ALL_COMPONENTS, singletons: ALL_SINGLETONS })

      executeSync(world, store)

      const state = store.getState()
      expect(state['entity-1/Position']).toMatchObject({ x: 5, y: 10 })
      expect(state['entity-1/Color']).toMatchObject({ r: 255, g: 0, b: 0 })
    })

    it('returns empty state when no initialState and no changes', async () => {
      const { world } = setup()
      store = new CanvasStore({})
      await store.initialize({ components: ALL_COMPONENTS, singletons: ALL_SINGLETONS })

      executeSync(world, store)

      expect(store.getState()).toEqual({})
    })

    it('combines initialState with ECS changes on first sync', async () => {
      const { world } = setup()
      store = new CanvasStore({
        initialState: {
          'entity-1/Position': { _exists: true, x: 10, y: 20 },
        },
      })
      await store.initialize({ components: ALL_COMPONENTS, singletons: ALL_SINGLETONS })

      // Add an entity via ECS before first sync
      world.execute((ctx: Context) => {
        const eid = createEntity(ctx)
        addComponent(ctx, eid, Synced, { id: 'entity-2' })
        addComponent(ctx, eid, Position, { x: 50, y: 60 })
      })

      executeSync(world, store)

      const state = store.getState()
      expect(state['entity-1/Position']).toMatchObject({ x: 10, y: 20 })
      expect(state['entity-2/Position']).toMatchObject({ x: 50, y: 60 })
    })
  })

  describe('getState', () => {
    it('returns empty object before initialize', () => {
      store = new CanvasStore({})
      expect(store.getState()).toEqual({})
    })
  })
})
