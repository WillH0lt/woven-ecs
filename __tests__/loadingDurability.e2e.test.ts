import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebsocketAdapter } from '../packages/canvas-store/src/adapters/Websocket'
import { defineCanvasComponent } from '../packages/canvas-store/src/CanvasComponentDef'
import { CanvasStore } from '../packages/canvas-store/src/CanvasStore'
import { Synced } from '../packages/canvas-store/src/components/Synced'
import { Origin } from '../packages/canvas-store/src/constants'
import type { Patch } from '../packages/canvas-store/src/types'
import { Room } from '../packages/canvas-store-server/src/Room'
import { MemoryStorage } from '../packages/canvas-store-server/src/storage/MemoryStorage'
import { type Context, field, World } from '../packages/core/src/index'

/**
 * End-to-end reproduction of the "large zine sometimes loads blank" bug.
 *
 * The real client {@link CanvasStore} (persistence + websocket) talks to the
 * real server {@link Room} over an in-memory socket bridge, with a real
 * (fake-indexeddb) persistence layer so "what's durable" is meaningful.
 *
 * The hazard: the websocket adapter advances + persists `lastTimestamp` the
 * moment it *receives* the document snapshot — before the document has been
 * applied to the ECS or written to IndexedDB. `lastTimestamp` is what a
 * reconnect sends so the server knows what to resend (`buildDiff(lastTimestamp)`).
 * If the tab reloads in that window (the window is large for a big document),
 * the next load reconnects with a `lastTimestamp` the server considers current,
 * gets an empty diff back, and the document is gone — and stays gone, because
 * the bad `lastTimestamp` is persisted.
 *
 * Invariant this asserts: a client interrupted before it has durably applied
 * the document must recover the whole document on reload.
 */

// --- In-memory socket bridge (same shape as rollbackRecovery.e2e) -------------

let currentRoom: Room

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

// --- Document component + harness helpers --------------------------------------

const Position = defineCanvasComponent(
  { name: 'Position', sync: 'document' },
  { x: field.float64().default(0), y: field.float64().default(0) },
)
const COMPONENTS = [Position]
const SINGLETONS: [] = []

// Controllable clock so the writer adapter's send throttle is deterministic.
let now = 100_000
function advanceClock(ms = 2_000): void {
  now += ms
}

