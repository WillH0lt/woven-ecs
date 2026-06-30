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

  /**
   * Disconnect every client, then persist every room to storage. Await this
   * from your process's SIGTERM/SIGINT handler before exiting so in-flight
   * state survives a restart (e.g. a Kubernetes rollout).
   *
   * Rooms are closed *before* the flush, not after: closing clears each room's
   * sessions, so no further patches can be applied or acked once it returns.
   * That makes the snapshot taken by `flush()` final and stable — preserving
   * the invariant that any patch the server acked is in the saved snapshot.
   * Flushing first would leave a window where a client patch lands (and is
   * acked) after the snapshot but before exit, and is then silently lost.
   *
   * Flushes run in parallel; a single room's failure does not abort the others.
   */
  async closeAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer)
    }
    this.idleTimers.clear()

    const rooms = Array.from(this.rooms.values())

    // Close sockets and clear sessions first, so the snapshot below can't race
    // a late patch. `flush: false` defers persistence to the awaited flush.
    for (const room of rooms) {
      room.close({ flush: false })
    }

    await Promise.allSettled(rooms.map((room) => room.flush()))
    this.rooms.clear()
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
