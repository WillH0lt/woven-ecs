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

    it('handles deletion', async () => {
      const docId = 'delete-test'
      adapter = createAdapter(docId)
      await adapter.init()

      // Add then delete
      adapter.push([makeMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      await new Promise((r) => setTimeout(r, 50))

      adapter.push([makeMutation({ 'e1/Pos': { _exists: false } })])
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // Reload - should be empty
      adapter = createAdapter(docId)
      await adapter.init()

      expect(adapter.pull()).toEqual([])
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
