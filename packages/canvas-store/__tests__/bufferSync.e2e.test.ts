import type { Context, EntityId } from '@woven-ecs/core'
import { addComponent, createEntity, defineQuery, field, World } from '@woven-ecs/core'
import { describe, expect, it } from 'vitest'
import { EcsAdapter } from '../src/adapters/ECS'
import { isBufferDelta, materializeFields } from '../src/bufferDelta'
import { defineCanvasComponent } from '../src/CanvasComponentDef'
import { Synced } from '../src/components/Synced'
import { Origin } from '../src/constants'
import { merge } from '../src/mutations'
import type { ComponentData, Mutation, Patch } from '../src/types'

// End-to-end regression for sparse buffer-field sync: a stroke drawn on one
// peer must reconstruct identically on a second peer and in the (materialized)
// server state, while only changed runs travel over the wire.

const CAP = 16 // points buffer capacity (8 points)

const Stroke = defineCanvasComponent(
  { name: 'stroke', sync: 'document' },
  {
    points: field.buffer(field.float32()).size(CAP),
    pointCount: field.uint32().default(0),
  },
)

const strokeQuery = defineQuery((q) => q.tracking(Stroke))

function makePeer() {
  const world = new World([Synced, Stroke], { maxEntities: 100, maxEvents: 4096 })
  const ctx = (world as unknown as { context: Context }).context
  const adapter = new EcsAdapter({ components: [Stroke], singletons: [] })
  adapter.ctx = ctx
  adapter.pull() // build internal maps
  return { ctx, adapter }
}

/** Mirror of the server's Room.applyPatch: store full materialized arrays. */
function applyServer(state: Record<string, ComponentData>, patch: Patch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value._exists === false) {
      state[key] = { _exists: false }
      continue
    }
    const existing = state[key]
    const base = !existing || existing._exists === false ? undefined : existing
    state[key] = materializeFields(base, value) as ComponentData
  }
}

function readStroke(ctx: Context): { points: number[]; pointCount: number } | null {
  for (const eid of strokeQuery.current(ctx)) {
    const s = Stroke.read(ctx, eid)
    return { points: Array.from(s.points.slice(0, s.pointCount * 2)), pointCount: s.pointCount }
  }
  return null
}

describe('buffer-field sync (end to end)', () => {
  it('reconstructs a stroke on a peer + server using sparse deltas', () => {
    const sender = makePeer()
    const receiver = makePeer()
    const server: Record<string, ComponentData> = {}

    let sawDelta = false

    // Push a sender patch through: server materializes, receiver applies.
    const deliver = (patch: Patch): void => {
      for (const value of Object.values(patch)) {
        if (isBufferDelta((value as ComponentData).points)) sawDelta = true
      }
      applyServer(server, patch)
      receiver.adapter.push([{ patch, origin: Origin.Websocket, syncBehavior: 'document' } satisfies Mutation])
    }

    const flush = (): void => {
      const patches = sender.adapter
        .pull()
        .filter((m) => m.origin === Origin.ECS)
        .map((m) => m.patch)
      sender.adapter.push([]) // advance past our own writes
      if (patches.length > 0) deliver(merge(...patches))
    }

    // Create the stroke (full add — never a delta).
    const eid: EntityId = createEntity(sender.ctx)
    addComponent(sender.ctx, eid, Synced, { id: 's1' })
    addComponent(sender.ctx, eid, Stroke, { points: [0, 0], pointCount: 1 })
    flush()

    // Append points one per frame (each a delta).
    for (const [x, y] of [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]) {
      const s = Stroke.write(sender.ctx, eid)
      const i = s.pointCount
      s.points[i * 2] = x
      s.points[i * 2 + 1] = y
      s.pointCount = i + 1
      flush()
    }

    // Slide the tail: overwrite the last point in place (a non-append run).
    {
      const s = Stroke.write(sender.ctx, eid)
      const last = s.pointCount - 1
      s.points[last * 2] = 9
      s.points[last * 2 + 1] = 9
      flush()
    }

    // Coalesced batch: two appends merged into one patch (like the WS flush).
    {
      const batch: Patch[] = []
      for (const [x, y] of [
        [5, 5],
        [6, 6],
      ]) {
        const s = Stroke.write(sender.ctx, eid)
        const i = s.pointCount
        s.points[i * 2] = x
        s.points[i * 2 + 1] = y
        s.pointCount = i + 1
        for (const m of sender.adapter.pull()) {
          if (m.origin === Origin.ECS) batch.push(m.patch)
        }
        sender.adapter.push([])
      }
      deliver(merge(...batch))
    }

    const expected = [0, 0, 1, 1, 2, 2, 3, 3, 9, 9, 5, 5, 6, 6]

    // The delta path was actually exercised (not just full-array replaces).
    expect(sawDelta).toBe(true)

    // Receiver reconstructs the exact geometry.
    expect(readStroke(receiver.ctx)).toEqual({ points: expected, pointCount: 7 })

    // Sender is unchanged (sanity).
    expect(readStroke(sender.ctx)).toEqual({ points: expected, pointCount: 7 })

    // Server holds the materialized full array (this is what new joiners get).
    const serverPoints = (server['s1/stroke'].points as number[]).slice(0, 14)
    expect(serverPoints).toEqual(expected)
  })
})
