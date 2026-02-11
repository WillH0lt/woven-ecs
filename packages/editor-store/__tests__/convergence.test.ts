import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Adapter } from '../src/Adapter'
import { HistoryAdapter } from '../src/adapters/History'
import { Origin } from '../src/constants'
import type { ComponentData, Mutation, Patch } from '../src/types'

// ---------------------------------------------------------------------------
// Mock adapter that tracks internal state the same way a "ground truth"
// adapter would: applies patches with last-write-wins semantics.
// ---------------------------------------------------------------------------
class MockAdapter implements Adapter {
  name: string
  state: Record<string, ComponentData> = {}
  pendingMutation: Mutation | null = null
  pushed: Mutation[][] = []

  constructor(
    name: string,
    private origin: Origin,
  ) {
    this.name = name
  }

  async init() {
    // no-op
  }

  /** Queue a mutation to be returned on the next pull(). */
  enqueue(patch: Patch) {
    this.pendingMutation = { patch, origin: this.origin, syncBehavior: 'document' }
  }

  pull(): Mutation[] {
    const m = this.pendingMutation
    this.pendingMutation = null
    return m ? [m] : []
  }

  push(mutations: Mutation[]): void {
    this.pushed.push(mutations)
    for (const { patch, origin } of mutations) {
      // Skip self-origin mutations — they were already applied during pull
      if (origin === this.origin) continue
      this.applyPatch(patch)
    }
  }

  close() {
    // no-op
  }

