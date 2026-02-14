import type { Adapter } from '../Adapter'
import type { AnyCanvasComponentDef } from '../CanvasComponentDef'
import type { AnyCanvasSingletonDef } from '../CanvasSingletonDef'
import { Origin } from '../constants'
import { merge } from '../mutations'
import type { ComponentData, Mutation, Patch } from '../types'

interface Delta {
  forward: Patch
  inverse: Patch
}

interface SettledCallback {
  callback: () => void
  requiredFrames: number
  quietFrames: number
}

export interface HistoryAdapterOptions {
  /** Component definitions for field exclusion lookup */
  components: AnyCanvasComponentDef[]
  /** Singleton definitions for field exclusion lookup */
  singletons: AnyCanvasSingletonDef[]
  /** Number of quiet frames before committing pending changes. Default: 60 */
  commitCheckpointAfterFrames?: number
  /** Maximum number of undo steps to keep. Default: 100 */
  maxHistoryStackSize?: number
}

/**
 * Undo/redo adapter that creates checkpoints based on inactivity.
 *
 * Tracks document state by observing mutations via push() and computes
 * minimal inverse mutations for each change. After 1 second of inactivity,
 * bundles accumulated forward/inverse mutations into a checkpoint.
 *
 * Only tracks mutations with origin 'ecs' (user actions).
 * Undo applies the inverse mutations; redo re-applies the forward mutations.
 */
export class HistoryAdapter implements Adapter {
  /** Current state, used to compute inverse mutations */
  private state: Record<string, ComponentData> = {}
  private undoStack: Delta[] = []
  private redoStack: Delta[] = []
  private pendingForward: Patch = {}
  private pendingInverse: Patch = {}
  private pendingPullPatches: Patch[] = []
  private dirty = false
  private commitCheckpointAfterFrames: number
  private maxHistoryStackSize: number
  private checkpoints = new Map<string, number>()
  private settledCallbacks: SettledCallback[] = []
  private cancelCommitSettled: (() => void) | null = null
  private excludedFields = new Map<string, Set<string>>()

  constructor(options: HistoryAdapterOptions) {
    this.commitCheckpointAfterFrames = options.commitCheckpointAfterFrames ?? 60
    this.maxHistoryStackSize = options.maxHistoryStackSize ?? 100

    // Build excluded fields lookup
    for (const def of options.components) {
      if (def.excludeFromHistory.length > 0) {
        this.excludedFields.set(def.name, new Set(def.excludeFromHistory))
      }
    }
    for (const def of options.singletons) {
      if (def.excludeFromHistory.length > 0) {
        this.excludedFields.set(def.name, new Set(def.excludeFromHistory))
      }
    }
  }

  async init(): Promise<void> {
    // No initialization needed for history adapter
  }

  push(mutations: Mutation[]): void {
    const ecsMutations = mutations.filter(
      (m) => m.origin === Origin.ECS && m.syncBehavior !== 'ephemeral' && m.syncBehavior !== 'local',
    )
    // Apply every mutation in the order received so that all adapters
    // converge to the same state.  Only ECS-originated document mutations
    // are recorded for undo/redo; ephemeral mutations are skipped entirely;
    // local mutations update state but are not recorded (preferences shouldn't be undoable);
    // everything else (including our own History-origin output) just updates state.
    for (const m of mutations) {
      if (m.syncBehavior === 'ephemeral') continue

      if (m.origin === Origin.ECS && m.syncBehavior !== 'local') {
        if (Object.keys(m.patch).length === 0) continue

        // Apply full patch to state and compute inverse
        const inverse = this.applyAndComputeInverse(m.patch)

        // Filter out excluded fields before recording to history (only if exclusions are configured)
        let forwardToRecord = m.patch
        let inverseToRecord = inverse
        if (this.excludedFields.size > 0) {
          forwardToRecord = this.filterExcludedFields(m.patch)
          // Preserve excluded fields for restorations (_exists: true) so that
          // undoing a deletion restores the complete entity state
          inverseToRecord = this.filterExcludedFields(inverse, true)

          // Only record if there are non-excluded changes
          if (Object.keys(forwardToRecord).length === 0) continue
        }

        this.pendingForward = merge(this.pendingForward, forwardToRecord)
        this.pendingInverse = merge(inverseToRecord, this.pendingInverse)
        this.dirty = true
        this.cancelCommitSettled?.()
        this.cancelCommitSettled = this.onSettled(() => this.commitPendingDelta(), {
          frames: this.commitCheckpointAfterFrames,
        })
        this.redoStack = []
      } else {
        // History, Websocket, Persistence — apply to state only
        this.applyToState(m.patch)
      }
    }

    // Process settled callbacks
    this.processSettledCallbacks(ecsMutations.length === 0)
  }

  pull(): Mutation[] {
    if (this.pendingPullPatches.length === 0) return []
    const patch = merge(...this.pendingPullPatches)
    this.pendingPullPatches = []

    return [{ patch, origin: Origin.History, syncBehavior: 'document' }]
  }

