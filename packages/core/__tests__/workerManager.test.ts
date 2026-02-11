import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, field, World } from '../src/index'
import type { Context, ExecuteMessage, InitMessage, WorkerSuccessResponse, WorkerSystem } from '../src/types'
import { WorkerManager } from '../src/WorkerManager'

// Mock Worker class with configurable behavior
class MockWorker {
  static instances: MockWorker[] = []
  static defaultBehavior: 'success' | 'error' | 'error-message' | 'manual' = 'success'
  static manualResolvers: Array<() => void> = []

  url: string
  options: WorkerOptions | undefined
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private messageListeners: Array<(e: MessageEvent) => void> = []
  terminated = false

  constructor(url: string, options?: WorkerOptions) {
    this.url = url
    this.options = options
    MockWorker.instances.push(this)
  }

  postMessage(message: InitMessage | ExecuteMessage): void {
    if (this.terminated) return

    if (MockWorker.defaultBehavior === 'manual') {
      // Store resolver for manual control
      MockWorker.manualResolvers.push(() => {
        this.respondSuccess(message.threadIndex)
      })
      return
    }

    // Simulate async response
    setTimeout(() => {
      if (this.terminated) return

      if (MockWorker.defaultBehavior === 'error' && message.type === 'execute') {
        this.triggerError('Test error')
      } else if (MockWorker.defaultBehavior === 'error-message' && message.type === 'execute') {
        this.respondError(message.threadIndex, 'Execution failed')
      } else {
        this.respondSuccess(message.threadIndex)
      }
    }, 0)
  }

  respondSuccess(threadIndex: number): void {
    const response: WorkerSuccessResponse = {
      threadIndex,
      result: true,
    }
    const event = { data: response } as MessageEvent
    if (this.onmessage) {
      this.onmessage(event)
    }
    for (const listener of this.messageListeners) {
      listener(event)
    }
  }

  respondError(index: number, error: string): void {
    const response = { index, error }
    const event = { data: response } as MessageEvent
    if (this.onmessage) {
      this.onmessage(event)
    }
    for (const listener of this.messageListeners) {
      listener(event)
    }
  }

  triggerError(message: string): void {
    if (this.onerror) {
      // Create a simple error event object (ErrorEvent not available in Node)
      const errorEvent = {
        message,
        type: 'error',
      } as ErrorEvent
      this.onerror(errorEvent)
    }
  }

  addEventListener(type: string, listener: (e: MessageEvent) => void): void {
    if (type === 'message') {
      this.messageListeners.push(listener)
    }
  }

  removeEventListener(type: string, listener: (e: MessageEvent) => void): void {
    if (type === 'message') {
      const index = this.messageListeners.indexOf(listener)
      if (index > -1) {
        this.messageListeners.splice(index, 1)
      }
    }
  }

  terminate(): void {
    this.terminated = true
  }

  static reset(): void {
    MockWorker.instances = []
    MockWorker.defaultBehavior = 'success'
    MockWorker.manualResolvers = []
  }

  static resolveNext(): void {
    const resolver = MockWorker.manualResolvers.shift()
    if (resolver) resolver()
  }

  static resolveAll(): void {
    while (MockWorker.manualResolvers.length > 0) {
      MockWorker.resolveNext()
    }
  }
}

// Store original Worker
const OriginalWorker = globalThis.Worker

