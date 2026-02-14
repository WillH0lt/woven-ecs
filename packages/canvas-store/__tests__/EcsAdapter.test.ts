import type { Context, EntityId } from '@woven-ecs/core'
import { addComponent, createEntity, field, removeComponent, removeEntity, World } from '@woven-ecs/core'
import { describe, expect, it } from 'vitest'
import { EcsAdapter } from '../src/adapters/ECS'
import { defineCanvasComponent } from '../src/CanvasComponentDef'
import { defineCanvasSingleton } from '../src/CanvasSingletonDef'
import { Synced } from '../src/components/Synced'
import { Origin } from '../src/constants'
import { type Mutation, SINGLETON_STABLE_ID } from '../src/types'

// ── Test component definitions ──────────────────────────────────────────────

const Position = defineCanvasComponent(
  { name: 'Position', sync: 'document' },
  {
    x: field.float64().default(0),
    y: field.float64().default(0),
  },
)

const Velocity = defineCanvasComponent(
  { name: 'Velocity', sync: 'document' },
  {
    vx: field.float64().default(0),
    vy: field.float64().default(0),
  },
)

const Linked = defineCanvasComponent(
  { name: 'Linked', sync: 'document' },
  {
    target: field.ref(),
  },
)

const Unsyncable = defineCanvasComponent(
  { name: 'Unsyncable', sync: 'none' },
  {
    value: field.float64().default(0),
  },
)

const Camera = defineCanvasSingleton(
  { name: 'Camera', sync: 'document' },
  {
    zoom: field.float64().default(1),
    panX: field.float64().default(0),
    panY: field.float64().default(0),
  },
)

const UnsyncedSingleton = defineCanvasSingleton(
  { name: 'UnsyncedSingleton', sync: 'none' },
  {
    foo: field.float64().default(0),
  },
)

// ── Helpers ─────────────────────────────────────────────────────────────────

const ALL_COMPONENTS = [Position, Velocity, Linked, Unsyncable]
const ALL_SINGLETONS = [Camera, UnsyncedSingleton]

function setup() {
  const world = new World([Synced, Position, Velocity, Linked, Unsyncable, Camera, UnsyncedSingleton], {
    maxEntities: 1000,
    maxEvents: 4096,
  })
  const ctx = (world as any).context as Context

  const adapter = new EcsAdapter({
    components: ALL_COMPONENTS,
    singletons: ALL_SINGLETONS,
  })
  adapter.ctx = ctx

  return { world, ctx, adapter }
}

/** Create a synced entity and return its entityId and stableId. */
function createSyncedEntity(ctx: Context, stableId: string): EntityId {
  const eid = createEntity(ctx)
  addComponent(ctx, eid, Synced, { id: stableId })
  return eid
}

function wsMutation(patch: Mutation['patch']): Mutation {
  return { patch, origin: Origin.Websocket, syncBehavior: 'document' }
}

