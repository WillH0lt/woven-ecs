import { type ComponentSchema, type Context, SingletonDef } from '@woven-ecs/core'
import { type ComponentMigration, validateMigrations } from './migrations'
import type { InferEditorComponentType, SyncBehavior } from './types'

export type SingletonEditorBehavior = Exclude<SyncBehavior, 'ephemeral'>

/**
 * An editor-aware singleton definition with sync behavior metadata.
 * Created via `defineEditorSingleton()`.
 */
export class EditorSingletonDef<T extends ComponentSchema, N extends string = string> extends SingletonDef<T> {
  /**
   * Stable identifier for storage and sync.
   * Use this instead of `_defId` for persistence keys.
   */
  readonly name: N

  /** Sync-specific metadata */
  readonly sync: SingletonEditorBehavior

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
      sync?: SingletonEditorBehavior
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

  override default(): InferEditorComponentType<T> {
    const data = super.default()
    return {
      ...data,
      _exists: true as const,
      _version: this.currentVersion,
    }
  }

  override snapshot(ctx: Context): InferEditorComponentType<T> {
    const data = super.snapshot(ctx)
    return {
      ...data,
      _exists: true as const,
      _version: this.currentVersion,
    }
  }
}

/** Any editor singleton definition */
export type AnyEditorSingletonDef = EditorSingletonDef<any>

/**
 * Define an editor singleton with a stable name for storage.
 *
 * @param options - Singleton options (name, sync behavior)
 * @param schema - Singleton schema built using field builders
 * @returns An EditorSingletonDef descriptor
 *
 * @example
 * ```typescript
 * export const Camera = defineEditorSingleton(
 *   { name: "camera" },
 *   {
 *     left: field.float64().default(0),
 *     top: field.float64().default(0),
 *     zoom: field.float64().default(1),
 *   },
 * );
 * ```
 */
export function defineEditorSingleton<N extends string, T extends ComponentSchema>(
  options: {
    name: N
    sync?: SingletonEditorBehavior
    migrations?: ComponentMigration[]
    excludeFromHistory?: string[]
  },
  schema: T,
): EditorSingletonDef<T, N> {
  return new EditorSingletonDef(options, schema)
}
