import type { EntityId } from '../../types'
import type { BinaryFieldDef, ComponentBuffer } from '../types'
import { Field } from './field'

const DEFAULT_BINARY_BYTES = 256

/**
 * BinaryBufferView provides access to binary data stored in a flat buffer
 * Each entry has a 4-byte length prefix followed by the binary data
 */
export class BinaryBufferView {
  private buffer: Uint8Array
  private bytesPerEntry: number
  private capacity: number
  public static readonly LENGTH_BYTES = 4 // uint32 for length prefix

  constructor(buffer: ArrayBufferLike, capacity: number, bytesPerEntry: number) {
    this.buffer = new Uint8Array(buffer)
    this.bytesPerEntry = bytesPerEntry
    this.capacity = capacity
  }

  get length(): number {
    return this.capacity
  }

  /**
   * Get binary data for an entity
   * Returns a new Uint8Array containing a copy of the stored data
   * @param index - The entity index
   * @returns A Uint8Array containing the binary data
   */
  get(index: number): Uint8Array {
    const offset = index * this.bytesPerEntry
    const b0 = Atomics.load(this.buffer, offset)
    const b1 = Atomics.load(this.buffer, offset + 1)
    const b2 = Atomics.load(this.buffer, offset + 2)
    const b3 = Atomics.load(this.buffer, offset + 3)
    const storedLength = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)

    if (storedLength === 0) {
      return new Uint8Array(0)
    }

    const dataStart = offset + BinaryBufferView.LENGTH_BYTES
    // Read binary bytes atomically and return a copy
    const result = new Uint8Array(storedLength)
    for (let i = 0; i < storedLength; i++) {
      result[i] = Atomics.load(this.buffer, dataStart + i)
    }
    return result
  }

  /**
   * Set binary data for an entity
   * @param index - The entity index
   * @param value - The binary data to store (Uint8Array)
   */
  set(index: number, value: Uint8Array): void {
    const offset = index * this.bytesPerEntry
    const maxDataBytes = this.bytesPerEntry - BinaryBufferView.LENGTH_BYTES
    const bytesToCopy = Math.min(value.length, maxDataBytes)

    // Write length prefix atomically (little-endian uint32)
    Atomics.store(this.buffer, offset, bytesToCopy & 0xff)
    Atomics.store(this.buffer, offset + 1, (bytesToCopy >> 8) & 0xff)
    Atomics.store(this.buffer, offset + 2, (bytesToCopy >> 16) & 0xff)
    Atomics.store(this.buffer, offset + 3, (bytesToCopy >> 24) & 0xff)

    // Clear the data area first
    const dataStart = offset + BinaryBufferView.LENGTH_BYTES
    for (let i = 0; i < maxDataBytes; i++) {
      Atomics.store(this.buffer, dataStart + i, 0)
    }

    // Copy the binary data atomically
    for (let i = 0; i < bytesToCopy; i++) {
      Atomics.store(this.buffer, dataStart + i, value[i])
    }
  }

  getBuffer(): Uint8Array {
    return this.buffer
  }
}

export class BinaryField extends Field<BinaryFieldDef> {
  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const maxDataLength = this.fieldDef.maxLength || DEFAULT_BINARY_BYTES
    // Add length prefix bytes to the user-specified max data length
    const bytesPerEntry = maxDataLength + BinaryBufferView.LENGTH_BYTES
    const buffer = new BufferConstructor(capacity * bytesPerEntry)
    const view = new BinaryBufferView(buffer, capacity, bytesPerEntry)
    return { buffer, view }
  }

  defineReadonly(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = (buffer as any)[fieldName]
        return array.get(getEntityId())
      },
    })
  }

  defineWritable(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = (buffer as any)[fieldName]
        return array.get(getEntityId())
      },
      set: (value: any) => {
        const array = (buffer as any)[fieldName]
        array.set(getEntityId(), value)
      },
    })
  }

  setValue(array: any, entityId: EntityId, value: any) {
    array.set(entityId, value)
  }
}
