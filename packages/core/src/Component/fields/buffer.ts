import type { EntityId } from '../../types'
import type { BufferFieldDef, ComponentBuffer, NumberFieldDef } from '../types'
import { Field } from './field'
import { getBytesPerElement } from './number'

/**
 * Create a typed array with a specific byte offset
 */
function createTypedArrayAtOffset(
  btype: string,
  size: number,
  buffer: ArrayBufferLike,
  byteOffset: number,
): Float32Array | Float64Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array {
  switch (btype) {
    case 'float32':
      return new Float32Array(buffer, byteOffset, size)
    case 'float64':
      return new Float64Array(buffer, byteOffset, size)
    case 'int8':
      return new Int8Array(buffer, byteOffset, size)
    case 'int16':
      return new Int16Array(buffer, byteOffset, size)
    case 'int32':
      return new Int32Array(buffer, byteOffset, size)
    case 'uint8':
      return new Uint8Array(buffer, byteOffset, size)
    case 'uint16':
      return new Uint16Array(buffer, byteOffset, size)
    case 'uint32':
      return new Uint32Array(buffer, byteOffset, size)
    default:
      throw new Error(`Unknown btype: ${btype}`)
  }
}

/**
 * BufferBufferView provides access to fixed-size numeric arrays stored in a flat buffer.
 *
 * Like tuples, buffers have a fixed size and no length prefix is stored.
 * Returns typed array subarray views for zero-allocation reads.
 *
 * Memory layout: [element0][element1]...[elementN-1] (no length prefix)
 */
export class BufferBufferView {
  private buffer: ArrayBufferLike
  private bytesPerEntry: number
  private bytesPerElement: number
  private capacity: number
  private bufferSize: number

  // Pre-allocated typed array covering entire buffer
  private numberTypedArray:
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Uint8Array
    | Uint16Array
    | Uint32Array

  // Elements per entry in the typed array (for stride calculation)
  private elementsPerEntry: number

  constructor(
    buffer: ArrayBufferLike,
    capacity: number,
    bytesPerEntry: number,
    elementDef: NumberFieldDef,
    bufferSize: number,
  ) {
    this.buffer = buffer
    this.bytesPerEntry = bytesPerEntry
    this.bytesPerElement = getBytesPerElement(elementDef.btype)
    this.capacity = capacity
    this.bufferSize = bufferSize

    // Calculate elements per entry (bytesPerEntry / bytesPerElement)
    this.elementsPerEntry = bytesPerEntry / this.bytesPerElement

    // Create one typed array view over the entire buffer
    this.numberTypedArray = createTypedArrayAtOffset(elementDef.btype, capacity * this.elementsPerEntry, buffer, 0)
  }

  get length(): number {
    return this.capacity
  }

  /**
   * Get buffer data as a subarray view (zero allocation).
   *
   * @param index - The entity index
   * @returns A typed array subarray view
   */
  get(index: number): ArrayLike<number> {
    const start = index * this.elementsPerEntry
    return this.numberTypedArray.subarray(start, start + this.bufferSize)
  }

  /**
   * Set buffer data from an array-like source.
   *
   * @param index - The entity index
   * @param value - The array data to store
   */
  set(index: number, value: ArrayLike<number>): void {
    const start = index * this.elementsPerEntry
    const len = Math.min(value.length, this.bufferSize)

    // Copy elements
    for (let i = 0; i < len; i++) {
      this.numberTypedArray[start + i] = value[i]
    }

    // Zero remaining elements if value is shorter
    for (let i = len; i < this.bufferSize; i++) {
      this.numberTypedArray[start + i] = 0
    }
  }

  getBuffer(): ArrayBufferLike {
    return this.buffer
  }

  getBytesPerEntry(): number {
    return this.bytesPerEntry
  }

  getSize(): number {
    return this.bufferSize
  }
}

export class BufferField extends Field<BufferFieldDef> {
  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const bytesPerElement = getBytesPerElement(this.fieldDef.elementDef.btype)

    // No length prefix needed - just element_size * buffer_size
    const bytesPerEntry = this.fieldDef.size * bytesPerElement

    // Ensure proper alignment for typed arrays (8-byte alignment for float64)
    const alignedBytesPerEntry = Math.ceil(bytesPerEntry / 8) * 8

    const buffer = new BufferConstructor(capacity * alignedBytesPerEntry)
    const view = new BufferBufferView(
      buffer,
      capacity,
      alignedBytesPerEntry,
      this.fieldDef.elementDef,
      this.fieldDef.size,
    )
    return { buffer, view }
  }

  defineReadonly(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const bufferView = (buffer as any)[fieldName] as BufferBufferView
        return bufferView.get(getEntityId())
      },
    })
  }

  defineWritable(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const bufferView = (buffer as any)[fieldName] as BufferBufferView
        return bufferView.get(getEntityId())
      },
      set: (value: ArrayLike<number>) => {
        const bufferView = (buffer as any)[fieldName] as BufferBufferView
        bufferView.set(getEntityId(), value)
      },
    })
  }

  setValue(bufferView: BufferBufferView, entityId: EntityId, value: any): void {
    // Handle object with numeric keys (e.g., {"0": 1, "1": 2} from Loro/CRDT stores)
    if (value && typeof value === 'object' && !Array.isArray(value) && value.length === undefined) {
      const arr: number[] = []
      let i = 0
      while (i in value) {
        arr.push(value[i])
        i++
      }
      value = arr
    }
    bufferView.set(entityId, value ?? [])
  }
}
