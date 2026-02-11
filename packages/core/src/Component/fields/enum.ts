import type { EntityId } from '../../types'
import type { ComponentBuffer, EnumFieldDef } from '../types'
import { Field } from './field'

/**
 * EnumField handler for enum-typed component fields.
 * Uses 2 bytes (Uint16) per entity, supporting up to 65536 enum values.
 * Values are sorted alphabetically for consistent ordering.
 */
export class EnumField extends Field<EnumFieldDef> {
  private readonly sortedValues: string[]
  private readonly valueToIndex: Map<string, number>

  constructor(fieldDef: EnumFieldDef) {
    super(fieldDef)
    this.sortedValues = [...fieldDef.values].sort()
    this.valueToIndex = new Map<string, number>()
    this.sortedValues.forEach((v, i) => {
      this.valueToIndex.set(v, i)
    })
  }

  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const buffer = new BufferConstructor(capacity * 2) // 2 bytes per Uint16
    const view = new Uint16Array(buffer)
    return { buffer, view }
  }

  defineReadonly(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    const sortedValues = this.sortedValues

    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = (buffer as any)[fieldName] as Uint16Array
        const index = Atomics.load(array, getEntityId())
        return sortedValues[index] ?? sortedValues[0] ?? ''
      },
    })
  }

  defineWritable(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    const sortedValues = this.sortedValues
    const valueToIndex = this.valueToIndex

    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = (buffer as any)[fieldName] as Uint16Array
        const index = Atomics.load(array, getEntityId())
        return sortedValues[index] ?? sortedValues[0] ?? ''
      },
      set: (value: string) => {
        const array = (buffer as any)[fieldName] as Uint16Array
        const index = valueToIndex.get(value)
        if (index !== undefined) {
          Atomics.store(array, getEntityId(), index)
        }
      },
    })
  }

  setValue(array: Uint16Array, entityId: EntityId, value: string | number) {
    if (typeof value === 'string') {
      const index = this.valueToIndex.get(value)
      Atomics.store(array, entityId, index !== undefined ? index : 0)
    } else {
      Atomics.store(array, entityId, value)
    }
  }
}
