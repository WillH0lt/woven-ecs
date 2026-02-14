import { field } from '@woven-ecs/core'
import { describe, expect, it } from 'vitest'
import { HistoryAdapter } from '../src/adapters/History'
import { defineCanvasComponent } from '../src/CanvasComponentDef'
import { defineCanvasSingleton } from '../src/CanvasSingletonDef'
import { Origin } from '../src/constants'
import type { Mutation } from '../src/types'

describe('HistoryAdapter', () => {
  function createAdapter(opts?: { commitAfterFrames?: number; maxHistoryStackSize?: number }) {
    // Default to 1 frame for easier testing
    return new HistoryAdapter({
      components: [],
      singletons: [],
      commitCheckpointAfterFrames: 1,
      ...opts,
    })
  }

  /** Simulate N quiet frames (pushes with no ECS mutations) */
  function advanceFrames(adapter: HistoryAdapter, n: number) {
    for (let i = 0; i < n; i++) {
      adapter.push([])
    }
  }

  function ecsMutation(patch: Mutation['patch']): Mutation {
    return { patch, origin: Origin.ECS, syncBehavior: 'document' }
  }

  function wsMutation(patch: Mutation['patch']): Mutation {
    return { patch, origin: Origin.Websocket, syncBehavior: 'document' }
  }

  describe('init', () => {
    it('resolves immediately', async () => {
      const adapter = createAdapter()
      await expect(adapter.init()).resolves.toBeUndefined()
    })
  })

  describe('push', () => {
    it('does nothing with empty mutations', () => {
      const adapter = createAdapter()
      adapter.push([])
      expect(adapter.canUndo()).toBe(false)
    })

    it('only tracks ECS-originated mutations', () => {
      const adapter = createAdapter()
      adapter.push([wsMutation({ 'e1/Pos': { x: 10 } })])
      expect(adapter.canUndo()).toBe(false)
    })

    it('tracks ECS mutations for undo', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      expect(adapter.canUndo()).toBe(true)
    })

    it('clears redo stack on new push', () => {
      const adapter = createAdapter()

      // Create some undo history
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)

      adapter.undo()
      expect(adapter.canRedo()).toBe(true)

      // New mutation should clear redo
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 50 } })])
      expect(adapter.canRedo()).toBe(false)
    })
  })

  describe('pull', () => {
    it('returns empty array when no pending mutations', () => {
      const adapter = createAdapter()
      expect(adapter.pull()).toEqual([])
    })

    it('returns pending mutation from undo and clears it', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)

      adapter.undo()
      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      expect(mutation[0].origin).toBe(Origin.History)

      // Second pull should be empty array
      expect(adapter.pull()).toEqual([])
    })
  })

  describe('undo/redo with state tracking', () => {
    it('undoes an addition (inverse is deletion)', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      advanceFrames(adapter, 1)

      const undid = adapter.undo()
      expect(undid).toBe(true)

      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      // Inverse of adding should be deletion
      expect(mutation[0].patch['e1/Pos']).toEqual({ _exists: false })
    })

    it('undoes a deletion (inverse is restoration)', () => {
      const adapter = createAdapter()

      // First add component
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      advanceFrames(adapter, 1)

      // Then delete it
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: false } })])
      advanceFrames(adapter, 1)

      const undid = adapter.undo()
      expect(undid).toBe(true)

      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      // Inverse of deletion should restore the component with _exists
      expect(mutation[0].patch['e1/Pos']).toEqual({
        _exists: true,
        x: 10,
        y: 20,
      })
    })

    it('undoes a partial update (inverse restores previous values)', () => {
      const adapter = createAdapter()

      // Add component
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      advanceFrames(adapter, 1)

      // Partially update
      adapter.push([ecsMutation({ 'e1/Pos': { x: 50 } })])
      advanceFrames(adapter, 1)

      const undid = adapter.undo()
      expect(undid).toBe(true)

      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      // Inverse should restore x to its previous value
      expect(mutation[0].patch['e1/Pos']).toEqual({ x: 10 })
    })

    it('redo re-applies forward mutations', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      advanceFrames(adapter, 1)

      adapter.push([ecsMutation({ 'e1/Pos': { x: 50 } })])
      advanceFrames(adapter, 1)

      adapter.undo()
      adapter.pull() // consume undo mutation

      const redone = adapter.redo()
      expect(redone).toBe(true)

      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      // Redo should re-apply the forward mutation
      expect(mutation[0].patch['e1/Pos']).toEqual({ x: 50 })
    })
  })

  describe('undo returns false when empty', () => {
    it('returns false when no history', () => {
      const adapter = createAdapter()
      expect(adapter.undo()).toBe(false)
    })

    it('returns false after undoing everything', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)

      adapter.undo()
      expect(adapter.undo()).toBe(false)
    })
  })

  describe('redo returns false when empty', () => {
    it('returns false when no redo history', () => {
      const adapter = createAdapter()
      expect(adapter.redo()).toBe(false)
    })
  })

  describe('checkpoint creation', () => {
    it('batches mutations until quiet frames pass', () => {
      const adapter = createAdapter({ commitAfterFrames: 3 })

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10, y: 20 } })])
      // More activity before quiet frames
      adapter.push([ecsMutation({ 'e1/Pos': { x: 50 } })])

      // Wait for 3 quiet frames
      advanceFrames(adapter, 3)

      // Both mutations should be in one checkpoint
      adapter.undo()
      const mutation = adapter.pull()
      // Should undo both (merged into a single mutation)
      expect(mutation).toHaveLength(1)
    })

    it('flushes pending on undo if dirty', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      // Don't wait for timeout - undo should flush

      const undid = adapter.undo()
      expect(undid).toBe(true)
    })
  })

  describe('maxHistoryStackSize', () => {
    it('trims undo stack when exceeding max', () => {
      const adapter = createAdapter({ maxHistoryStackSize: 2 })

      for (let i = 0; i < 5; i++) {
        adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: i } })])
        advanceFrames(adapter, 1)
      }

      // Should only be able to undo 2 times
      expect(adapter.undo()).toBe(true)
      expect(adapter.undo()).toBe(true)
      expect(adapter.undo()).toBe(false)
    })
  })

  describe('canUndo / canRedo', () => {
    it('canUndo is true when dirty (pending mutations)', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      expect(adapter.canUndo()).toBe(true)
    })

    it('canUndo is true with undo stack', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)
      expect(adapter.canUndo()).toBe(true)
    })

    it('canRedo is true after undo', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)
      adapter.undo()
      expect(adapter.canRedo()).toBe(true)
    })

    it('canRedo is false with no redo stack', () => {
      const adapter = createAdapter()
      expect(adapter.canRedo()).toBe(false)
    })
  })

  describe('close', () => {
    it('clears pending callbacks', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      adapter.close()
      // Should not throw or create checkpoints after close
      advanceFrames(adapter, 10)
    })
  })

  describe('undo/redo with remote changes (Figma principle)', () => {
    it('undo then redo is a no-op when remote changes occurred', () => {
      const adapter = createAdapter()

      // User changes x: 0 → 10
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)

      // Remote changes x to 50
      adapter.push([wsMutation({ 'e1/Pos': { x: 50 } })])

      // Undo the user's last change
      adapter.undo()
      const undoMut = adapter.pull()[0]
      // Inverse restores x to 0 (pre-user-change value)
      expect(undoMut.patch['e1/Pos']).toEqual({ x: 0 })

      // Push the undo result back through (simulating the sync loop)
      adapter.push([
        {
          patch: undoMut.patch,
          origin: Origin.History,
          syncBehavior: 'document',
        },
      ])

      // Redo — should restore x to 50 (the pre-undo state), NOT x to 10
      adapter.redo()
      const redoMut = adapter.pull()[0]
      expect(redoMut.patch['e1/Pos']).toEqual({ x: 50 })
    })

    it('multiple undo then multiple redo restores original state with remote changes', () => {
      const adapter = createAdapter()

      // User creates entity
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0, y: 0 } })])
      advanceFrames(adapter, 1)

      // User changes x
      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)

      // User changes y
      adapter.push([ecsMutation({ 'e1/Pos': { y: 20 } })])
      advanceFrames(adapter, 1)

      // Remote changes x to 99
      adapter.push([wsMutation({ 'e1/Pos': { x: 99 } })])

      // State is now: x=99, y=20

      // Undo y change
      adapter.undo()
      const undo1 = adapter.pull()[0]
      adapter.push([
        {
          patch: undo1.patch,
          origin: Origin.History,
          syncBehavior: 'document',
        },
      ])

      // Undo x change
      adapter.undo()
      const undo2 = adapter.pull()[0]
      adapter.push([
        {
          patch: undo2.patch,
          origin: Origin.History,
          syncBehavior: 'document',
        },
      ])

      // Redo x change — should restore x to 99 (pre-first-undo), not 10
      adapter.redo()
      const redo1 = adapter.pull()[0]
      adapter.push([
        {
          patch: redo1.patch,
          origin: Origin.History,
          syncBehavior: 'document',
        },
      ])
      expect(redo1.patch['e1/Pos']).toEqual({ x: 99 })

      // Redo y change — should restore y to 20
      adapter.redo()
      const redo2 = adapter.pull()[0]
      expect(redo2.patch['e1/Pos']).toEqual({ y: 20 })
    })

    it('redo after remote change on same key preserves pre-undo state', () => {
      const adapter = createAdapter()

      // User adds entity with x=10
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)

      // Remote changes x to 50
      adapter.push([wsMutation({ 'e1/Pos': { x: 50 } })])

      // Undo creation — deletes entity
      adapter.undo()
      const undoMut = adapter.pull()[0]
      expect(undoMut.patch['e1/Pos']).toEqual({ _exists: false })
      adapter.push([
        {
          patch: undoMut.patch,
          origin: Origin.History,
          syncBehavior: 'document',
        },
      ])

      // Redo — should restore entity with x=50 (remote value was present)
      adapter.redo()
      const redoMut = adapter.pull()[0]
      expect(redoMut.patch['e1/Pos']).toEqual({ _exists: true, x: 50 })
    })

    it('repeated undo/redo cycles remain stable', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)

      // Remote changes x to 50
      adapter.push([wsMutation({ 'e1/Pos': { x: 50 } })])

      // Cycle 1: undo then redo
      adapter.undo()
      let mut = adapter.pull()[0]
      adapter.push([{ patch: mut.patch, origin: Origin.History, syncBehavior: 'document' }])
      adapter.redo()
      mut = adapter.pull()[0]
      adapter.push([{ patch: mut.patch, origin: Origin.History, syncBehavior: 'document' }])
      expect(mut.patch['e1/Pos']).toEqual({ x: 50 })

      // Cycle 2: undo then redo again — should still restore to 50
      adapter.undo()
      mut = adapter.pull()[0]
      adapter.push([{ patch: mut.patch, origin: Origin.History, syncBehavior: 'document' }])
      adapter.redo()
      mut = adapter.pull()[0]
      expect(mut.patch['e1/Pos']).toEqual({ x: 50 })
    })
  })

  describe('no-op delta filtering', () => {
    it('discards create-then-delete within the same batch', () => {
      const adapter = createAdapter()

      // Create entity
      adapter.push([
        ecsMutation({
          'e1/Block': { _exists: true, type: 'text' },
          'e1/Text': { _exists: true, content: '' },
        }),
      ])

      // Delete entity in the same batch (before commit)
      adapter.push([
        ecsMutation({
          'e1/Block': { _exists: false },
          'e1/Text': { _exists: false },
        }),
      ])

      // Wait for commit
      advanceFrames(adapter, 1)

      // Should not have any undo steps since the net effect is a no-op
      expect(adapter.canUndo()).toBe(false)
    })

    it('keeps real changes when only some keys are no-ops', () => {
      const adapter = createAdapter()

      // Create two entities
      adapter.push([
        ecsMutation({
          'e1/Block': { _exists: true, type: 'text' },
          'e2/Block': { _exists: true, type: 'rect' },
        }),
      ])

      // Delete only e1 (e2 remains)
      adapter.push([
        ecsMutation({
          'e1/Block': { _exists: false },
        }),
      ])

      // Wait for commit
      advanceFrames(adapter, 1)

      // Should still have an undo step for e2's creation
      expect(adapter.canUndo()).toBe(true)

      adapter.undo()
      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      // Only e2 should be in the inverse (e1 was a no-op)
      expect(mutation[0].patch['e2/Block']).toEqual({ _exists: false })
      expect(mutation[0].patch['e1/Block']).toBeUndefined()
    })
  })

  describe('multiple keys in single mutation', () => {
    it('handles mutations affecting multiple entity/component keys', () => {
      const adapter = createAdapter()

      adapter.push([
        ecsMutation({
          'e1/Pos': { _exists: true, x: 10 },
          'e2/Pos': { _exists: true, x: 20 },
        }),
      ])
      advanceFrames(adapter, 1)

      const undid = adapter.undo()
      expect(undid).toBe(true)

      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      // Both keys should be in the inverse
      expect('e1/Pos' in mutation[0].patch).toBe(true)
      expect('e2/Pos' in mutation[0].patch).toBe(true)
    })
  })

  describe('createCheckpoint', () => {
    it('returns a string id', () => {
      const adapter = createAdapter()
      const cp = adapter.createCheckpoint()
      expect(typeof cp).toBe('string')
      expect(cp.length).toBeGreaterThan(0)
    })

    it('commits pending changes before creating checkpoint', () => {
      const adapter = createAdapter()
      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      // Don't wait for timeout
      const cp = adapter.createCheckpoint()
      expect(typeof cp).toBe('string')
      // The pending change should now be committed
      expect(adapter.canUndo()).toBe(true)
    })

    it('returns unique ids for each checkpoint', () => {
      const adapter = createAdapter()
      const cp1 = adapter.createCheckpoint()
      const cp2 = adapter.createCheckpoint()
      expect(cp1).not.toBe(cp2)
    })
  })

  describe('revertToCheckpoint', () => {
    it('reverts all changes since checkpoint', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 20 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 30 } })])
      advanceFrames(adapter, 1)

      const reverted = adapter.revertToCheckpoint(cp)
      expect(reverted).toBe(true)

      // Should have inverse patches to revert all 3 changes
      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)
      expect(mutation[0].origin).toBe(Origin.History)
    })

    it('clears redo stack after revert', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)

      // Create some redo history
      adapter.undo()
      adapter.pull()
      adapter.redo()
      adapter.pull()

      adapter.revertToCheckpoint(cp)
      expect(adapter.canRedo()).toBe(false)
    })

    it('returns false for invalid checkpoint id', () => {
      const adapter = createAdapter()
      const result = adapter.revertToCheckpoint('invalid-id')
      expect(result).toBe(false)
    })

    it('returns false if no changes since checkpoint', () => {
      const adapter = createAdapter()
      const cp = adapter.createCheckpoint()
      const result = adapter.revertToCheckpoint(cp)
      expect(result).toBe(false)
    })

    it('invalidates checkpoint after use', () => {
      const adapter = createAdapter()

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)

      adapter.revertToCheckpoint(cp)
      // Second call should fail
      const result = adapter.revertToCheckpoint(cp)
      expect(result).toBe(false)
    })

    it('commits pending changes before reverting', () => {
      const adapter = createAdapter()

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      // Don't wait for timeout

      const reverted = adapter.revertToCheckpoint(cp)
      expect(reverted).toBe(true)
    })
  })

  describe('squashToCheckpoint', () => {
    it('combines multiple changes into single undo step', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 20 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 30 } })])
      advanceFrames(adapter, 1)

      const squashed = adapter.squashToCheckpoint(cp)
      expect(squashed).toBe(true)

      // Should only need one undo to revert all 3 changes
      adapter.undo()
      const mutation = adapter.pull()
      expect(mutation).toHaveLength(1)

      // One more undo should go back to before the checkpoint
      adapter.undo()
      const prevMutation = adapter.pull()
      expect(prevMutation).toHaveLength(1)
      // This should be the deletion of the original entity
      expect(prevMutation[0].patch['e1/Pos']).toEqual({ _exists: false })
    })

    it('returns false for invalid checkpoint id', () => {
      const adapter = createAdapter()
      const result = adapter.squashToCheckpoint('invalid-id')
      expect(result).toBe(false)
    })

    it('returns false if no changes since checkpoint', () => {
      const adapter = createAdapter()
      const cp = adapter.createCheckpoint()
      // squashToCheckpoint returns false when there are no changes to squash
      const result = adapter.squashToCheckpoint(cp)
      expect(result).toBe(false)
      // canUndo should be false since there was nothing to squash
      expect(adapter.canUndo()).toBe(false)
    })

    it('invalidates checkpoint after use', () => {
      const adapter = createAdapter()

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      advanceFrames(adapter, 1)

      adapter.squashToCheckpoint(cp)
      // Second call should fail because checkpoint was deleted
      const result = adapter.squashToCheckpoint(cp)
      expect(result).toBe(false)
    })

    it('commits pending changes before squashing', () => {
      const adapter = createAdapter()

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 10 } })])
      // Don't wait for frames - squash commits pending immediately

      const squashed = adapter.squashToCheckpoint(cp)
      expect(squashed).toBe(true)
      // Verify it was squashed - should have one undo step
      expect(adapter.canUndo()).toBe(true)
    })
  })

  describe('checkpoint invalidation', () => {
    it('invalidates checkpoint when undo goes past it', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)

      // Undo past the checkpoint
      adapter.undo() // undo x: 10
      adapter.undo() // undo x: 0 (creation)

      // Checkpoint should now be invalid
      adapter.redo()
      adapter.redo()
      adapter.push([ecsMutation({ 'e1/Pos': { x: 20 } })])
      advanceFrames(adapter, 1)

      const result = adapter.revertToCheckpoint(cp)
      expect(result).toBe(false)
    })

    it('adjusts checkpoint index when old entries are trimmed', () => {
      const adapter = createAdapter({ maxHistoryStackSize: 3 })

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)

      // Add more entries to trigger trimming
      adapter.push([ecsMutation({ 'e1/Pos': { x: 20 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 30 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 40 } })])
      advanceFrames(adapter, 1)

      // The checkpoint's original entry has been trimmed, so it should be invalid
      const result = adapter.revertToCheckpoint(cp)
      expect(result).toBe(false)
    })

    it('checkpoint remains valid when undo does not reach it', () => {
      const adapter = createAdapter()

      adapter.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      advanceFrames(adapter, 1)

      const cp = adapter.createCheckpoint()

      adapter.push([ecsMutation({ 'e1/Pos': { x: 10 } })])
      advanceFrames(adapter, 1)
      adapter.push([ecsMutation({ 'e1/Pos': { x: 20 } })])
      advanceFrames(adapter, 1)

      // Undo only one step (not past checkpoint)
      adapter.undo()

      // Checkpoint should still be valid
      const result = adapter.revertToCheckpoint(cp)
      expect(result).toBe(true)
    })
  })

  describe('excludeFromHistory', () => {
    const TestComponent = defineCanvasComponent(
      {
        name: 'Test',
        sync: 'document',
        excludeFromHistory: ['excluded'],
      },
      {
        included: field.int32().default(0),
        excluded: field.int32().default(0),
      },
    )

    const TestSingleton = defineCanvasSingleton(
      {
        name: 'TestSingleton',
        sync: 'document',
        excludeFromHistory: ['excluded'],
      },
      {
        included: field.int32().default(0),
        excluded: field.int32().default(0),
      },
    )

    function createAdapterWithExclusions() {
      return new HistoryAdapter({
        components: [TestComponent],
        singletons: [TestSingleton],
        commitCheckpointAfterFrames: 1,
      })
    }

    it('excludes specified fields from history tracking', () => {
      const adapter = createAdapterWithExclusions()

      // Change both included and excluded fields
      adapter.push([
        ecsMutation({
          'e1/Test': { _exists: true, included: 10, excluded: 20 },
        }),
      ])
      advanceFrames(adapter, 1)

      adapter.undo()
      const mutation = adapter.pull()

      // Undo should only affect the included field
      expect(mutation).toHaveLength(1)
      expect(mutation[0].patch['e1/Test']).toEqual({ _exists: false })
      // The excluded field should not appear in the undo
    })

    it('does not record changes to only excluded fields', () => {
      const adapter = createAdapterWithExclusions()

      // First add the component with both fields
      adapter.push([
        ecsMutation({
          'e1/Test': { _exists: true, included: 10, excluded: 20 },
        }),
      ])
      advanceFrames(adapter, 1)

      // Now change only the excluded field
      adapter.push([
        ecsMutation({
          'e1/Test': { excluded: 30 },
        }),
      ])
      advanceFrames(adapter, 1)

      // Undo should skip the excluded-only change and undo the creation
      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      // Should be undoing the creation, not the excluded field change
      expect(mutation[0].patch['e1/Test']).toEqual({ _exists: false })
    })

    it('records changes to included fields normally', () => {
      const adapter = createAdapterWithExclusions()

      adapter.push([
        ecsMutation({
          'e1/Test': { _exists: true, included: 10, excluded: 20 },
        }),
      ])
      advanceFrames(adapter, 1)

      adapter.push([
        ecsMutation({
          'e1/Test': { included: 50 },
        }),
      ])
      advanceFrames(adapter, 1)

      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      // Should undo the included field change
      expect(mutation[0].patch['e1/Test']).toEqual({ included: 10 })
    })

    it('works with singletons', () => {
      const adapter = createAdapterWithExclusions()

      adapter.push([
        ecsMutation({
          'SINGLETON/TestSingleton': {
            _exists: true,
            included: 10,
            excluded: 20,
          },
        }),
      ])
      advanceFrames(adapter, 1)

      adapter.push([
        ecsMutation({
          'SINGLETON/TestSingleton': { included: 50, excluded: 100 },
        }),
      ])
      advanceFrames(adapter, 1)

      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      // Should only undo the included field
      expect(mutation[0].patch['SINGLETON/TestSingleton']).toEqual({
        included: 10,
      })
    })

    it('preserves component additions even when all data fields are excluded', () => {
      const AllExcluded = defineCanvasComponent(
        {
          name: 'AllExcluded',
          sync: 'document',
          excludeFromHistory: ['value'],
        },
        {
          value: field.int32().default(0),
        },
      )

      const adapter = new HistoryAdapter({
        components: [AllExcluded],
        singletons: [],
        commitCheckpointAfterFrames: 1,
      })

      // Add component with only excluded field
      adapter.push([
        ecsMutation({
          'e1/AllExcluded': { _exists: true, value: 10 },
        }),
      ])
      advanceFrames(adapter, 1)

      // Should still track the addition
      expect(adapter.canUndo()).toBe(true)

      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      // Should be a deletion
      expect(mutation[0].patch['e1/AllExcluded']).toEqual({ _exists: false })
    })

    it('does not affect components without exclusions', () => {
      const adapter = createAdapterWithExclusions()

      // Use a different component name that has no exclusions
      adapter.push([
        ecsMutation({
          'e1/Other': { _exists: true, someField: 10 },
        }),
      ])
      advanceFrames(adapter, 1)

      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      expect(mutation[0].patch['e1/Other']).toEqual({ _exists: false })
    })

    it('restores excluded fields when undoing a deletion', () => {
      const adapter = createAdapterWithExclusions()

      // Create component with both fields
      adapter.push([
        ecsMutation({
          'e1/Test': { _exists: true, included: 10, excluded: 20 },
        }),
      ])
      advanceFrames(adapter, 1)

      // Update the excluded field (simulates upload completing)
      adapter.push([
        ecsMutation({
          'e1/Test': { excluded: 100 },
        }),
      ])
      advanceFrames(adapter, 1)

      // Delete the component
      adapter.push([
        ecsMutation({
          'e1/Test': { _exists: false },
        }),
      ])
      advanceFrames(adapter, 1)

      // Undo the deletion - should restore BOTH fields including excluded
      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      // The restored component should have the excluded field's final value
      expect(mutation[0].patch['e1/Test']).toEqual({
        _exists: true,
        included: 10,
        excluded: 100,
      })
    })

    it('does not include excluded fields when undoing creation', () => {
      const adapter = createAdapterWithExclusions()

      // Create component with both fields
      adapter.push([
        ecsMutation({
          'e1/Test': { _exists: true, included: 10, excluded: 20 },
        }),
      ])
      advanceFrames(adapter, 1)

      // Undo the creation - inverse is deletion, no excluded fields involved
      adapter.undo()
      const mutation = adapter.pull()

      expect(mutation).toHaveLength(1)
      expect(mutation[0].patch['e1/Test']).toEqual({ _exists: false })
    })
  })
})
