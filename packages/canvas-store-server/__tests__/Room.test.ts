import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Room } from '../src/Room'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import type {
  AckResponse,
  ClientCountBroadcast,
  PatchBroadcast,
  ServerMessage,
  SessionPermission,
  VersionMismatchResponse,
} from '../src/types'

// --- Test helpers ---

function createMockSocket() {
  const socket = {
    messages: [] as ServerMessage[],
    send: vi.fn((data: string) => {
      socket.messages.push(JSON.parse(data))
    }),
    close: vi.fn(),
  }
  return socket
}

function connectClient(room: Room, clientId: string, permissions: SessionPermission = 'readwrite') {
  const socket = createMockSocket()
  const sessionId = room.handleSocketConnect({ socket, clientId, permissions })
  return { socket, sessionId }
}

function getMessages<T extends ServerMessage>(socket: ReturnType<typeof createMockSocket>, type: T['type']): T[] {
  return socket.messages.filter((m) => m.type === type) as T[]
}

function clearMessages(socket: ReturnType<typeof createMockSocket>) {
  socket.messages.length = 0
}

// --- Tests ---

describe('Room', () => {
  let room: Room

  beforeEach(() => {
    room = new Room()
  })

  describe('connection lifecycle', () => {
    it('broadcasts clientCount on connect', () => {
      const { socket } = connectClient(room, 'alice')
      const counts = getMessages<ClientCountBroadcast>(socket, 'clientCount')
      expect(counts).toHaveLength(1)
      expect(counts[0].count).toBe(1)
    })

    it('broadcasts updated clientCount when second client connects', () => {
      const { socket: s1 } = connectClient(room, 'alice')
      clearMessages(s1)
      const { socket: s2 } = connectClient(room, 'bob')

      // Both clients should get count=2
      const c1 = getMessages<ClientCountBroadcast>(s1, 'clientCount')
      const c2 = getMessages<ClientCountBroadcast>(s2, 'clientCount')
      expect(c1).toHaveLength(1)
      expect(c1[0].count).toBe(2)
      expect(c2).toHaveLength(1)
      expect(c2[0].count).toBe(2)
    })

    it('broadcasts clientCount on disconnect', () => {
      const { socket: s1 } = connectClient(room, 'alice')
      const { socket: s2, sessionId: sid2 } = connectClient(room, 'bob')
      clearMessages(s1)
      clearMessages(s2)

      room.handleSocketClose(sid2)

      const counts = getMessages<ClientCountBroadcast>(s1, 'clientCount')
      expect(counts).toHaveLength(1)
      expect(counts[0].count).toBe(1)
    })

    it('calls onSessionRemoved callback', () => {
      const onRemoved = vi.fn()
      room = new Room({ onSessionRemoved: onRemoved })

      const { sessionId } = connectClient(room, 'alice')
      room.handleSocketClose(sessionId)

      expect(onRemoved).toHaveBeenCalledWith(room, {
        sessionId,
        remaining: 0,
      })
    })

    it('tracks sessions', () => {
      connectClient(room, 'alice')
      connectClient(room, 'bob')
      expect(room.getSessionCount()).toBe(2)
      expect(room.getSessions()).toHaveLength(2)
    })
  })

  describe('patch handling', () => {
    it('acks a patch with the current timestamp', () => {
      const { socket, sessionId } = connectClient(room, 'alice')
      clearMessages(socket)

      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'entity1/Position': { _exists: true, x: 10, y: 20 } }],
        }),
      )

      const acks = getMessages<AckResponse>(socket, 'ack')
      expect(acks).toHaveLength(1)
      expect(acks[0].messageId).toBe('msg-1')
      expect(acks[0].timestamp).toBe(1)
    })

    it('broadcasts document patches to other clients', () => {
      const { socket: s1, sessionId: sid1 } = connectClient(room, 'alice')
      const { socket: s2 } = connectClient(room, 'bob')
      clearMessages(s1)
      clearMessages(s2)

      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'entity1/Position': { x: 10 } }],
        }),
      )

      // Alice gets ack, Bob gets broadcast
      expect(getMessages<AckResponse>(s1, 'ack')).toHaveLength(1)
      expect(getMessages<PatchBroadcast>(s1, 'patch')).toHaveLength(0)

      const broadcasts = getMessages<PatchBroadcast>(s2, 'patch')
      expect(broadcasts).toHaveLength(1)
      expect(broadcasts[0].clientId).toBe('alice')
      expect(broadcasts[0].documentPatches).toEqual([{ 'entity1/Position': { x: 10 } }])
    })

    it('broadcasts ephemeral patches to other clients', () => {
      const { socket: s1, sessionId: sid1 } = connectClient(room, 'alice')
      const { socket: s2 } = connectClient(room, 'bob')
      clearMessages(s1)
      clearMessages(s2)

      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          ephemeralPatches: [{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }],
        }),
      )

      const broadcasts = getMessages<PatchBroadcast>(s2, 'patch')
      expect(broadcasts).toHaveLength(1)
      expect(broadcasts[0].ephemeralPatches).toEqual([{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }])
    })

    it('ignores empty patches', () => {
      const { socket: s1, sessionId: sid1 } = connectClient(room, 'alice')
      const { socket: s2 } = connectClient(room, 'bob')
      clearMessages(s1)
      clearMessages(s2)

      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
        }),
      )

      expect(getMessages<AckResponse>(s1, 'ack')).toHaveLength(0)
      expect(getMessages<PatchBroadcast>(s2, 'patch')).toHaveLength(0)
    })

    it('increments timestamp only for document patches', () => {
      const { socket, sessionId } = connectClient(room, 'alice')
      clearMessages(socket)

      // Ephemeral only -- no timestamp bump
      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          ephemeralPatches: [{ 'alice/Cursor': { x: 1 } }],
        }),
      )
      expect(getMessages<AckResponse>(socket, 'ack')[0].timestamp).toBe(0)

      clearMessages(socket)

      // Document -- bumps timestamp
      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-2',
          documentPatches: [{ 'entity1/Position': { x: 10 } }],
        }),
      )
      expect(getMessages<AckResponse>(socket, 'ack')[0].timestamp).toBe(1)
    })
  })

  describe('document state', () => {
    it('applies and merges patches field-by-field', () => {
      const { sessionId } = connectClient(room, 'alice')

      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10, y: 20 } }],
        }),
      )
      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-2',
          documentPatches: [{ 'e1/Pos': { x: 30 } }],
        }),
      )

      const snapshot = room.getSnapshot()
      expect(snapshot.state['e1/Pos']).toEqual({ _exists: true, x: 30, y: 20 })
    })

    it('handles tombstone deletions', () => {
      const { sessionId } = connectClient(room, 'alice')

      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )
      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-2',
          documentPatches: [{ 'e1/Pos': { _exists: false } }],
        }),
      )

      const snapshot = room.getSnapshot()
      expect(snapshot.state['e1/Pos']).toBeUndefined()
    })
  })

  describe('ephemeral state', () => {
    it('sends existing ephemeral state to newly connecting clients', () => {
      const { sessionId: sid1 } = connectClient(room, 'alice')

      // Alice sends ephemeral state
      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          ephemeralPatches: [{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }],
        }),
      )

      // Bob connects and should receive Alice's ephemeral state
      const { socket: s2 } = connectClient(room, 'bob')
      const patches = getMessages<PatchBroadcast>(s2, 'patch')
      expect(patches).toHaveLength(1)
      expect(patches[0].ephemeralPatches).toEqual([{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }])
    })

    it('broadcasts deletion patches when a client disconnects', () => {
      const { sessionId: sid1 } = connectClient(room, 'alice')
      const { socket: s2 } = connectClient(room, 'bob')

      // Alice sends ephemeral state
      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          ephemeralPatches: [{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }],
        }),
      )
      clearMessages(s2)

      // Alice disconnects
      room.handleSocketClose(sid1)

      const patches = getMessages<PatchBroadcast>(s2, 'patch')
      expect(patches).toHaveLength(1)
      expect(patches[0].ephemeralPatches).toEqual([{ 'alice/Cursor': { _exists: false } }])
      expect(patches[0].clientId).toBe('alice')
    })
  })

  describe('reconnect handling', () => {
    it('sends document diff since lastTimestamp', () => {
      const { sessionId: sid1 } = connectClient(room, 'alice')

      // Alice makes some changes
      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10, y: 20 } }],
        }),
      )
      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-2',
          documentPatches: [{ 'e2/Vel': { _exists: true, dx: 1 } }],
        }),
      )

      // Bob reconnects knowing timestamp 1 (missed the second patch)
      const { socket: s2, sessionId: sid2 } = connectClient(room, 'bob')
      clearMessages(s2)

      room.handleSocketMessage(
        sid2,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 1,
          protocolVersion: 1,
        }),
      )

      const patches = getMessages<PatchBroadcast>(s2, 'patch')
      expect(patches).toHaveLength(1)
      // Should only include e2/Vel which was at timestamp 2
      expect(patches[0].documentPatches).toEqual([{ 'e2/Vel': { _exists: true, dx: 1 } }])
    })

    it('applies offline document patches from reconnecting client', () => {
      connectClient(room, 'alice')
      const { socket: s2, sessionId: sid2 } = connectClient(room, 'bob')
      clearMessages(s2)

      // Bob reconnects with offline changes
      room.handleSocketMessage(
        sid2,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 1,
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 99 } }],
        }),
      )

      const snapshot = room.getSnapshot()
      expect(snapshot.state['e1/Pos']).toEqual({ _exists: true, x: 99 })
    })

    it("sends other clients' ephemeral state on reconnect", () => {
      const { sessionId: sid1 } = connectClient(room, 'alice')

      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          ephemeralPatches: [{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }],
        }),
      )

      const { socket: s2, sessionId: sid2 } = connectClient(room, 'bob')
      clearMessages(s2)

      room.handleSocketMessage(
        sid2,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 1,
        }),
      )

      // Bob should receive Alice's ephemeral state
      const patches = getMessages<PatchBroadcast>(s2, 'patch')
      // One of the patches should contain ephemeral data
      const ephPatch = patches.find((p) => p.ephemeralPatches?.length)
      expect(ephPatch).toBeDefined()
      expect(ephPatch!.ephemeralPatches).toEqual([{ 'alice/Cursor': { _exists: true, x: 50, y: 100 } }])
    })

    it("broadcasts reconnecting client's changes to others", () => {
      const { socket: s1 } = connectClient(room, 'alice')
      connectClient(room, 'bob')
      clearMessages(s1)

      const { sessionId: sid2 } = connectClient(room, 'bob')

      clearMessages(s1)
      room.handleSocketMessage(
        sid2,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 1,
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 42 } }],
        }),
      )

      const broadcasts = getMessages<PatchBroadcast>(s1, 'patch')
      expect(broadcasts.length).toBeGreaterThanOrEqual(1)
      const docBroadcast = broadcasts.find((b) => b.documentPatches?.length)
      expect(docBroadcast).toBeDefined()
      expect(docBroadcast!.documentPatches).toEqual([{ 'e1/Pos': { _exists: true, x: 42 } }])
    })
  })

  describe('snapshots', () => {
    it('getSnapshot returns current state', () => {
      const { sessionId } = connectClient(room, 'alice')

      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [
            {
              'e1/Pos': { _exists: true, x: 10, y: 20 },
              'e2/Vel': { _exists: true, dx: 1, dy: 2 },
            },
          ],
        }),
      )

      const snap = room.getSnapshot()
      expect(snap.timestamp).toBe(1)
      expect(snap.state['e1/Pos']).toEqual({ _exists: true, x: 10, y: 20 })
      expect(snap.state['e2/Vel']).toEqual({ _exists: true, dx: 1, dy: 2 })
      expect(snap.timestamps['e1/Pos']).toEqual({
        _exists: 1,
        x: 1,
        y: 1,
      })
    })
  })

  describe('persistence', () => {
    it('throttles saves to storage', async () => {
      vi.useFakeTimers()
      const storage = new MemoryStorage()
      const saveSpy = vi.spyOn(storage, 'save')

      room = new Room({ createStorage: () => storage, saveThrottleMs: 100 })

      const { sessionId } = connectClient(room, 'alice')

      // Send multiple patches rapidly
      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )
      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-2',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 20 } }],
        }),
      )

      // Should not have saved yet
      expect(saveSpy).not.toHaveBeenCalled()

      // Advance past the throttle
      await vi.advanceTimersByTimeAsync(150)

      expect(saveSpy).toHaveBeenCalledTimes(1)
      const savedSnapshot = saveSpy.mock.calls[0][0]
      expect(savedSnapshot.state['e1/Pos']).toEqual({ _exists: true, x: 20 })

      vi.useRealTimers()
    })

    it('loads state from storage', async () => {
      const storage = new MemoryStorage()
      await storage.save({
        timestamp: 10,
        state: { 'e1/Pos': { x: 99 } },
        timestamps: { 'e1/Pos': { x: 10 } },
      })

      room = new Room({ createStorage: () => storage })
      await room.load()

      const snap = room.getSnapshot()
      expect(snap.timestamp).toBe(10)
      expect(snap.state['e1/Pos']).toEqual({ x: 99 })
    })
  })

  describe('close', () => {
    it('closes all client sockets', () => {
      const { socket: s1 } = connectClient(room, 'alice')
      const { socket: s2 } = connectClient(room, 'bob')

      room.close()

      expect(s1.close).toHaveBeenCalled()
      expect(s2.close).toHaveBeenCalled()
      expect(room.getSessionCount()).toBe(0)
    })
  })

  describe('permissions', () => {
    it('readonly client cannot send document patches', () => {
      const { socket: sWriter } = connectClient(room, 'alice', 'readwrite')
      const { socket: sReader, sessionId: readerSid } = connectClient(room, 'bob', 'readonly')
      clearMessages(sWriter)
      clearMessages(sReader)

      room.handleSocketMessage(
        readerSid,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )

      // Reader still gets an ack so the client doesn't stall
      const acks = getMessages<AckResponse>(sReader, 'ack')
      expect(acks).toHaveLength(1)
      expect(acks[0].messageId).toBe('msg-1')

      // Writer should NOT receive a broadcast
      expect(getMessages<PatchBroadcast>(sWriter, 'patch')).toHaveLength(0)

      // Document state should be unchanged
      const snapshot = room.getSnapshot()
      expect(snapshot.state['e1/Pos']).toBeUndefined()
      expect(snapshot.timestamp).toBe(0)
    })

    it('readonly client cannot send ephemeral patches', () => {
      const { socket: sWriter } = connectClient(room, 'alice', 'readwrite')
      const { socket: sReader, sessionId: readerSid } = connectClient(room, 'bob', 'readonly')
      clearMessages(sWriter)
      clearMessages(sReader)

      room.handleSocketMessage(
        readerSid,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          ephemeralPatches: [{ 'bob/Cursor': { x: 50 } }],
        }),
      )

      // Reader gets an ack
      expect(getMessages<AckResponse>(sReader, 'ack')).toHaveLength(1)

      // Writer should NOT receive the ephemeral broadcast
      expect(getMessages<PatchBroadcast>(sWriter, 'patch')).toHaveLength(0)
    })

    it('readonly client receives document patches from writers', () => {
      const { sessionId: writerSid } = connectClient(room, 'alice', 'readwrite')
      const { socket: sReader } = connectClient(room, 'bob', 'readonly')
      clearMessages(sReader)

      room.handleSocketMessage(
        writerSid,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )

      const broadcasts = getMessages<PatchBroadcast>(sReader, 'patch')
      expect(broadcasts).toHaveLength(1)
      expect(broadcasts[0].documentPatches).toEqual([{ 'e1/Pos': { _exists: true, x: 10 } }])
    })

    it('readonly reconnect strips offline patches', () => {
      const { sessionId: writerSid } = connectClient(room, 'alice', 'readwrite')

      // Alice writes some data
      room.handleSocketMessage(
        writerSid,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )

      // Bob connects readonly and reconnects with offline patches
      const { socket: sReader, sessionId: readerSid } = connectClient(room, 'bob', 'readonly')
      clearMessages(sReader)

      room.handleSocketMessage(
        readerSid,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 1,
          documentPatches: [{ 'e1/Pos': { x: 999 } }],
          ephemeralPatches: [{ 'bob/Cursor': { x: 50 } }],
        }),
      )

      // Server state should NOT include Bob's patches
      const snapshot = room.getSnapshot()
      expect(snapshot.state['e1/Pos']).toEqual({ _exists: true, x: 10 })

      // Bob should still receive the document diff
      const patches = getMessages<PatchBroadcast>(sReader, 'patch')
      expect(patches.length).toBeGreaterThanOrEqual(1)
      const docPatch = patches.find((p) => p.documentPatches?.length)
      expect(docPatch).toBeDefined()
    })

    it('setSessionPermissions changes enforcement mid-session', () => {
      const { socket: sWriter } = connectClient(room, 'alice', 'readwrite')
      const { socket: sBob, sessionId: bobSid } = connectClient(room, 'bob', 'readwrite')
      clearMessages(sWriter)
      clearMessages(sBob)

      // Bob can write initially
      room.handleSocketMessage(
        bobSid,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )
      expect(getMessages<PatchBroadcast>(sWriter, 'patch')).toHaveLength(1)
      clearMessages(sWriter)
      clearMessages(sBob)

      // Downgrade Bob to readonly
      room.setSessionPermissions(bobSid, 'readonly')
      expect(room.getSessionPermissions(bobSid)).toBe('readonly')

      room.handleSocketMessage(
        bobSid,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-2',
          documentPatches: [{ 'e1/Pos': { x: 999 } }],
        }),
      )

      // Patch should be silently dropped
      expect(getMessages<PatchBroadcast>(sWriter, 'patch')).toHaveLength(0)
      expect(room.getSnapshot().state['e1/Pos']).toEqual({ _exists: true, x: 10 })
    })

    it('getSessions includes permissions', () => {
      connectClient(room, 'alice', 'readwrite')
      connectClient(room, 'bob', 'readonly')

      const sessions = room.getSessions()
      const alice = sessions.find((s) => s.clientId === 'alice')
      const bob = sessions.find((s) => s.clientId === 'bob')
      expect(alice?.permissions).toBe('readwrite')
      expect(bob?.permissions).toBe('readonly')
    })
  })

  describe('version mismatch', () => {
    it('sends version-mismatch when protocolVersion differs', () => {
      const { socket, sessionId } = connectClient(room, 'alice')
      clearMessages(socket)

      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 999,
        }),
      )

      const mismatches = getMessages<VersionMismatchResponse>(socket, 'version-mismatch')
      expect(mismatches).toHaveLength(1)
      expect(mismatches[0].serverProtocolVersion).toBe(1)
    })

    it('does not send version-mismatch when protocolVersion matches', () => {
      const { socket, sessionId } = connectClient(room, 'alice')
      clearMessages(socket)

      room.handleSocketMessage(
        sessionId,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 1,
        }),
      )

      const mismatches = getMessages<VersionMismatchResponse>(socket, 'version-mismatch')
      expect(mismatches).toHaveLength(0)
    })

    it('does not process reconnect after version-mismatch', () => {
      const { sessionId: sid1 } = connectClient(room, 'alice')

      room.handleSocketMessage(
        sid1,
        JSON.stringify({
          type: 'patch',
          messageId: 'msg-1',
          documentPatches: [{ 'e1/Pos': { _exists: true, x: 10 } }],
        }),
      )

      const { socket: s2, sessionId: sid2 } = connectClient(room, 'bob')
      clearMessages(s2)

      room.handleSocketMessage(
        sid2,
        JSON.stringify({
          type: 'reconnect',
          lastTimestamp: 0,
          protocolVersion: 999,
        }),
      )

      // Should get version-mismatch but NOT the document diff
      const mismatches = getMessages<VersionMismatchResponse>(s2, 'version-mismatch')
      expect(mismatches).toHaveLength(1)

      const patches = getMessages<PatchBroadcast>(s2, 'patch')
      expect(patches).toHaveLength(0)
    })
  })
})
