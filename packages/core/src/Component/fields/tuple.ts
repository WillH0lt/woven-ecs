import type { EntityId } from '../../types'
import type {
  BinaryFieldDef,
  BooleanFieldDef,
  ComponentBuffer,
  NumberFieldDef,
  StringFieldDef,
  TupleFieldDef,
} from '../types'
import { Field } from './field'
import { getBytesPerElement } from './number'

const DEFAULT_STRING_BYTES = 512
const DEFAULT_BINARY_BYTES = 256

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Tuples are fixed-length: these methods would change the length
const lengthChangingMethods = new Set(['push', 'pop', 'shift', 'unshift', 'splice'])

// Length-preserving mutating methods that operate on a copy and persist
const mutatingMethods = new Set(['reverse', 'sort', 'fill', 'copyWithin'])

/**
 * Calculate bytes per element based on element definition
 * Ensures proper alignment for typed array access
 */
function getElementBytesPerEntry(
  elementDef: StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef,
): number {
  switch (elementDef.type) {
    case 'number':
      return getBytesPerElement(elementDef.btype)
    case 'boolean':
      return 1
    case 'string': {
      const maxLength = elementDef.maxLength || DEFAULT_STRING_BYTES
      // 4 bytes for length prefix + data, aligned to 4 bytes
      return Math.ceil((maxLength + 4) / 4) * 4
    }
    case 'binary': {
      const maxLength = elementDef.maxLength || DEFAULT_BINARY_BYTES
      // 4 bytes for length prefix + data, aligned to 4 bytes
      return Math.ceil((maxLength + 4) / 4) * 4
    }
  }
}

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
 * TupleBufferView provides access to tuple data stored in a flat buffer
 * Unlike ArrayBufferView, tuples have a fixed length and no length prefix is stored
 * Supports all element types: number, boolean, string, and binary
 */
export class TupleBufferView {
  private buffer: ArrayBufferLike
  private uint8View: Uint8Array
  private bytesPerEntry: number
  private bytesPerElement: number
  private capacity: number
  private elementDef: StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef
  private tupleLength: number

  // Pre-allocated typed array for number tuples (covers entire buffer)
  private numberTypedArray:
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Uint8Array
    | Uint16Array
    | Uint32Array
    | null = null
  // Elements per entry in the typed array (for stride calculation)
  private elementsPerEntry: number = 0

  constructor(
    buffer: ArrayBufferLike,
    capacity: number,
    bytesPerEntry: number,
    elementDef: StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef,
    tupleLength: number,
  ) {
    this.buffer = buffer
    this.uint8View = new Uint8Array(buffer)
    this.bytesPerEntry = bytesPerEntry
    this.bytesPerElement = getElementBytesPerEntry(elementDef)
    this.capacity = capacity
    this.elementDef = elementDef
    this.tupleLength = tupleLength

    // Pre-allocate typed array for number tuples
    if (elementDef.type === 'number') {
      const bytesPerNum = getBytesPerElement(elementDef.btype)
      this.elementsPerEntry = bytesPerEntry / bytesPerNum
      // Create one typed array view over the entire buffer
      this.numberTypedArray = createTypedArrayAtOffset(elementDef.btype, capacity * this.elementsPerEntry, buffer, 0)
    }
  }

  get length(): number {
    return this.capacity
  }

  /**
   * Read a uint32 value atomically from the buffer
   */
  private readUint32(byteOffset: number): number {
    const b0 = Atomics.load(this.uint8View, byteOffset)
    const b1 = Atomics.load(this.uint8View, byteOffset + 1)
    const b2 = Atomics.load(this.uint8View, byteOffset + 2)
    const b3 = Atomics.load(this.uint8View, byteOffset + 3)
    return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
  }

  /**
   * Write a uint32 value atomically to the buffer
   */
  private writeUint32(byteOffset: number, value: number): void {
    Atomics.store(this.uint8View, byteOffset, value & 0xff)
    Atomics.store(this.uint8View, byteOffset + 1, (value >> 8) & 0xff)
    Atomics.store(this.uint8View, byteOffset + 2, (value >> 16) & 0xff)
    Atomics.store(this.uint8View, byteOffset + 3, (value >> 24) & 0xff)
  }