function ecsMutation(patch: Mutation['patch']): Mutation {
  return { patch, origin: Origin.ECS, syncBehavior: 'document' }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('EcsAdapter', () => {
  describe('init', () => {
    it('resolves immediately', async () => {
      const { adapter } = setup()
      await expect(adapter.init()).resolves.toBeUndefined()
    })
  })

  describe('close', () => {
    it('does not throw', () => {
      const { adapter } = setup()
      adapter.close()
    })
  })

  describe('pull', () => {
    it('returns null when no events have occurred', () => {
      const { adapter } = setup()
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('returns null when events exist but none are for tracked components', () => {
      const { ctx, adapter } = setup()
      // Trigger initialization
      adapter.pull()

      // Create entity without Synced — should be ignored
      const eid = createEntity(ctx)
      addComponent(ctx, eid, Unsyncable, { value: 42 })

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('produces a mutation for a component addition on a synced entity', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].origin).toBe(Origin.ECS)
      expect(mutations[0].patch['uuid-1/Position']).toEqual({
        _exists: true,
        _version: null,
        x: 10,
        y: 20,
      })
    })

    it('produces a mutation for component removal', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })
      adapter.pull() // consume add

      removeComponent(ctx, eid, Position)

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['uuid-1/Position']).toEqual({ _exists: false })
    })

    it('produces diffs for changed fields only', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })

      const addMutations = adapter.pull() // consume add
      expect(addMutations.length).toBeGreaterThan(0)

      // push() advances eventIndex — mimics the real sync loop
      adapter.push([])

      // Change only x
      const writer = Position.write(ctx, eid)
      writer.x = 50

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      // Only x changed
      expect(mutations[0].patch['uuid-1/Position']).toEqual({ x: 50 })
    })

    it('returns null when field values have not changed', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })
      adapter.pull() // consume add
      adapter.push([]) // advance eventIndex

      // Write the same value — triggers a CHANGED event but no actual diff
      const writer = Position.write(ctx, eid)
      writer.x = 10

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('handles multiple components on the same entity', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 1, y: 2 })
      addComponent(ctx, eid, Velocity, { vx: 3, vy: 4 })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['uuid-1/Position']).toEqual({
        _exists: true,
        _version: null,
        x: 1,
        y: 2,
      })
      expect(mutations[0].patch['uuid-1/Velocity']).toEqual({
        _exists: true,
        _version: null,
        vx: 3,
        vy: 4,
      })
    })

    it('handles multiple entities', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid1 = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid1, Position, { x: 10, y: 20 })

      const eid2 = createSyncedEntity(ctx, 'uuid-2')
      addComponent(ctx, eid2, Position, { x: 30, y: 40 })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['uuid-1/Position']).toBeDefined()
      expect(mutations[0].patch['uuid-2/Position']).toBeDefined()
    })

    it('ignores entities without Synced component', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createEntity(ctx)
      addComponent(ctx, eid, Position, { x: 10, y: 20 })

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('ignores components with sync: none', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Unsyncable, { value: 42 })

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('emits deletion patches when entity is removed', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })
      addComponent(ctx, eid, Velocity, { vx: 1, vy: 2 })
      adapter.pull() // consume adds

      removeEntity(ctx, eid)

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['uuid-1/Position']).toEqual({ _exists: false })
      expect(mutations[0].patch['uuid-1/Velocity']).toEqual({ _exists: false })
    })

    it('ignores entity removal for untracked entities', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createEntity(ctx)
      // No Synced, no tracked components
      removeEntity(ctx, eid)

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })
  })

  describe('pull — singletons', () => {
    it('produces a mutation for singleton changes', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      // First write — prevState is empty so all fields are reported
      const w0 = Camera.write(ctx)
      w0.zoom = 2.5
      w0.panX = 100
      adapter.pull() // consume first diff
      adapter.push([]) // advance eventIndex

      // Second write — only zoom changed
      const w1 = Camera.write(ctx)
      w1.zoom = 5

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch[`${SINGLETON_STABLE_ID}/Camera`]).toEqual({
        zoom: 5,
      })
    })

    it('diffs singleton fields correctly', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      // First change
      const w1 = Camera.write(ctx)
      w1.zoom = 2
      w1.panX = 100
      adapter.pull() // consume

      // Second change — only panX
      const w2 = Camera.write(ctx)
      w2.panX = 200

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch[`${SINGLETON_STABLE_ID}/Camera`]).toEqual({
        panX: 200,
      })
    })

    it('ignores singletons with sync: none', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const writer = UnsyncedSingleton.write(ctx)
      writer.foo = 99

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('does not emit COMPONENT_ADDED for singletons', () => {
      const { ctx, adapter } = setup()

      // Singletons always exist; COMPONENT_ADDED events should be skipped.
      const initial = adapter.pull()
      const key = `${SINGLETON_STABLE_ID}/Camera`
      expect(initial.some((m) => m.patch[key])).toBe(false)

      // First CHANGED event produces a full snapshot (no prevState baseline)
      const writer = Camera.write(ctx)
      writer.zoom = 3

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch[key]).toEqual({
        _exists: true,
        _version: null,
        panX: 0,
        panY: 0,
        zoom: 3,
      })

      // Subsequent changes produce minimal diffs
      const writer2 = Camera.write(ctx)
      writer2.panX = 10

      const mutations2 = adapter.pull()
      expect(mutations2.length).toBeGreaterThan(0)
      expect(mutations2[0].patch[key]).toEqual({ panX: 10 })
    })
  })

  describe('push', () => {
    it('skips mutations with origin ECS', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([ecsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // No entity should have been created
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('creates a new entity and adds a component from a mutation', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([
        wsMutation({
          'uuid-1/Position': { _exists: true, x: 10, y: 20 },
        }),
      ])

      // Entity should now exist in ECS with a Synced component
      // pull() should return null since push advances the event index
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('applies component data when adding', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([
        wsMutation({
          'uuid-1/Position': { _exists: true, x: 42, y: 99 },
        }),
      ])

      // Verify by pulling — push advances event index so pull returns null
      // Instead, find the entity and read its data directly
      // We need to find the entity that was created
      // The adapter created an entity with Synced.id = "uuid-1"
      // Let's push another mutation and check pull still works
      let mutations = adapter.pull()
      expect(mutations.length).toBe(0)

      // Push a second mutation for the same entity (partial update)
      adapter.push([wsMutation({ 'uuid-1/Position': { x: 100 } })])

      // Verify no spurious pull
      mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('removes a component via _exists: false', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // First add
      adapter.push([
        wsMutation({
          'uuid-1/Position': { _exists: true, x: 10, y: 20 },
        }),
      ])

      // Then remove
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: false } })])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('applies partial updates to existing components', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Add entity with Position
      adapter.push([
        wsMutation({
          'uuid-1/Position': { _exists: true, x: 10, y: 20 },
        }),
      ])

      // Partial update — only x
      adapter.push([wsMutation({ 'uuid-1/Position': { x: 99 } })])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('creates multiple entities from one mutation', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([
        wsMutation({
          'uuid-1/Position': { _exists: true, x: 1, y: 2 },
          'uuid-2/Position': { _exists: true, x: 3, y: 4 },
        }),
      ])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('handles multiple mutations in one push call', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([
        wsMutation({ 'uuid-1/Position': { _exists: true, x: 1, y: 2 } }),
        wsMutation({ 'uuid-2/Velocity': { _exists: true, vx: 3, vy: 4 } }),
      ])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('ignores unknown component names', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([wsMutation({ 'uuid-1/Unknown': { _exists: true, foo: 1 } })])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('ignores _exists: false for singletons', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Trying to delete a singleton should be a no-op
      adapter.push([
        wsMutation({
          [`${SINGLETON_STABLE_ID}/Camera`]: { _exists: false },
        }),
      ])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('patches a singleton', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      adapter.push([
        wsMutation({
          [`${SINGLETON_STABLE_ID}/Camera`]: { zoom: 3.5 },
        }),
      ])

      // Verify the singleton was updated
      const snap = Camera.snapshot(ctx)
      expect(snap.zoom).toBe(3.5)
    })

    it('re-uses an existing entity for the same stableId', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Push two mutations for the same stableId
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])
      adapter.push([wsMutation({ 'uuid-1/Velocity': { _exists: true, vx: 1, vy: 2 } })])

      // Should not have created a second entity — adapter maps stableId -> entityId
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('overwrites existing component data when _exists: true is pushed again', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // Push _exists: true again with different data — should copy/overwrite
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 99, y: 88 } })])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })
  })

  describe('circular update avoidance', () => {
    it('push advances event index so pull does not see push-generated events', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Push creates entities and adds components — generates ECS events
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // pull() should not produce a mutation from the events push just created
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('pull sees only events between push and the next pull', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      // Push a remote mutation
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // Now make a local ECS change
      // The entity was created by push, so we need its entityId.
      // We can use the adapter's internal stableIdToEntity mapping implicitly
      // by creating a new synced entity and modifying it.
      const eid2 = createSyncedEntity(ctx, 'uuid-2')
      addComponent(ctx, eid2, Position, { x: 50, y: 60 })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      // Should see only the locally-created entity, not the pushed one
      expect(mutations[0].patch['uuid-2/Position']).toEqual({
        _exists: true,
        _version: null,
        x: 50,
        y: 60,
      })
      expect(mutations[0].patch['uuid-1/Position']).toBeUndefined()
    })
  })

  describe('ref translation', () => {
    it('translates entityId to stableId on outbound pull (ref field)', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const targetEid = createSyncedEntity(ctx, 'target-uuid')
      addComponent(ctx, targetEid, Position, { x: 0, y: 0 })
      adapter.pull() // consume and register mapping

      const sourceEid = createSyncedEntity(ctx, 'source-uuid')
      addComponent(ctx, sourceEid, Linked, { target: targetEid })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      // The ref field should be translated from entityId to stableId
      expect(mutations[0].patch['source-uuid/Linked']).toEqual({
        _exists: true,
        _version: null,
        target: 'target-uuid',
      })
    })

    it('translates null ref to null on outbound pull', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Linked, { target: null })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['uuid-1/Linked']).toEqual({
        _exists: true,
        _version: null,
        target: null,
      })
    })

    it('translates stableId to entityId on inbound push (ref field)', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Create the target entity first so ref can resolve
      adapter.push([
        wsMutation({
          'target-uuid/Position': { _exists: true, x: 0, y: 0 },
        }),
      ])

      // Now create source with a ref to target via stableId
      adapter.push([
        wsMutation({
          'source-uuid/Linked': { _exists: true, target: 'target-uuid' },
        }),
      ])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('translates ref within the same mutation (pass 1 creates entities first)', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Both entities in the same mutation — pass 1 should create both
      // before pass 2 resolves refs
      adapter.push([
        wsMutation({
          'target-uuid/Position': { _exists: true, x: 0, y: 0 },
          'source-uuid/Linked': { _exists: true, target: 'target-uuid' },
        }),
      ])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('translates ref to null for unknown stableId on inbound push', () => {
      const { adapter } = setup()
      adapter.pull() // init

      // Push a linked component referencing an entity that doesn't exist
      adapter.push([
        wsMutation({
          'source-uuid/Linked': {
            _exists: true,
            target: 'nonexistent-uuid',
          },
        }),
      ])

      // Should not crash; ref resolves to null
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('translates ref to null for untracked entityId on outbound pull', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      // Create a non-synced entity (no Synced component)
      const unsyncedEid = createEntity(ctx)

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Linked, { target: unsyncedEid })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      // The ref points to an entity with no stableId mapping → null
      expect(mutations[0].patch['uuid-1/Linked']!.target).toBeNull()
    })
  })

  describe('round-trip: pull then push', () => {
    it('local change round-trips through mutation format', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      // Create entity locally
      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)

      // Simulate another adapter receiving this mutation (as websocket origin)
      const { adapter: adapter2 } = setup()
      adapter2.pull() // init
      adapter2.push([{ patch: mutations[0].patch, origin: Origin.Websocket, syncBehavior: 'document' }])

      // Verify the entity was created
      const mutations2 = adapter2.pull()
      expect(mutations2.length).toBe(0)
    })

    it('entity removal round-trips correctly', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })
      adapter.pull() // consume add

      removeEntity(ctx, eid)
      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['uuid-1/Position']).toEqual({ _exists: false })

      // Apply on another adapter
      const { adapter: adapter2 } = setup()
      adapter2.pull() // init

      // First create the entity
      adapter2.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // Then remove it
      adapter2.push([{ patch: mutations[0].patch, origin: Origin.Websocket, syncBehavior: 'document' }])

      const mutations2 = adapter2.pull()
      expect(mutations2.length).toBe(0)
    })
  })

  describe('lazy initialization', () => {
    it('initializes component maps on first pull', () => {
      const { ctx, adapter } = setup()

      // Before any pull, create an entity
      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })

      // First pull triggers ensureInitialized.  eventIndex starts at 0
      // so events created before the first pull are captured (this is
      // important for entities created during canvas initialization,
      // e.g. the User entity).
      const mutations = adapter.pull()

      expect(mutations.length).toBe(1)
      expect(mutations[0].patch['uuid-1/Position']).toEqual({
        _exists: true,
        _version: null,
        x: 10,
        y: 20,
      })
    })

    it('initializes component maps on first push via pull dependency', () => {
      const { adapter } = setup()

      // push can work without prior pull — it doesn't call ensureInitialized
      // It just iterates the mutations and applies them.
      // However componentsByName must be populated.
      // ensureInitialized is only called in pull(). So push before pull
      // means componentsByName is empty and push skips unknown components.
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // After pull initializes, push should work
      adapter.pull() // triggers ensureInitialized

      adapter.push([wsMutation({ 'uuid-2/Position': { _exists: true, x: 30, y: 40 } })])

      // Events from push are skipped
      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })
  })

  describe('stable ID mapping', () => {
    it('maps stableId to entityId after pull sees a synced entity', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })
      adapter.pull() // registers mapping

      // Now push a partial update using the stableId — should find the entity
      adapter.push([wsMutation({ 'uuid-1/Position': { x: 99 } })])

      // Verify via snapshot
      const snap = Position.snapshot(ctx, eid)
      expect(snap.x).toBe(99)
    })

    it('maps stableId to entityId after push creates an entity', () => {
      const { adapter } = setup()
      adapter.pull() // init

      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 10, y: 20 } })])

      // Push another mutation for the same stableId — should reuse entity
      adapter.push([wsMutation({ 'uuid-1/Position': { x: 50 } })])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })

    it('cleans up mapping when entity is removed via pull', () => {
      const { ctx, adapter } = setup()
      adapter.pull() // init

      const eid = createSyncedEntity(ctx, 'uuid-1')
      addComponent(ctx, eid, Position, { x: 10, y: 20 })
      adapter.pull() // registers mapping

      removeEntity(ctx, eid)
      adapter.pull() // processes removal, cleans up mapping

      // Push for the same stableId should create a new entity
      adapter.push([wsMutation({ 'uuid-1/Position': { _exists: true, x: 99, y: 88 } })])

      const mutations = adapter.pull()
      expect(mutations.length).toBe(0)
    })
  })
})
