import type { EntityId } from '../../types'
import type { BooleanFieldDef, ComponentBuffer } from '../types'
import { Field } from './field'

export class BooleanField extends Field<BooleanFieldDef> {
  initializeStorage(capacity: number, BufferConstructor: new (byteLength: number) => ArrayBufferLike) {
    const buffer = new BufferConstructor(capacity)
    const view = new Uint8Array(buffer, 0, capacity)
    return { buffer, view }
  }

  defineReadonly(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = (buffer as any)[fieldName]
        return Boolean(Atomics.load(array, getEntityId()))
      },
    })
  }

  defineWritable(master: any, fieldName: string, buffer: ComponentBuffer<any>, getEntityId: () => EntityId) {
    Object.defineProperty(master, fieldName, {
      enumerable: true,
      configurable: false,
      get: () => {
        const array = (buffer as any)[fieldName]
        return Boolean(Atomics.load(array, getEntityId()))
      },
      set: (value: any) => {
        const array = (buffer as any)[fieldName]
        Atomics.store(array, getEntityId(), value ? 1 : 0)
      },
    })
  }

  setValue(array: any, entityId: EntityId, value: any) {
    Atomics.store(array, entityId, value ? 1 : 0)
  }
}
