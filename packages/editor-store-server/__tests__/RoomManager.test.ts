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
      createStorage: () => new MemoryStorage(),
      idleTimeout: 50,
    })
  })

  it('creates and returns rooms', async () => {
    const room = await manager.getRoom('room-1')
    expect(room).toBeDefined()
    expect(room.getSessionCount()).toBe(0)
  })

  it('returns the same room for the same id', async () => {
    const room1 = await manager.getRoom('room-1')
    const room2 = await manager.getRoom('room-1')
    expect(room1).toBe(room2)
  })

  it('creates different rooms for different ids', async () => {
    const room1 = await manager.getRoom('room-1')
    const room2 = await manager.getRoom('room-2')
    expect(room1).not.toBe(room2)
  })

  it('lists room ids', async () => {
    await manager.getRoom('room-1')
    await manager.getRoom('room-2')
    expect(manager.getRoomIds().sort()).toEqual(['room-1', 'room-2'])
  })

  it('closes a specific room', async () => {
    const room = await manager.getRoom('room-1')
    const socket = createMockSocket()
    room.handleSocketConnect({ socket, clientId: 'alice', permissions: 'readwrite' })

    manager.closeRoom('room-1')

    expect(socket.close).toHaveBeenCalled()
    expect(manager.getRoomIds()).toEqual([])
  })

  it('closes all rooms', async () => {
    await manager.getRoom('room-1')
    await manager.getRoom('room-2')

    manager.closeAll()

    expect(manager.getRoomIds()).toEqual([])
  })

  it('auto-closes empty rooms after idle timeout', async () => {
    vi.useFakeTimers()

    const room = await manager.getRoom('room-1')
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

    const room = await manager.getRoom('room-1')
    const s1 = createMockSocket()
    const sid1 = room.handleSocketConnect({ socket: s1, clientId: 'alice', permissions: 'readwrite' })

    // Disconnect first client (triggers idle timer)
    room.handleSocketClose(sid1)

    // New client reconnects before timeout
    await vi.advanceTimersByTimeAsync(25)
    // Getting the room again should cancel the idle timer
    const sameRoom = await manager.getRoom('room-1')
    const s2 = createMockSocket()
    sameRoom.handleSocketConnect({ socket: s2, clientId: 'bob', permissions: 'readwrite' })

    // Advance past the original timeout
    await vi.advanceTimersByTimeAsync(100)

    // Room should still exist because we cancelled the timer
    expect(manager.getRoomIds()).toEqual(['room-1'])

    vi.useRealTimers()
  })

  it('getExistingRoom returns undefined for unknown rooms', () => {
    expect(manager.getExistingRoom('nope')).toBeUndefined()
  })

  it('getExistingRoom returns room if it exists', async () => {
    const room = await manager.getRoom('room-1')
    expect(manager.getExistingRoom('room-1')).toBe(room)
  })
})
