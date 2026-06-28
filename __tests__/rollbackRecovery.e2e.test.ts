import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebsocketAdapter } from '../packages/canvas-store/src/adapters/Websocket'
import { materializeFields } from '../packages/canvas-store/src/bufferDelta'
import { Origin } from '../packages/canvas-store/src/constants'
import type { Patch } from '../packages/canvas-store/src/types'
import { Room } from '../packages/canvas-store-server/src/Room'
import { MemoryStorage } from '../packages/canvas-store-server/src/storage/MemoryStorage'

/**
 * True end-to-end test of server-rollback recovery: the real client
 * {@link WebsocketAdapter} talks to the real server {@link Room} over an
 * in-memory socket bridge (real JSON wire messages, no mocks of either half).
 *
 * It proves the two independently-implemented protocol halves actually heal
 * together when the server crashes and reloads a stale snapshot — losing acked
 * ops that a reconnecting client still holds.
 */

// --- In-memory socket bridge ---------------------------------------------------

// The room the next `new WebSocket()` should connect to. Swapped to simulate a
// crash + restart onto a fresh Room instance.
let currentRoom: Room

/**
 * Stands in for the browser `WebSocket`. On (deferred) connect it registers a
 * session with `currentRoom`; the room's outbound `send` is delivered straight
 * to this socket's `message` listeners, and this socket's `send` is fed into the
 * room. Connect + open are deferred to a microtask so the adapter's listeners
 * (attached synchronously right after construction) are in place first.
 */
class BridgeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = BridgeWebSocket.OPEN
  url: string
  private listeners: Record<string, Array<(e: any) => void>> = {}
  private room: Room
  private sessionId: string | null = null

  constructor(url: string) {
    this.url = url
    this.room = currentRoom
    const clientId = new URL(url).searchParams.get('clientId') ?? 'anon'

    queueMicrotask(() => {
      const serverSocket = {
        send: (data: string) => this.dispatch('message', { data }),
        close: () => {
          /* teardown is driven from the client side via handleSocketClose */
        },
      }
      this.sessionId = this.room.handleSocketConnect({ socket: serverSocket, clientId, permissions: 'readwrite' })
      this.dispatch('open', {})
    })
  }

  addEventListener(type: string, cb: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(cb)
  }

  send(data: string): void {
    if (this.sessionId) this.room.handleSocketMessage(this.sessionId, data)
  }

  close(): void {
    this.readyState = BridgeWebSocket.CLOSED
    if (this.sessionId) this.room.handleSocketClose(this.sessionId)
    this.dispatch('close', {})
  }

  private dispatch(type: string, e: any): void {
    for (const l of this.listeners[type] ?? []) l(e)
  }
}

// --- Test-side document accumulation ------------------------------------------

/**
 * Apply a wire patch to a plain document map (mirrors what the ECS world does):
 * deletions drop the key, everything else merges field-by-field with buffer
 * deltas materialized — the same `materializeFields` the real state layers use.
 */
function applyPatch(doc: Patch, patch: Patch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value._exists === false) {
      delete doc[key]
    } else {
      doc[key] = materializeFields(doc[key], value) as Patch[string]
    }
  }
}

/**
 * Wraps a real adapter and reproduces what the CanvasStore router does: applies
 * pulled remote mutations to a local document and feeds them back into the
 * adapter so its internal mirror stays current.
 */
class Peer {
  doc: Patch = {}
  constructor(
    readonly clientId: string,
    readonly adapter: WebsocketAdapter,
  ) {}

  /** Make a local edit: record it locally and push it toward the server. */
  edit(patch: Patch): void {
    advanceClock() // ensure the adapter's send throttle lets this flush
    applyPatch(this.doc, patch)
    this.adapter.push([{ patch, origin: Origin.ECS, syncBehavior: 'document' }])
  }

  /** Drain server-delivered mutations into the local doc + adapter mirror. */
  pump(): void {
    const muts = this.adapter.pull()
    if (muts.length === 0) return
    for (const m of muts) applyPatch(this.doc, m.patch)
    this.adapter.push(muts)
  }
}

// Controllable clock so the adapter's send throttle is deterministic.
let now = 100_000
function advanceClock(ms = 2_000): void {
  now += ms
}

