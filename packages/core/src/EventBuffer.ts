import type { EntityId } from './types'

const BufferConstructor: new (byteLength: number) => ArrayBufferLike =
  typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer

/**
 * Bitmask flags for entity lifecycle and component change events.
 * Used to filter events when reading from the event buffer.
 * ```
 */
export const EventType = {
  /** Entity created */
  ADDED: 1,
  /** Entity removed from world */
  REMOVED: 1 << 1, // 2
  /** Component data modified */
  CHANGED: 1 << 2, // 4
  /** Component added to existing entity */
  COMPONENT_ADDED: 1 << 3, // 8
  /** Component removed from existing entity */
  COMPONENT_REMOVED: 1 << 4, // 16
} as const

export type EventTypeValue = (typeof EventType)[keyof typeof EventType]

/**
 * Common event type combinations for query operations.
 * @internal
 */
export const EventTypeMask = {
  QUERY_ADDED: EventType.ADDED | EventType.COMPONENT_ADDED | EventType.COMPONENT_REMOVED,
  QUERY_REMOVED: EventType.REMOVED | EventType.COMPONENT_ADDED | EventType.COMPONENT_REMOVED,
  ALL:
    EventType.ADDED | EventType.REMOVED | EventType.CHANGED | EventType.COMPONENT_ADDED | EventType.COMPONENT_REMOVED,
} as const

export type EventTypeMaskValue = (typeof EventTypeMask)[keyof typeof EventTypeMask]

/**
 * EventBuffer layout (8 bytes per event):
 *   [0-3]  entityId (u32)
 *   [4]    eventType (u8)
 *   [5]    padding (u8)
 *   [6-7]  componentId (u16) - populated for CHANGED/COMPONENT_ADDED/COMPONENT_REMOVED
 */
const BYTES_PER_EVENT = 8

/**
 * Header layout (4 bytes):
 *   [0-3]  writeIndex (u32, atomic) - ring buffer write position
 */
const HEADER_SIZE = 4
const WRITE_INDEX_OFFSET = 0

/**
 * Lock-free ring buffer for tracking entity and component events across threads.
 * Uses atomic operations on SharedArrayBuffer for thread-safe event publishing.
 */
export class EventBuffer {
  private buffer: ArrayBufferLike
  private headerView: Uint32Array
  private dataView: Uint32Array // Each event is 2 Uint32s (8 bytes)
  private readonly maxEvents: number
  private readonly reusableSet: Set<number> = new Set()

  /**
   * Create a new EventBuffer
   * @param maxEvents - Ring buffer capacity (wraps when full)
   */
  constructor(maxEvents: number) {
    this.maxEvents = maxEvents
    const totalBytes = HEADER_SIZE + maxEvents * BYTES_PER_EVENT
    this.buffer = new BufferConstructor(totalBytes)
    this.headerView = new Uint32Array(this.buffer, 0, 1)
    // Each event is 2 Uint32s, starting after the header
    this.dataView = new Uint32Array(this.buffer, HEADER_SIZE)

    // Initialize header atomically
    Atomics.store(this.headerView, WRITE_INDEX_OFFSET, 0)
  }

  /**
   * Reconstruct EventBuffer from a SharedArrayBuffer (for worker threads)
   * @param buffer - The SharedArrayBuffer from the main thread
   * @param maxEvents - Ring buffer capacity (must match original)
   * @returns EventBuffer wrapping the shared buffer
   */
  static fromTransfer(buffer: ArrayBufferLike, maxEvents: number): EventBuffer {
    const instance = Object.create(EventBuffer.prototype)
    instance.buffer = buffer
    instance.headerView = new Uint32Array(buffer, 0, 1)
    instance.dataView = new Uint32Array(buffer, HEADER_SIZE)
    instance.maxEvents = maxEvents
    instance.reusableSet = new Set<number>()
    return instance
  }

  /**
   * Get the underlying buffer for transfer to workers
   */
  getBuffer(): ArrayBufferLike {
    return this.buffer
  }

  /**
   * Get the data view for direct event access
   * @internal
   */
  getDataView(): Uint32Array {
    return this.dataView
  }

  /**
   * Write an event to the ring buffer
   * @param entityId - Entity ID
   * @param eventType - Event type (ADDED, REMOVED, CHANGED, etc.)
   * @param componentId - Component ID (for CHANGED/COMPONENT_ADDED/COMPONENT_REMOVED, 0 otherwise)
   */
  push(entityId: EntityId, eventType: EventTypeValue, componentId: number = 0): void {
    // Atomically get and increment write index
    const index = Atomics.add(this.headerView, WRITE_INDEX_OFFSET, 1) % this.maxEvents

    // Pack eventType and componentId into second u32
    const dataIndex = index * 2
    const packedData = eventType | (componentId << 16)

    Atomics.store(this.dataView, dataIndex, entityId)
    Atomics.store(this.dataView, dataIndex + 1, packedData)
  }

  /**
   * Write an ADDED event
   */
  pushAdded(entityId: EntityId): void {
    this.push(entityId, EventType.ADDED, 0)
  }

  /**
   * Write a REMOVED event
   */
  pushRemoved(entityId: EntityId): void {
    this.push(entityId, EventType.REMOVED, 0)
  }

  /**
   * Write a CHANGED event for a specific component
   */
  pushChanged(entityId: EntityId, componentId: number): void {
    this.push(entityId, EventType.CHANGED, componentId)
  }