  private applyPatch(patch: Patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value._exists === false) {
        delete this.state[key]
      } else if (value._exists) {
        const { _exists, ...data } = value
        this.state[key] = data as ComponentData
      } else {
        this.state[key] = { ...this.state[key], ...value }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reproduce the EditorSync.sync() pull-push loop with arbitrary adapters.
// Every adapter receives ALL mutations (including its own).  Each adapter
// is responsible for skipping its own side-effects internally.
// ---------------------------------------------------------------------------
function syncLoop(adapters: Adapter[]): void {
  // Phase 1: Pull
  const allMutations: Mutation[] = []
  for (const adapter of adapters) {
    const mutations = adapter.pull()
    allMutations.push(...mutations)
  }

  // Phase 2: Push the same list to every adapter
  for (const adapter of adapters) {
    adapter.push(allMutations)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ecsMutation(patch: Patch): Mutation {
  return { patch, origin: Origin.ECS, syncBehavior: 'document' }
}

/** Read History adapter's internal state for test verification. */
function getHistoryState(adapter: HistoryAdapter): Record<string, ComponentData> {
  return (adapter as any).state
}

// ===========================================================================
// Tests
// ===========================================================================
describe('Sync loop convergence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Scenario 1: Non-conflicting concurrent mutations should converge.
  // ECS changes x, Websocket changes y — no field overlap.
  // -------------------------------------------------------------------------
  describe('non-conflicting concurrent mutations', () => {
    it('History tracks both ECS and WS changes', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      // Pre-populate
      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0, y: 0 } })])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 0, y: 0 }

      // Same frame: ECS changes x, Websocket changes y
      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      ws.enqueue({ 'e1/Pos': { y: 20 } })

      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      // History applies in order: ECS {x:10}, then WS {y:20}
      expect(historyState['e1/Pos']).toEqual({ x: 10, y: 20 })

      // ECS-mock only received ws mutation
      expect(ecs.state['e1/Pos']).toEqual({ x: 0, y: 20 })
      // (In the real ECS adapter the entity already has x=10 from the
      // local change, so the full state would be {x:10, y:20}.)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 2: Conflicting concurrent mutations — same key, same field.
  // ECS sets x=10, Websocket sets x=20 in the SAME frame.
  // With in-order processing, WS comes after ECS so WS wins — matching
  // the ECS adapter which also receives only the WS mutation.
  // -------------------------------------------------------------------------
  describe('conflicting concurrent mutations (same field)', () => {
    it('History and ECS-mock converge to the same value', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      // Pre-populate
      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 0 }

      // Same frame conflict
      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })

      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      // ECS-mock receives only ws mutation → x=20
      expect(ecs.state['e1/Pos']!.x).toBe(20)

      // History applies in order: ECS {x:10}, then WS {x:20}
      // Final state = x:20 — matches ECS
      expect(historyState['e1/Pos']!.x).toBe(20)

      // CONVERGENCE
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
    })

    it('convergence holds across subsequent no-op frames', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      // Pre-populate
      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 0 }

      // Conflicting frame
      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })
      syncLoop([ecs, history, ws])

      // Run several no-op frames
      for (let i = 0; i < 5; i++) {
        syncLoop([ecs, history, ws])
      }

      const historyState = getHistoryState(history)

      // Both remain at x=20
      expect(ecs.state['e1/Pos']!.x).toBe(20)
      expect(historyState['e1/Pos']!.x).toBe(20)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 3: Undo after a conflicting concurrent mutation.
  // Because History now converges with ECS, the inverse is correct.
  // -------------------------------------------------------------------------
  describe('undo correctness after concurrent conflict', () => {
    it('undo produces correct inverse after concurrent conflict', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      // Step 1: establish initial state x=0
      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 0 }

      // Step 2: conflict — ECS x=10, WS x=20 in same frame
      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })
      syncLoop([ecs, history, ws])
      history.commitPendingDelta() // checkpoint

      // History state is now x=20 (converged with ECS)
      expect(getHistoryState(history)['e1/Pos']!.x).toBe(20)

      // Step 3: user makes another change x=50
      ecs.enqueue({ 'e1/Pos': { x: 50 } })
      syncLoop([ecs, history, ws])
      history.commitPendingDelta() // checkpoint

      // History state: x=50
      expect(getHistoryState(history)['e1/Pos']!.x).toBe(50)

      // Step 4: Undo the x=50 change
      history.undo()
      const undoMutations = history.pull()
      expect(undoMutations).toHaveLength(1)

      // The inverse correctly restores to x=20 (the actual state before
      // the user's x=50 change), not x=10 or x=0.
      expect(undoMutations[0].patch['e1/Pos']).toEqual({ x: 20 })
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 4: Adapter ordering.
  // In-order processing means the array order determines conflict
  // resolution. In the real EditorSync, ECS is always first, so
  // later adapters (WS) win conflicts — matching the ECS adapter's view.
  // -------------------------------------------------------------------------
  describe('adapter ordering', () => {
    it('standard order [ecs, history, ws] converges', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      history.commitPendingDelta()

      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })
      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      // WS comes after ECS in the array, so WS wins: x=20
      expect(historyState['e1/Pos']!.x).toBe(20)
      expect(ecs.state['e1/Pos']!.x).toBe(20)
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
    })

    it('reversed order [ws, history, ecs] gives ECS priority', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0 } })])
      history.commitPendingDelta()

      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })
      syncLoop([ws, history, ecs])

      const historyState = getHistoryState(history)

      // ECS comes after WS in the array, so ECS wins: x=10
      expect(historyState['e1/Pos']!.x).toBe(10)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 5: Multiple fields in conflict — partial overlap.
  // ECS changes {x:10, y:30}, WS changes {x:20, z:40}.
  // x conflicts (WS wins), y and z are unique to each source.
  // -------------------------------------------------------------------------
  describe('partial field overlap in concurrent mutations', () => {
    it('all fields converge between History and ECS-mock', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 0, y: 0, z: 0 } })])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 0, y: 0, z: 0 }

      ecs.enqueue({ 'e1/Pos': { x: 10, y: 30 } })
      ws.enqueue({ 'e1/Pos': { x: 20, z: 40 } })
      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      // History: ECS {x:10,y:30} then WS {x:20,z:40}
      // = {x:0,y:0,z:0} + {x:10,y:30} + {x:20,z:40} = {x:20, y:30, z:40}
      expect(historyState['e1/Pos']).toEqual({ x: 20, y: 30, z: 40 })

      // ECS-mock: only WS {x:20,z:40} → {x:20, y:0, z:40}
      expect(ecs.state['e1/Pos']).toEqual({ x: 20, y: 0, z: 40 })

      // x and z converge; y differs because ECS-mock doesn't get its own
      // mutation (in the real system, ECS already has y=30 locally).
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
      expect(historyState['e1/Pos']!.z).toBe(ecs.state['e1/Pos']!.z)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 6: Concurrent add (ECS) and update (WS) for the same entity.
  // -------------------------------------------------------------------------
  describe('concurrent add and update', () => {
    it('History and ECS-mock converge on conflicting fields', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      ecs.enqueue({ 'e1/Pos': { _exists: true, x: 10, y: 5 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })

      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      // History: ECS add {x:10,y:5}, then WS partial {x:20}
      // = {x:10,y:5} + {x:20} = {x:20, y:5}
      expect(historyState['e1/Pos']).toEqual({ x: 20, y: 5 })

      // ECS-mock: only WS {x:20} → {x:20}
      expect(ecs.state['e1/Pos']).toEqual({ x: 20 })

      // x converges
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 7: Concurrent delete (ECS) and update (WS).
  // ECS deletes first (in-order), then WS update re-creates partial state.
  // Both adapters end up with the entity present.
  // -------------------------------------------------------------------------
  describe('concurrent delete and update', () => {
    it('History and ECS-mock agree on entity existence', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      // Pre-populate
      history.push([ecsMutation({ 'e1/Pos': { _exists: true, x: 5 } })])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 5 }

      // ECS deletes, WS updates
      ecs.enqueue({ 'e1/Pos': { _exists: false } })
      ws.enqueue({ 'e1/Pos': { x: 99 } })

      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      // ECS-mock receives ws:{x:99} → state = {x:5} + {x:99} = {x:99}
      expect(ecs.state['e1/Pos']).toEqual({ x: 99 })

      // History: ECS {_exists:false} (delete), then WS {x:99} (partial re-creates)
      // state["e1/Pos"] = {_exists:false}, then state["e1/Pos"] = {x:99}
      expect(historyState['e1/Pos']).toEqual({ x: 99 })

      // Both agree the entity exists with x=99
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 8: Sequential (non-concurrent) mutations — baseline.
  // -------------------------------------------------------------------------
  describe('sequential mutations converge correctly', () => {
    it('ECS mutation in frame 1, WS mutation in frame 2 — no divergence', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      // Frame 1: ECS adds entity
      ecs.enqueue({ 'e1/Pos': { _exists: true, x: 10 } })
      syncLoop([ecs, history, ws])

      // Frame 2: WS updates it
      ws.enqueue({ 'e1/Pos': { x: 20 } })
      syncLoop([ecs, history, ws])

      const historyState = getHistoryState(history)

      expect(historyState['e1/Pos']!.x).toBe(20)
      expect(ecs.state['e1/Pos']!.x).toBe(20)
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 9: Three-way concurrent mutations.
  // All three produce mutations for the same key.
  // In standard order [ecs, persistence, history, ws], the last non-self
  // adapter in the array wins conflicts.
  // -------------------------------------------------------------------------
  describe('three-way concurrent mutations', () => {
    it('all adapters converge with standard ordering', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const persistence = new MockAdapter('persistence', Origin.Persistence)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })
      const ws = new MockAdapter('ws', Origin.Websocket)

      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      persistence.enqueue({ 'e1/Pos': { _exists: true, x: 30 } })
      ws.enqueue({ 'e1/Pos': { x: 20 } })

      syncLoop([ecs, history, persistence, ws])

      const historyState = getHistoryState(history)

      // History receives [ecs:{x:10}, persistence:{_exists,x:30}, ws:{x:20}]
      // In order: {x:10}, then {x:30} (full replace), then {x:20} → x=20
      expect(historyState['e1/Pos']!.x).toBe(20)

      // ECS-mock receives [persistence:{_exists,x:30}, ws:{x:20}]
      // In order: {x:30}, then {x:20} → x=20
      expect(ecs.state['e1/Pos']!.x).toBe(20)

      // Convergence
      expect(historyState['e1/Pos']!.x).toBe(ecs.state['e1/Pos']!.x)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 10: Concurrent ECS + History (undo) mutations.
  //
  // All adapters receive ALL mutations and skip self side-effects,
  // so both converge to the same final state.
  //
  // Mutations in pull order: [ecs:{x:50}, history:{x:0}]
  //   ECS-mock:  skips ecs (self), applies history:{x:0} → x=0
  //   History:   applies ecs:{x:50} (tracked for undo), then
  //              history:{x:0} (state only) → x=0
  // -------------------------------------------------------------------------
  describe('concurrent ECS and History mutations converge', () => {
    it('ECS and History converge when both produce mutations for the same key', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })

      // Setup: entity at x=10, with undo history back to x=0
      ecs.enqueue({ 'e1/Pos': { _exists: true, x: 0 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      // Both agree: x=10
      expect(getHistoryState(history)['e1/Pos']!.x).toBe(10)
      ecs.state['e1/Pos'] = { x: 10 }

      // Now: user presses undo AND an ECS system changes x=50 in the
      // same frame. undo() is called before sync().
      history.undo()
      // History internal state is now x=0 (inverse applied).
      // History.pull() will return {x:0, origin: History}.

      // Meanwhile an ECS system changed x to 50.
      ecs.enqueue({ 'e1/Pos': { x: 50 } })

      // Run the sync loop — both pull mutations simultaneously
      syncLoop([ecs, history])

      // ECS-mock: skips self {x:50}, applies history {x:0} → x=0
      expect(ecs.state['e1/Pos']!.x).toBe(0)

      // History: applies ecs:{x:50} (tracked), then history:{x:0}
      // (state only) → x=0
      expect(getHistoryState(history)['e1/Pos']!.x).toBe(0)

      // CONVERGENCE
      expect(ecs.state['e1/Pos']!.x).toBe(getHistoryState(history)['e1/Pos']!.x)
    })

    it('ECS changes during undo frame are still tracked for undo', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })

      // Setup: entity with x=0, y=0
      ecs.enqueue({ 'e1/Pos': { _exists: true, x: 0, y: 0 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 0, y: 0 }

      // User changes x to 10
      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()
      ecs.state['e1/Pos'] = { x: 10, y: 0 }

      expect(getHistoryState(history)['e1/Pos']).toEqual({ x: 10, y: 0 })

      // User undoes x=10 AND a system changes y=99 in the same frame
      history.undo()
      ecs.enqueue({ 'e1/Pos': { y: 99 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      // History converges: undo restores x=0, system sets y=99
      expect(getHistoryState(history)['e1/Pos']).toEqual({ x: 0, y: 99 })

      // The y=99 change should be undoable
      history.undo()
      const undoPatches = history.pull()
      expect(undoPatches).toHaveLength(1)
      expect(undoPatches[0].patch['e1/Pos']).toEqual({ y: 0 })
    })

    it('no divergence when only one adapter produces a mutation', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })

      // Setup
      ecs.enqueue({ 'e1/Pos': { _exists: true, x: 0 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      ecs.enqueue({ 'e1/Pos': { x: 10 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      ecs.state['e1/Pos'] = { x: 10 }

      // Only History produces (undo), ECS is idle this frame
      history.undo()
      syncLoop([ecs, history])

      // ECS receives history:{x:0} → x=0
      expect(ecs.state['e1/Pos']!.x).toBe(0)

      // History: applies history:{x:0} (state only) → x=0
      expect(getHistoryState(history)['e1/Pos']!.x).toBe(0)

      // Converged
      expect(ecs.state['e1/Pos']!.x).toBe(getHistoryState(history)['e1/Pos']!.x)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 11: Undo-redo round-trip (no conflict baseline).
  // -------------------------------------------------------------------------
  describe('undo-redo round trip (no conflict baseline)', () => {
    it('undo then redo restores original state when no conflicts exist', () => {
      const ecs = new MockAdapter('ecs', Origin.ECS)
      const history = new HistoryAdapter({ components: [], singletons: [], commitAfterFrames: 1 })

      // Frame 1: add entity
      ecs.enqueue({ 'e1/Pos': { _exists: true, x: 0, y: 0 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      // Frame 2: update x
      ecs.enqueue({ 'e1/Pos': { x: 42 } })
      syncLoop([ecs, history])
      history.commitPendingDelta()

      const historyState = getHistoryState(history)
      expect(historyState['e1/Pos']).toEqual({ x: 42, y: 0 })

      // Undo
      history.undo()
      const undoPatches = history.pull()
      expect(undoPatches).toHaveLength(1)
      expect(undoPatches[0].patch['e1/Pos']).toEqual({ x: 0 })

      // Redo
      history.redo()
      const redoPatches = history.pull()
      expect(redoPatches).toHaveLength(1)
      expect(redoPatches[0].patch['e1/Pos']).toEqual({ x: 42 })
    })
  })
})
