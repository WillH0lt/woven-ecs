import type { AnyEditorComponentDef } from './EditorComponentDef'
import type { AnyEditorSingletonDef } from './EditorSingletonDef'
import type { ComponentData, Patch } from './types'

/**
 * Component/singleton data migration system.
 *
 * Migrations form a linear chain. Each component instance stores the name
 * of the last migration applied (`_version`). On load, all migrations
 * after the stored version are run in order.
 *
 * If a migration has a bug, add a new migration that corrects it.
 * If the buggy migration destroyed data, use `supersedes` to skip it
 * for data that hasn't reached it yet — the superseding migration
 * handles both paths via the `from` argument.
 */

export interface ComponentMigration {
  /** Unique name identifying this migration version. */
  name: string
  /**
   * Name of a prior migration this one replaces.
   * For data before the superseded migration, it is skipped entirely
   * and this migration's `upgrade` runs instead.
   * For data already at the superseded version, `upgrade` runs with
   * `from` set to the superseded name so it can handle the fix path.
   */
  supersedes?: string
  /** Transform component data from the previous version. */
  upgrade: (data: Record<string, unknown>, from: string | null) => Record<string, unknown>
}

export interface MigrationResult {
  data: Record<string, unknown>
  version: string | null
  changed: boolean
}

/**
 * Validate a migrations array for correctness.
 * Throws on duplicate names, missing supersede targets, or conflicts.
 */
export function validateMigrations(migrations: readonly ComponentMigration[]): void {
  const seen = new Set<string>()
  const supersededBy = new Map<string, string>()

  for (const m of migrations) {
    if (seen.has(m.name)) {
      throw new Error(`Duplicate migration name: "${m.name}"`)
    }
    seen.add(m.name)

    if (m.supersedes != null) {
      if (!seen.has(m.supersedes)) {
        throw new Error(
          `Migration "${m.name}" supersedes "${m.supersedes}", which ${
            migrations.some((o) => o.name === m.supersedes) ? 'must come before it' : 'does not exist'
          }`,
        )
      }
      if (supersededBy.has(m.supersedes)) {
        throw new Error(`Migration "${m.supersedes}" is already superseded by "${supersededBy.get(m.supersedes)}"`)
      }
      supersededBy.set(m.supersedes, m.name)
    }
  }
}

/**
 * Migrate all component entries in a patch that need upgrading.
 * Only processes full component adds (_exists: true), not partial
 * updates or deletions.
 *
 * Returns the same patch reference if nothing needed migration,
 * or a new patch object with migrated entries.
 */
export function migratePatch(
  patch: Patch,
  componentsByName: ReadonlyMap<string, AnyEditorComponentDef | AnyEditorSingletonDef>,
): Patch {
  let result: Patch | null = null

  for (const [key, value] of Object.entries(patch)) {
    if (value._exists !== true) continue

    const componentName = key.slice(key.indexOf('/') + 1)
    const def = componentsByName.get(componentName)
    if (!def || def.migrations.length === 0) continue

    const { _exists, _version, ...componentData } = value
    const migrationResult = migrateComponentData(componentData, _version ?? null, def.migrations)
    if (!migrationResult.changed) continue

    if (!result) result = { ...patch }
    result[key] = {
      ...migrationResult.data,
      _exists: true,
      _version: migrationResult.version,
    } as ComponentData
  }

  return result ?? patch
}

/**
 * Migrate component data from its current version through all
 * applicable migrations.
 *
 * Returns the upgraded data, the new version name, and whether
 * any migrations actually ran.
 */
export function migrateComponentData(
  data: Record<string, unknown>,
  currentVersion: string | null,
  migrations: readonly ComponentMigration[],
): MigrationResult {
  if (migrations.length === 0) {
    return { data, version: currentVersion, changed: false }
  }

  // Collect superseded migration names
  const superseded = new Set<string>()
  for (const m of migrations) {
    if (m.supersedes != null) {
      superseded.add(m.supersedes)
    }
  }

  // Find where to start
  let startIndex = 0
  if (currentVersion !== null) {
    const idx = migrations.findIndex((m) => m.name === currentVersion)
    if (idx === -1) {
      throw new Error(
        `Unknown migration version "${currentVersion}" — ` +
          `known versions: ${migrations.map((m) => `"${m.name}"`).join(', ')}`,
      )
    }
    startIndex = idx + 1
  }

  // Run applicable migrations, skipping superseded ones
  let result = data
  let version: string | null = currentVersion
  let changed = false

  for (let i = startIndex; i < migrations.length; i++) {
    const migration = migrations[i]
    if (superseded.has(migration.name)) {
      continue
    }
    result = migration.upgrade(result, version)
    version = migration.name
    changed = true
  }

  return { data: result, version, changed }
}
