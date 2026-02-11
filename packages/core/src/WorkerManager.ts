import type { WorkerSystem } from './System'
import type { ComponentTransferMap, Context, ExecuteMessage, InitMessage, WorkerOutgoingMessage } from './types'

/**
 * WorkerManager - manages a pool of web workers for parallel execution
 */
export class WorkerManager {
  private maxWorkers: number
  private workerPool: Map<string, Worker[]> = new Map()
  private initializedWorkers: Set<Worker> = new Set()
  private taskQueue: Map<string, Array<(worker: Worker) => void>> = new Map()
  private busyWorkers = 0

  /**
   * Create a new WorkerManager instance
   * @param maxWorkers - Maximum number of workers to use (defaults to hardware concurrency)
   */
  constructor(maxWorkers: number) {
    this.maxWorkers = maxWorkers
  }

  /**
   * Execute a system in parallel using web workers
   * @param workerPath - Path to the worker file
   * @param batches - Number of parallel batches to run (default: 4)
   * @param entityBuffer - Optional entity buffer to pass to workers
   * @param components - Components registry to pass to workers
   * @param data - Optional data to pass to each worker
   * @returns Promise that resolves when all batches complete
   */
  async execute(workerSystem: WorkerSystem, ctx: Context, currEventIndex: number): Promise<void> {
    const promises = []
    const threads = workerSystem.threads

    if (threads > this.maxWorkers) {
      throw new Error(
        `Worker system requests ${threads} threads, but World was configured with only ${this.maxWorkers} max workers. ` +
          `Increase the 'threads' option in World constructor or reduce the worker system's thread count.`,
      )
    }

    // Execute tasks (workers will be initialized on-demand)
    for (let i = 0; i < threads; i++) {
      promises.push(this.executeTask(ctx, workerSystem.path, i, threads, currEventIndex))
    }

    await Promise.all(promises)
  }

