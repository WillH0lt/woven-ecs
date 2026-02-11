import type { SystemFunction, WorkerPriority, WorkerSystemOptions } from './types'

/** Base class for all systems */
export abstract class BaseSystem {
  private static systemCounter = 0

  /** Unique system ID */
  readonly id: number

  /** System type discriminator */
  abstract readonly type: 'main' | 'worker'

  constructor() {
    this.id = BaseSystem.systemCounter++
  }
}

/** Main thread system (created via defineSystem) */
export class MainThreadSystem extends BaseSystem {
  readonly type = 'main' as const
  readonly execute: SystemFunction

  constructor(execute: SystemFunction) {
    super()
    this.execute = execute
  }
}

/** Worker system (created via defineWorkerSystem) */
export class WorkerSystem extends BaseSystem {
  readonly type = 'worker' as const
  readonly path: string
  readonly threads: number
  readonly priority: WorkerPriority

  constructor(path: string, options: WorkerSystemOptions = {}) {
    super()
    this.path = path
    this.threads = options.threads ?? 1
    this.priority = options.priority ?? 'medium'
  }
}

/**
 * Define a system that runs on the main thread
 * @param execute - System execution function
 * @returns MainThreadSystem instance
 * @example
 * ```typescript
 * const movementSystem = defineSystem((ctx) => {
 *   for (const eid of query(ctx, (q) => q.with(Position, Velocity))) {
 *     const pos = Position.write(ctx, eid);
 *     const vel = Velocity.read(ctx, eid);
 *     pos.x += vel.x;
 *     pos.y += vel.y;
 *   }
 * });
 * ```
 */
export function defineSystem(execute: SystemFunction): MainThreadSystem {
  return new MainThreadSystem(execute)
}

/**
 * Define a system that runs in web workers.
 * Worker file must use setupWorker() to define its execution logic.
 * @param workerPath - Path to worker file (use new URL('./worker.ts', import.meta.url).href)
 * @param options - Worker configuration
 * @returns WorkerSystem instance
 * @example
 * ```typescript
 * const physicsSystem = defineWorkerSystem(
 *   new URL('./physicsWorker.ts', import.meta.url).href,
 *   { threads: 4, priority: 'high' }
 * );
 * ```
 */
export function defineWorkerSystem(path: string, options: WorkerSystemOptions = {}): WorkerSystem {
  return new WorkerSystem(path, options)
}

/** Union of all system types */
export type System = MainThreadSystem | WorkerSystem
