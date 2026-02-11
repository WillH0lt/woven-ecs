import type { QueryMasks } from './Query'
import type { EntityId } from './types'

const BufferConstructor: new (byteLength: number) => ArrayBufferLike =
  typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer

/**
 * EntityBuffer manages entity lifecycle and component composition using a compact
 * SharedArrayBuffer layout for thread-safe cross-thread access.
 *
 * Entity layout per entity:
 *   [0] = metadata (bit 0: alive flag, bits 1-7: generation counter)
 *   [1...] = component bits (8 components per byte)
 */
export class EntityBuffer {
  private buffer: ArrayBufferLike
  private view: Uint8Array
  private readonly bytesPerEntity: number

  private static readonly ALIVE_FLAG = 0x01
  private static readonly GENERATION_MASK = 0xfe
  private static readonly GENERATION_SHIFT = 1

  /**
   * Create a new EntityBuffer
   * @param maxEntities - Maximum entity count
   * @param componentCount - Number of components (determines storage size)
   */
  constructor(maxEntities: number, componentCount: number) {
    const componentBytes = Math.ceil(componentCount / 8)
    this.bytesPerEntity = 1 + componentBytes

    const totalBytes = maxEntities * this.bytesPerEntity
    this.buffer = new BufferConstructor(totalBytes)
    this.view = new Uint8Array(this.buffer)
  }

  /**
   * Reconstruct EntityBuffer from SharedArrayBuffer (for workers)
   * @param buffer - SharedArrayBuffer from main thread
   * @param componentCount - Number of components (must match original)
   * @returns EntityBuffer wrapping the shared buffer
   */
  static fromTransfer(buffer: ArrayBufferLike, componentCount: number): EntityBuffer {
    const instance = Object.create(EntityBuffer.prototype)
    instance.buffer = buffer
    instance.view = new Uint8Array(buffer)
    const componentBytes = Math.ceil(componentCount / 8)
    instance.bytesPerEntity = 1 + componentBytes
    return instance
  }

  /** Get underlying SharedArrayBuffer for transfer to workers */
  getBuffer(): ArrayBufferLike {
    return this.buffer
  }

  /**
   * Create entity (mark as alive, clear components, increment generation)
   * @param entityId - Entity ID
   */
  create(entityId: EntityId): void {
    const offset = entityId * this.bytesPerEntity
    const view = this.view
    const bytesPerEntity = this.bytesPerEntity

    // Get current generation and increment it (wraps at 128)
    const oldMetadata = Atomics.load(view, offset)
    const oldGeneration = (oldMetadata & EntityBuffer.GENERATION_MASK) >> EntityBuffer.GENERATION_SHIFT
    const newGeneration = (oldGeneration + 1) & 0x7f // 7 bits = 0-127

    // Clear all bytes for this entity
    for (let i = 0; i < bytesPerEntity; i++) {
      Atomics.store(view, offset + i, 0)
    }
    // Set alive flag and new generation in metadata byte
    Atomics.store(view, offset, EntityBuffer.ALIVE_FLAG | (newGeneration << EntityBuffer.GENERATION_SHIFT))
  }

  /**
   * Add a component to an entity
   */
  addComponentToEntity(entityId: EntityId, componentId: number): void {
    const byteIndex = 1 + (componentId >> 3)
    const bitIndex = componentId & 7
    const offset = entityId * this.bytesPerEntity
    Atomics.or(this.view, offset + byteIndex, 1 << bitIndex)
  }

  /**
   * Remove a component from an entity
   */
  removeComponentFromEntity(entityId: EntityId, componentId: number): void {
    const byteIndex = 1 + (componentId >> 3)
    const bitIndex = componentId & 7
    const offset = entityId * this.bytesPerEntity
    Atomics.and(this.view, offset + byteIndex, ~(1 << bitIndex))
  }

