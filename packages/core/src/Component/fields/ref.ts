import type { EntityBuffer } from '../../EntityBuffer'
import type { EntityId } from '../../types'
import type { ComponentBuffer, RefFieldDef } from '../types'
import { Field } from './field'

/**
 * Sentinel value representing a null reference.
 * Uses max uint32 value which will never be a valid packed ref.
 */
export const NULL_REF = 0xffffffff

/**
 * Ref packing layout (32-bit):
 * - Bits 0-24: entity ID (supports up to 33 million entities)
 * - Bits 25-31: generation (7 bits = 0-127, matches EntityBuffer)
 */
const ENTITY_ID_MASK = 0x01ffffff // 25 bits
const GENERATION_SHIFT = 25

/**
 * Pack an entity ID and generation into a 32-bit ref value.
 */
function packRef(entityId: EntityId, generation: number): number {
  return (entityId & ENTITY_ID_MASK) | (generation << GENERATION_SHIFT)
}

/**
 * Unpack entity ID from a 32-bit ref value.
 */
function unpackEntityId(ref: number): EntityId {
  return ref & ENTITY_ID_MASK
}

/**
 * Unpack generation from a 32-bit ref value.
 */
function unpackGeneration(ref: number): number {
  return ref >>> GENERATION_SHIFT
}

/**
 * Validate a packed ref and return the entity ID if valid, null otherwise.
 * Checks that the referenced entity is alive and the generation matches.
 *
 * @param packedRef - The packed ref value from the buffer
 * @param entityBuffer - The entity buffer to validate against
 * @param checkExistence - If false, skips the existence check but still validates generation.
 *                         Useful for finding refs to recently deleted entities.
 * @returns The entity ID if valid, null if the ref is null or stale
 */
export function readRef(packedRef: number, entityBuffer: EntityBuffer, checkExistence = true): EntityId | null {
  if (packedRef === NULL_REF) {
    return null
  }

  const refEntityId = unpackEntityId(packedRef)
  const refGeneration = unpackGeneration(packedRef)

  // Check if ref is still valid (generation matches, and alive if checking existence)
  if ((checkExistence && !entityBuffer.has(refEntityId)) || entityBuffer.getGeneration(refEntityId) !== refGeneration) {
    return null
  }

  return refEntityId
}

/**
 * RefField handler for entity reference fields.
 * Uses 4 bytes per entity storing packed (entityId + generation).
 * NULL_REF (0xFFFFFFFF) represents null/no reference.
 * Uses lazy validation: refs to dead/recycled entities are auto-nullified on read.
 */
export class RefField extends Field<RefFieldDef> {
  private readonly entityBuffer: EntityBuffer

  constructor(fieldDef: RefFieldDef, entityBuffer: EntityBuffer) {
    super(fieldDef)
    this.entityBuffer = entityBuffer
  }

  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const buffer = new BufferConstructor(capacity * 4)
    const view = new Uint32Array(buffer)
    // Initialize all refs to null
    view.fill(NULL_REF)
    return { buffer, view }
  }

  defineReadonly(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    const entityBuffer = this.entityBuffer

    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = buffer[fieldName] as Uint32Array
        const entityId = getEntityId()
        const packedRef = Atomics.load(array, entityId)
        const refEntityId = readRef(packedRef, entityBuffer)

        // Auto-nullify stale references
        if (packedRef !== NULL_REF && refEntityId === null) {
          Atomics.store(array, entityId, NULL_REF)
        }

        return refEntityId
      },
    })
  }

  defineWritable(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    const entityBuffer = this.entityBuffer

    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = buffer[fieldName] as Uint32Array
        const entityId = getEntityId()
        const packedRef = Atomics.load(array, entityId)
        const refEntityId = readRef(packedRef, entityBuffer)

        // Auto-nullify stale references
        if (packedRef !== NULL_REF && refEntityId === null) {
          Atomics.store(array, entityId, NULL_REF)
        }

        return refEntityId
      },
      set: (value: EntityId | null) => {
        const array = buffer[fieldName] as Uint32Array
        const entityId = getEntityId()
        if (value === null || value === NULL_REF) {
          Atomics.store(array, entityId, NULL_REF)
        } else {
          // Pack the entity ID with its current generation
          const generation = entityBuffer.getGeneration(value)
          Atomics.store(array, entityId, packRef(value, generation))
        }
      },
    })
  }

  setValue(array: Uint32Array, entityId: EntityId, value: EntityId | null) {
    if (value === null || value === NULL_REF) {
      Atomics.store(array, entityId, NULL_REF)
    } else {
      // Pack the entity ID with its current generation
      const generation = this.entityBuffer.getGeneration(value)
      Atomics.store(array, entityId, packRef(value, generation))
    }
  }
}