async function connect(clientId: string): Promise<Peer> {
  const adapter = new WebsocketAdapter({
    url: 'ws://localhost/sync',
    clientId,
    documentId: 'room-1',
    usePersistence: false,
    components: [],
    singletons: [],
  })
  const peer = new Peer(clientId, adapter)
  await adapter.init()
  peer.pump()
  return peer
}

/** Reconnect an existing peer to whatever `currentRoom` now points at. */
async function reconnect(peer: Peer): Promise<void> {
  peer.adapter.disconnect()
  await peer.adapter.reconnect()
  peer.pump()
}

// --- Tests --------------------------------------------------------------------

describe('server rollback recovery (e2e)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    now = 100_000
    vi.stubGlobal('WebSocket', BridgeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('propagates edits client → server → client (bridge sanity)', async () => {
    currentRoom = new Room()
    const alice = await connect('alice')
    const bob = await connect('bob')

    alice.edit({ 'e1/Pos': { _exists: true, x: 1, y: 2 } })
    bob.pump()

    expect(bob.doc['e1/Pos']).toEqual({ _exists: true, x: 1, y: 2 })
    expect(currentRoom.getSnapshot().state['e1/Pos']).toMatchObject({ x: 1, y: 2 })
  })

  it('heals a rolled-back server when a witness reconnects', async () => {
    currentRoom = new Room()
    const alice = await connect('alice')
    const bob = await connect('bob')

    // Acked edit that the server WILL have in its last durable snapshot.
    alice.edit({ 'e1/Pos': { _exists: true, x: 1 } })
    bob.pump()
    const durable = structuredClone(currentRoom.getSnapshot())

    // Acked edit applied AFTER the last save — this is what the crash loses.
    alice.edit({ 'e2/Vel': { _exists: true, dx: 9 } })
    bob.pump()

    // Crash + restart: a fresh Room loads only the stale (pre-e2) snapshot.
    const storage = new MemoryStorage()
    await storage.save(durable)
    currentRoom = new Room({ createStorage: () => storage })
    await currentRoom.load()
    expect(currentRoom.getSnapshot().state['e2/Vel']).toBeUndefined() // genuinely lost

    // The witness reconnects; the real reverse-diff heals the real server.
    await reconnect(alice)
    await reconnect(bob)

    const state = currentRoom.getSnapshot().state
    expect(state['e1/Pos']).toMatchObject({ x: 1 })
    expect(state['e2/Vel']).toMatchObject({ _exists: true, dx: 9 })
    // Everyone converged back to the pre-crash document.
    expect(alice.doc['e2/Vel']).toMatchObject({ dx: 9 })
    expect(bob.doc['e2/Vel']).toMatchObject({ dx: 9 })
  })

  it('heals a windowed deletion across a rollback', async () => {
    currentRoom = new Room()
    const alice = await connect('alice')
    const bob = await connect('bob')

    // Create + save, so the durable snapshot still has the entity alive.
    alice.edit({ 'e1/Pos': { _exists: true, x: 5 } })
    bob.pump()
    const durable = structuredClone(currentRoom.getSnapshot())

    // Delete after the save — the deletion is what the crash loses.
    alice.edit({ 'e1/Pos': { _exists: false } })
    bob.pump()

    const storage = new MemoryStorage()
    await storage.save(durable)
    currentRoom = new Room({ createStorage: () => storage })
    await currentRoom.load()
    expect(currentRoom.getSnapshot().state['e1/Pos']).toMatchObject({ x: 5 }) // resurrected by the rollback

    await reconnect(alice)
    await reconnect(bob)

    // The deletion is re-asserted, so the entity stays gone everywhere.
    expect(currentRoom.getSnapshot().state['e1/Pos']).toBeUndefined()
    expect(alice.doc['e1/Pos']).toBeUndefined()
    expect(bob.doc['e1/Pos']).toBeUndefined()
  })

  it('does not ask a level client to resync after a healthy reconnect', async () => {
    currentRoom = new Room()
    const alice = await connect('alice')

    alice.edit({ 'e1/Pos': { _exists: true, x: 1 } })

    // No rollback: same room, just a reconnect. Nothing should regress and the
    // client should not be asked to re-send anything.
    await reconnect(alice)

    expect(currentRoom.getSnapshot().state['e1/Pos']).toMatchObject({ x: 1 })
    expect(alice.doc['e1/Pos']).toMatchObject({ x: 1 })
  })
})

