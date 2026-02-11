import type { EntityId } from '../../types'
import type { ComponentBuffer, StringFieldDef } from '../types'
import { Field } from './field'

const DEFAULT_STRING_BYTES = 512

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export class StringBufferView {
  private buffer: Uint8Array
  private bytesPerString: number
  private capacity: number
  public static readonly LENGTH_BYTES = 4 // uint32 for length prefix

  constructor(buffer: ArrayBufferLike, capacity: number, bytesPerString: number) {
    this.buffer = new Uint8Array(buffer)
    this.bytesPerString = bytesPerString
    this.capacity = capacity
  }

  get length(): number {
    return this.capacity
  }

  get(index: number): string {
    const offset = index * this.bytesPerString
    const b0 = Atomics.load(this.buffer, offset)
    const b1 = Atomics.load(this.buffer, offset + 1)
    const b2 = Atomics.load(this.buffer, offset + 2)
    const b3 = Atomics.load(this.buffer, offset + 3)
    const storedLength = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    if (storedLength === 0) return ''
    const dataStart = offset + StringBufferView.LENGTH_BYTES
    // Read string bytes atomically
    const stringBytes = new Uint8Array(storedLength)
    for (let i = 0; i < storedLength; i++) {
      stringBytes[i] = Atomics.load(this.buffer, dataStart + i)
    }
    return textDecoder.decode(stringBytes)
  }

  set(index: number, value: string): void {
    const offset = index * this.bytesPerString
    const encoded = textEncoder.encode(value)
    const maxDataBytes = this.bytesPerString - StringBufferView.LENGTH_BYTES
    const bytesToCopy = Math.min(encoded.length, maxDataBytes)

    // Write length prefix atomically
    Atomics.store(this.buffer, offset, bytesToCopy & 0xff)
    Atomics.store(this.buffer, offset + 1, (bytesToCopy >> 8) & 0xff)
    Atomics.store(this.buffer, offset + 2, (bytesToCopy >> 16) & 0xff)
    Atomics.store(this.buffer, offset + 3, (bytesToCopy >> 24) & 0xff)

    // Clear the data area first
    const dataStart = offset + StringBufferView.LENGTH_BYTES
    for (let i = 0; i < maxDataBytes; i++) {
      Atomics.store(this.buffer, dataStart + i, 0)
    }

    // Write string data atomically
    for (let i = 0; i < bytesToCopy; i++) {
      Atomics.store(this.buffer, dataStart + i, encoded[i])
    }
  }

  getBuffer(): Uint8Array {
    return this.buffer
  }
}

export class StringField extends Field<StringFieldDef> {
  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const maxDataLength = this.fieldDef.maxLength || DEFAULT_STRING_BYTES
    // Add length prefix bytes to the user-specified max data length
    const bytesPerString = maxDataLength + StringBufferView.LENGTH_BYTES
    const buffer = new BufferConstructor(capacity * bytesPerString)
    const view = new StringBufferView(buffer, capacity, bytesPerString)
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
