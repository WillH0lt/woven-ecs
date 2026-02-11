import type { EntityId } from '../../types'
import type { ComponentBuffer, FieldDef } from '../types'

/**
 * Abstract base class for field type handlers.
 * Each field type (string, number, boolean, etc.) extends this class.
 * Field instances are created per-field and store their fieldDef.
 */
export abstract class Field<TFieldDef extends FieldDef = FieldDef> {
  /** The field definition containing type-specific configuration */
  protected readonly fieldDef: TFieldDef

  constructor(fieldDef: TFieldDef) {
    this.fieldDef = fieldDef
  }

  /**
   * Initialize storage for this field type
   * @param capacity - The initial capacity
   * @param BufferConstructor - The buffer constructor (SharedArrayBuffer or ArrayBuffer)
   * @returns The initialized buffer and backing ArrayBufferLike
   */
  abstract initializeStorage(
    capacity: number,
    BufferConstructor: new (byteLength: number) => ArrayBufferLike,
  ): { buffer: ArrayBufferLike; view: any }

  /**
   * Define readonly property descriptor for this field type
   * @param master - The master object to define the property on
   * @param fieldName - The field name
   * @param buffer - The buffer accessor
   * @param getEntityId - Function to get the current entity ID
   */
  abstract defineReadonly(
    master: any,
    fieldName: string,
    buffer: ComponentBuffer<any>,
    getEntityId: () => EntityId,
  ): void

  /**
   * Define writable property descriptor for this field type
   * @param master - The master object to define the property on
   * @param fieldName - The field name
   * @param buffer - The buffer accessor
   * @param getEntityId - Function to get the current entity ID
   */
  abstract defineWritable(
    master: any,
    fieldName: string,
    buffer: ComponentBuffer<any>,
    getEntityId: () => EntityId,
  ): void

  /**
   * Get the default value for this field type.
   * Reads from the schemaDefault computed by the field builder.
   * @returns The default value
   */
  getDefaultValue(): any {
    return this.fieldDef.schemaDefault
  }

  /**
   * Set a value in the storage
   * @param array - The storage array
   * @param entityId - The entity ID
   * @param value - The value to set
   */
  abstract setValue(array: any, entityId: EntityId, value: any): void
}
