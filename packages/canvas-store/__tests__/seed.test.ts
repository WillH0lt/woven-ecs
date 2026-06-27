import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { readPersistedDocument, seedRoom } from '../src/seed'
import { openStore } from '../src/storage'
import type { Patch, ServerMessage } from '../src/types'

// Minimal WebSocket mock (mirrors WebsocketAdapter.test.ts).
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  url: string
  readyState = MockWebSocket.OPEN
  sentMessages: string[] = []
  closed = false
  private listeners: Record<string, Array<(event: any) => void>> = {}

  constructor(url: string) {
    this.url = url
    queueMicrotask(() => this.dispatchEvent('open', {}))
  }
  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type]!.push(listener)
  }
  send(data: string) {
    this.sentMessages.push(data)
  }
  close() {
    this.closed = true
    this.readyState = MockWebSocket.CLOSED
  }
  dispatchEvent(type: string, event: any) {
    for (const l of this.listeners[type] ?? []) l(event)
  }
  receive(msg: ServerMessage) {
    this.dispatchEvent('message', { data: JSON.stringify(msg) })
  }
}

describe('readPersistedDocument', () => {
  it('returns the persisted state as a patch', async () => {
    const store = await openStore('doc-with-content', 'state')
    store.put('block-1/block', { _exists: true, tag: 'image' })
    store.put('SINGLETON/book', { _exists: true, pageSize: [100, 200] })
    await store.flush()
    store.close()

    const doc = await readPersistedDocument('doc-with-content')
    expect(doc['block-1/block']).toEqual({ _exists: true, tag: 'image' })
    expect(doc['SINGLETON/book']).toEqual({ _exists: true, pageSize: [100, 200] })
  })

  it('returns {} for an unknown document', async () => {
    expect(await readPersistedDocument('never-existed')).toEqual({})
  })
})

describe('seedRoom', () => {
  let mockWs: MockWebSocket | undefined

  beforeEach(() => {
    mockWs = undefined
    const MockWSClass = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
      }
    }
    vi.stubGlobal('WebSocket', MockWSClass)
  })
  afterEach(() => vi.unstubAllGlobals())

  const doc: Patch = { 'block-1/block': { _exists: true, tag: 'image' } }

  it('connects with roomId/clientId/token and sends the document as a patch', async () => {
    const promise = seedRoom({
      url: 'ws://localhost:8080',
      roomId: 'zine-1',
      token: 'tok',
      clientId: 'c1',
      document: doc,
    })
    // Let the queued "open" fire.
    await Promise.resolve()
    await Promise.resolve()

    expect(mockWs!.url).toBe('ws://localhost:8080/?roomId=zine-1&clientId=c1&token=tok')
    const sent = JSON.parse(mockWs!.sentMessages[0]!)
    expect(sent).toMatchObject({ type: 'patch', messageId: 'seed-c1', documentPatches: [doc] })

    mockWs!.receive({ type: 'ack', messageId: 'seed-c1', timestamp: 1 })
    expect(await promise).toBe(true)
    expect(mockWs!.closed).toBe(true)
  })

  it('resolves false on version-mismatch', async () => {
    const promise = seedRoom({
      url: 'ws://localhost:8080',
      roomId: 'zine-1',
      token: 'tok',
      clientId: 'c1',
      document: doc,
    })
    await Promise.resolve()
    await Promise.resolve()
    mockWs!.receive({ type: 'version-mismatch', serverProtocolVersion: 999 })
    expect(await promise).toBe(false)
  })

  it('ignores acks for other messages', async () => {
    const promise = seedRoom({
      url: 'ws://localhost:8080',
      roomId: 'zine-1',
      token: 'tok',
      clientId: 'c1',
      document: doc,
    })
    await Promise.resolve()
    await Promise.resolve()
    mockWs!.receive({ type: 'ack', messageId: 'someone-else', timestamp: 1 })
    mockWs!.receive({ type: 'ack', messageId: 'seed-c1', timestamp: 2 })
    expect(await promise).toBe(true)
  })

  it('does not connect when there is nothing to seed', async () => {
    const result = await seedRoom({ url: 'ws://localhost:8080', roomId: 'zine-1', token: 'tok', document: {} })
    expect(result).toBe(true)
    expect(mockWs).toBeUndefined()
  })
})
