import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomManager } from '../src/RoomManager'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import type { ServerMessage } from '../src/types'

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

describe('RoomManager', () => {
  let manager: RoomManager

  beforeEach(() => {
    manager = new RoomManager({
      idleTimeout: 50,
    })
  })

  const getRoom = (roomId: string) => manager.getOrCreateRoom(roomId, { createStorage: () => new MemoryStorage() })

  it('creates and returns rooms', async () => {
    const room = await getRoom('room-1')
    expect(room).toBeDefined()
    expect(room.getSessionCount()).toBe(0)
  })

  it('returns the same room for the same id', async () => {
    const room1 = await getRoom('room-1')
    const room2 = await getRoom('room-1')
    expect(room1).toBe(room2)
  })

  it('creates different rooms for different ids', async () => {
    const room1 = await getRoom('room-1')
    const room2 = await getRoom('room-2')
    expect(room1).not.toBe(room2)
  })

  it('lists room ids', async () => {
    await getRoom('room-1')
    await getRoom('room-2')
    expect(manager.getRoomIds().sort()).toEqual(['room-1', 'room-2'])
  })

  it('closes a specific room', async () => {
    const room = await getRoom('room-1')
    const socket = createMockSocket()
    room.handleSocketConnect({ socket, clientId: 'alice', permissions: 'readwrite' })

    manager.closeRoom('room-1')

    expect(socket.close).toHaveBeenCalled()
    expect(manager.getRoomIds()).toEqual([])
  })

  it('closes all rooms', async () => {
    await getRoom('room-1')
    await getRoom('room-2')

    await manager.closeAll()

    expect(manager.getRoomIds()).toEqual([])
  })

  it('auto-closes empty rooms after idle timeout', async () => {
    vi.useFakeTimers()

    const room = await getRoom('room-1')
    const socket = createMockSocket()
    const sessionId = room.handleSocketConnect({ socket, clientId: 'alice', permissions: 'readwrite' })

    // Disconnect the client
    room.handleSocketClose(sessionId)

    // Room still exists immediately
    expect(manager.getRoomIds()).toEqual(['room-1'])

    // Advance past idle timeout
    await vi.advanceTimersByTimeAsync(100)

    expect(manager.getRoomIds()).toEqual([])

    vi.useRealTimers()
  })

  it('cancels idle timeout when a new client connects', async () => {
    vi.useFakeTimers()

    const room = await getRoom('room-1')
    const s1 = createMockSocket()
    const sid1 = room.handleSocketConnect({ socket: s1, clientId: 'alice', permissions: 'readwrite' })

    // Disconnect first client (triggers idle timer)
    room.handleSocketClose(sid1)

    // New client reconnects before timeout
    await vi.advanceTimersByTimeAsync(25)
    // Getting the room again should cancel the idle timer
    const sameRoom = await getRoom('room-1')
    const s2 = createMockSocket()
    sameRoom.handleSocketConnect({ socket: s2, clientId: 'bob', permissions: 'readwrite' })

    // Advance past the original timeout
    await vi.advanceTimersByTimeAsync(100)

    // Room should still exist because we cancelled the timer
    expect(manager.getRoomIds()).toEqual(['room-1'])

    vi.useRealTimers()
  })

  it('closeAll persists room state on shutdown', async () => {
    const storages = new Map<string, MemoryStorage>()
    const m = new RoomManager({ idleTimeout: 50 })
    const open = async (roomId: string) => {
      const storage = new MemoryStorage()
      storages.set(roomId, storage)
      return m.getOrCreateRoom(roomId, { createStorage: () => storage, saveThrottleMs: 10_000 })
    }

    const r1 = await open('room-1')
    const r2 = await open('room-2')
    const s1 = createMockSocket()
    const s2 = createMockSocket()
    const sid1 = r1.handleSocketConnect({ socket: s1, clientId: 'alice', permissions: 'readwrite' })
    r2.handleSocketConnect({ socket: s2, clientId: 'bob', permissions: 'readwrite' })

    // Apply a patch so there is unsaved state (throttled save hasn't fired yet).
    r1.handleSocketMessage(
      sid1,
      JSON.stringify({
        type: 'patch',
        messageId: '1',
        documentPatches: [{ 'entity-1/Position': { _exists: true, x: 42 } }],
      }),
    )

    await m.closeAll()

    // State was persisted despite the throttle timer not having fired.
    const saved = await storages.get('room-1')!.load()
    expect(saved?.state['entity-1/Position']).toBeDefined()

    // Rooms are gone and sockets closed.
    expect(m.getRoomIds()).toEqual([])
    expect(s1.close).toHaveBeenCalled()
    expect(s2.close).toHaveBeenCalled()
  })

  it('closeAll closes rooms before flushing, so no patch can be acked after the snapshot', async () => {
    // Storage that records the room's live session count at the moment save()
    // runs. Closing before flushing means sessions are already cleared here.
    let sessionCountAtSave = -1
    const m = new RoomManager({ idleTimeout: 50 })
    const room = await m.getOrCreateRoom('room-1', {
      saveThrottleMs: 10_000,
      createStorage: () => ({
        load: async () => null,
        save: async () => {
          sessionCountAtSave = room.getSessionCount()
        },
      }),
    })
    const socket = createMockSocket()
    room.handleSocketConnect({ socket, clientId: 'alice', permissions: 'readwrite' })
    expect(room.getSessionCount()).toBe(1)

    await m.closeAll()

    expect(sessionCountAtSave).toBe(0)
  })

  it('getExistingRoom returns undefined for unknown rooms', () => {
    expect(manager.getExistingRoom('nope')).toBeUndefined()
  })

  it('getExistingRoom returns room if it exists', async () => {
    const room = await getRoom('room-1')
    expect(manager.getExistingRoom('room-1')).toBe(room)
  })
})
