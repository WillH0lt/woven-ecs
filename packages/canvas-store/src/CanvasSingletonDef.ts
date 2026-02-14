import { type ComponentSchema, type Context, SingletonDef } from '@woven-ecs/core'
import { type ComponentMigration, validateMigrations } from './migrations'
import type { InferCanvasComponentType, SyncBehavior } from './types'

export type SingletonSyncBehavior = Exclude<SyncBehavior, 'ephemeral'>

/**
 * A canvas-aware singleton definition with sync behavior metadata.
 * Created via `defineCanvasSingleton()`.
 */
export class CanvasSingletonDef<T extends ComponentSchema, N extends string = string> extends SingletonDef<T> {
  /**
   * Stable identifier for storage and sync.
   * Use this instead of `_defId` for persistence keys.
   */
  readonly name: N

  /** Sync-specific metadata */
  readonly sync: SingletonSyncBehavior

  /** Ordered migration chain for this singleton's persisted data. */
  readonly migrations: readonly ComponentMigration[]

  /**
   * Fields to exclude from undo/redo history.
   * Changes to these fields won't be recorded in history and won't be affected by undo/redo.
   */
  readonly excludeFromHistory: readonly string[]

  /** Version name of the latest migration, or null if none. */
  get currentVersion(): string | null {
    return this.migrations.length > 0 ? this.migrations[this.migrations.length - 1].name : null
  }

  constructor(
    options: {
      name: N
      sync?: SingletonSyncBehavior
      migrations?: ComponentMigration[]
      excludeFromHistory?: string[]
    },
    schema: T,
  ) {
    super(schema)
    this.name = options.name
    this.sync = options.sync ?? 'none'
    this.migrations = options.migrations ?? []
    this.excludeFromHistory = options.excludeFromHistory ?? []
    if (this.migrations.length > 0) {
      validateMigrations(this.migrations)
    }
  }

  override default(): InferCanvasComponentType<T> {
    const data = super.default()
    return {
      ...data,
      _exists: true as const,
      _version: this.currentVersion,
    }
  }

  override snapshot(ctx: Context): InferCanvasComponentType<T> {
    const data = super.snapshot(ctx)
    return {
      ...data,
      _exists: true as const,
      _version: this.currentVersion,
    }
  }
}

/** Any canvas singleton definition */
export type AnyCanvasSingletonDef = CanvasSingletonDef<any>

/**
 * Define an canvas singleton with a stable name for storage.
 *
 * @param options - Singleton options (name, sync behavior)
 * @param schema - Singleton schema built using field builders
 * @returns An CanvasSingletonDef descriptor
 *
 * @example
 * ```typescript
 * export const Camera = defineCanvasSingleton(
 *   { name: "camera" },
 *   {
 *     left: field.float64().default(0),
 *     top: field.float64().default(0),
 *     zoom: field.float64().default(1),
 *   },
 * );
 * ```
 */
export function defineCanvasSingleton<N extends string, T extends ComponentSchema>(
  options: {
    name: N
    sync?: SingletonSyncBehavior
    migrations?: ComponentMigration[]
    excludeFromHistory?: string[]
  },
  schema: T,
): CanvasSingletonDef<T, N> {
  return new CanvasSingletonDef(options, schema)
}