// Let fake-indexeddb's buffered writes (kicked by KeyValueStore.close → flush)
// actually commit before we "reload" with a fresh store on the same db.
async function settleIdb(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

function makeWorld(): World {
  return new World([Synced, Position], { maxEntities: 1000, maxEvents: 4096 })
}

function tick(world: World, store: CanvasStore): void {
  world.execute((ctx: Context) => store.sync(ctx))
}

function makeLoaderStore(documentId: string): CanvasStore {
  return new CanvasStore({
    persistence: { documentId },
    websocket: { documentId, url: 'ws://localhost/sync', clientId: 'loader' },
  })
}

/** Seed the room with a small document via a local-only (no IndexedDB) writer. */
async function seedServerDocument(): Promise<WebsocketAdapter> {
  const writer = new WebsocketAdapter({
    url: 'ws://localhost/sync',
    clientId: 'writer',
    documentId: 'writer-no-persist',
    usePersistence: false,
    components: COMPONENTS,
    singletons: SINGLETONS,
  })
  await writer.init()

  const edits: Patch[] = [
    { 'e1/Position': { _exists: true, x: 1, y: 1 } },
    { 'e2/Position': { _exists: true, x: 2, y: 2 } },
    { 'e3/Position': { _exists: true, x: 3, y: 3 } },
  ]
  for (const patch of edits) {
    advanceClock()
    writer.push([{ patch, origin: Origin.ECS, syncBehavior: 'document' }])
  }
  return writer
}

// --- Test ----------------------------------------------------------------------

describe('document loads on reload after an interrupted initial sync (e2e)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    now = 100_000
    vi.stubGlobal('WebSocket', BridgeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('recovers the whole document when reloaded before the first persist tick', async () => {
    const docId = 'room-interrupted-load'
    currentRoom = new Room()

    const writer = await seedServerDocument()
    expect(Object.keys(currentRoom.getSnapshot().state)).toHaveLength(3)

    // First open: connect and receive the snapshot, then "reload" before any
    // sync tick applies/persists it (no tick is run). Models closing the tab
    // mid-load — for a large zine the receive→durable window is long.
    const store1 = makeLoaderStore(docId)
    await store1.initialize({ components: COMPONENTS, singletons: SINGLETONS })
    store1.close()
    await settleIdb()

    // Reload: a brand-new store on the same documentId. Its persisted document
    // is empty, so it must re-fetch the whole document from the server.
    const store2 = makeLoaderStore(docId)
    const world2 = makeWorld()
    await store2.initialize({ components: COMPONENTS, singletons: SINGLETONS })
    tick(world2, store2)
    await settleIdb()
    tick(world2, store2)

    const state = store2.getState()
    expect(state['e1/Position']).toMatchObject({ x: 1, y: 1 })
    expect(state['e2/Position']).toMatchObject({ x: 2, y: 2 })
    expect(state['e3/Position']).toMatchObject({ x: 3, y: 3 })

    store2.close()
    writer.disconnect()
    await settleIdb()
  })

  // Control: proves the harness round-trips correctly. When the first session
  // is NOT interrupted — it ticks, applying + persisting the document — a reload
  // loads it straight from IndexedDB. Green today; the test above is the bug.
  it('loads the document on reload when the first session persisted it normally', async () => {
    const docId = 'room-clean-load'
    currentRoom = new Room()

    const writer = await seedServerDocument()
    expect(Object.keys(currentRoom.getSnapshot().state)).toHaveLength(3)

    const store1 = makeLoaderStore(docId)
    const world1 = makeWorld()
    await store1.initialize({ components: COMPONENTS, singletons: SINGLETONS })
    tick(world1, store1) // apply the snapshot + hand it to persistence
    await settleIdb()
    expect(store1.getState()['e1/Position']).toMatchObject({ x: 1, y: 1 })
    store1.close()
    await settleIdb()

    const store2 = makeLoaderStore(docId)
    const world2 = makeWorld()
    await store2.initialize({ components: COMPONENTS, singletons: SINGLETONS })
    tick(world2, store2)

    const state = store2.getState()
    expect(state['e1/Position']).toMatchObject({ x: 1, y: 1 })
    expect(state['e2/Position']).toMatchObject({ x: 2, y: 2 })
    expect(state['e3/Position']).toMatchObject({ x: 3, y: 3 })

    store2.close()
    writer.disconnect()
    await settleIdb()
  })

  it('marks the store synced (and fires onSync) once the document is delivered + applied', async () => {
    const docId = 'room-synced-signal'
    currentRoom = new Room()
    const writer = await seedServerDocument()

    const onSync = vi.fn()
    const store = new CanvasStore({
      persistence: { documentId: docId },
      websocket: { documentId: docId, url: 'ws://localhost/sync', clientId: 'loader', onSync },
    })
    const world = makeWorld()
    await store.initialize({ components: COMPONENTS, singletons: SINGLETONS })

    // The snapshot + synced marker have arrived, but synced is deferred to apply.
    expect(store.isSynced).toBe(false)
    expect(onSync).not.toHaveBeenCalled()

    tick(world, store) // applies the snapshot and fires synced
    expect(store.isSynced).toBe(true)
    expect(onSync).toHaveBeenCalledTimes(1)
    // synced really does mean loaded: the document is in the world.
    expect(store.getState()['e1/Position']).toMatchObject({ x: 1, y: 1 })

    store.close()
    writer.disconnect()
    await settleIdb()
  })
})

// --- Server warm-up lag --------------------------------------------------------

/**
 * The real server's `acceptConnection` is async: it `await`s auth + lazy room
 * load before it attaches the socket's message handler. But the client sends its
 * `reconnect` the instant the socket opens — so during a slow accept (a big
 * document loading from storage) that first `reconnect` is emitted before the
 * server is listening and is simply lost. The server then never proactively
 * sends the document. This bridge models exactly that window.
 */
let serverWarm = true
const pendingAccepts: Array<() => void> = []
function warmUpServer(): void {
  serverWarm = true
  for (const accept of pendingAccepts.splice(0)) accept()
}

class LaggyBridge {
  static OPEN = 1
  static CLOSED = 3
  readyState = LaggyBridge.OPEN
  url: string
  private listeners: Record<string, Array<(e: any) => void>> = {}
  private room: Room
  private clientId: string
  private sessionId: string | null = null
  private serverSocket = {
    send: (data: string) => this.dispatch('message', { data }),
    close: () => {
      /* teardown is driven from the client side via handleSocketClose */
    },
  }

  constructor(url: string) {
    this.url = url
    this.room = currentRoom
    this.clientId = new URL(url).searchParams.get('clientId') ?? 'anon'

    queueMicrotask(() => {
      const accept = () => {
        this.sessionId = this.room.handleSocketConnect({
          socket: this.serverSocket,
          clientId: this.clientId,
          permissions: 'readwrite',
        })
      }
      // The socket "connects" (open fires) regardless — but until the server is
      // warm it has no session/handler, so anything the client sends is dropped.
      if (serverWarm) accept()
      else pendingAccepts.push(accept)
      this.dispatch('open', {})
    })
  }

  addEventListener(type: string, cb: (e: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(cb)
  }

  send(data: string): void {
    // Server not warm yet → no handler attached → message is lost.
    if (this.sessionId) this.room.handleSocketMessage(this.sessionId, data)
  }

  close(): void {
    this.readyState = LaggyBridge.CLOSED
    if (this.sessionId) this.room.handleSocketClose(this.sessionId)
    this.dispatch('close', {})
  }

  private dispatch(type: string, e: any): void {
    for (const l of this.listeners[type] ?? []) l(e)
  }
}

/** Apply a wire patch to a plain document map (mirrors the ECS world). */
function applyDoc(doc: Patch, patch: Patch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value._exists === false) delete doc[key]
    else doc[key] = { ...(doc[key] ?? {}), ...value }
  }
}

