import { Room } from './Room'
import type { Storage } from './storage/Storage'

export interface RoomManagerOptions {
  /** Factory for creating a storage backend per room. */
  createStorage: (roomId: string) => Storage
  /** Auto-close empty rooms after this many ms. Default: 30000 (30s). */
  idleTimeout?: number
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private createStorage: (roomId: string) => Storage
  private idleTimeout: number

  constructor(options: RoomManagerOptions) {
    this.createStorage = options.createStorage
    this.idleTimeout = options.idleTimeout ?? 30_000
  }

  /** Get an existing room or create a new one, loading state from storage. */
  async getRoom(roomId: string): Promise<Room> {
    const existing = this.rooms.get(roomId)
    if (existing) {
      // Cancel any pending idle cleanup
      this.clearIdleTimer(roomId)
      return existing
    }

    const storage = this.createStorage(roomId)
    const room = new Room({
      storage,
      onSessionRemoved: (_room, { remaining }) => {
        if (remaining === 0) {
          this.scheduleIdleClose(roomId)
        }
      },
    })

    await room.load()
    this.rooms.set(roomId, room)
    return room
  }

  /** Get a room only if it already exists. Does not create. */
  getExistingRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  /** List all active room IDs. */
  getRoomIds(): string[] {
    return Array.from(this.rooms.keys())
  }

  /** Close and remove a specific room. */
  closeRoom(roomId: string): void {
    this.clearIdleTimer(roomId)
    const room = this.rooms.get(roomId)
    if (room) {
      room.close()
      this.rooms.delete(roomId)
    }
  }

  /** Shut down all rooms. */
  closeAll(): void {
    for (const roomId of this.rooms.keys()) {
      this.closeRoom(roomId)
    }
  }

  private scheduleIdleClose(roomId: string): void {
    this.clearIdleTimer(roomId)
    const timer = setTimeout(() => {
      this.idleTimers.delete(roomId)
      const room = this.rooms.get(roomId)
      if (room && room.getSessionCount() === 0) {
        room.close()
        this.rooms.delete(roomId)
      }
    }, this.idleTimeout)
    this.idleTimers.set(roomId, timer)
  }

  private clearIdleTimer(roomId: string): void {
    const timer = this.idleTimers.get(roomId)
    if (timer) {
      clearTimeout(timer)
      this.idleTimers.delete(roomId)
    }
  }
}