  /**
   * Get tuple data for an entity
   * @param index - The entity index
   * @returns A typed array subarray for number tuples, or a plain array for other types
   */
  get(index: number): any {
    // Fast path: number tuples return a subarray view (no allocation)
    if (this.numberTypedArray !== null) {
      const start = index * this.elementsPerEntry
      return this.numberTypedArray.subarray(start, start + this.tupleLength)
    }

    // Slow path: other types build an array
    const offset = index * this.bytesPerEntry
    const result: any[] = []

    switch (this.elementDef.type) {
      case 'boolean': {
        for (let i = 0; i < this.tupleLength; i++) {
          result.push(Atomics.load(this.uint8View, offset + i) !== 0)
        }
        break
      }
      case 'string': {
        for (let i = 0; i < this.tupleLength; i++) {
          const strOffset = offset + i * this.bytesPerElement
          const strLen = this.readUint32(strOffset)
          if (strLen === 0) {
            result.push('')
          } else {
            const stringBytes = new Uint8Array(strLen)
            for (let j = 0; j < strLen; j++) {
              stringBytes[j] = Atomics.load(this.uint8View, strOffset + 4 + j)
            }
            result.push(textDecoder.decode(stringBytes))
          }
        }
        break
      }
      case 'binary': {
        for (let i = 0; i < this.tupleLength; i++) {
          const binOffset = offset + i * this.bytesPerElement
          const binLen = this.readUint32(binOffset)
          if (binLen === 0) {
            result.push(new Uint8Array(0))
          } else {
            const binData = new Uint8Array(binLen)
            for (let j = 0; j < binLen; j++) {
              binData[j] = Atomics.load(this.uint8View, binOffset + 4 + j)
            }
            result.push(binData)
          }
        }
        break
      }
    }

    return result
  }

  /**
   * Set tuple data for an entity
   * @param index - The entity index
   * @param value - The tuple data to store (must match tuple length)
   */
  set(index: number, value: ArrayLike<any>): void {
    // Fast path: number tuples use direct typed array access
    if (this.numberTypedArray !== null) {
      const start = index * this.elementsPerEntry
      const len = Math.min(value.length, this.tupleLength)
      // Direct element copy - no allocations
      for (let i = 0; i < len; i++) {
        this.numberTypedArray[start + i] = value[i]
      }
      // Zero remaining elements if value is shorter
      for (let i = len; i < this.tupleLength; i++) {
        this.numberTypedArray[start + i] = 0
      }
      return
    }

    // Slow path: other types
    const offset = index * this.bytesPerEntry
    const elementsToCopy = Math.min(value.length, this.tupleLength)

    // Clear the data area first
    const totalDataBytes = this.tupleLength * this.bytesPerElement
    for (let i = 0; i < totalDataBytes; i++) {
      Atomics.store(this.uint8View, offset + i, 0)
    }

    if (elementsToCopy === 0) return

    switch (this.elementDef.type) {
      case 'boolean': {
        for (let i = 0; i < elementsToCopy; i++) {
          Atomics.store(this.uint8View, offset + i, value[i] ? 1 : 0)
        }
        break
      }
      case 'string': {
        const maxDataBytes = this.bytesPerElement - 4
        for (let i = 0; i < elementsToCopy; i++) {
          const strOffset = offset + i * this.bytesPerElement
          const str = value[i] as string
          const encoded = textEncoder.encode(str)
          const bytesToCopy = Math.min(encoded.length, maxDataBytes)

          // Write string length atomically
          this.writeUint32(strOffset, bytesToCopy)

          // Write string data atomically
          for (let j = 0; j < bytesToCopy; j++) {
            Atomics.store(this.uint8View, strOffset + 4 + j, encoded[j])
          }
        }
        break
      }
      case 'binary': {
        const maxDataBytes = this.bytesPerElement - 4
        for (let i = 0; i < elementsToCopy; i++) {
          const binOffset = offset + i * this.bytesPerElement
          const bin = value[i] as Uint8Array
          const bytesToCopy = Math.min(bin.length, maxDataBytes)

          // Write binary length atomically
          this.writeUint32(binOffset, bytesToCopy)

          // Write binary data atomically
          for (let j = 0; j < bytesToCopy; j++) {
            Atomics.store(this.uint8View, binOffset + 4 + j, bin[j])
          }
        }
        break
      }
    }
  }

