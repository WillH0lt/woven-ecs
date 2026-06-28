import { afterEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { PersistenceAdapter } from '../src/adapters/Persistence'
import { Origin } from '../src/constants'
import type { Mutation } from '../src/types'

describe('PersistenceAdapter', () => {
  let adapter: PersistenceAdapter

  function createAdapter(documentId = 'test-doc') {
    return new PersistenceAdapter({ documentId, components: [], singletons: [] })
  }

  function makeMutation(patch: Mutation['patch'], origin: Mutation['origin'] = Origin.ECS): Mutation {
    return { patch, origin, syncBehavior: 'document' }
  }

  afterEach(() => {
    if (adapter) {
      adapter.close()
    }
  })

  describe('init', () => {
    it('initializes successfully', async () => {
      adapter = createAdapter()
      await expect(adapter.init()).resolves.toBeUndefined()
    })

    it('returns null pull on fresh database', async () => {
      adapter = createAdapter('fresh-db')
      await adapter.init()
      expect(adapter.pull()).toEqual([])
    })
  })

  describe('push and persistence', () => {
    it('persists mutations and loads them on re-init', async () => {
      const docId = 'persist-test'

      // First session: save data
      adapter = createAdapter(docId)
      await adapter.init()

      adapter.push([
        makeMutation({
          'e1/Pos': { _exists: true, x: 10, y: 20 },
        }),
      ])

      // Allow fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Second session: load data
      adapter = createAdapter(docId)
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].origin).toBe(Origin.Persistence)
      expect(mutations[0].patch['e1/Pos']).toEqual({
        _exists: true,
        x: 10,
        y: 20,
      })
    })

    it('persists partial updates by merging with existing', async () => {
      const docId = 'merge-test'
      adapter = createAdapter(docId)
      await adapter.init()

      // Add component
      adapter.push([makeMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      await new Promise((r) => setTimeout(r, 50))

      // Partial update
      adapter.push([makeMutation({ 'e1/Pos': { x: 50 } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Reload
      adapter = createAdapter(docId)
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      expect(mutations[0].patch['e1/Pos']).toEqual({
        _exists: true,
        x: 50,
        y: 20,
      })
    })

    it('retains a tombstone on deletion so it survives reload', async () => {
      const docId = 'delete-test'
      adapter = createAdapter(docId)
      await adapter.init()

      // Add then delete
      adapter.push([makeMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      await new Promise((r) => setTimeout(r, 50))

      adapter.push([makeMutation({ 'e1/Pos': { _exists: false } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Reload — the deletion is preserved as a tombstone (not dropped) so the
      // websocket mirror can re-assert it after a server rollback.
      adapter = createAdapter(docId)
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBe(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: false })
    })
  })

  describe('pull', () => {
    it('only returns mutations once', async () => {
      const docId = 'pull-once-test'

      // Pre-populate
      adapter = createAdapter(docId)
      await adapter.init()
      adapter.push([makeMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Reload
      adapter = createAdapter(docId)
      await adapter.init()

      const first = adapter.pull()
      expect(first.length).toBeGreaterThan(0)

      const second = adapter.pull()
      expect(second).toEqual([])
    })
  })

  describe('close', () => {
    it('can be called safely', async () => {
      adapter = createAdapter()
      await adapter.init()
      adapter.close()
      // Should not throw when pushing after close
      adapter.push([makeMutation({ 'e1/Pos': { x: 10 } })])
    })
  })

  describe('clear', () => {
    it('clears all persisted state', async () => {
      const docId = 'clear-test'
      adapter = createAdapter(docId)
      await adapter.init()

      adapter.push([
        makeMutation({ 'e1/Pos': { _exists: true, x: 10 } }),
        makeMutation({ 'e2/Vel': { _exists: true, vx: 5 } }),
      ])
      await new Promise((r) => setTimeout(r, 50))

      await adapter.clearAll()
      adapter.close()

      // Reload - should be empty
      adapter = createAdapter(docId)
      await adapter.init()

      expect(adapter.pull()).toEqual([])
    })
  })

  describe('initialState', () => {
    it('seeds IndexedDB when empty', async () => {
      const docId = 'initial-state-seed'
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
          'e2/Pos': { _exists: true, x: 30, y: 40 },
        },
      })
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBe(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: true, x: 10, y: 20 })
      expect(mutations[0].patch['e2/Pos']).toEqual({ _exists: true, x: 30, y: 40 })
    })

    it('persists seed data so it survives without initialState on reload', async () => {
      const docId = 'initial-state-persists'
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
        },
      })
      await adapter.init()
      adapter.close()

      // Reload without initialState
      adapter = createAdapter(docId)
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBe(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: true, x: 10, y: 20 })
    })

    it('ignores initialState when IndexedDB already has data', async () => {
      const docId = 'initial-state-ignored'

      // First session: persist some data
      adapter = createAdapter(docId)
      await adapter.init()
      adapter.push([makeMutation({ 'e1/Pos': { _exists: true, x: 99, y: 99 } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Second session: provide different initialState
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
          'e2/Pos': { _exists: true, x: 30, y: 40 },
        },
      })
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBe(1)
      // Should have persisted data, not initialState
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: true, x: 99, y: 99 })
      // e2 should not exist — it was only in initialState
      expect(mutations[0].patch['e2/Pos']).toBeUndefined()
    })

    it('user modifications persist over initialState across reloads', async () => {
      const docId = 'initial-state-modified'

      // First session: seed with initialState
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
        },
      })
      await adapter.init()

      // User modifies the entity
      adapter.push([makeMutation({ 'e1/Pos': { _exists: true, x: 50, y: 60 } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Second session: same initialState, but user data should win
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
        },
      })
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBe(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: true, x: 50, y: 60 })
    })

    it('user deletions persist over initialState across reloads', async () => {
      const docId = 'initial-state-deleted'

      // First session: seed with initialState
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
          'e2/Pos': { _exists: true, x: 30, y: 40 },
        },
      })
      await adapter.init()

      // User deletes e1
      adapter.push([makeMutation({ 'e1/Pos': { _exists: false } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Second session: initialState still has e1, but it should stay deleted
      adapter = new PersistenceAdapter({
        documentId: docId,
        components: [],
        singletons: [],
        initialState: {
          'e1/Pos': { _exists: true, x: 10, y: 20 },
          'e2/Pos': { _exists: true, x: 30, y: 40 },
        },
      })
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBe(1)
      // e1 was deleted — it comes back as a tombstone (a no-op for the ECS world,
      // so it stays gone) rather than reappearing from initialState.
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: false })
      // e2 should still be there
      expect(mutations[0].patch['e2/Pos']).toEqual({ _exists: true, x: 30, y: 40 })
    })
  })

  describe('concurrent writes (buffer-delta race)', () => {
    // Regression: push() is fire-and-forget and persistMutations does an async
    // read-modify-write per key (get -> materialize buffer deltas -> put). Two
    // overlapping pushes both read the same base before either writes back, so
    // the second put clobbers the first and drops a buffer delta. Because the
    // dropped delta grew the buffer, the next applyBufferDelta zero-fills the
    // indices it had added — persisting (0,0)-style stray values that only
    // surface on reload. push() now serializes persists to keep the RMW atomic.
    it('does not drop a buffer delta when two pushes race on the same key', async () => {
      const docId = 'buffer-delta-race'
      adapter = createAdapter(docId)
      await adapter.init()

      // Establish a full base array [1,2,3,4] (two xy points).
      adapter.push([makeMutation({ 'e1/Stroke': { _exists: true, points: [1, 2, 3, 4] } })])
      await new Promise((r) => setTimeout(r, 50))

      // Two updates fired back-to-back with NO await between them, so their
      // async read-modify-writes interleave. Both are encoded against the
      // *post-A* baseline the ECS adapter would hold:
      //   A grows the buffer, adding indices 4 and 5 ([..,5,6]).
      //   B changes only index 0 and carries the new length, but no values for
      //     indices 4/5 (it assumes A already wrote them).
      // If B's RMW runs against the pre-A base, applyBufferDelta zero-fills 4/5.
      adapter.push([makeMutation({ 'e1/Stroke': { points: { __buf: 1, len: 6, runs: [[4, [5, 6]]] } } })])
      adapter.push([makeMutation({ 'e1/Stroke': { points: { __buf: 1, len: 6, runs: [[0, [9]]] } } })])

      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Reload and assert no index was lost to a zero-fill.
      adapter = createAdapter(docId)
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      // B's index-0 edit applied on top of A's growth — nothing zeroed.
      expect(mutations[0].patch['e1/Stroke']).toEqual({
        _exists: true,
        points: [9, 2, 3, 4, 5, 6],
      })
    })
  })

  describe('multiple entities', () => {
    it('persists and loads multiple entities', async () => {
      const docId = 'multi-entity-test'
      adapter = createAdapter(docId)
      await adapter.init()

      adapter.push([
        makeMutation({
          'e1/Pos': { _exists: true, x: 10, y: 20 },
          'e2/Pos': { _exists: true, x: 30, y: 40 },
          'SINGLETON/Camera': { _exists: true, zoom: 1.5 },
        }),
      ])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      adapter = createAdapter(docId)
      await adapter.init()

      const mutations = adapter.pull()
      expect(mutations.length).toBeGreaterThan(0)
      const patch = mutations[0].patch

      expect(patch['e1/Pos']).toEqual({ _exists: true, x: 10, y: 20 })
      expect(patch['e2/Pos']).toEqual({ _exists: true, x: 30, y: 40 })
      expect(patch['SINGLETON/Camera']).toEqual({
        _exists: true,
        zoom: 1.5,
      })
    })
  })
})
