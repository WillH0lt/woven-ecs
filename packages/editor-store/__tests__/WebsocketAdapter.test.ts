import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { WebsocketAdapter } from '../src/adapters/Websocket'
import { Origin } from '../src/constants'
import type { Mutation, ServerMessage } from '../src/types'

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.OPEN
  private listeners: Record<string, Array<(event: any) => void>> = {}
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    // Auto-fire open event on next microtask
    queueMicrotask(() => {
      this.dispatchEvent('open', {})
    })
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type]!.push(listener)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent('close', {})
  }

  dispatchEvent(type: string, event: any) {
    for (const listener of this.listeners[type] ?? []) {
      listener(event)
    }
  }

  // Test helper: simulate receiving a server message
  receiveMessage(msg: ServerMessage) {
    this.dispatchEvent('message', { data: JSON.stringify(msg) })
  }
}

describe('WebsocketAdapter', () => {
  let mockWs: MockWebSocket

  beforeEach(() => {
    // Replace global WebSocket with a mock class
    const MockWSClass = class extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWs = this
      }
    }
    // Copy static properties
    ;(MockWSClass as any).OPEN = MockWebSocket.OPEN
    ;(MockWSClass as any).CLOSED = MockWebSocket.CLOSED
    vi.stubGlobal('WebSocket', MockWSClass)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createAdapter(clientId = 'client-1') {
    return new WebsocketAdapter({
      url: 'ws://localhost:8080',
      clientId,
      documentId: 'test-doc',
      usePersistence: false,
      components: [],
      singletons: [],
    })
  }

  describe('init', () => {
    it('creates a WebSocket connection', async () => {
      const adapter = createAdapter()
      await adapter.init()
      expect(mockWs).toBeDefined()
      expect(mockWs.url).toBe('ws://localhost:8080/?clientId=client-1')
    })

    it('rejects on connection error', async () => {
      // Replace with a mock that fires error instead of open
      const ErrorMockWS = class {
        static OPEN = 1
        static CLOSED = 3
        private listeners: Record<string, Array<(event: any) => void>> = {}

        constructor(_url: string) {
          queueMicrotask(() => {
            for (const listener of this.listeners.error ?? []) {
              listener({})
            }
          })
        }

        addEventListener(type: string, listener: (event: any) => void) {
          if (!this.listeners[type]) this.listeners[type] = []
          this.listeners[type]!.push(listener)
        }
      }
      vi.stubGlobal('WebSocket', ErrorMockWS)

      const adapter = createAdapter()
      // init() now catches connection errors and schedules reconnect instead of throwing
      await expect(adapter.init()).resolves.toBeUndefined()
    })
  })

  describe('push', () => {
    it('sends patches as JSON with messageId', async () => {
      const adapter = createAdapter()
      await adapter.init()

      const mutations: Mutation[] = [{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }]
      adapter.push(mutations)

      expect(mockWs.sentMessages).toHaveLength(2)
      const sent = JSON.parse(mockWs.sentMessages[1]!)
      expect(sent.type).toBe('patch')
      expect(sent.messageId).toEqual(expect.any(String))
      expect(sent.documentPatches).toEqual([{ 'e1/Pos': { x: 10 } }])
    })

    it('does nothing when WebSocket is not open', async () => {
      const adapter = createAdapter()
      await adapter.init()
      mockWs.readyState = MockWebSocket.CLOSED

      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      expect(mockWs.sentMessages).toHaveLength(1) // only the initial reconnect
    })

    it('does nothing with empty mutations', async () => {
      const adapter = createAdapter()
      await adapter.init()

      adapter.push([])
      expect(mockWs.sentMessages).toHaveLength(1) // only the initial reconnect
    })

    it('sends multiple patches in one message', async () => {
      const adapter = createAdapter()
      await adapter.init()

      adapter.push([
        { patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' },
        { patch: { 'e2/Vel': { vx: 5 } }, origin: Origin.ECS, syncBehavior: 'document' },
      ])

      expect(mockWs.sentMessages).toHaveLength(2)
      const sent = JSON.parse(mockWs.sentMessages[1]!)
      expect(sent.documentPatches).toHaveLength(2)
    })

    it('increments messageId per send', async () => {
      const adapter = createAdapter()
      await adapter.init()

      let now = 2000
      const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)

      adapter.push([{ patch: { 'e1/Pos': { x: 1 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      now += 1001
      adapter.push([{ patch: { 'e1/Pos': { x: 2 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      const sent1 = JSON.parse(mockWs.sentMessages[1]!)
      const sent2 = JSON.parse(mockWs.sentMessages[2]!)
      expect(sent1.messageId).not.toBe(sent2.messageId)
      spy.mockRestore()
    })
  })

  describe('pull / message handling', () => {
    it('returns empty array when no messages received', async () => {
      const adapter = createAdapter()
      await adapter.init()
      expect(adapter.pull()).toEqual([])
    })

    it('queues mutations from remote clients', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 99 } }],
        clientId: 'client-2',
        timestamp: 100,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch).toEqual({ 'e1/Pos': { x: 99 } })
      expect(mutations[0].origin).toBe(Origin.Websocket)
    })

    it('ignores malformed JSON messages', async () => {
      const adapter = createAdapter()
      await adapter.init()

      mockWs.dispatchEvent('message', { data: 'not-json' })
      expect(adapter.pull()).toEqual([])
    })

    it('clears pending mutations after pull', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 10 } }],
        clientId: 'client-2',
        timestamp: 100,
      })

      adapter.pull() // consume
      expect(adapter.pull()).toEqual([])
    })

    it('merges multiple patches from one message into a single mutation', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 10 } }, { 'e2/Pos': { x: 20 } }],
        clientId: 'client-2',
        timestamp: 100,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ x: 10 })
      expect(mutations[0].patch['e2/Pos']).toEqual({ x: 20 })
    })
  })

  describe('ack handling', () => {
    it('updates lastTimestamp from ack messages', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Send a patch
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Server acks with timestamp
      mockWs.receiveMessage({
        type: 'ack',
        messageId: 'client-1-1',
        timestamp: 500,
      })

      // Ack should not produce a pending patch
      expect(adapter.pull()).toEqual([])

      // Verify timestamp was updated via reconnect message
      await adapter.reconnect()
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg?.lastTimestamp).toBe(500)
    })

    it('uses latest timestamp from ack or patch', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Receive a remote patch
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5 } }],
        clientId: 'client-2',
        timestamp: 100,
      })

      // Then receive an ack with a higher timestamp
      mockWs.receiveMessage({
        type: 'ack',
        messageId: 'client-1-1',
        timestamp: 200,
      })

      await adapter.reconnect()
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect' && m.lastTimestamp === 200)
      expect(reconnectMsg).toBeDefined()
    })
  })

  describe('in-flight conflict resolution', () => {
    it('strips overlapping fields from broadcasts while patch is in-flight', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Send a patch — now in-flight
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Concurrent broadcast arrives before ack (processed before ours on server)
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5 } }],
        clientId: 'client-2',
        timestamp: 1,
      })

      // x was stripped — our in-flight value takes precedence
      expect(adapter.pull()).toEqual([])
    })

    it('keeps non-overlapping fields from concurrent broadcasts', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Send a patch for x only
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Broadcast touches x (overlapping) and y (non-overlapping)
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5, y: 20 } }],
        clientId: 'client-2',
        timestamp: 1,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // x stripped, y kept
      expect(mutations[0].patch['e1/Pos']).toEqual({ y: 20 })
    })

    it('applies broadcasts after ack clears in-flight', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Send a patch
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Ack arrives — clears in-flight
      mockWs.receiveMessage({
        type: 'ack',
        messageId: 'client-1-1',
        timestamp: 1,
      })

      // Broadcast arrives after ack — should be applied fully
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 99 } }],
        clientId: 'client-2',
        timestamp: 2,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ x: 99 })
    })

    it('keeps deletion broadcast even while in-flight', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Send a patch for e1
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Another client deleted e1 — deletions always win
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { _exists: false } }],
        clientId: 'client-2',
        timestamp: 1,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: false })
    })

    it('does not filter patches for unrelated keys', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Send a patch for e1
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Broadcast for e2 — completely unrelated
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e2/Vel': { vx: 5 } }],
        clientId: 'client-2',
        timestamp: 1,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch['e2/Vel']).toEqual({ vx: 5 })
    })

    it('handles multiple in-flight patches', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      let now = 2000
      const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)

      // Two separate sends — both in-flight
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      now += 1001
      adapter.push([{ patch: { 'e2/Pos': { y: 20 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Broadcast overlaps with both
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5 }, 'e2/Pos': { y: 7, z: 3 } }],
        clientId: 'client-2',
        timestamp: 1,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // x and y stripped, z kept
      expect(mutations[0].patch['e1/Pos']).toBeUndefined()
      expect(mutations[0].patch['e2/Pos']).toEqual({ z: 3 })
      spy.mockRestore()
    })

    it("partial ack clears only that message's in-flight", async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      let now = 2000
      const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)

      // Two sends
      adapter.push([{ patch: { 'e1/Pos': { x: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      now += 1001
      adapter.push([{ patch: { 'e2/Pos': { y: 20 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Ack first message only
      mockWs.receiveMessage({
        type: 'ack',
        messageId: 'client-1-1',
        timestamp: 1,
      })

      // Broadcast touches both — e1 should apply (acked), e2 should strip
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5 }, 'e2/Pos': { y: 7 } }],
        clientId: 'client-2',
        timestamp: 2,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch['e1/Pos']).toEqual({ x: 5 })
      expect(mutations[0].patch['e2/Pos']).toBeUndefined()
      spy.mockRestore()
    })
  })

  describe('close', () => {
    it('closes the WebSocket', async () => {
      const adapter = createAdapter()
      await adapter.init()

      adapter.close()
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED)
    })

    it('handles close when not initialized', () => {
      const adapter = createAdapter()
      // Should not throw
      adapter.close()
    })
  })

  describe('reconnect', () => {
    it('sends reconnect message on initial connect with lastTimestamp=0', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      expect(mockWs.sentMessages).toHaveLength(1)
      const sent = JSON.parse(mockWs.sentMessages[0]!)
      expect(sent).toEqual({
        type: 'reconnect',
        lastTimestamp: 0,
        protocolVersion: 1,
      })
    })

    it('sends reconnect message with last timestamp', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Receive a message to set lastTimestamp
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 10 } }],
        clientId: 'client-2',
        timestamp: 500,
      })

      // Reconnect
      await adapter.reconnect()

      // Should send reconnect message
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg).toEqual({
        type: 'reconnect',
        lastTimestamp: 500,
        protocolVersion: 1,
      })
    })
  })

  describe('timestamp tracking', () => {
    it('updates lastTimestamp from patch messages', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [],
        clientId: 'client-2',
        timestamp: 100,
      })

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [],
        clientId: 'client-2',
        timestamp: 200,
      })

      // Reconnect to verify timestamp is tracked
      await adapter.reconnect()
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg?.lastTimestamp).toBe(200)
    })

    it('updates lastTimestamp from ack messages', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      mockWs.receiveMessage({
        type: 'ack',
        messageId: 'client-1-1',
        timestamp: 300,
      })

      await adapter.reconnect()
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg?.lastTimestamp).toBe(300)
    })
  })

  describe('startOffline', () => {
    it('does not connect on init when startOffline is true', async () => {
      const adapter = new WebsocketAdapter({
        url: 'ws://localhost:8080',
        clientId: 'client-1',
        documentId: 'test-doc',
        usePersistence: false,
        startOffline: true,
        components: [],
        singletons: [],
      })
      await adapter.init()

      // push should buffer, not throw
      adapter.push([{ patch: { 'e1/Pos': { x: 1 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      expect(adapter.pull()).toEqual([])
    })

    it('can connect later via reconnect after startOffline', async () => {
      const adapter = new WebsocketAdapter({
        url: 'ws://localhost:8080',
        clientId: 'client-1',
        documentId: 'test-doc',
        usePersistence: false,
        startOffline: true,
        components: [],
        singletons: [],
      })
      await adapter.init()

      // Buffer a mutation while offline
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Connect for the first time
      await adapter.reconnect()

      // Since lastTimestamp is 0 (never synced), buffer should flush
      // push() should send the buffered patch
      adapter.push([])
      // sentMessages[0] is the initial reconnect, [1] is the buffered patch
      expect(mockWs.sentMessages).toHaveLength(2)
      const sent = JSON.parse(mockWs.sentMessages[1]!)
      expect(sent.documentPatches).toEqual([{ 'e1/Pos': { x: 5 } }])
    })
  })

  describe('disconnect', () => {
    it('closes the websocket and prevents auto-reconnect', async () => {
      vi.useFakeTimers()
      const adapter = createAdapter()
      await adapter.init()

      adapter.disconnect()
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED)

      // Advance timers — no reconnect should be scheduled
      vi.advanceTimersByTime(10_000)
      // If auto-reconnect fired, a new mockWs would be created
      // and sentMessages would be empty on the new one. But since
      // disconnect was intentional, no new connection should be made.
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED)
      vi.useRealTimers()
    })
  })

  describe('offline buffering', () => {
    it('buffers mutations while disconnected', async () => {
      const adapter = createAdapter()
      await adapter.init()

      // Set lastTimestamp so reconnect sends a reconnect message
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 0 } }],
        clientId: 'client-2',
        timestamp: 100,
      })
      adapter.pull() // consume

      // Go offline
      adapter.disconnect()

      // Push mutations while offline — these should buffer
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      adapter.push([{ patch: { 'e2/Vel': { vx: 10 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Reconnect — buffer is sent in the reconnect message
      await adapter.reconnect()
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg.documentPatches).toEqual([{ 'e1/Pos': { x: 5 }, 'e2/Vel': { vx: 10 } }])

      // Server sends patches for things that changed while we were away
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e3/Pos': { x: 99 } }],
        clientId: 'client-2',
        timestamp: 200,
      })

      // pull() returns only new server values (buffer fields stripped —
      // ECS already has them from this session)
      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch['e3/Pos']).toEqual({ x: 99 })
      expect(mutations[0].patch['e1/Pos']).toBeUndefined()
      expect(mutations[0].patch['e2/Vel']).toBeUndefined()
    })

    it('merges multiple buffered mutations into one', async () => {
      const adapter = new WebsocketAdapter({
        url: 'ws://localhost:8080',
        clientId: 'client-1',
        documentId: 'test-doc',
        usePersistence: false,
        startOffline: true,
        components: [],
        singletons: [],
      })
      await adapter.init()

      // Push several mutations while offline
      adapter.push([{ patch: { 'e1/Pos': { x: 1, y: 0 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      adapter.push([{ patch: { 'e1/Pos': { z: 3 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Connect for first time (lastTimestamp=0, flushes directly)
      await adapter.reconnect()

      // push should send the merged buffer
      adapter.push([])
      // sentMessages[0] is the initial reconnect, [1] is the merged buffer
      expect(mockWs.sentMessages).toHaveLength(2)
      const sent = JSON.parse(mockWs.sentMessages[1]!)
      // x=5 (overwritten), y=0 (kept), z=3 (added)
      expect(sent.documentPatches).toEqual([{ 'e1/Pos': { x: 5, y: 0, z: 3 } }])
    })

    it('sends buffer in reconnect even when server sends no patches back', async () => {
      const adapter = createAdapter()
      await adapter.init()

      // Establish lastTimestamp
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 0 } }],
        clientId: 'client-2',
        timestamp: 100,
      })
      adapter.pull()

      adapter.disconnect()

      // Make edits offline
      adapter.push([{ patch: { 'e1/Pos': { x: 42 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      // Buffer was sent in the reconnect message
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg.documentPatches).toEqual([{ 'e1/Pos': { x: 42 } }])

      // Server sends NOTHING — no changes while we were offline
      expect(adapter.pull()).toEqual([])
    })

    it('skips websocket-origin mutations when buffering', async () => {
      const adapter = createAdapter()
      await adapter.init()
      adapter.disconnect()

      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.Websocket, syncBehavior: 'document' }])

      await adapter.reconnect()

      // No buffer to send — only the initial reconnect message
      adapter.push([])
      expect(mockWs.sentMessages).toHaveLength(1)
      const sent = JSON.parse(mockWs.sentMessages[0]!)
      expect(sent.type).toBe('reconnect')
    })
  })

  describe('reconnect conflict resolution', () => {
    async function setupOfflineAdapter() {
      const adapter = createAdapter('client-1')
      await adapter.init()

      // Establish lastTimestamp
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { _exists: true, x: 0, y: 0, z: 0 } }],
        clientId: 'client-2',
        timestamp: 100,
      })
      adapter.pull() // consume

      adapter.disconnect()
      return adapter
    }

    it('strips buffer fields from server response', async () => {
      const adapter = await setupOfflineAdapter()

      // Modify e1 locally while offline
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      // Server also modified e1
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 10, y: 20 } }],
        clientId: 'client-2',
        timestamp: 200,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // x is in our buffer → stripped. y is new from server → kept.
      expect(mutations[0].patch['e1/Pos']).toEqual({ y: 20 })
    })

    it('server deletions win over local modifications', async () => {
      const adapter = await setupOfflineAdapter()

      // Modify e1 locally while offline
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      // Server deleted e1
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { _exists: false } }],
        clientId: 'client-2',
        timestamp: 200,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // Deletion wins — entity stays deleted
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: false })
    })

    it('non-conflicting server changes pass through', async () => {
      const adapter = await setupOfflineAdapter()

      // Modify e1 locally, server modifies e2
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e2/Pos': { x: 99 } }],
        clientId: 'client-2',
        timestamp: 200,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // e2 is from server (not in buffer) → kept
      expect(mutations[0].patch['e2/Pos']).toEqual({ x: 99 })
      // e1 is not in server patch → absent
      expect(mutations[0].patch['e1/Pos']).toBeUndefined()
    })

    it('server deletes one entity while local modifies another', async () => {
      const adapter = await setupOfflineAdapter()

      // Modify e1 and e2 locally
      adapter.push([
        {
          patch: { 'e1/Pos': { x: 5 }, 'e2/Pos': { x: 7 } },
          origin: Origin.ECS,
          syncBehavior: 'document',
        },
      ])

      await adapter.reconnect()

      // Server deletes e1 only
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { _exists: false } }],
        clientId: 'client-2',
        timestamp: 200,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // e1 deleted (server deletion wins), e2 not in server patch
      expect(mutations[0].patch['e1/Pos']).toEqual({ _exists: false })
      expect(mutations[0].patch['e2/Pos']).toBeUndefined()
    })

    it('no buffer produces normal server-only merge', async () => {
      const adapter = createAdapter('client-1')
      await adapter.init()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 10 } }],
        clientId: 'client-2',
        timestamp: 100,
      })

      // No buffer — should behave exactly as before
      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      expect(mutations[0].patch).toEqual({ 'e1/Pos': { x: 10 } })
    })
  })

  describe('persistent offline buffer', () => {
    function createPersistentAdapter(clientId = 'client-1', documentId = 'test-doc') {
      return new WebsocketAdapter({
        url: 'ws://localhost:8080',
        clientId,
        documentId,
        usePersistence: true,
        startOffline: true,
        components: [],
        singletons: [],
      })
    }

    it('persists offline buffer to IndexedDB and loads on re-init', async () => {
      const docId = 'persist-buffer-test'

      // Session 1: buffer mutations while offline
      const adapter1 = createPersistentAdapter('client-1', docId)
      await adapter1.init()

      adapter1.push([{ patch: { 'e1/Pos': { x: 10, y: 20 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      // Allow fire-and-forget IndexedDB write to complete
      await new Promise((r) => setTimeout(r, 50))
      adapter1.close()

      // Session 2: should load saved offline buffer
      const adapter2 = createPersistentAdapter('client-1', docId)
      await adapter2.init()

      // Connect and check the reconnect message includes patches
      await adapter2.reconnect()

      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg).toBeDefined()
      expect(reconnectMsg.documentPatches).toEqual([{ 'e1/Pos': { x: 10, y: 20 } }])

      adapter2.close()
    })

    it('persists lastTimestamp and loads on re-init', async () => {
      const docId = 'persist-ts-test'

      // Session 1: connect and receive a message to set lastTimestamp
      const adapter1 = new WebsocketAdapter({
        url: 'ws://localhost:8080',
        clientId: 'client-1',
        documentId: docId,
        usePersistence: true,
        components: [],
        singletons: [],
      })
      await adapter1.init()

      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 10 } }],
        clientId: 'client-2',
        timestamp: 500,
      })

      // Allow fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 50))
      adapter1.close()

      // Session 2: should reconnect with persisted timestamp
      const adapter2 = createPersistentAdapter('client-1', docId)
      await adapter2.init()
      await adapter2.reconnect()

      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg?.lastTimestamp).toBe(500)

      adapter2.close()
    })

    it('sends offline buffer in reconnect message', async () => {
      const adapter = createPersistentAdapter()
      await adapter.init()

      // Buffer while offline
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg.documentPatches).toEqual([{ 'e1/Pos': { x: 5 } }])

      adapter.close()
    })

    it('does not include patches in reconnect when buffer is empty', async () => {
      const adapter = new WebsocketAdapter({
        url: 'ws://localhost:8080',
        clientId: 'client-1',
        documentId: 'empty-buf-test',
        usePersistence: true,
        components: [],
        singletons: [],
      })
      await adapter.init()

      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg.documentPatches).toBeUndefined()

      adapter.close()
    })

    it('strips offline buffer from server response (persistence already has them)', async () => {
      const adapter = createPersistentAdapter()
      await adapter.init()

      // Buffer while offline
      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      // Server sends back diff including our offline changes + other changes
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5, y: 20 }, 'e2/Vel': { vx: 10 } }],
        clientId: 'server',
        timestamp: 200,
      })

      const mutations = adapter.pull()
      expect(mutations).toHaveLength(1)
      // x was in offlineBuffer → stripped. y is new from server → kept.
      expect(mutations[0].patch['e1/Pos']).toEqual({ y: 20 })
      // e2/Vel is entirely from server → kept
      expect(mutations[0].patch['e2/Vel']).toEqual({ vx: 10 })

      adapter.close()
    })

    it('returns null from pull when server response is entirely our offline buffer', async () => {
      const adapter = createPersistentAdapter()
      await adapter.init()

      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      // Server echoes back exactly what we sent
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5 } }],
        clientId: 'server',
        timestamp: 200,
      })

      expect(adapter.pull()).toEqual([])

      adapter.close()
    })

    it('clears persisted offline buffer after pull', async () => {
      const docId = 'clear-buf-test'
      const adapter = createPersistentAdapter('client-1', docId)
      await adapter.init()

      adapter.push([{ patch: { 'e1/Pos': { x: 5 } }, origin: Origin.ECS, syncBehavior: 'document' }])

      await adapter.reconnect()

      // Server response triggers pull which clears buffer
      mockWs.receiveMessage({
        type: 'patch',
        documentPatches: [{ 'e1/Pos': { x: 5 }, 'e2/Vel': { vx: 10 } }],
        clientId: 'server',
        timestamp: 200,
      })

      adapter.pull()
      await new Promise((r) => setTimeout(r, 50))
      adapter.close()

      // New session: offline buffer should be empty
      const adapter2 = createPersistentAdapter('client-1', docId)
      await adapter2.init()
      await adapter2.reconnect()

      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg.documentPatches).toBeUndefined()

      adapter2.close()
    })

    it('skips Persistence-origin mutations when usePersistence is true', async () => {
      const adapter = createPersistentAdapter()
      await adapter.init()

      // Push a Persistence-origin mutation (simulating page-load state)
      adapter.push([
        { patch: { 'e1/Pos': { _exists: true, x: 10 } }, origin: Origin.Persistence, syncBehavior: 'document' },
      ])

      await adapter.reconnect()

      // Should NOT have patches in reconnect (Persistence-origin was skipped)
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      expect(reconnectMsg.documentPatches).toBeUndefined()

      adapter.close()
    })

    it('merges multiple offline sessions into one buffer', async () => {
      const docId = 'multi-session-test'

      // Session 1
      const adapter1 = createPersistentAdapter('client-1', docId)
      await adapter1.init()
      adapter1.push([{ patch: { 'e1/Pos': { x: 10, y: 20 } }, origin: Origin.ECS, syncBehavior: 'document' }])
      await new Promise((r) => setTimeout(r, 50))
      adapter1.close()

      // Session 2: loads session 1's buffer, adds more
      const adapter2 = createPersistentAdapter('client-1', docId)
      await adapter2.init()
      adapter2.push([
        { patch: { 'e1/Pos': { x: 30 }, 'e2/Vel': { vx: 5 } }, origin: Origin.ECS, syncBehavior: 'document' },
      ])
      await new Promise((r) => setTimeout(r, 50))

      await adapter2.reconnect()
      const sent = mockWs.sentMessages.map((s) => JSON.parse(s))
      const reconnectMsg = sent.find((m) => m.type === 'reconnect')
      // x=30 overwrites x=10, y=20 kept, e2/Vel added
      expect(reconnectMsg.documentPatches).toEqual([{ 'e1/Pos': { x: 30, y: 20 }, 'e2/Vel': { vx: 5 } }])

      adapter2.close()
    })
  })

  describe('auto-reconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('schedules reconnect on unexpected close', async () => {
      const adapter = createAdapter()
      await adapter.init()

      const firstWs = mockWs

      // Simulate unexpected close (server drops connection)
      firstWs.dispatchEvent('close', {})

      // Should not reconnect immediately
      expect(mockWs).toBe(firstWs)

      // After 500ms (MIN_RECONNECT_DELAY), should attempt reconnect
      await vi.advanceTimersByTimeAsync(500)

      // A new WebSocket should have been created
      expect(mockWs).not.toBe(firstWs)
    })

    it('does not auto-reconnect after intentional disconnect', async () => {
      const adapter = createAdapter()
      await adapter.init()

      const firstWs = mockWs
      adapter.disconnect()

      // Advance past any possible reconnect delay
      await vi.advanceTimersByTimeAsync(20_000)

      // Should still be the same closed websocket
      expect(mockWs).toBe(firstWs)
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED)
    })

    it('backs off on repeated failures', async () => {
      // Use a WebSocket that always fails
      let connectAttempts = 0
      const FailingMockWS = class {
        static OPEN = 1
        static CLOSED = 3
        readyState = 3
        private listeners: Record<string, Array<(event: any) => void>> = {}
        constructor(_url: string) {
          connectAttempts++
          queueMicrotask(() => {
            for (const listener of this.listeners.error ?? []) {
              listener({})
            }
          })
        }
        addEventListener(type: string, listener: (event: any) => void) {
          if (!this.listeners[type]) this.listeners[type] = []
          this.listeners[type]!.push(listener)
        }
        send() {
          // No-op for mock
        }
        close() {
          // No-op for mock
        }
      }

      // Start with a working connection
      const adapter = createAdapter()
      await adapter.init()

      // Now switch to failing WebSocket
      vi.stubGlobal('WebSocket', FailingMockWS)
      connectAttempts = 0

      // Simulate unexpected close
      mockWs.dispatchEvent('close', {})

      // 500ms — first retry
      await vi.advanceTimersByTimeAsync(500)
      expect(connectAttempts).toBe(1)

      // 1000ms — second retry (backed off)
      await vi.advanceTimersByTimeAsync(1000)
      expect(connectAttempts).toBe(2)

      // 2000ms — third retry
      await vi.advanceTimersByTimeAsync(2000)
      expect(connectAttempts).toBe(3)
    })
  })
})