  /**
   * Initialize a worker with the entity buffer
   * @param worker - The worker to initialize
   * @param index - Index of this worker
   * @param entityBuffer - Optional entity buffer to pass
   * @returns Promise that resolves when initialization is complete
   */
  private async initializeWorker(
    ctx: Context,
    worker: Worker,
    threadIndex: number,
    threadCount: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${threadIndex} initialization timed out`))
      }, 5000) // 5 second timeout

      const messageHandler = (e: MessageEvent<WorkerOutgoingMessage>) => {
        if (e.data.threadIndex === threadIndex) {
          clearTimeout(timeout)
          worker.removeEventListener('message', messageHandler)

          if ('error' in e.data) {
            reject(new Error(e.data.error))
          } else {
            resolve()
          }
        }
      }

      worker.addEventListener('message', messageHandler)

      // Serialize component metadata and buffers for reconstruction in worker
      const componentTransferMap: ComponentTransferMap = {}
      for (const [defId, component] of Object.entries(ctx.components)) {
        componentTransferMap[Number(defId)] = {
          componentId: component.componentId,
          buffer: component.buffer, // Transfer the SharedArrayBuffer-backed typed arrays
          schema: component.schema,
          isSingleton: component.isSingleton,
        }
      }

      // Send initialization message with shared buffers
      const initMessage: InitMessage = {
        type: 'init',
        entitySAB: ctx.entityBuffer.getBuffer() as SharedArrayBuffer,
        eventSAB: ctx.eventBuffer.getBuffer() as SharedArrayBuffer,
        poolSAB: ctx.pool.getBuffer(),
        poolBucketCount: ctx.pool.getBucketCount(),
        poolSize: ctx.pool.getSize(),
        componentTransferMap,
        maxEntities: ctx.maxEntities,
        maxEvents: ctx.maxEvents,
        componentCount: ctx.componentCount,
        threadIndex,
        threadCount,
      }
      worker.postMessage(initMessage)
    })
  }

  /**
   * Execute a single task on a worker
   * @param workerPath - Path to the worker file
   * @param index - Index of this task
   * @param data - Optional data to pass to the worker
   * @returns Promise that resolves with the task result
   */
  private async executeTask(
    ctx: Context,
    workerPath: string,
    threadIndex: number,
    threadCount: number,
    currEventIndex: number,
  ): Promise<any> {
    const worker = await this.getWorker(workerPath)

    // Initialize worker if not already initialized
    if (!this.initializedWorkers.has(worker)) {
      await this.initializeWorker(ctx, worker, threadIndex, threadCount)
      this.initializedWorkers.add(worker)
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        this.removeWorker(workerPath, worker)
        reject(new Error(`Task ${threadIndex} timed out`))
      }, 5000) // 5 second timeout

      worker.onmessage = (e: MessageEvent<WorkerOutgoingMessage>) => {
        clearTimeout(timeout)

        if ('error' in e.data) {
          reject(new Error(e.data.error))
        } else {
          resolve(true)
        }

        this.releaseWorker(workerPath, worker)
      }

      worker.onerror = (error: ErrorEvent) => {
        clearTimeout(timeout)
        reject(error)
        // this.releaseWorker(workerPath, worker);
        this.removeWorker(workerPath, worker)
      }

      // Send the task to the worker
      const executeMessage: ExecuteMessage = {
        type: 'execute',
        threadIndex,
        currEventIndex,
      }
      worker.postMessage(executeMessage)
    })
  }

  /**
   * Get a worker from the pool or create a new one
   * @param workerPath - Path to the worker file
   * @returns Promise that resolves with a worker
   */
  private async getWorker(workerPath: string): Promise<Worker> {
    // Get or create pool for this worker path
    let pool = this.workerPool.get(workerPath)
    if (!pool) {
      pool = []
      this.workerPool.set(workerPath, pool)
    }

    // If we have idle workers for this path, reuse them
    if (pool.length > 0) {
      this.busyWorkers++
      return pool.pop()!
    }

    // If we're at max busy capacity, wait for a worker to become available
    if (this.busyWorkers >= this.maxWorkers) {
      return new Promise<Worker>((resolve) => {
        let queue = this.taskQueue.get(workerPath)
        if (!queue) {
          queue = []
          this.taskQueue.set(workerPath, queue)
        }
        queue.push(resolve)
      })
    }

    // Create a new worker
    this.busyWorkers++
    return this.createWorker(workerPath)
  }

  /**
   * Create a new web worker from a file path
   * @param workerPath - Path to the worker file
   * @returns A new Worker instance
   */
  private createWorker(workerPath: string): Worker {
    return new Worker(workerPath, { type: 'module' })
  }

  /**
   * Release a worker back to the pool or assign it to a queued task
   * @param workerPath - Path to the worker file
   * @param worker - The worker to release
   */
  private releaseWorker(workerPath: string, worker: Worker): void {
    // If there are queued tasks for this worker path, assign this worker to them
    // (worker stays busy, no change to busyWorkers count)
    const queue = this.taskQueue.get(workerPath)
    if (queue && queue.length > 0) {
      const resolveWithWorker = queue.shift()
      if (resolveWithWorker) {
        resolveWithWorker(worker)
        return
      }
    }

    // Check if there are queued tasks for other worker paths
    for (const [otherPath, otherQueue] of this.taskQueue.entries()) {
      if (otherPath !== workerPath && otherQueue.length > 0) {
        // Return this worker to its pool (becomes idle)
        const pool = this.workerPool.get(workerPath)
        if (pool) {
          pool.push(worker)
        }
        // Worker is now idle, decrement busy count
        this.busyWorkers--

        // Get or create a worker for the waiting task
        let otherPool = this.workerPool.get(otherPath)
        if (!otherPool) {
          otherPool = []
          this.workerPool.set(otherPath, otherPool)
        }

        const resolveWithWorker = otherQueue.shift()
        if (resolveWithWorker) {
          if (otherPool.length > 0) {
            // Reuse existing idle worker for other path
            this.busyWorkers++
            resolveWithWorker(otherPool.pop()!)
          } else {
            // Create new worker for other path
            this.busyWorkers++
            const newWorker = this.createWorker(otherPath)
            resolveWithWorker(newWorker)
          }
        }
        return
      }
    }

    // No queued tasks, return worker to pool (becomes idle)
    this.busyWorkers--
    const pool = this.workerPool.get(workerPath)
    if (pool) {
      pool.push(worker)
    }
  }

  /**
   * Remove a worker from the pool and decrement busy worker count
   * @param workerPath - Path to the worker file
   * @param worker - The worker to remove
   */
  private removeWorker(workerPath: string, worker: Worker): void {
    this.busyWorkers--
    this.initializedWorkers.delete(worker)
    const pool = this.workerPool.get(workerPath)
    if (pool) {
      const index = pool.indexOf(worker)
      if (index > -1) {
        pool.splice(index, 1)
      }
    }
  }

  /**
   * Dispose of the worker manager and terminate all workers
   */
  dispose(): void {
    // Terminate all workers in all pools
    for (const pool of this.workerPool.values()) {
      for (const worker of pool) {
        worker.terminate()
      }
    }
    this.workerPool.clear()
    this.initializedWorkers.clear()
    this.busyWorkers = 0
    this.taskQueue.clear()
  }
}