describe('WorkerManager', () => {
  let Position: ReturnType<typeof defineComponent>
  let Velocity: ReturnType<typeof defineComponent>
  let world: World
  let ctx: Context

  beforeEach(() => {
    // Reset mock workers
    MockWorker.reset()

    // Mock global Worker
    ;(globalThis as any).Worker = MockWorker

    // Define test components
    Position = defineComponent({
      x: field.float32().default(0),
      y: field.float32().default(0),
    })

    Velocity = defineComponent({
      dx: field.float32().default(0),
      dy: field.float32().default(0),
    })

    // Create world and context
    world = new World([Position, Velocity], { threads: 4 })
    ctx = world._getContext()
  })

  afterEach(() => {
    // Restore original Worker
    ;(globalThis as any).Worker = OriginalWorker
    MockWorker.reset()
  })

  describe('constructor', () => {
    it('should create a WorkerManager with specified max workers', () => {
      const manager = new WorkerManager(4)
      expect(manager).toBeDefined()
    })

    it('should create a WorkerManager with 1 worker', () => {
      const manager = new WorkerManager(1)
      expect(manager).toBeDefined()
    })
  })

  describe('execute', () => {
    it('should execute a worker system with 1 thread', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)

      // Should have created 1 worker
      expect(MockWorker.instances).toHaveLength(1)
      expect(MockWorker.instances[0].url).toBe('/test/worker.js')
    })

    it('should execute a worker system with multiple threads', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 3,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)

      // Should have created 3 workers
      expect(MockWorker.instances).toHaveLength(3)
    })

    it('should pass correct threadIndex and threadCount in init message', async () => {
      const manager = new WorkerManager(4)

      // Track init messages
      const initMessages: InitMessage[] = []
      const originalPostMessage = MockWorker.prototype.postMessage
      MockWorker.prototype.postMessage = function (this: MockWorker, message: InitMessage | ExecuteMessage) {
        if (message.type === 'init') {
          initMessages.push(message)
        }
        originalPostMessage.call(this, message)
      }

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 3,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)

      // Restore
      MockWorker.prototype.postMessage = originalPostMessage

      // Verify thread info was passed correctly
      expect(initMessages).toHaveLength(3)
      expect(initMessages[0].threadIndex).toBe(0)
      expect(initMessages[0].threadCount).toBe(3)
      expect(initMessages[1].threadIndex).toBe(1)
      expect(initMessages[1].threadCount).toBe(3)
      expect(initMessages[2].threadIndex).toBe(2)
      expect(initMessages[2].threadCount).toBe(3)
    })

    it('should reuse workers from pool on subsequent executions', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 2,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      // First execution
      await manager.execute(workerSystem, ctx)
      expect(MockWorker.instances).toHaveLength(2)

      // Second execution - should reuse existing workers
      await manager.execute(workerSystem, ctx)
      expect(MockWorker.instances).toHaveLength(2)
    })

    it('should create separate workers for different paths', async () => {
      const manager = new WorkerManager(4)

      const workerSystem1: WorkerSystem = {
        type: 'worker',
        path: '/test/worker1.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      const workerSystem2: WorkerSystem = {
        type: 'worker',
        path: '/test/worker2.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem1, ctx)
      await manager.execute(workerSystem2, ctx)

      // Should have created 2 different workers
      expect(MockWorker.instances).toHaveLength(2)
      expect(MockWorker.instances[0].url).toBe('/test/worker1.js')
      expect(MockWorker.instances[1].url).toBe('/test/worker2.js')
    })
  })

  describe('worker pool limiting', () => {
    it('should limit concurrent workers to maxWorkers', async () => {
      const manager = new WorkerManager(2)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 2, // Request exactly maxWorkers
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      // Execute - the manager should limit concurrent workers
      await manager.execute(workerSystem, ctx)

      // Only 2 workers should be created (maxWorkers limit)
      expect(MockWorker.instances).toHaveLength(2)
    })

    it('should throw error when threads exceed maxWorkers', async () => {
      const manager = new WorkerManager(2)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 4, // Request more than maxWorkers
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      // Should throw an error when threads exceed maxWorkers
      await expect(manager.execute(workerSystem, ctx)).rejects.toThrow(
        /Worker system requests 4 threads, but World was configured with only 2 max workers/,
      )
    })

    it('should queue tasks and process them when workers become available', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 2,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      // Execute twice - second should reuse workers from first
      await manager.execute(workerSystem, ctx)
      await manager.execute(workerSystem, ctx)

      // Workers should be reused, not new ones created
      expect(MockWorker.instances).toHaveLength(2)
    })
  })

  describe('dispose', () => {
    it('should terminate all workers on dispose', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 2,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)

      // Workers should be in the pool
      expect(MockWorker.instances).toHaveLength(2)
      expect(MockWorker.instances[0].terminated).toBe(false)
      expect(MockWorker.instances[1].terminated).toBe(false)

      // Dispose
      manager.dispose()

      // All workers should be terminated
      expect(MockWorker.instances[0].terminated).toBe(true)
      expect(MockWorker.instances[1].terminated).toBe(true)
    })

    it('should clear internal state on dispose', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 2,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)
      manager.dispose()

      // Create new workers after dispose - should work
      MockWorker.reset()
      ;(globalThis as any).Worker = MockWorker

      await manager.execute(workerSystem, ctx)

      // New workers should be created
      expect(MockWorker.instances).toHaveLength(2)
    })
  })

  describe('error handling', () => {
    it('should handle worker errors gracefully', async () => {
      MockWorker.defaultBehavior = 'error'

      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await expect(manager.execute(workerSystem, ctx)).rejects.toThrow()
    })

    it('should handle worker returning error in message', async () => {
      MockWorker.defaultBehavior = 'error-message'

      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await expect(manager.execute(workerSystem, ctx)).rejects.toThrow('Execution failed')
    })
  })

  describe('worker initialization', () => {
    it('should pass all required data in init message', async () => {
      const manager = new WorkerManager(4)

      let capturedInitMessage: InitMessage | null = null
      const originalPostMessage = MockWorker.prototype.postMessage
      MockWorker.prototype.postMessage = function (this: MockWorker, message: InitMessage | ExecuteMessage) {
        if (message.type === 'init') {
          capturedInitMessage = message
        }
        originalPostMessage.call(this, message)
      }

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)

      // Restore
      MockWorker.prototype.postMessage = originalPostMessage

      expect(capturedInitMessage).not.toBeNull()
      expect(capturedInitMessage!.type).toBe('init')
      expect(capturedInitMessage!.entitySAB).toBeDefined()
      expect(capturedInitMessage!.eventSAB).toBeDefined()
      expect(capturedInitMessage!.poolSAB).toBeDefined()
      expect(capturedInitMessage!.componentTransferMap).toBeDefined()
      expect(capturedInitMessage!.maxEntities).toBe(ctx.maxEntities)
      expect(capturedInitMessage!.maxEvents).toBe(ctx.maxEvents)
      expect(capturedInitMessage!.componentCount).toBe(ctx.componentCount)
      expect(capturedInitMessage!.threadIndex).toBe(0)
      expect(capturedInitMessage!.threadCount).toBe(1)

      // Check component transfer map has our components (uses numeric defId keys)
      expect(capturedInitMessage!.componentTransferMap[Position._defId]).toBeDefined()
      expect(capturedInitMessage!.componentTransferMap[Velocity._defId]).toBeDefined()
    })

    it('should only initialize worker once even if reused', async () => {
      const manager = new WorkerManager(4)

      let initCount = 0
      const originalPostMessage = MockWorker.prototype.postMessage
      MockWorker.prototype.postMessage = function (this: MockWorker, message: InitMessage | ExecuteMessage) {
        if (message.type === 'init') {
          initCount++
        }
        originalPostMessage.call(this, message)
      }

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      // Execute multiple times
      await manager.execute(workerSystem, ctx)
      await manager.execute(workerSystem, ctx)
      await manager.execute(workerSystem, ctx)

      // Restore
      MockWorker.prototype.postMessage = originalPostMessage

      // Worker should only be initialized once
      expect(initCount).toBe(1)
    })
  })

  describe('worker creation options', () => {
    it('should create workers with module type', async () => {
      const manager = new WorkerManager(4)

      const workerSystem: WorkerSystem = {
        type: 'worker',
        path: '/test/worker.js',
        threads: 1,
        priority: 'medium',
        prevEventIndex: 0,
        currEventIndex: 0,
      }

      await manager.execute(workerSystem, ctx)

      expect(MockWorker.instances[0].options).toEqual({ type: 'module' })
    })
  })
})
