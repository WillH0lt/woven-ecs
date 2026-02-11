import type {
  ArrayFieldDef,
  BinaryFieldDef,
  BooleanFieldDef,
  BufferFieldDef,
  EnumFieldDef,
  FieldDef,
  NumberFieldDef,
  NumberSubtype,
  RefFieldDef,
  StringFieldDef,
  TupleFieldDef,
} from './types'

/**
 * Symbol for accessing schema default value.
 * Hidden from users to keep the builder API clean.
 */
export const schemaDefault = Symbol('schemaDefault')

/**
 * Abstract base class for all field builders.
 * Provides a common interface and type constraint for field definitions.
 */
export abstract class FieldBuilder<D extends FieldDef = FieldDef> {
  abstract readonly def: D
  abstract [schemaDefault](): unknown
}

/** Valid element types for array and tuple fields */
const VALID_ELEMENT_TYPES = new Set(['string', 'number', 'boolean', 'binary'])

/**
 * Validate that an element builder is valid for use in array/tuple fields
 * @throws Error if the element builder is not a valid type
 */
function validateElementBuilder(elementBuilder: FieldBuilder, containerType: 'array' | 'tuple'): void {
  const elementType = elementBuilder.def.type

  if (!VALID_ELEMENT_TYPES.has(elementType)) {
    throw new Error(
      `Invalid ${containerType} element type: "${elementType}". ` +
        `Only primitive types are allowed: string, number, boolean, binary. ` +
        `Nested ${containerType}s, tuples, arrays, enums, and refs are not supported.`,
    )
  }
}

/** Union type for all field builders that can be used as array elements */
export type ElementFieldBuilder = StringFieldBuilder | NumberFieldBuilder | BooleanFieldBuilder | BinaryFieldBuilder

// Field builder classes with fluent API
export class StringFieldBuilder extends FieldBuilder<StringFieldDef> {
  def: StringFieldDef = {
    type: 'string',
  }

  /**
   * Set the maximum number of bytes for the string field
   * @param length - The maximum number of bytes for the string
   * @returns This builder for chaining
   */
  max(length: number): this {
    this.def.maxLength = length
    return this
  }

  /**
   * Set the default value for the string field
   * @param value - The default value
   * @returns This builder for chaining
   */
  default(value: string): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): string {
    return this.def.default ?? ''
  }
}

export class NumberFieldBuilder<TBtype extends NumberSubtype = NumberSubtype> extends FieldBuilder<NumberFieldDef> {
  def: NumberFieldDef & { btype: TBtype }

  /**
   * Create a number field builder with the specified binary type
   * @param btype - The binary type for the number field
   */
  constructor(btype: TBtype) {
    super()
    this.def = {
      type: 'number',
      btype: btype,
    }
  }

  /**
   * Set the default value for the number field
   * @param value - The default value
   * @returns This builder for chaining
   */
  default(value: number): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): number {
    return this.def.default ?? 0
  }
}

export class BooleanFieldBuilder extends FieldBuilder<BooleanFieldDef> {
  def: BooleanFieldDef = {
    type: 'boolean',
  }

  /**
   * Set the default value for the boolean field
   * @param value - The default value
   * @returns This builder for chaining
   */
  default(value: boolean): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): boolean {
    return this.def.default ?? false
  }
}

export class BinaryFieldBuilder extends FieldBuilder<BinaryFieldDef> {
  def: BinaryFieldDef = {
    type: 'binary',
  }

  /**
   * Set the maximum number of bytes for the binary field
   * @param length - The maximum number of bytes
   * @returns This builder for chaining
   */
  max(length: number): this {
    this.def.maxLength = length
    return this
  }

  /**
   * Set the default value for the binary field
   * @param value - The default value
   * @returns This builder for chaining
   */
  default(value: Uint8Array): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): Uint8Array {
    return this.def.default ?? new Uint8Array(0)
  }
}

export class ArrayFieldBuilder<
  T extends ElementFieldBuilder = ElementFieldBuilder,
> extends FieldBuilder<ArrayFieldDef> {
  def: T extends StringFieldBuilder
    ? ArrayFieldDef<StringFieldDef>
    : T extends NumberFieldBuilder
      ? ArrayFieldDef<NumberFieldDef>
      : T extends BooleanFieldBuilder
        ? ArrayFieldDef<BooleanFieldDef>
        : T extends BinaryFieldBuilder
          ? ArrayFieldDef<BinaryFieldDef>
          : ArrayFieldDef

  /**
   * Create an array field builder with the specified element type and max length
   * @param elementBuilder - A field builder specifying the element type
   * @param maxLength - The maximum number of elements in the array
   * @throws Error if elementBuilder is not a valid element type
   */
  constructor(elementBuilder: T, maxLength: number) {
    super()
    validateElementBuilder(elementBuilder, 'array')
    this.def = {
      type: 'array',
      elementDef: elementBuilder.def,
      maxLength: maxLength,
    } as any
  }

  /**
   * Set the default value for the array field
   * @param value - The default value (array of the element type)
   * @returns This builder for chaining
   */
  default(value: any[]): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): any[] {
    return this.def.default ?? []
  }
}