/** Minimal client peer: pulls server mutations into a local doc + adapter mirror. */
class Peer {
  doc: Patch = {}
  constructor(readonly adapter: WebsocketAdapter) {}
  pump(): void {
    const muts = this.adapter.pull()
    if (muts.length === 0) return
    for (const m of muts) applyDoc(this.doc, m.patch)
    this.adapter.push(muts)
  }
  sendPresence(patch: Patch): void {
    advanceClock()
    this.adapter.push([{ patch, origin: Origin.ECS, syncBehavior: 'ephemeral' }])
  }
}

async function reconnectPeer(peer: Peer): Promise<void> {
  peer.adapter.disconnect()
  await peer.adapter.reconnect()
  peer.pump()
}

/** A room with a 3-entity document already loaded from durable storage. */
async function seedLoadedRoom(): Promise<void> {
  const storage = new MemoryStorage()
  await storage.save({
    timestamp: 3,
    state: {
      'e1/Position': { _exists: true, x: 1, y: 1 },
      'e2/Position': { _exists: true, x: 2, y: 2 },
      'e3/Position': { _exists: true, x: 3, y: 3 },
    },
    timestamps: {
      'e1/Position': { _exists: 1, x: 1, y: 1 },
      'e2/Position': { _exists: 2, x: 2, y: 2 },
      'e3/Position': { _exists: 3, x: 3, y: 3 },
    },
  })
  currentRoom = new Room({ createStorage: () => storage })
  await currentRoom.load()
}

function makeLaggyPeer(): Peer {
  return new Peer(
    new WebsocketAdapter({
      url: 'ws://localhost/sync',
      clientId: 'loader',
      documentId: 'lag',
      usePersistence: false,
      components: COMPONENTS,
      singletons: SINGLETONS,
    }),
  )
}

describe('document loads despite server warm-up lag + early presence (e2e)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    now = 100_000
    serverWarm = true
    pendingAccepts.length = 0
    vi.stubGlobal('WebSocket', LaggyBridge)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('recovers the document when the initial sync is missed during warm-up and presence is sent', async () => {
    await seedLoadedRoom()
    expect(Object.keys(currentRoom.getSnapshot().state)).toHaveLength(3)

    // The server is still warming up (attaching the handler) when the user opens
    // the page, so the client's eager reconnect is dropped.
    serverWarm = false
    const loader = makeLaggyPeer()
    await loader.adapter.init()
    loader.pump()
    expect(loader.doc).toEqual({}) // nothing arrived — initial sync was missed

    // The server finishes warming up. The dropped reconnect is NOT retried, so
    // the server doesn't know this client still needs the document.
    warmUpServer()

    // While waiting, the user's presence goes out — and gets acked with the
    // server's current timestamp.
    loader.sendPresence({ 'loader/user': { _exists: true, name: 'Will' } })
    loader.pump()

    // A couple ticks later the client re-syncs (socket retry / remount). With a
    // healthy lastTimestamp this fetches the whole document; the bug poisons it.
    await reconnectPeer(loader)
    await reconnectPeer(loader)

    expect(loader.doc['e1/Position']).toMatchObject({ x: 1, y: 1 })
    expect(loader.doc['e2/Position']).toMatchObject({ x: 2, y: 2 })
    expect(loader.doc['e3/Position']).toMatchObject({ x: 3, y: 3 })

    loader.adapter.disconnect()
  })

  // Control: identical warm-up miss, but the client sends NO presence. The
  // reconnect recovers the whole document — proving the recovery path works and
  // that the early presence (above) is the sole cause of the permanent failure.
  it('recovers via reconnect when the initial sync is missed and no presence is sent', async () => {
    await seedLoadedRoom()

    serverWarm = false
    const loader = makeLaggyPeer()
    await loader.adapter.init()
    loader.pump()
    expect(loader.doc).toEqual({})

    warmUpServer()

    // No presence — lastTimestamp is untouched, so the reconnect asks from 0.
    await reconnectPeer(loader)

    expect(loader.doc['e1/Position']).toMatchObject({ x: 1, y: 1 })
    expect(loader.doc['e2/Position']).toMatchObject({ x: 2, y: 2 })
    expect(loader.doc['e3/Position']).toMatchObject({ x: 3, y: 3 })

    loader.adapter.disconnect()
  })
})
