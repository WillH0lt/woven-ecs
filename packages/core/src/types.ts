import type { Component } from './Component'
import type { ComponentBuffer, FieldDef } from './Component/types'
import type { EntityBuffer } from './EntityBuffer'
import type { EventBuffer } from './EventBuffer'
import type { Pool } from './Pool'

/**
 * Context for system execution.
 * Contains entity buffer, components, and metadata.
 * Works identically on main thread and worker threads.
 */
export interface Context {
  /** Entity storage */
  entityBuffer: EntityBuffer
  /** Event tracking buffer */
  eventBuffer: EventBuffer
  /** Entity ID pool */
  pool: Pool
  /** Registered components by definition ID */
  components: Record<number, Component<any>>
  /** Maximum entity count */
  maxEntities: number
  /** Event ring buffer capacity */
  maxEvents: number
  /** Total registered component count */
  componentCount: number
  /**
   * Worker thread index (0-based).
   * Always 0 on main thread. In workers, determines partition.
   */
  threadIndex: number
  /**
   * Total worker threads for current system.
   * Always 1 on main thread. Queries auto-partition based on threadIndex/threadCount.
   */
  threadCount: number
  /**
   * Unique reader identifier. Used internally for query caching.
   */
  readerId: string
  /**
   * Event buffer index at start of last frame. Used by queries to compute
   * added/removed/changed based on the previous frame, not all time since last run.
   */
  prevEventIndex: number
  /**
   * Event buffer index at start of current execution. Used by queries to limit
   * visibility to events that existed before this execute batch started.
   * if undefined it will use the live event buffer index
   */
  currEventIndex?: number
  /**
   * User-defined resources. Access via getResources<T>(ctx).
   */
  readonly resources: unknown
}

/** Entity identifier */
export type EntityId = number

/** Main thread system execution function */
export type SystemFunction = (ctx: Context) => void

/** Worker system execution function */
export type WorkerSystemFunction = (ctx: Context) => void

/** Worker system priority */
export type WorkerPriority = 'low' | 'medium' | 'high'

/** Worker system configuration */
export interface WorkerSystemOptions {
  /**
   * Number of worker threads to spawn.
   * Each thread runs the same worker code in parallel.
   * @default 1
   */
  threads?: number
  /**
   * Priority for worker scheduling (high started first, low started last)
   * @default 'medium'
   */
  priority?: WorkerPriority
}

export type ComponentTransferData = {
  componentId: number
  buffer: ComponentBuffer<any>
  schema: Record<string, FieldDef>
  isSingleton: boolean
}

export type ComponentTransferMap = Record<number, ComponentTransferData>

/** Worker initialization message from main thread */
export interface InitMessage {
  type: 'init'
  entitySAB: SharedArrayBuffer
  eventSAB: SharedArrayBuffer
  poolSAB: SharedArrayBuffer
  poolBucketCount: number
  poolSize: number
  componentTransferMap: ComponentTransferMap
  maxEntities: number
  maxEvents: number
  componentCount: number
  threadIndex: number
  threadCount: number
}

/** Worker execute message from main thread */
export interface ExecuteMessage {
  type: 'execute'
  threadIndex: number
  currEventIndex: number
}

/** All messages received by worker */
export type WorkerIncomingMessage = InitMessage | ExecuteMessage

/** Worker success response to main thread */
export interface WorkerSuccessResponse {
  threadIndex: number
  result: true
}

/** Worker error response to main thread */
export interface WorkerErrorResponse {
  threadIndex: number
  error: string
}

/** All messages sent by worker */
export type WorkerOutgoingMessage = WorkerSuccessResponse | WorkerErrorResponse