  /**
   * Get a single element from the tuple
   * @param index - The entity index
   * @param elementIndex - The index of the element within the tuple
   * @returns The element value, or undefined if out of bounds
   */
  getElement(index: number, elementIndex: number): any {
    if (elementIndex < 0 || elementIndex >= this.tupleLength) {
      return undefined
    }

    if (this.numberTypedArray !== null) {
      return this.numberTypedArray[index * this.elementsPerEntry + elementIndex]
    }

    const offset = index * this.bytesPerEntry

    switch (this.elementDef.type) {
      case 'boolean': {
        return Atomics.load(this.uint8View, offset + elementIndex) !== 0
      }
      case 'string': {
        const strOffset = offset + elementIndex * this.bytesPerElement
        const strLen = this.readUint32(strOffset)
        if (strLen === 0) {
          return ''
        }
        const stringBytes = new Uint8Array(strLen)
        for (let j = 0; j < strLen; j++) {
          stringBytes[j] = Atomics.load(this.uint8View, strOffset + 4 + j)
        }
        return textDecoder.decode(stringBytes)
      }
      case 'binary': {
        const binOffset = offset + elementIndex * this.bytesPerElement
        const binLen = this.readUint32(binOffset)
        if (binLen === 0) {
          return new Uint8Array(0)
        }
        const binData = new Uint8Array(binLen)
        for (let j = 0; j < binLen; j++) {
          binData[j] = Atomics.load(this.uint8View, binOffset + 4 + j)
        }
        return binData
      }
    }
  }

  /**
   * Set a single element in the tuple
   * @param index - The entity index
   * @param elementIndex - The index of the element within the tuple
   * @param value - The value to set
   */
  setElement(index: number, elementIndex: number, value: any): void {
    if (elementIndex < 0 || elementIndex >= this.tupleLength) {
      return
    }

    if (this.numberTypedArray !== null) {
      this.numberTypedArray[index * this.elementsPerEntry + elementIndex] = value
      return
    }

    const offset = index * this.bytesPerEntry

    switch (this.elementDef.type) {
      case 'boolean': {
        Atomics.store(this.uint8View, offset + elementIndex, value ? 1 : 0)
        break
      }
      case 'string': {
        const strOffset = offset + elementIndex * this.bytesPerElement
        const str = value as string
        const encoded = textEncoder.encode(str)
        const maxDataBytes = this.bytesPerElement - 4
        const bytesToCopy = Math.min(encoded.length, maxDataBytes)

        // Clear existing string data
        for (let j = 0; j < maxDataBytes; j++) {
          Atomics.store(this.uint8View, strOffset + 4 + j, 0)
        }

        // Write string length
        this.writeUint32(strOffset, bytesToCopy)

        // Write string data
        for (let j = 0; j < bytesToCopy; j++) {
          Atomics.store(this.uint8View, strOffset + 4 + j, encoded[j])
        }
        break
      }
      case 'binary': {
        const binOffset = offset + elementIndex * this.bytesPerElement
        const bin = value as Uint8Array
        const maxDataBytes = this.bytesPerElement - 4
        const bytesToCopy = Math.min(bin.length, maxDataBytes)

        // Clear existing binary data
        for (let j = 0; j < maxDataBytes; j++) {
          Atomics.store(this.uint8View, binOffset + 4 + j, 0)
        }

        // Write binary length
        this.writeUint32(binOffset, bytesToCopy)

        // Write binary data
        for (let j = 0; j < bytesToCopy; j++) {
          Atomics.store(this.uint8View, binOffset + 4 + j, bin[j])
        }
        break
      }
    }
  }

