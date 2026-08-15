import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebsocketAdapter } from '../packages/canvas-store/src/adapters/Websocket'
import { defineCanvasComponent } from '../packages/canvas-store/src/CanvasComponentDef'
import { Origin } from '../packages/canvas-store/src/constants'
import { Room } from '../packages/canvas-store-server/src/Room'
import { field } from '../packages/core/src/index'

/**
 * A write that is sent but never acknowledged must survive the reconnect.
 *
 * `inFlight` is the only record of writes that have left the client and not yet
 * been acked — `flush()` already drained them out of `documentSendBuffer`, and
 * the `reconnect` frame carries `offlineBuffer`, not `inFlight`. Clearing that
 * map on reconnect (which is what `connectWs` used to do) drops the write with
 * no error on either side.
 *
 * That is how a zine loses a page. The ECS adapter advances its `prevState`
 * optimistically at pull time, so after the loss it still believes the server
 * holds the component: every subsequent edit ships as a *partial* diff against a
 * key the room has never seen, and `Room.applyPatch` materializes the first one
 * into a record with no `_exists` — which no client can ever load, because
 * `push()` pass 1 only creates entities for `_exists: true`. The entity is
 * unrecoverable; the client can never be talked into re-sending a full record.
 *
 * Invariant asserted here: an unacked document write is replayed on the next
 * connect, so the room ends up with the entity.
 */

// --- In-memory socket bridge with a controllable drop switch ------------------

let currentRoom: Room
/** When true, `send()` swallows the frame — sent by the client, never delivered. */
let dropSends = false
let liveSockets: BridgeWebSocket[] = []

class BridgeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = BridgeWebSocket.OPEN
  private listeners: Record<string, Array<(e: any) => void>> = {}
  private room: Room
  private sessionId: string | null = null

  constructor(url: string) {
    this.room = currentRoom
    liveSockets.push(this)
    const clientId = new URL(url).searchParams.get('clientId') ?? 'anon'

    queueMicrotask(() => {
      const serverSocket = {
        send: (data: string) => this.dispatch('message', { data }),
        close: () => {
          /* teardown is driven from the client side */
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
    if (dropSends) return // frame lost in flight — no delivery, so no ack
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

const Position = defineCanvasComponent(
  { name: 'Position', sync: 'document' },
  { x: field.float64().default(0), y: field.float64().default(0) },
)
const COMPONENTS = [Position]
const SINGLETONS: [] = []

// Controllable clock so the adapter's send throttle is deterministic.
let now = 100_000
function advanceClock(ms = 2_000): void {
  now += ms
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

function makeAdapter(documentId: string, clientId: string): WebsocketAdapter {
  return new WebsocketAdapter({
    url: 'ws://localhost/sync',
    clientId,
    documentId,
    usePersistence: true,
    components: COMPONENTS,
    singletons: SINGLETONS,
  })
}

describe('unacked writes survive a mid-flight disconnect (e2e)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    now = 100_000
    dropSends = false
    liveSockets = []
    vi.stubGlobal('WebSocket', BridgeWebSocket)
    currentRoom = new Room()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('replays a create whose frame was lost before the ack', async () => {
    const adapter = makeAdapter('room-lost-create', 'author')
    await adapter.init()
    await settle()

    // The frame leaves the client but never reaches the room, so no ack comes
    // back — the socket then dies. This is a sleeping laptop, a wifi blip, a
    // pod restart, or the editor's short-lived JWT forcing a reconnect.
    dropSends = true
    advanceClock()
    adapter.push([
      {
        patch: { 'page-1/Position': { _exists: true, x: 10, y: 20 } },
        origin: Origin.ECS,
        syncBehavior: 'document',
      },
    ])
    await settle()

    expect(currentRoom.getSnapshot().state['page-1/Position']).toBeUndefined()

    // Socket dies mid-flight.
    liveSockets[liveSockets.length - 1]!.close()
    await settle()

    // Reconnect on a healthy link.
    dropSends = false
    advanceClock()
    await adapter.reconnect()
    await settle()
    advanceClock()
    adapter.push([])
    await settle()

    // The create was replayed, so the room has the whole component — not a
    // fragment, and not nothing.
    expect(currentRoom.getSnapshot().state['page-1/Position']).toEqual({ _exists: true, x: 10, y: 20 })

    adapter.close()
    await settle()
  })

  it('does not strand later edits as an _exists-less fragment', async () => {
    const adapter = makeAdapter('room-fragment', 'author')
    await adapter.init()
    await settle()

    // Create lost in flight …
    dropSends = true
    advanceClock()
    adapter.push([
      {
        patch: { 'page-2/Position': { _exists: true, x: 1, y: 2 } },
        origin: Origin.ECS,
        syncBehavior: 'document',
      },
    ])
    await settle()
    liveSockets[liveSockets.length - 1]!.close()
    await settle()

    // … then the user keeps editing that entity. The ECS adapter's `prevState`
    // says the component exists, so this goes out as a bare partial — the exact
    // shape that produced the phantom page.
    dropSends = false
    advanceClock()
    await adapter.reconnect()
    await settle()
    advanceClock()
    adapter.push([{ patch: { 'page-2/Position': { x: 99 } }, origin: Origin.ECS, syncBehavior: 'document' }])
    await settle()

    const record = currentRoom.getSnapshot().state['page-2/Position']
    // The replayed create landed first, so the partial merges onto a real
    // component instead of becoming one.
    expect(record).toMatchObject({ _exists: true, x: 99, y: 2 })

    adapter.close()
    await settle()
  })

  // Control: with delivery working normally there is nothing to replay, and the
  // room must not see the write twice or in a different shape.
  it('delivers normally when no frame is lost', async () => {
    const adapter = makeAdapter('room-clean-send', 'author')
    await adapter.init()
    await settle()

    advanceClock()
    adapter.push([
      {
        patch: { 'page-3/Position': { _exists: true, x: 7, y: 8 } },
        origin: Origin.ECS,
        syncBehavior: 'document',
      },
    ])
    await settle()

    expect(currentRoom.getSnapshot().state['page-3/Position']).toMatchObject({ _exists: true, x: 7, y: 8 })

    advanceClock()
    await adapter.reconnect()
    await settle()

    expect(currentRoom.getSnapshot().state['page-3/Position']).toMatchObject({ _exists: true, x: 7, y: 8 })

    adapter.close()
    await settle()
  })
})
