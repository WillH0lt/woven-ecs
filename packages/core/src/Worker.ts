import { Component } from './Component'
import { EntityBuffer } from './EntityBuffer'
import { EventBuffer } from './EventBuffer'
import { Pool } from './Pool'
import type {
  ComponentTransferMap,
  Context,
  WorkerErrorResponse,
  WorkerIncomingMessage,
  WorkerSuccessResponse,
} from './types'

/**
 * Register a parallel system to run in a web worker.
 * Call this in your worker file to set up the execution handler.
 * Components are automatically initialized when first accessed.
 * @param execute - System execution function
 * @example
 * ```typescript
 * import { setupWorker, defineQuery, type Context } from '@woven-ecs/core';
 * import { Position, Velocity } from './components';
 *
 * setupWorker(execute);
 *
 * const movingEntities = defineQuery((q) => q.with(Position, Velocity));
 *
 * function execute(ctx: Context) {
 *   for (const eid of movingEntities.current(ctx)) {
 *     const pos = Position.read(ctx, eid);
 *     console.log(`Entity ${eid}: (${pos.x}, ${pos.y})`);
 *   }
 * }
 * ```
 */

interface InternalContext {
  context: Context | null
  execute: (ctx: Context) => void | Promise<void>
  ComponentTransferMap: ComponentTransferMap | null
}

let internalContext: InternalContext | null = null

export function setupWorker(execute: (ctx: Context) => void | Promise<void>): void {
  internalContext = {
    context: null,
    execute,
    ComponentTransferMap: null,
  }

  self.onmessage = async (e: MessageEvent<WorkerIncomingMessage>) => {
    handleMessage(e, self)
  }
}

/** Handle messages from main thread */
function handleMessage(e: MessageEvent<WorkerIncomingMessage>, self: any): void {
  const { type, threadIndex } = e.data

  if (!internalContext) {
    sendError(self, threadIndex, 'Worker not initialized. Call defineSystem(...) first.')

    return
  }

  try {
    if (type === 'init') {
      internalContext.ComponentTransferMap = e.data.componentTransferMap

      const eventBuffer = EventBuffer.fromTransfer(e.data.eventSAB, e.data.maxEvents)
      const pool = Pool.fromTransfer(e.data.poolSAB, e.data.poolBucketCount, e.data.poolSize)
      const entityBuffer = EntityBuffer.fromTransfer(e.data.entitySAB, e.data.componentCount)

      const components: Record<number, Component<any>> = {}
      for (const [defId, transferData] of Object.entries(internalContext.ComponentTransferMap)) {
        const component = Component.fromTransfer(e.data.maxEntities, transferData, eventBuffer, entityBuffer)
        components[Number(defId)] = component
      }

      internalContext.context = {
        entityBuffer,
        eventBuffer,
        pool,
        components,
        maxEntities: e.data.maxEntities,
        maxEvents: e.data.maxEvents,
        componentCount: e.data.componentCount,
        threadIndex: e.data.threadIndex,
        threadCount: e.data.threadCount,
        readerId: 'worker',
        prevEventIndex: 0,
        resources: undefined,
      }

      sendResult(self, threadIndex)
    } else if (type === 'execute') {
      if (!internalContext.context) {
        throw new Error('Entity buffer not initialized')
      }
      const ctx = internalContext.context
      // Use currEventIndex from message to limit query visibility
      ctx.currEventIndex = e.data.currEventIndex
      ctx.threadIndex = threadIndex
      internalContext.execute(ctx)
      // Update prevEventIndex for next execution
      ctx.prevEventIndex = e.data.currEventIndex
      sendResult(self, threadIndex)
    }
  } catch (error: any) {
    sendError(self, threadIndex, error.message)
  }
}

/** Send success response to main thread */
function sendResult(self: any, threadIndex: number): void {
  const message: WorkerSuccessResponse = { threadIndex, result: true }
  self.postMessage(message)
}

/** Send error response to main thread */
function sendError(self: any, threadIndex: number, error: string): void {
  const message: WorkerErrorResponse = { threadIndex, error }
  self.postMessage(message)
}

/** Reset worker state (testing only) */
export function __resetWorkerState(): void {
  internalContext = null
}
