import { ComponentDef, type ComponentSchema, type Context, type EntityId } from '@woven-ecs/core'
import { type ComponentMigration, validateMigrations } from './migrations'
import type { InferCanvasComponentType, SyncBehavior } from './types'

/**
 * A canvas-aware component definition with sync behavior metadata.
 * Created via `defineCanvasComponent()`.
 *
 * Entity identity is stored in the Synced component's `id` field.
 */
export class CanvasComponentDef<T extends ComponentSchema, N extends string = string> extends ComponentDef<T> {
  /**
   * Stable identifier for storage and sync.
   * Use this instead of `_defId` for persistence keys.
   */
  readonly name: N

  /** Sync-specific metadata */
  readonly sync: SyncBehavior

  /** Ordered migration chain for this component's persisted data. */
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
      sync?: SyncBehavior
      migrations?: ComponentMigration[]
      excludeFromHistory?: string[]
    },
    schema: T,
  ) {
    super(schema, false)
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

  override snapshot(ctx: Context, entityId: EntityId): InferCanvasComponentType<T> {
    const data = super.snapshot(ctx, entityId)
    return {
      ...data,
      _exists: true as const,
      _version: this.currentVersion,
    }
  }
}

/** Any canvas component definition */
export type AnyCanvasComponentDef = CanvasComponentDef<any>

/**
 * Define a canvas component with a stable name.
 *
 * Entity identity is stored in the Synced component's `id` field.
 * Add Synced to any entity you want persisted/synced.
 *
 * @param options - Component options (name, sync behavior)
 * @param schema - Component schema
 * @returns  CanvasComponentDef descriptor
 *
 * @example
 * ```typescript
 * export const Shape = defineCanvasComponent(
 *   { name: "shapes", sync: "document" },
 *   {
 *     position: field.tuple(field.float64(), 2).default([0, 0]),
 *     size: field.tuple(field.float64(), 2).default([50, 50]),
 *     color: field.string().max(16).default("#0f3460"),
 *   },
 * );
 * ```
 */
export function defineCanvasComponent<N extends string, T extends ComponentSchema>(
  options: {
    name: N
    sync?: SyncBehavior
    migrations?: ComponentMigration[]
    excludeFromHistory?: string[]
  },
  schema: T,
): CanvasComponentDef<T, N> {
  return new CanvasComponentDef(options, schema)
}