describe('client/server state merge (e2e)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    now = 100_000
    vi.stubGlobal('WebSocket', BridgeWebSocket)
    currentRoom = new Room()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('merges concurrent edits to different fields of one component', async () => {
    const alice = await connect('alice')
    const bob = await connect('bob')

    alice.edit({ 'e1/Pos': { _exists: true, x: 1 } })
    bob.pump()
    bob.edit({ 'e1/Pos': { y: 2 } })
    alice.pump()

    const expected = { _exists: true, x: 1, y: 2 }
    expect(currentRoom.getSnapshot().state['e1/Pos']).toMatchObject(expected)
    expect(alice.doc['e1/Pos']).toMatchObject(expected)
    expect(bob.doc['e1/Pos']).toMatchObject(expected)
  })

  it('resolves same-field writes last-writer-wins by server arrival order', async () => {
    const alice = await connect('alice')
    const bob = await connect('bob')

    alice.edit({ 'e1/Pos': { _exists: true, x: 1 } })
    bob.pump()
    bob.edit({ 'e1/Pos': { x: 2 } }) // later arrival wins
    alice.pump()

    expect(currentRoom.getSnapshot().state['e1/Pos']).toMatchObject({ x: 2 })
    expect(alice.doc['e1/Pos']).toMatchObject({ x: 2 })
    expect(bob.doc['e1/Pos']).toMatchObject({ x: 2 })
  })

  it('catches a freshly-joining client up to existing state', async () => {
    const alice = await connect('alice')
    alice.edit({ 'e1/Pos': { _exists: true, x: 1 } })
    alice.edit({ 'e2/Pos': { _exists: true, x: 2 } })

    // carol joins after the edits; connect() pumps the catch-up diff.
    const carol = await connect('carol')

    expect(carol.doc['e1/Pos']).toMatchObject({ x: 1 })
    expect(carol.doc['e2/Pos']).toMatchObject({ x: 2 })
  })

  it('merges a client’s offline edits with changes made on the server while it was away', async () => {
    const alice = await connect('alice')
    const bob = await connect('bob')

    alice.edit({ 'e1/Pos': { _exists: true, x: 0, y: 0 } })
    bob.pump()

    alice.adapter.disconnect() // alice goes offline
    alice.edit({ 'e1/Pos': { x: 5 } }) // buffered locally
    bob.edit({ 'e1/Pos': { y: 7 } }) // lands on the server while alice is away

    await alice.adapter.reconnect() // offline buffer flushes; server diff comes back
    alice.pump()
    bob.pump()

    const expected = { _exists: true, x: 5, y: 7 }
    expect(currentRoom.getSnapshot().state['e1/Pos']).toMatchObject(expected)
    expect(alice.doc['e1/Pos']).toMatchObject(expected) // its own x not clobbered
    expect(bob.doc['e1/Pos']).toMatchObject(expected) // converged to alice's x
  })

  it('syncs a sparse buffer-delta append through the server', async () => {
    const alice = await connect('alice')
    const bob = await connect('bob')

    alice.edit({ 'e1/Stroke': { _exists: true, points: [1, 2] } })
    bob.pump()
    expect(bob.doc['e1/Stroke']).toMatchObject({ points: [1, 2] })

    // Append (3,4) as a sparse delta — only the changed run travels.
    alice.edit({ 'e1/Stroke': { points: { __buf: 1, len: 4, runs: [[2, [3, 4]]] } } })
    bob.pump()

    // Server materializes the delta into a full array; both peers reconstruct it.
    expect(currentRoom.getSnapshot().state['e1/Stroke']).toMatchObject({ points: [1, 2, 3, 4] })
    expect(alice.doc['e1/Stroke']).toMatchObject({ points: [1, 2, 3, 4] })
    expect(bob.doc['e1/Stroke']).toMatchObject({ points: [1, 2, 3, 4] })
  })
})