  /**
   * Check if an entity has a component
   */
  hasComponent(entityId: EntityId, componentId: number): boolean {
    const byteIndex = 1 + (componentId >> 3)
    const bitIndex = componentId & 7
    const offset = entityId * this.bytesPerEntity
    return (Atomics.load(this.view, offset + byteIndex) & (1 << bitIndex)) !== 0
  }

  /**
   * Check if an entity matches query criteria (used by queries)
   * @param entityId - Entity ID
   * @param masks - Query masks with component criteria
   * @returns True if entity matches
   */
  matches(entityId: EntityId, masks: QueryMasks): boolean {
    const bytesPerEntity = this.bytesPerEntity
    const offset = entityId * bytesPerEntity
    const view = this.view

    if ((Atomics.load(view, offset) & EntityBuffer.ALIVE_FLAG) === 0) {
      return false
    }

    const componentOffset = offset + 1

    // Entity must have ALL 'with' components
    if (masks.hasWith) {
      const withMask = masks.with
      const maskLength = withMask.length
      for (let i = 0; i < maskLength; i++) {
        const mask = withMask[i]
        if (mask !== 0) {
          const value = Atomics.load(view, componentOffset + i)
          if ((value & mask) !== mask) {
            return false
          }
        }
      }
    }

    // Entity must have NONE of the 'without' components
    if (masks.hasWithout) {
      const withoutMask = masks.without
      const maskLength = withoutMask.length
      for (let i = 0; i < maskLength; i++) {
        const mask = withoutMask[i]
        if (mask !== 0) {
          const value = Atomics.load(view, componentOffset + i)
          if ((value & mask) !== 0) {
            return false
          }
        }
      }
    }

    // Entity must have AT LEAST ONE 'any' component
    if (masks.hasAny) {
      const anyMask = masks.any
      const maskLength = anyMask.length
      let foundAny = false
      for (let i = 0; i < maskLength; i++) {
        const mask = anyMask[i]
        if (mask !== 0) {
          const value = Atomics.load(view, componentOffset + i)
          if ((value & mask) !== 0) {
            foundAny = true
            break
          }
        }
      }
      if (!foundAny) {
        return false
      }
    }

    return true
  }

  /**
   * Clear all entity data including component bits
   */
  delete(entityId: EntityId): void {
    const offset = entityId * this.bytesPerEntity
    const view = this.view
    const bytesPerEntity = this.bytesPerEntity
    for (let i = 0; i < bytesPerEntity; i++) {
      Atomics.store(view, offset + i, 0)
    }
  }

  /**
   * Mark entity as dead but preserve component data.
   * Allows .removed() queries to still read component values.
   */
  markDead(entityId: EntityId): void {
    const offset = entityId * this.bytesPerEntity
    Atomics.and(this.view, offset, ~EntityBuffer.ALIVE_FLAG)
  }

  /**
   * Check if an entity exists and is alive
   */
  has(entityId: EntityId): boolean {
    const offset = entityId * this.bytesPerEntity
    return (Atomics.load(this.view, offset) & EntityBuffer.ALIVE_FLAG) !== 0
  }

  /**
   * Get entity generation counter (used by refs to detect stale references)
   * @returns Generation counter (0-127)
   */
  getGeneration(entityId: EntityId): number {
    const offset = entityId * this.bytesPerEntity
    return (Atomics.load(this.view, offset) & EntityBuffer.GENERATION_MASK) >> EntityBuffer.GENERATION_SHIFT
  }

  /**
   * Iterate over all component IDs that an entity has.
   * More efficient than checking each component individually when
   * you need to find any component on an entity.
   */
  *getComponentIds(entityId: EntityId): Generator<number> {
    const offset = entityId * this.bytesPerEntity
    const view = this.view
    const componentBytes = this.bytesPerEntity - 1

    for (let byteIndex = 0; byteIndex < componentBytes; byteIndex++) {
      const byte = Atomics.load(view, offset + 1 + byteIndex)
      if (byte === 0) continue

      // Check each bit in the byte
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << bit)) {
          yield byteIndex * 8 + bit
        }
      }
    }
  }
}