// Helper type to create a fixed-length tuple type
type CreateTuple<T, N extends number, R extends T[] = []> = R['length'] extends N ? R : CreateTuple<T, N, [...R, T]>

// Helper type to infer element type from field builder
type InferElementType<T extends ElementFieldBuilder> = T extends StringFieldBuilder
  ? string
  : T extends NumberFieldBuilder
    ? number
    : T extends BooleanFieldBuilder
      ? boolean
      : T extends BinaryFieldBuilder
        ? Uint8Array
        : never

export class TupleFieldBuilder<
  T extends ElementFieldBuilder = ElementFieldBuilder,
  L extends number = number,
> extends FieldBuilder<TupleFieldDef> {
  def: T extends StringFieldBuilder
    ? TupleFieldDef<StringFieldDef, L>
    : T extends NumberFieldBuilder
      ? TupleFieldDef<NumberFieldDef, L>
      : T extends BooleanFieldBuilder
        ? TupleFieldDef<BooleanFieldDef, L>
        : T extends BinaryFieldBuilder
          ? TupleFieldDef<BinaryFieldDef, L>
          : TupleFieldDef<any, L>

  private elementBuilder: T

  /**
   * Create a tuple field builder with the specified element type and length
   * @param elementBuilder - A field builder specifying the element type
   * @param length - The fixed length of the tuple
   * @throws Error if elementBuilder is not a valid element type
   */
  constructor(elementBuilder: T, length: L) {
    super()
    validateElementBuilder(elementBuilder, 'tuple')
    this.elementBuilder = elementBuilder
    this.def = {
      type: 'tuple',
      elementDef: elementBuilder.def,
      length: length,
    } as any
  }

  /**
   * Set the default value for the tuple field
   * @param value - The default value (tuple of the element type)
   * @returns This builder for chaining
   */
  default(value: CreateTuple<InferElementType<T>, L>): this {
    this.def.default = value as any[]
    return this
  }

  [schemaDefault](): any[] {
    if (this.def.default) return this.def.default
    const elementDefault = this.elementBuilder[schemaDefault]()
    return new Array(this.def.length).fill(elementDefault)
  }
}

export class BufferFieldBuilder<TBtype extends NumberSubtype = NumberSubtype> extends FieldBuilder<BufferFieldDef> {
  def: BufferFieldDef<NumberFieldDef & { btype: TBtype }>

  /**
   * Create a buffer field builder with the specified element type
   * @param elementBuilder - A number field builder specifying the element type
   */
  constructor(elementBuilder: NumberFieldBuilder<TBtype>) {
    super()
    this.def = {
      type: 'buffer',
      elementDef: elementBuilder.def,
      size: 0, // must be set via size()
    }
  }

  /**
   * Set the fixed size of the buffer
   * @param length - The fixed number of elements
   * @returns This builder for chaining
   */
  size(length: number): this {
    this.def.size = length
    return this
  }

  /**
   * Set the default value for the buffer field
   * @param value - The default value (array of numbers)
   * @returns This builder for chaining
   */
  default(value: number[]): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): number[] {
    return this.def.default ?? new Array(this.def.size).fill(0)
  }
}

/** Helper type to extract string values from an enum-like const object */
type EnumValues<T extends Record<string, string>> = T[keyof T]

export class EnumFieldBuilder<T extends string = string> extends FieldBuilder<EnumFieldDef<T>> {
  def: EnumFieldDef<T>

  /**
   * Create an enum field builder with the specified enum values
   * @param enumObj - An object with string values (typically a const object)
   */
  constructor(enumObj: Record<string, T>) {
    super()
    this.def = {
      type: 'enum',
      values: Object.values(enumObj) as T[],
    }
  }

  /**
   * Set the default value for the enum field
   * @param value - The default value (must be one of the enum values)
   * @returns This builder for chaining
   */
  default(value: T): this {
    this.def.default = value
    return this
  }

  [schemaDefault](): T {
    if (this.def.default !== undefined) return this.def.default
    return [...this.def.values].sort()[0] as T
  }
}

/**
 * Builder for entity reference fields.
 * Refs store an entity ID (or null).
 *
 * When a referenced entity is deleted, the ref is lazily set to null
 * on the next read (no eager scanning required).
 */
export class RefFieldBuilder extends FieldBuilder<RefFieldDef> {
  def: RefFieldDef = {
    type: 'ref',
  };

  [schemaDefault](): null {
    return null
  }
}

/**
 * Schema builder API for defining component fields
 * Provides factory functions for creating typed field builders
 */