  /**
   * Write a COMPONENT_ADDED event
   */
  pushComponentAdded(entityId: EntityId, componentId: number): void {
    this.push(entityId, EventType.COMPONENT_ADDED, componentId)
  }

  /**
   * Write a COMPONENT_REMOVED event
   */
  pushComponentRemoved(entityId: EntityId, componentId: number): void {
    this.push(entityId, EventType.COMPONENT_REMOVED, componentId)
  }

  /**
   * Read an event at a specific index
   * @param index - Ring buffer index (0 to maxEvents-1)
   * @returns Event data
   */
  readEvent(index: number): {
    entityId: number
    eventType: EventTypeValue
    componentId: number
  } {
    const dataIndex = index * 2

    const entityId = Atomics.load(this.dataView, dataIndex)
    const packedData = Atomics.load(this.dataView, dataIndex + 1)

    return {
      entityId,
      eventType: (packedData & 0xff) as EventTypeValue,
      componentId: (packedData >> 16) & 0xffff,
    }
  }

  /**
   * Get current write index
   */
  getWriteIndex(): number {
    return Atomics.load(this.headerView, WRITE_INDEX_OFFSET)
  }

  /**
   * Collect entity IDs from events since lastIndex, filtered by event type and component mask.
   * Optimized for queries - avoids generator overhead and reuses a Set instance.
   *
   * @param lastIndex - Previous read position
   * @param eventTypes - Bitmask of event types to include
   * @param componentMask - Optional component bitmask for CHANGED event filtering
   * @param endIndex - Optional end position (defaults to current write index)
   * @returns Object with entities Set and updated read position
   */
  collectEntitiesInRange(
    lastIndex: number,
    eventTypes: number,
    componentMask?: Uint8Array,
    endIndex?: number,
  ): { entities: Set<number>; newIndex: number } {
    const currentWriteIndex = endIndex ?? this.getWriteIndex()

    // Handle buffer overflow - if we're too far behind, skip to oldest available event
    if (currentWriteIndex - lastIndex > this.maxEvents) {
      lastIndex = currentWriteIndex - this.maxEvents
      console.warn(
        'EventBuffer: Missed events due to buffer overflow, adjusting read index. Increase the maxEvents size to prevent this from happening.',
      )
    }

    const seen = this.reusableSet
    seen.clear()

    const fromIndex = lastIndex % this.maxEvents
    const toIndex = currentWriteIndex % this.maxEvents

    // No new events
    if (fromIndex === toIndex) {
      return { entities: seen, newIndex: currentWriteIndex }
    }

    // Calculate event count, handling ring buffer wrap
    let eventsToScan: number
    if (toIndex >= fromIndex) {
      eventsToScan = toIndex - fromIndex
    } else {
      eventsToScan = this.maxEvents - fromIndex + toIndex
    }

    if (eventsToScan > this.maxEvents) {
      eventsToScan = this.maxEvents
    }

    const dataView = this.dataView
    const maxEvents = this.maxEvents

    for (let i = 0; i < eventsToScan; i++) {
      const index = (fromIndex + i) % maxEvents
      const dataIndex = index * 2

      const packedData = Atomics.load(dataView, dataIndex + 1)
      const eventType = (packedData & 0xff) as EventTypeValue

      if ((eventType & eventTypes) === 0) continue

      // Filter CHANGED events by component mask if provided
      if (componentMask !== undefined && eventType === EventType.CHANGED) {
        const componentId = (packedData >> 16) & 0xffff
        const byteIndex = componentId >> 3
        const bitIndex = componentId & 7
        if (byteIndex >= componentMask.length || (componentMask[byteIndex] & (1 << bitIndex)) === 0) {
          continue
        }
      }

      const entityId = Atomics.load(dataView, dataIndex)
      seen.add(entityId)
    }

    return {
      entities: seen,
      newIndex: currentWriteIndex,
    }
  }

  /**
   * Read all events since lastIndex
   * @param lastIndex - Previous read position
   * @returns Object with events array and updated read position
   */
  readEvents(lastIndex: number): {
    events: Array<{
      entityId: EntityId
      eventType: EventTypeValue
      componentId: number
    }>
    newIndex: number
  } {
    const currentWriteIndex = this.getWriteIndex()
    const events: Array<{
      entityId: EntityId
      eventType: EventTypeValue
      componentId: number
    }> = []

    // Handle buffer overflow
    if (currentWriteIndex - lastIndex > this.maxEvents) {
      lastIndex = currentWriteIndex - this.maxEvents
    }

    const fromIndex = lastIndex % this.maxEvents
    const toIndex = currentWriteIndex % this.maxEvents

    if (fromIndex === toIndex) {
      return { events, newIndex: currentWriteIndex }
    }

    let eventsToScan: number
    if (toIndex >= fromIndex) {
      eventsToScan = toIndex - fromIndex
    } else {
      eventsToScan = this.maxEvents - fromIndex + toIndex
    }

    if (eventsToScan > this.maxEvents) {
      eventsToScan = this.maxEvents
    }

    const dataView = this.dataView
    const maxEvents = this.maxEvents

    for (let i = 0; i < eventsToScan; i++) {
      const index = (fromIndex + i) % maxEvents
      const dataIndex = index * 2

      const packedData = Atomics.load(dataView, dataIndex + 1)
      const eventType = (packedData & 0xff) as EventTypeValue
      const componentId = (packedData >> 16) & 0xffff
      const entityId = Atomics.load(dataView, dataIndex)

      events.push({ entityId, eventType, componentId })
    }

    return { events, newIndex: currentWriteIndex }
  }
}