  getBuffer(): ArrayBufferLike {
    return this.buffer
  }

  getBytesPerEntry(): number {
    return this.bytesPerEntry
  }
}

export class TupleField extends Field<TupleFieldDef> {
  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const bytesPerElement = getElementBytesPerEntry(this.fieldDef.elementDef)
    // No length prefix needed for tuples - fixed size
    const bytesPerEntry = this.fieldDef.length * bytesPerElement

    // Ensure proper alignment for typed arrays (8-byte alignment for float64)
    const alignedBytesPerEntry = Math.ceil(bytesPerEntry / 8) * 8

    const buffer = new BufferConstructor(capacity * alignedBytesPerEntry)
    const view = new TupleBufferView(
      buffer,
      capacity,
      alignedBytesPerEntry,
      this.fieldDef.elementDef,
      this.fieldDef.length,
    )
    return { buffer, view }
  }

  defineReadonly(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const tuple = (buffer as any)[fieldName]
        return tuple.get(getEntityId())
      },
    })
  }

  defineWritable(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    const isNumberTuple = this.fieldDef.elementDef.type === 'number'
    const tupleLength = this.fieldDef.length

    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const tupleView = (buffer as any)[fieldName] as TupleBufferView
        const entityId = getEntityId()

        // Fast path: number tuples return a typed array subarray that writes
        // through to the buffer directly (no allocation, no proxy)
        if (isNumberTuple) {
          return tupleView.get(entityId)
        }

        // Other element types decode into a detached copy, so element writes
        // must be intercepted and routed back to the buffer
        return new Proxy([] as any[], {
          get(_target, prop) {
            // Handle numeric indices
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              return tupleView.getElement(entityId, index)
            }
            // Handle 'length' property
            if (prop === 'length') {
              return tupleLength
            }
            if (typeof prop === 'string' && lengthChangingMethods.has(prop)) {
              return () => {
                throw new TypeError(`Cannot call ${prop}() on a fixed-length tuple field`)
              }
            }
            // Handle mutating tuple methods by operating on copy and persisting
            if (typeof prop === 'string' && mutatingMethods.has(prop)) {
              return (...args: any[]) => {
                const tuple = tupleView.get(entityId)
                const result = (tuple as any)[prop](...args)
                tupleView.set(entityId, tuple)
                return result
              }
            }
            // Handle non-mutating methods by getting the full tuple first
            const fullTuple = tupleView.get(entityId)
            const value = (fullTuple as any)[prop]
            if (typeof value === 'function') {
              return value.bind(fullTuple)
            }
            return value
          },
          set(_target, prop, value) {
            // Handle numeric indices
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              tupleView.setElement(entityId, index, value)
              return true
            }
            return false
          },
          has(_target, prop) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              return index >= 0 && index < tupleLength
            }
            return prop in []
          },
          ownKeys() {
            const keys: string[] = []
            for (let i = 0; i < tupleLength; i++) {
              keys.push(String(i))
            }
            keys.push('length')
            return keys
          },
          getOwnPropertyDescriptor(_target, prop) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              if (index >= 0 && index < tupleLength) {
                return {
                  value: tupleView.getElement(entityId, index),
                  writable: true,
                  enumerable: true,
                  configurable: true,
                }
              }
            }
            if (prop === 'length') {
              return {
                value: tupleLength,
                writable: false,
                enumerable: false,
                configurable: false,
              }
            }
            return undefined
          },
        })
      },
      set: (value: any) => {
        const tuple = (buffer as any)[fieldName]
        tuple.set(getEntityId(), value)
      },
    })
  }

  setValue(tuple: any, entityId: EntityId, value: any) {
    // Handle object with numeric keys (e.g., {"0": 60, "1": 60} from Loro/CRDT stores)
    // by converting to an array
    if (value && typeof value === 'object' && !Array.isArray(value) && value.length === undefined) {
      const arr = new Array(this.fieldDef.length)
      for (let i = 0; i < this.fieldDef.length; i++) {
        arr[i] = value[i]
      }
      value = arr
    }
    tuple.set(entityId, value)
  }
}
