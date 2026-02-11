import type { ArrayBufferView } from './fields/array'
import type { BinaryBufferView } from './fields/binary'
import type { BufferBufferView } from './fields/buffer'
import type { StringBufferView } from './fields/string'
import type { TupleBufferView } from './fields/tuple'

// Field type definitions
export type FieldType = 'string' | 'number' | 'boolean' | 'binary' | 'array' | 'tuple' | 'buffer' | 'enum' | 'ref'

export type NumberSubtype = 'uint8' | 'uint16' | 'uint32' | 'int8' | 'int16' | 'int32' | 'float32' | 'float64'

// Schema field definitions
export interface BaseField<T> {
  type: FieldType
  default?: T
  schemaDefault?: any
}

export interface StringFieldDef extends BaseField<string> {
  type: 'string'
  maxLength?: number
  default?: string
}

export interface NumberFieldDef extends BaseField<number> {
  type: 'number'
  btype: NumberSubtype
  default?: number
}

export interface BooleanFieldDef extends BaseField<boolean> {
  type: 'boolean'
  default?: boolean
}

export interface BinaryFieldDef extends BaseField<Uint8Array> {
  type: 'binary'
  maxLength?: number
  default?: Uint8Array
}

export interface EnumFieldDef<T extends string = string> extends BaseField<T> {
  type: 'enum'
  values: readonly T[]
  default?: T
}

export interface ArrayFieldDef<
  TElementDef extends StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef =
    | StringFieldDef
    | NumberFieldDef
    | BooleanFieldDef
    | BinaryFieldDef,
> extends BaseField<any[]> {
  type: 'array'
  elementDef: TElementDef
  maxLength: number
  default?: any[]
}

export interface TupleFieldDef<
  TElementDef extends StringFieldDef | NumberFieldDef | BooleanFieldDef | BinaryFieldDef =
    | StringFieldDef
    | NumberFieldDef
    | BooleanFieldDef
    | BinaryFieldDef,
  TLength extends number = number,
> extends BaseField<any[]> {
  type: 'tuple'
  elementDef: TElementDef
  length: TLength
  default?: any[]
}

export interface BufferFieldDef<TElementDef extends NumberFieldDef = NumberFieldDef, TSize extends number = number>
  extends BaseField<any[]> {
  type: 'buffer'
  elementDef: TElementDef
  size: TSize
  default?: any[]
}

export interface RefFieldDef extends BaseField<number | null> {
  type: 'ref'
}

export type FieldDef =
  | StringFieldDef
  | NumberFieldDef
  | BooleanFieldDef
  | BinaryFieldDef
  | EnumFieldDef<any>
  | ArrayFieldDef
  | TupleFieldDef
  | BufferFieldDef
  | RefFieldDef

// TypedArray union type
export type TypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array

// Helper type to infer element type from ArrayFieldDef
type InferArrayElementType<TElementDef> = TElementDef extends StringFieldDef
  ? string
  : TElementDef extends NumberFieldDef
    ? number
    : TElementDef extends BooleanFieldDef
      ? boolean
      : TElementDef extends BinaryFieldDef
        ? Uint8Array
        : never

// Helper type to create a fixed-length tuple type
type CreateTuple<T, N extends number, R extends T[] = []> = R['length'] extends N ? R : CreateTuple<T, N, [...R, T]>

// Helper type to map NumberSubtype to TypedArray
type NumberSubtypeToTypedArray<T extends NumberSubtype> = T extends 'uint8'
  ? Uint8Array
  : T extends 'uint16'
    ? Uint16Array
    : T extends 'uint32'
      ? Uint32Array
      : T extends 'int8'
        ? Int8Array
        : T extends 'int16'
          ? Int16Array
          : T extends 'int32'
            ? Int32Array
            : T extends 'float32'
              ? Float32Array
              : T extends 'float64'
                ? Float64Array
                : TypedArray

// Component schema and inference types
export type ComponentSchema = Record<
  string,
  {
    def:
      | StringFieldDef
      | NumberFieldDef
      | BooleanFieldDef
      | BinaryFieldDef
      | EnumFieldDef<any>
      | ArrayFieldDef
      | TupleFieldDef
      | BufferFieldDef
      | RefFieldDef
  }
>

export type InferComponentType<T extends ComponentSchema> = {
  [K in keyof T]: T[K]['def'] extends EnumFieldDef<infer TEnum>
    ? TEnum
    : T[K]['def'] extends StringFieldDef
      ? string
      : T[K]['def'] extends NumberFieldDef
        ? number
        : T[K]['def'] extends BooleanFieldDef
          ? boolean
          : T[K]['def'] extends BinaryFieldDef
            ? Uint8Array
            : T[K]['def'] extends ArrayFieldDef<infer TElementDef>
              ? InferArrayElementType<TElementDef>[]
              : T[K]['def'] extends TupleFieldDef<infer TElementDef, infer TLength>
                ? CreateTuple<InferArrayElementType<TElementDef>, TLength>
                : T[K]['def'] extends BufferFieldDef<infer TElementDef>
                  ? TElementDef extends { btype: infer TBtype extends NumberSubtype }
                    ? NumberSubtypeToTypedArray<TBtype>
                    : TypedArray
                  : T[K]['def'] extends RefFieldDef
                    ? number | null
                    : never
}

// Input type for component data - accepts ArrayLike<number> for Buffer fields
export type InferComponentInput<T extends ComponentSchema> = {
  [K in keyof T]: T[K]['def'] extends EnumFieldDef<infer TEnum>
    ? TEnum
    : T[K]['def'] extends StringFieldDef
      ? string
      : T[K]['def'] extends NumberFieldDef
        ? number
        : T[K]['def'] extends BooleanFieldDef
          ? boolean
          : T[K]['def'] extends BinaryFieldDef
            ? Uint8Array
            : T[K]['def'] extends ArrayFieldDef<infer TElementDef>
              ? InferArrayElementType<TElementDef>[]
              : T[K]['def'] extends TupleFieldDef<infer TElementDef, infer TLength>
                ? CreateTuple<InferArrayElementType<TElementDef>, TLength>
                : T[K]['def'] extends BufferFieldDef
                  ? ArrayLike<number>
                  : T[K]['def'] extends RefFieldDef
                    ? number | null
                    : never
}

// Type for the buffer accessor that provides typed array access to component fields
export type ComponentBuffer<T extends ComponentSchema> = {
  [K in keyof T]: T[K]['def'] extends NumberFieldDef
    ? TypedArray
    : T[K]['def'] extends BooleanFieldDef
      ? Uint8Array
      : T[K]['def'] extends StringFieldDef
        ? StringBufferView
        : T[K]['def'] extends BinaryFieldDef
          ? BinaryBufferView
          : T[K]['def'] extends EnumFieldDef<any>
            ? Uint16Array
            : T[K]['def'] extends ArrayFieldDef
              ? ArrayBufferView
              : T[K]['def'] extends TupleFieldDef
                ? TupleBufferView
                : T[K]['def'] extends BufferFieldDef
                  ? BufferBufferView
                  : T[K]['def'] extends RefFieldDef
                    ? Uint32Array
                    : never
}
