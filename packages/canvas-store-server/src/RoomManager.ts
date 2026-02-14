import { Room, type RoomOptions } from './Room'

export interface RoomManagerOptions {
  /** Auto-close empty rooms after this many ms. Default: 30000 (30s). */
  idleTimeout?: number
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private idleTimeout: number

  constructor(options: RoomManagerOptions = {}) {
    this.idleTimeout = options.idleTimeout ?? 30_000
  }

  /** Get an existing room or create a new one, loading state from storage. */
  async getOrCreateRoom(roomId: string, options: RoomOptions = {}): Promise<Room> {
    const existing = this.rooms.get(roomId)
    if (existing) {
      // Cancel any pending idle cleanup
      this.clearIdleTimer(roomId)
      return existing
    }

    const userOnSessionRemoved = options.onSessionRemoved
    const room = new Room({
      ...options,
      onSessionRemoved: (room, info) => {
        userOnSessionRemoved?.(room, info)
        if (info.remaining === 0) {
          this.scheduleIdleClose(roomId)
        }
      },
    })

    await room.load()
    this.rooms.set(roomId, room)
    return room
  }

  /**
   * @deprecated Use getOrCreateRoom instead
   */
  async getRoom(roomId: string): Promise<Room> {
    return this.getOrCreateRoom(roomId)
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