export const field = {
  /** Create a string field builder */
  string: () => new StringFieldBuilder(),
  /** Create an unsigned 8-bit integer field builder */
  uint8: () => new NumberFieldBuilder('uint8'),
  /** Create an unsigned 16-bit integer field builder */
  uint16: () => new NumberFieldBuilder('uint16'),
  /** Create an unsigned 32-bit integer field builder */
  uint32: () => new NumberFieldBuilder('uint32'),
  /** Create a signed 8-bit integer field builder */
  int8: () => new NumberFieldBuilder('int8'),
  /** Create a signed 16-bit integer field builder */
  int16: () => new NumberFieldBuilder('int16'),
  /** Create a signed 32-bit integer field builder */
  int32: () => new NumberFieldBuilder('int32'),
  /** Create a 32-bit floating point field builder */
  float32: () => new NumberFieldBuilder('float32'),
  /** Create a 64-bit floating point field builder */
  float64: () => new NumberFieldBuilder('float64'),
  /** Create a boolean field builder */
  boolean: () => new BooleanFieldBuilder(),
  /** Create a binary field builder for Uint8Array data */
  binary: () => new BinaryFieldBuilder(),
  /**
   * Create an enum field builder for type-safe enum values
   * @param enumObj - An object with string values (typically a const object like `{ A: 'A', B: 'B' } as const`)
   * @returns An enum field builder
   * @example
   * ```typescript
   * const ShareMode = {
   *   None: 'None',
   *   ReadOnly: 'ReadOnly',
   *   ReadWrite: 'ReadWrite'
   * } as const;
   *
   * type ShareMode = (typeof ShareMode)[keyof typeof ShareMode];
   *
   * const Document = defineComponent("Document", {
   *   shareMode: field.enum(ShareMode).default(ShareMode.None),
   * });
   * ```
   */
  enum: <T extends Record<string, string>>(enumObj: T) =>
    new EnumFieldBuilder<EnumValues<T>>(enumObj as unknown as Record<string, EnumValues<T>>),
  /**
   * Create an array field builder for fixed-length arrays of any field type
   * @param elementBuilder - A field builder specifying the element type (e.g., field.float32(), field.string().max(100))
   * @param maxLength - The maximum number of elements in the array
   * @returns An array field builder
   * @example
   * ```typescript
   * // Array of floats
   * const Polygon = defineComponent({
   *   pts: field.array(field.float32(), 1024),
   * });
   *
   * // Array of strings
   * const Tags = defineComponent({
   *   names: field.array(field.string().max(50), 10),
   * });
   *
   * // Array of booleans
   * const Flags = defineComponent({
   *   bits: field.array(field.boolean(), 32),
   * });
   * ```
   */
  array: <T extends ElementFieldBuilder>(elementBuilder: T, maxLength: number) =>
    new ArrayFieldBuilder(elementBuilder, maxLength),
  /**
   * Create a tuple field builder for fixed-length typed tuples
   * @param elementBuilder - A field builder specifying the element type (e.g., field.float32(), field.string().max(100))
   * @param length - The exact length of the tuple
   * @returns A tuple field builder with proper TypeScript tuple type inference
   * @example
   * ```typescript
   * // Position as a 2D tuple
   * const Position = defineComponent("Position", {
   *   coords: field.tuple(field.float32(), 2).default([0, 0]),
   * });
   * // coords is typed as [number, number]
   *
   * // RGB color tuple
   * const Color = defineComponent("Color", {
   *   rgb: field.tuple(field.uint8(), 3).default([255, 255, 255]),
   * });
   * // rgb is typed as [number, number, number]
   * ```
   */
  tuple: <T extends ElementFieldBuilder, L extends number>(elementBuilder: T, length: L) =>
    new TupleFieldBuilder(elementBuilder, length),
  /**
   * Create a buffer field builder for fixed-size numeric arrays.
   * Buffers are more efficient than arrays for numeric data because they
   * return subarray views instead of copying data (zero allocation).
   *
   * Like tuples but with configurable size - ideal for large fixed-size numeric data.
   *
   * @param elementBuilder - A number field builder specifying the element type
   * @returns A buffer field builder with chainable size() method
   * @example
   * ```typescript
   * // Path points as float32 buffer (1024 elements)
   * const Path = defineComponent({
   *   points: field.buffer(field.float32()).size(1024),
   * });
   *
   * // Indices as uint16 buffer
   * const Mesh = defineComponent({
   *   indices: field.buffer(field.uint16()).size(65536),
   * });
   *
   * // Usage: returns a typed array subarray view (zero allocation)
   * const path = Path.read(ctx, entityId);
   * for (let i = 0; i < path.points.length; i++) {
   *   console.log(path.points[i]);
   * }
   * ```
   */
  buffer: <TBtype extends NumberSubtype>(elementBuilder: NumberFieldBuilder<TBtype>) =>
    new BufferFieldBuilder(elementBuilder),
  /**
   * Create an entity reference field builder.
   * Refs store an entity ID (or null) and support automatic cleanup on deletion.
   * @returns A ref field builder
   * @example
   * ```typescript
   * const Child = defineComponent("Child", {
   *   parent: field.ref()
   * });

   * ```
   */
  ref: () => new RefFieldBuilder(),
}
