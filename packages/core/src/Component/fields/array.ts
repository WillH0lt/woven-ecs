import type { EntityId } from '../../types'
import type {
  ArrayFieldDef,
  BinaryFieldDef,
  BooleanFieldDef,
  ComponentBuffer,
  NumberFieldDef,
  StringFieldDef,
} from '../types'
import { Field } from './field'
import { getBytesPerElement } from './number'

const DEFAULT_STRING_BYTES = 512
const DEFAULT_BINARY_BYTES = 256

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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
 * ArrayBufferView provides access to array data stored in a flat buffer
 * Each entry has a 4-byte length prefix (element count) followed by the array data
 * Supports all element types: number, boolean, string, and binary
 */
export class ArrayBufferView {
  private buffer: ArrayBufferLike
  private uint8View: Uint8Array
  private bytesPerEntry: number
  private bytesPerElement: number
  private capacity: number
  private elementDef: StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef
  private maxLength: number
  public static readonly LENGTH_BYTES = 4 // uint32 for array length prefix

  constructor(
    buffer: ArrayBufferLike,
    capacity: number,
    bytesPerEntry: number,
    elementDef: StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef,
    maxLength: number,
  ) {
    this.buffer = buffer
    this.uint8View = new Uint8Array(buffer)
    this.bytesPerEntry = bytesPerEntry
    this.bytesPerElement = getElementBytesPerEntry(elementDef)
    this.capacity = capacity
    this.elementDef = elementDef
    this.maxLength = maxLength
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
   * Get array data for an entity
   * @param index - The entity index
   * @returns An array containing the data
   */
  get(index: number): any[] {
    const offset = index * this.bytesPerEntry
    const storedLength = this.readUint32(offset)

    if (storedLength === 0) {
      return []
    }

    const dataOffset = offset + ArrayBufferView.LENGTH_BYTES
    const result: any[] = []

    switch (this.elementDef.type) {
      case 'number': {
        const typedArray = createTypedArrayAtOffset(this.elementDef.btype, storedLength, this.buffer, dataOffset)
        const useAtomics = this.elementDef.btype !== 'float32' && this.elementDef.btype !== 'float64'
        for (let i = 0; i < storedLength; i++) {
          // For integer types, use Atomics; for floats, use direct access
          // (floats don't support Atomics but are atomic on aligned access)
          if (useAtomics) {
            result.push(Atomics.load(typedArray as Exclude<typeof typedArray, Float32Array | Float64Array>, i))
          } else {
            result.push(typedArray[i])
          }
        }
        break
      }
      case 'boolean': {
        for (let i = 0; i < storedLength; i++) {
          result.push(Atomics.load(this.uint8View, dataOffset + i) !== 0)
        }
        break
      }
      case 'string': {
        for (let i = 0; i < storedLength; i++) {
          const strOffset = dataOffset + i * this.bytesPerElement
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
        for (let i = 0; i < storedLength; i++) {
          const binOffset = dataOffset + i * this.bytesPerElement
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
   * Set array data for an entity
   * @param index - The entity index
   * @param value - The array data to store
   */
  set(index: number, value: any[]): void {
    const offset = index * this.bytesPerEntry
    const elementsToCopy = Math.min(value.length, this.maxLength)

    // Write array length prefix atomically
    this.writeUint32(offset, elementsToCopy)

    const dataOffset = offset + ArrayBufferView.LENGTH_BYTES

    // Clear the data area first
    const totalDataBytes = this.maxLength * this.bytesPerElement
    for (let i = 0; i < totalDataBytes; i++) {
      Atomics.store(this.uint8View, dataOffset + i, 0)
    }

    if (elementsToCopy === 0) return

    switch (this.elementDef.type) {
      case 'number': {
        const typedArray = createTypedArrayAtOffset(this.elementDef.btype, elementsToCopy, this.buffer, dataOffset)
        const useAtomics = this.elementDef.btype !== 'float32' && this.elementDef.btype !== 'float64'
        for (let i = 0; i < elementsToCopy; i++) {
          // For integer types, use Atomics; for floats, use direct access
          if (useAtomics) {
            Atomics.store(typedArray as Exclude<typeof typedArray, Float32Array | Float64Array>, i, value[i])
          } else {
            typedArray[i] = value[i]
          }
        }
        break
      }
      case 'boolean': {
        for (let i = 0; i < elementsToCopy; i++) {
          Atomics.store(this.uint8View, dataOffset + i, value[i] ? 1 : 0)
        }
        break
      }
      case 'string': {
        const maxDataBytes = this.bytesPerElement - 4
        for (let i = 0; i < elementsToCopy; i++) {
          const strOffset = dataOffset + i * this.bytesPerElement
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
          const binOffset = dataOffset + i * this.bytesPerElement
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
   * Get a single element from the array
   * @param index - The entity index
   * @param elementIndex - The index of the element within the array
   * @returns The element value, or undefined if out of bounds
   */
  getElement(index: number, elementIndex: number): any {
    const offset = index * this.bytesPerEntry
    const storedLength = this.readUint32(offset)

    if (elementIndex < 0 || elementIndex >= storedLength) {
      return undefined
    }

    const dataOffset = offset + ArrayBufferView.LENGTH_BYTES

    switch (this.elementDef.type) {
      case 'number': {
        const typedArray = createTypedArrayAtOffset(this.elementDef.btype, storedLength, this.buffer, dataOffset)
        const useAtomics = this.elementDef.btype !== 'float32' && this.elementDef.btype !== 'float64'
        if (useAtomics) {
          return Atomics.load(typedArray as Exclude<typeof typedArray, Float32Array | Float64Array>, elementIndex)
        } else {
          return typedArray[elementIndex]
        }
      }
      case 'boolean': {
        return Atomics.load(this.uint8View, dataOffset + elementIndex) !== 0
      }
      case 'string': {
        const strOffset = dataOffset + elementIndex * this.bytesPerElement
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
        const binOffset = dataOffset + elementIndex * this.bytesPerElement
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
   * Set a single element in the array
   * @param index - The entity index
   * @param elementIndex - The index of the element within the array
   * @param value - The value to set
   */
  setElement(index: number, elementIndex: number, value: any): void {
    if (elementIndex < 0 || elementIndex >= this.maxLength) {
      return
    }

    const offset = index * this.bytesPerEntry
    let storedLength = this.readUint32(offset)

    // Expand array length if necessary
    if (elementIndex >= storedLength) {
      storedLength = elementIndex + 1
      this.writeUint32(offset, storedLength)
    }

    const dataOffset = offset + ArrayBufferView.LENGTH_BYTES

    switch (this.elementDef.type) {
      case 'number': {
        const typedArray = createTypedArrayAtOffset(this.elementDef.btype, this.maxLength, this.buffer, dataOffset)
        const useAtomics = this.elementDef.btype !== 'float32' && this.elementDef.btype !== 'float64'
        if (useAtomics) {
          Atomics.store(typedArray as Exclude<typeof typedArray, Float32Array | Float64Array>, elementIndex, value)
        } else {
          typedArray[elementIndex] = value
        }
        break
      }
      case 'boolean': {
        Atomics.store(this.uint8View, dataOffset + elementIndex, value ? 1 : 0)
        break
      }
      case 'string': {
        const strOffset = dataOffset + elementIndex * this.bytesPerElement
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
        const binOffset = dataOffset + elementIndex * this.bytesPerElement
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

  /**
   * Get the current stored length for an entity's array
   */
  getStoredLength(index: number): number {
    const offset = index * this.bytesPerEntry
    return this.readUint32(offset)
  }

  /**
   * Get the maximum allowed length for arrays
   */
  getMaxLength(): number {
    return this.maxLength
  }

  getBuffer(): ArrayBufferLike {
    return this.buffer
  }

  getBytesPerEntry(): number {
    return this.bytesPerEntry
  }
}

export class ArrayField extends Field<ArrayFieldDef> {
  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const bytesPerElement = getElementBytesPerEntry(this.fieldDef.elementDef)
    // Add array length prefix bytes
    const bytesPerEntry = this.fieldDef.maxLength * bytesPerElement + ArrayBufferView.LENGTH_BYTES

    // Ensure proper alignment for typed arrays (8-byte alignment for float64)
    const alignedBytesPerEntry = Math.ceil(bytesPerEntry / 8) * 8

    const buffer = new BufferConstructor(capacity * alignedBytesPerEntry)
    const view = new ArrayBufferView(
      buffer,
      capacity,
      alignedBytesPerEntry,
      this.fieldDef.elementDef,
      this.fieldDef.maxLength,
    )
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
        const arrayView = (buffer as any)[fieldName] as ArrayBufferView
        const entityId = getEntityId()

        // Mutating array methods that need special handling
        const mutatingMethods = new Set([
          'push',
          'pop',
          'shift',
          'unshift',
          'splice',
          'reverse',
          'sort',
          'fill',
          'copyWithin',
        ])

        // Return a proxy that intercepts index reads/writes
        return new Proxy([] as any[], {
          get(_target, prop) {
            // Handle numeric indices
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              return arrayView.getElement(entityId, index)
            }
            // Handle 'length' property
            if (prop === 'length') {
              return arrayView.getStoredLength(entityId)
            }
            // Handle mutating array methods by operating on copy and persisting
            if (typeof prop === 'string' && mutatingMethods.has(prop)) {
              return (...args: any[]) => {
                const arr = arrayView.get(entityId)
                const result = (arr as any)[prop](...args)
                arrayView.set(entityId, arr)
                return result
              }
            }
            // Handle non-mutating array methods by getting the full array first
            const fullArray = arrayView.get(entityId)
            const value = (fullArray as any)[prop]
            if (typeof value === 'function') {
              return value.bind(fullArray)
            }
            return value
          },
          set(_target, prop, value) {
            // Handle numeric indices
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              arrayView.setElement(entityId, index, value)
              return true
            }
            return false
          },
          has(_target, prop) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              return index >= 0 && index < arrayView.getStoredLength(entityId)
            }
            return prop in []
          },
          ownKeys() {
            const length = arrayView.getStoredLength(entityId)
            const keys: string[] = []
            for (let i = 0; i < length; i++) {
              keys.push(String(i))
            }
            keys.push('length')
            return keys
          },
          getOwnPropertyDescriptor(_target, prop) {
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
              const index = parseInt(prop, 10)
              if (index >= 0 && index < arrayView.getStoredLength(entityId)) {
                return {
                  value: arrayView.getElement(entityId, index),
                  writable: true,
                  enumerable: true,
                  configurable: true,
                }
              }
            }
            if (prop === 'length') {
              return {
                value: arrayView.getStoredLength(entityId),
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
        const array = (buffer as any)[fieldName]
        array.set(getEntityId(), value)
      },
    })
  }

  setValue(array: any, entityId: EntityId, value: any) {
    array.set(entityId, value)
  }
}