  undo(): boolean {
    if (this.dirty) {
      this.commitPendingDelta()
    }

    if (this.undoStack.length === 0) return false

    const delta = this.undoStack.pop()!

    // Apply inverse patch via applyAndComputeInverse so we capture the
    // current state of every touched key *before* the undo.  These captured
    // values become the redo entry's forward patch — ensuring that redo
    // restores the exact pre-undo state (including any remote changes).
    const recomputedForward = this.applyAndComputeInverse(delta.inverse)

    this.redoStack.push({
      forward: recomputedForward,
      inverse: delta.inverse,
    })

    this.pendingPullPatches.push(delta.inverse)

    // Invalidate checkpoints that are now beyond the stack
    for (const [id, index] of this.checkpoints) {
      if (index > this.undoStack.length) {
        this.checkpoints.delete(id)
      }
    }

    return true
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false

    const delta = this.redoStack.pop()!

    // Apply forward patch via applyAndComputeInverse so we capture the
    // current state of every touched key *before* the redo.  These captured
    // values become the undo entry's inverse patch — ensuring that a
    // subsequent undo restores the exact pre-redo state.
    const recomputedInverse = this.applyAndComputeInverse(delta.forward)

    this.undoStack.push({
      forward: delta.forward,
      inverse: recomputedInverse,
    })

    this.pendingPullPatches.push(delta.forward)

    return true
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 || this.dirty
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  close(): void {
    this.cancelCommitSettled?.()
    this.cancelCommitSettled = null
    this.settledCallbacks = []
  }

  /**
   * Create a checkpoint at the current position in history.
   * Use with revertToCheckpoint() to discard changes or squashToCheckpoint()
   * to combine all changes since into a single undo step.
   */
  createCheckpoint(): string {
    const id = crypto.randomUUID()
    this.checkpoints.set(id, this.undoStack.length)

    return id
  }

  /**
   * Revert all changes since the checkpoint and discard them.
   * Returns false if the checkpoint is invalid or no changes to revert.
   */
  revertToCheckpoint(checkpointId: string): boolean {
    const targetIndex = this.checkpoints.get(checkpointId)
    if (targetIndex === undefined) return false

    this.commitPendingDelta()

    if (this.undoStack.length <= targetIndex) {
      this.checkpoints.delete(checkpointId)
      return false
    }

    // Apply inverse patches for all deltas since the checkpoint
    while (this.undoStack.length > targetIndex) {
      const delta = this.undoStack.pop()!
      this.applyToState(delta.inverse)
      this.pendingPullPatches.push(delta.inverse)
    }

    // Clear redo stack since we're discarding changes
    this.redoStack = []
    this.checkpoints.delete(checkpointId)
    return true
  }

  /**
   * Squash all changes since the checkpoint into a single undo step.
   * Commits any pending changes and squashes immediately.
   * Returns false if the checkpoint is invalid or no changes to squash.
   */
  squashToCheckpoint(checkpointId: string): boolean {
    const targetIndex = this.checkpoints.get(checkpointId)
    if (targetIndex === undefined) return false

    this.commitPendingDelta()

    if (this.undoStack.length <= targetIndex) {
      this.checkpoints.delete(checkpointId)
      return false
    }

    // Collect all deltas since the checkpoint
    const deltasToSquash = this.undoStack.splice(targetIndex)

    // Merge all forward and inverse patches
    // Note: merge() automatically removes create-then-delete sequences as no-ops
    const mergedForward = merge(...deltasToSquash.map((d) => d.forward))
    const mergedInverse = merge(...deltasToSquash.map((d) => d.inverse))

    // Sync inverse with forward: if a key was removed from forward as a no-op
    // (create-then-delete), also remove it from inverse
    for (const key of Object.keys(mergedInverse)) {
      if (!(key in mergedForward)) {
        delete mergedInverse[key]
      }
    }

    // If no actual changes remain, don't create a delta
    if (Object.keys(mergedForward).length === 0) {
      this.checkpoints.delete(checkpointId)
      return true
    }

    // Push as a single delta
    this.undoStack.push({
      forward: mergedForward,
      inverse: mergedInverse,
    })

    this.checkpoints.delete(checkpointId)
    return true
  }

  /**
   * Register a callback to be called after N consecutive frames with no ECS mutations.
   * Useful for waiting for state to settle before performing operations like squash.
   */
  onSettled(callback: () => void, options: { frames: number }): () => void {
    const entry: SettledCallback = {
      callback,
      requiredFrames: options.frames,
      quietFrames: 0,
    }
    this.settledCallbacks.push(entry)
    return () => {
      const index = this.settledCallbacks.indexOf(entry)
      if (index !== -1) this.settledCallbacks.splice(index, 1)
    }
  }

  private processSettledCallbacks(isQuiet: boolean): void {
    const callbacks = this.settledCallbacks
    this.settledCallbacks = []
    for (const cb of callbacks) {
      if (isQuiet) {
        cb.quietFrames++
        if (cb.quietFrames >= cb.requiredFrames) {
          cb.callback()
        } else {
          this.settledCallbacks.push(cb)
        }
      } else {
        cb.quietFrames = 0
        this.settledCallbacks.push(cb)
      }
    }
  }

  /**
   * Immediately commit any pending changes to the undo stack.
   */
  commitPendingDelta(): void {
    if (!this.dirty) return

    this.cancelCommitSettled = null
    this.dirty = false

    // Remove no-op entries where forward and inverse are identical
    // (e.g., entity created then immediately deleted within the same batch)
    for (const key of Object.keys(this.pendingForward)) {
      if (
        key in this.pendingInverse &&
        JSON.stringify(this.pendingForward[key]) === JSON.stringify(this.pendingInverse[key])
      ) {
        delete this.pendingForward[key]
        delete this.pendingInverse[key]
      }
    }

    // If no actual changes remain, don't create a delta
    if (Object.keys(this.pendingForward).length === 0) return

    this.undoStack.push({
      forward: this.pendingForward,
      inverse: this.pendingInverse,
    })
    this.pendingForward = {}
    this.pendingInverse = {}

    while (this.undoStack.length > this.maxHistoryStackSize) {
      this.undoStack.shift()
      // Adjust checkpoint indices since we shifted from the front
      for (const [id, index] of this.checkpoints) {
        if (index <= 0) {
          this.checkpoints.delete(id)
        } else {
          this.checkpoints.set(id, index - 1)
        }
      }
    }
  }

  /**
   * Apply a diff to state and return the inverse diff.
   */
  private applyAndComputeInverse(diff: Patch): Patch {
    const inverse: Patch = {}

    for (const [key, value] of Object.entries(diff)) {
      const prev = this.state[key]

      if (value._exists === false) {
        // Deletion: inverse restores previous value
        if (prev !== undefined && prev._exists !== false) {
          inverse[key] = { _exists: true, ...prev }
        }
        this.state[key] = { _exists: false }
      } else if (value._exists) {
        // Addition/replacement: inverse is deletion or restore previous
        if (prev === undefined || prev._exists === false) {
          inverse[key] = { _exists: false }
        } else {
          inverse[key] = { _exists: true, ...prev }
        }
        const { _exists, ...data } = value
        this.state[key] = data as ComponentData
      } else {
        // Partial update: inverse contains previous values of changed fields
        const inverseChanges: ComponentData = {}
        for (const field of Object.keys(value)) {
          if (prev !== undefined && prev._exists !== false && field in prev) {
            inverseChanges[field] = prev[field]
          }
        }
        if (Object.keys(inverseChanges).length > 0) {
          inverse[key] = inverseChanges
        }
        const base = prev?._exists === false ? {} : prev
        this.state[key] = { ...base, ...value }
      }
    }

    return inverse
  }

  /**
   * Apply a diff to state without computing an inverse.
   * Used during undo/redo to keep state in sync.
   */
  private applyToState(diff: Patch): void {
    for (const [key, value] of Object.entries(diff)) {
      if (value._exists === false) {
        this.state[key] = { _exists: false }
      } else if (value._exists) {
        const { _exists, ...data } = value
        this.state[key] = data as ComponentData
      } else {
        const existing = this.state[key]
        const base = existing?._exists === false ? {} : existing
        this.state[key] = { ...base, ...value }
      }
    }
  }

  /**
   * Get excluded fields for a patch key.
   * Key format: "<entityId>/<componentName>" or "SINGLETON/<singletonName>"
   */
  private getExcludedFields(key: string): Set<string> | undefined {
    const slashIndex = key.indexOf('/')
    if (slashIndex === -1) return undefined
    const name = key.slice(slashIndex + 1)
    return this.excludedFields.get(name)
  }

  /**
   * Filter excluded fields from a patch, returning a new patch.
   * Component additions/deletions are preserved, but excluded fields are removed from the data.
   *
   * @param patch - The patch to filter
   * @param preserveRestorations - If true, preserve all fields (including excluded) for
   *   entries with _exists: true. Used for inverse patches so that undoing a deletion
   *   restores the complete state including excluded fields.
   */
  private filterExcludedFields(patch: Patch, preserveRestorations = false): Patch {
    const filtered: Patch = {}

    for (const [key, value] of Object.entries(patch)) {
      const excluded = this.getExcludedFields(key)
      if (!excluded || excluded.size === 0) {
        // No exclusions for this component
        filtered[key] = value
        continue
      }

      if (value._exists === false) {
        // Deletion - keep as-is
        filtered[key] = value
        continue
      }

      // For restorations (_exists: true in inverse patches), preserve all fields
      // so that undoing a deletion restores the complete state
      if (preserveRestorations && value._exists) {
        filtered[key] = value
        continue
      }

      // Filter out excluded fields
      const filteredValue: ComponentData = {}
      let hasFields = false

      for (const [field, fieldValue] of Object.entries(value)) {
        if (field === '_exists') {
          filteredValue._exists = fieldValue as boolean
        } else if (field === '_version') {
          filteredValue._version = fieldValue as string
        } else if (!excluded.has(field)) {
          filteredValue[field] = fieldValue
          hasFields = true
        }
      }

      // For additions (_exists: true), always include even if only metadata
      // For partial updates, only include if there are non-excluded fields
      if (value._exists || hasFields) {
        filtered[key] = filteredValue
      }
    }

    return filtered
  }
}
