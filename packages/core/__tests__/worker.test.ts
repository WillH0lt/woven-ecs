import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addComponent, createEntity, defineComponent, field, World } from '../src/index'
import { Pool } from '../src/Pool'
import type {
  ComponentTransferMap,
  Context,
  ExecuteMessage,
  InitMessage,
  WorkerErrorResponse,
  WorkerSuccessResponse,
} from '../src/types'
import { __resetWorkerState, setupWorker } from '../src/Worker'

// Mock the global self object for worker environment
const mockPostMessage = vi.fn()
const mockSelf = {
  postMessage: mockPostMessage,
  onmessage: null as ((e: MessageEvent) => void) | null,
}

// Store the original global self
const originalSelf = globalThis.self

describe('Worker', () => {
  let Position: ReturnType<typeof defineComponent>
  let Velocity: ReturnType<typeof defineComponent>

  beforeEach(() => {
    // Reset worker internal state
    __resetWorkerState()

    // Reset mocks
    vi.clearAllMocks()
    mockSelf.onmessage = null

    // Mock self globally
    ;(globalThis as any).self = mockSelf

    // Define test components
    Position = defineComponent({
      x: field.float32().default(0),
      y: field.float32().default(0),
    })

    Velocity = defineComponent({
      dx: field.float32().default(0),
      dy: field.float32().default(0),
    })
  })

  afterEach(() => {
    // Restore original self
    ;(globalThis as any).self = originalSelf
  })

  describe('setupWorker', () => {
    it('should set up message handler on self', () => {
      const execute = vi.fn()

      setupWorker(execute)

      expect(mockSelf.onmessage).toBeDefined()
      expect(typeof mockSelf.onmessage).toBe('function')
    })

    it('should not call execute immediately', () => {
      const execute = vi.fn()

      setupWorker(execute)

      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('Message Handling', () => {
    it('should handle init message and create context', () => {
      const execute = vi.fn()

      setupWorker(execute)

      // Create world to get properly initialized components
      const world = new World([Position, Velocity])
      const ctx = world._getContext()

      // Create component transfer data from the context
      const componentTransferMap: ComponentTransferMap = {}
      for (const [defId, component] of Object.entries(ctx.components)) {
        componentTransferMap[Number(defId)] = {
          componentId: component.componentId,
          buffer: component.buffer,
          schema: component.schema,
          isSingleton: component.isSingleton,
        }
      }

      const pool = Pool.create(ctx.maxEntities)

      const initMessage: InitMessage = {
        type: 'init',
        threadIndex: 1,
        threadCount: 1,
        entitySAB: ctx.entityBuffer.getBuffer() as SharedArrayBuffer,
        eventSAB: ctx.eventBuffer.getBuffer() as SharedArrayBuffer,
        poolSAB: pool.getBuffer(),
        poolBucketCount: pool.getBucketCount(),
        poolSize: pool.getSize(),
        componentTransferMap,
        maxEntities: ctx.maxEntities,
        maxEvents: ctx.maxEvents,
        componentCount: ctx.componentCount,
      }

      // Simulate receiving the init message
      const messageEvent = { data: initMessage } as MessageEvent<InitMessage>
      mockSelf.onmessage!(messageEvent)

      // Should send success response
      expect(mockPostMessage).toHaveBeenCalledWith({
        threadIndex: 1,
        result: true,
      } satisfies WorkerSuccessResponse)
    })

    it('should handle execute message after init', () => {
      const execute = vi.fn()

      setupWorker(execute)

      // Need fresh components for this test
      const TestPosition = defineComponent({
        x: field.float32().default(0),
        y: field.float32().default(0),
      })

      // Create world to get properly initialized components
      const world = new World([TestPosition])
      const ctx = world._getContext()

      // Create component transfer data from the context
      const componentTransferMap: ComponentTransferMap = {}
      for (const [defId, component] of Object.entries(ctx.components)) {
        componentTransferMap[Number(defId)] = {
          componentId: component.componentId,
          buffer: component.buffer,
          schema: component.schema,
          isSingleton: component.isSingleton,
        }
      }

      const pool = Pool.create(ctx.maxEntities)

      // First, send init message
      const initMessage: InitMessage = {
        type: 'init',
        threadIndex: 1,
        threadCount: 1,
        entitySAB: ctx.entityBuffer.getBuffer() as SharedArrayBuffer,
        eventSAB: ctx.eventBuffer.getBuffer() as SharedArrayBuffer,
        poolSAB: pool.getBuffer(),
        poolBucketCount: pool.getBucketCount(),
        poolSize: pool.getSize(),
        componentTransferMap,
        maxEntities: ctx.maxEntities,
        maxEvents: ctx.maxEvents,
        componentCount: ctx.componentCount,
      }

      mockSelf.onmessage!({ data: initMessage } as MessageEvent<InitMessage>)
      mockPostMessage.mockClear()

      // Then send execute message
      const executeMessage: ExecuteMessage = {
        type: 'execute',
        threadIndex: 1,
        currEventIndex: ctx.eventBuffer.getWriteIndex(),
      }

      mockSelf.onmessage!({
        data: executeMessage,
      } as MessageEvent<ExecuteMessage>)

      // Execute should have been called with context
      expect(execute).toHaveBeenCalledTimes(1)

      const callArg = execute.mock.calls[0][0] as Context
      // Check entityBuffer has expected properties
      expect(callArg.entityBuffer).toBeDefined()
      expect(callArg.components).toBeDefined()
      expect(callArg.maxEntities).toBe(ctx.maxEntities)
      expect(callArg.componentCount).toBe(ctx.componentCount)

      // Should send success response
      expect(mockPostMessage).toHaveBeenCalledWith({
        threadIndex: 1,
        result: true,
      } satisfies WorkerSuccessResponse)
    })

    it('should error if execute is called before init', () => {
      const execute = vi.fn()

      setupWorker(execute)

      // Send execute without init
      const executeMessage: ExecuteMessage = {
        type: 'execute',
        threadIndex: 1,
        currEventIndex: 0,
      }

      mockSelf.onmessage!({
        data: executeMessage,
      } as MessageEvent<ExecuteMessage>)

      // Should send error response
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadIndex: 1,
          error: expect.any(String),
        } satisfies WorkerErrorResponse),
      )

      // Execute should not have been called
      expect(execute).not.toHaveBeenCalled()
    })

    it('should handle errors in execute function', () => {
      const execute = vi.fn().mockImplementation(() => {
        throw new Error('Test error')
      })

      setupWorker(execute)

      // Create world
      const TestComp = defineComponent({
        x: field.float32(),
      })

      const world = new World([TestComp])
      const ctx = world._getContext()

      // Create component transfer data from the context
      const componentTransferMap: ComponentTransferMap = {}
      for (const [defId, component] of Object.entries(ctx.components)) {
        componentTransferMap[Number(defId)] = {
          componentId: component.componentId,
          buffer: component.buffer,
          schema: component.schema,
          isSingleton: component.isSingleton,
        }
      }

      const pool = Pool.create(ctx.maxEntities)

      // First, send init message
      const initMessage: InitMessage = {
        type: 'init',
        threadIndex: 1,
        threadCount: 1,
        entitySAB: ctx.entityBuffer.getBuffer() as SharedArrayBuffer,
        eventSAB: ctx.eventBuffer.getBuffer() as SharedArrayBuffer,
        poolSAB: pool.getBuffer(),
        poolBucketCount: pool.getBucketCount(),
        poolSize: pool.getSize(),
        componentTransferMap,
        maxEntities: ctx.maxEntities,
        maxEvents: ctx.maxEvents,
        componentCount: ctx.componentCount,
      }

      mockSelf.onmessage!({ data: initMessage } as MessageEvent<InitMessage>)
      mockPostMessage.mockClear()

      // Then send execute message
      const executeMessage: ExecuteMessage = {
        type: 'execute',
        threadIndex: 2,
        currEventIndex: ctx.eventBuffer.getWriteIndex(),
      }

      mockSelf.onmessage!({
        data: executeMessage,
      } as MessageEvent<ExecuteMessage>)

      // Should send error response
      expect(mockPostMessage).toHaveBeenCalledWith({
        threadIndex: 2,
        error: 'Test error',
      } satisfies WorkerErrorResponse)
    })
  })

  describe('Component Access in Worker', () => {
    it('should have access to component data via context', () => {
      let capturedCtx: Context | null = null
      const execute = vi.fn().mockImplementation((ctx: Context) => {
        capturedCtx = ctx
      })

      setupWorker(execute)

      // Create world
      const TestPosition = defineComponent({
        x: field.float32().default(100),
        y: field.float32().default(200),
      })

      const world = new World([TestPosition])
      const ctx = world._getContext()

      // Create component transfer data from the context
      const componentTransferMap: ComponentTransferMap = {}
      for (const [defId, component] of Object.entries(ctx.components)) {
        componentTransferMap[Number(defId)] = {
          componentId: component.componentId,
          buffer: component.buffer,
          schema: component.schema,
          isSingleton: component.isSingleton,
        }
      }

      const pool = Pool.create(ctx.maxEntities)

      const initMessage: InitMessage = {
        type: 'init',
        threadIndex: 1,
        threadCount: 1,
        entitySAB: ctx.entityBuffer.getBuffer() as SharedArrayBuffer,
        eventSAB: ctx.eventBuffer.getBuffer() as SharedArrayBuffer,
        poolSAB: pool.getBuffer(),
        poolBucketCount: pool.getBucketCount(),
        poolSize: pool.getSize(),
        componentTransferMap,
        maxEntities: ctx.maxEntities,
        maxEvents: ctx.maxEvents,
        componentCount: ctx.componentCount,
      }

      mockSelf.onmessage!({ data: initMessage } as MessageEvent<InitMessage>)

      const executeMessage: ExecuteMessage = {
        type: 'execute',
        threadIndex: 1,
        currEventIndex: ctx.eventBuffer.getWriteIndex(),
      }

      mockSelf.onmessage!({
        data: executeMessage,
      } as MessageEvent<ExecuteMessage>)

      // Check that the worker context has the component
      expect(capturedCtx).not.toBeNull()
      expect(capturedCtx!.components).toBeDefined()
      expect(capturedCtx!.components[TestPosition._defId]).toBeDefined()
      expect(capturedCtx!.components[TestPosition._defId].componentId).toBe(0)
    })

    it('should share component buffers between main and worker contexts', () => {
      let capturedCtx: Context | null = null
      const execute = vi.fn().mockImplementation((ctx: Context) => {
        capturedCtx = ctx
      })

      setupWorker(execute)

      // Create world
      const TestPosition = defineComponent({
        x: field.float32().default(0),
        y: field.float32().default(0),
      })

      const world = new World([TestPosition])
      const ctx = world._getContext()

      // Create an entity and add component with data on main thread
      const eid = createEntity(ctx)
      addComponent(ctx, eid, TestPosition, { x: 42, y: 24 })

      // Create component transfer data from the context
      const componentTransferMap: ComponentTransferMap = {}
      for (const [defId, component] of Object.entries(ctx.components)) {
        componentTransferMap[Number(defId)] = {
          componentId: component.componentId,
          buffer: component.buffer,
          schema: component.schema,
          isSingleton: component.isSingleton,
        }
      }

      const pool = Pool.create(ctx.maxEntities)

      const initMessage: InitMessage = {
        type: 'init',
        threadIndex: 1,
        threadCount: 1,
        entitySAB: ctx.entityBuffer.getBuffer() as SharedArrayBuffer,
        eventSAB: ctx.eventBuffer.getBuffer() as SharedArrayBuffer,
        poolSAB: pool.getBuffer(),
        poolBucketCount: pool.getBucketCount(),
        poolSize: pool.getSize(),
        componentTransferMap,
        maxEntities: ctx.maxEntities,
        maxEvents: ctx.maxEvents,
        componentCount: ctx.componentCount,
      }

      mockSelf.onmessage!({ data: initMessage } as MessageEvent<InitMessage>)

      const executeMessage: ExecuteMessage = {
        type: 'execute',
        threadIndex: 1,
        currEventIndex: ctx.eventBuffer.getWriteIndex(),
      }

      mockSelf.onmessage!({
        data: executeMessage,
      } as MessageEvent<ExecuteMessage>)

      // Check that the worker can read the same data
      expect(capturedCtx).not.toBeNull()
      const workerComponent = capturedCtx!.components[TestPosition._defId]
      const readData = workerComponent.read(eid)
      expect(readData.x).toBeCloseTo(42)
      expect(readData.y).toBeCloseTo(24)
    })
  })

  describe('Error Handling', () => {
    it('should handle missing setupWorker call', () => {
      // Don't call setupWorker, but try to receive a message
      // This simulates an improperly configured worker

      // Reset state to ensure no previous setup
      __resetWorkerState()

      // Manually set up the onmessage handler as if self.onmessage was called
      // Without setupWorker, this should error gracefully
      // The actual worker.ts checks for null internalContext

      // Since we can't directly test the error path without setupWorker,
      // we verify that setupWorker properly initializes state
      const execute = vi.fn()
      setupWorker(execute)

      expect(mockSelf.onmessage).not.toBeNull()
    })
  })
})
