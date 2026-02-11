import { describe, expect, it } from 'vitest'
import { type ComponentMigration, migrateComponentData, migratePatch, validateMigrations } from '../src/migrations'
import type { Patch } from '../src/types'

describe('validateMigrations', () => {
  it('accepts an empty array', () => {
    expect(() => validateMigrations([])).not.toThrow()
  })

  it('accepts a valid chain', () => {
    expect(() =>
      validateMigrations([
        { name: 'a', upgrade: (d) => d },
        { name: 'b', upgrade: (d) => d },
      ]),
    ).not.toThrow()
  })

  it('rejects duplicate names', () => {
    expect(() =>
      validateMigrations([
        { name: 'a', upgrade: (d) => d },
        { name: 'a', upgrade: (d) => d },
      ]),
    ).toThrow('Duplicate migration name: "a"')
  })

  it('rejects superseding a migration that does not exist', () => {
    expect(() => validateMigrations([{ name: 'a', supersedes: 'nope', upgrade: (d) => d }])).toThrow('does not exist')
  })

  it('rejects superseding a migration that comes after', () => {
    expect(() =>
      validateMigrations([
        { name: 'a', supersedes: 'b', upgrade: (d) => d },
        { name: 'b', upgrade: (d) => d },
      ]),
    ).toThrow('must come before it')
  })

  it('rejects double-supersede of the same migration', () => {
    expect(() =>
      validateMigrations([
        { name: 'a', upgrade: (d) => d },
        { name: 'b', supersedes: 'a', upgrade: (d) => d },
        { name: 'c', supersedes: 'a', upgrade: (d) => d },
      ]),
    ).toThrow('already superseded by "b"')
  })

  it('accepts a valid supersede', () => {
    expect(() =>
      validateMigrations([
        { name: 'a', upgrade: (d) => d },
        { name: 'b', supersedes: 'a', upgrade: (d) => d },
      ]),
    ).not.toThrow()
  })
})

describe('migrateComponentData', () => {
  it('returns data unchanged when there are no migrations', () => {
    const data = { x: 1 }
    const result = migrateComponentData(data, null, [])
    expect(result).toEqual({ data: { x: 1 }, version: null, changed: false })
    expect(result.data).toBe(data) // same reference
  })

  it('runs a single migration from null version', () => {
    const migrations: ComponentMigration[] = [{ name: 'add_y', upgrade: (d) => ({ ...d, y: 0 }) }]
    const result = migrateComponentData({ x: 1 }, null, migrations)
    expect(result).toEqual({
      data: { x: 1, y: 0 },
      version: 'add_y',
      changed: true,
    })
  })

  it('runs multiple migrations in order', () => {
    const migrations: ComponentMigration[] = [
      { name: 'add_y', upgrade: (d) => ({ ...d, y: 0 }) },
      { name: 'add_z', upgrade: (d) => ({ ...d, z: 0 }) },
    ]
    const result = migrateComponentData({ x: 1 }, null, migrations)
    expect(result).toEqual({
      data: { x: 1, y: 0, z: 0 },
      version: 'add_z',
      changed: true,
    })
  })

  it('skips migrations already applied', () => {
    const migrations: ComponentMigration[] = [
      { name: 'add_y', upgrade: (d) => ({ ...d, y: 0 }) },
      { name: 'add_z', upgrade: (d) => ({ ...d, z: 0 }) },
    ]
    const result = migrateComponentData({ x: 1, y: 5 }, 'add_y', migrations)
    expect(result).toEqual({
      data: { x: 1, y: 5, z: 0 },
      version: 'add_z',
      changed: true,
    })
  })

  it('returns unchanged when already at latest version', () => {
    const data = { x: 1 }
    const migrations: ComponentMigration[] = [{ name: 'add_y', upgrade: (d) => ({ ...d, y: 0 }) }]
    const result = migrateComponentData(data, 'add_y', migrations)
    expect(result).toEqual({
      data: { x: 1 },
      version: 'add_y',
      changed: false,
    })
    expect(result.data).toBe(data)
  })

  it('throws on unknown version', () => {
    const migrations: ComponentMigration[] = [{ name: 'a', upgrade: (d) => d }]
    expect(() => migrateComponentData({}, 'nope', migrations)).toThrow('Unknown migration version "nope"')
  })

  it("passes 'from' to each upgrade function", () => {
    const fromValues: (string | null)[] = []
    const migrations: ComponentMigration[] = [
      {
        name: 'a',
        upgrade: (d, from) => {
          fromValues.push(from)
          return d
        },
      },
      {
        name: 'b',
        upgrade: (d, from) => {
          fromValues.push(from)
          return d
        },
      },
    ]
    migrateComponentData({}, null, migrations)
    expect(fromValues).toEqual([null, 'a'])
  })

  // --- supersede tests ---

  describe('supersedes', () => {
    // Migrations: [A, B(buggy), C(supersedes B), D]
    const migrations: ComponentMigration[] = [
      { name: 'A', upgrade: (d) => ({ ...d, a: true }) },
      {
        name: 'B',
        upgrade: (d) => ({ ...d, label: undefined }), // buggy: drops label
      },
      {
        name: 'C',
        supersedes: 'B',
        upgrade: (d, from) => {
          if (from === 'B') {
            // Fix: data already lost label, set default
            return { ...d, label: d.label ?? 'default', b: true }
          }
          // Fresh path: data still has label, just add the field
          return { ...d, b: true }
        },
      },
      { name: 'D', upgrade: (d) => ({ ...d, d: true }) },
    ]

    it('skips superseded migration for unversioned data', () => {
      const result = migrateComponentData({ label: 'hello' }, null, migrations)
      // A runs, B skipped, C runs (from=A), D runs
      expect(result.data).toEqual({
        label: 'hello',
        a: true,
        b: true,
        d: true,
      })
      expect(result.version).toBe('D')
    })

    it('skips superseded migration for data at A', () => {
      const result = migrateComponentData({ label: 'hello', a: true }, 'A', migrations)
      // B skipped, C runs (from=A), D runs
      expect(result.data).toEqual({
        label: 'hello',
        a: true,
        b: true,
        d: true,
      })
      expect(result.version).toBe('D')
    })

    it('runs superseding migration for data at superseded version', () => {
      const result = migrateComponentData({ a: true, label: undefined }, 'B', migrations)
      // C runs (from=B, fix path), D runs
      expect(result.data).toEqual({
        a: true,
        label: 'default',
        b: true,
        d: true,
      })
      expect(result.version).toBe('D')
    })

    it('skips both superseded and superseding when already past them', () => {
      const result = migrateComponentData({ a: true, b: true, label: 'ok' }, 'C', migrations)
      // Only D runs
      expect(result.data).toEqual({
        a: true,
        b: true,
        label: 'ok',
        d: true,
      })
      expect(result.version).toBe('D')
    })

    it('returns unchanged when already at latest', () => {
      const data = { a: true, b: true, d: true, label: 'ok' }
      const result = migrateComponentData(data, 'D', migrations)
      expect(result.changed).toBe(false)
      expect(result.data).toBe(data)
    })
  })
})

describe('migratePatch', () => {
  const componentsByName = new Map([
    [
      'Position',
      {
        migrations: [
          { name: 'add_z', upgrade: (d: Record<string, unknown>) => ({ ...d, z: 0 }) },
          { name: 'add_w', upgrade: (d: Record<string, unknown>) => ({ ...d, w: 1 }) },
        ],
      },
    ],
  ])

  it('returns same reference when no migrations needed', () => {
    const patch: Patch = {
      'e1/Position': { _exists: true, _version: 'add_w', x: 1 },
    }
    const result = migratePatch(patch, componentsByName)
    expect(result).toBe(patch)
  })

  it('returns same reference when no matching component defs', () => {
    const patch: Patch = {
      'e1/Velocity': { _exists: true, vx: 1 },
    }
    const result = migratePatch(patch, componentsByName)
    expect(result).toBe(patch)
  })

  it('migrates a component from null version', () => {
    const patch: Patch = {
      'e1/Position': { _exists: true, x: 10, y: 20 },
    }
    const result = migratePatch(patch, componentsByName)

    expect(result).not.toBe(patch)
    expect(result['e1/Position']).toEqual({
      _exists: true,
      _version: 'add_w',
      x: 10,
      y: 20,
      z: 0,
      w: 1,
    })
  })

  it('migrates a component from an older version', () => {
    const patch: Patch = {
      'e1/Position': { _exists: true, _version: 'add_z', x: 1, z: 5 },
    }
    const result = migratePatch(patch, componentsByName)

    expect(result).not.toBe(patch)
    expect(result['e1/Position']).toEqual({
      _exists: true,
      _version: 'add_w',
      x: 1,
      z: 5,
      w: 1,
    })
  })

  it('skips deletions', () => {
    const patch: Patch = {
      'e1/Position': { _exists: false },
    }
    const result = migratePatch(patch, componentsByName)
    expect(result).toBe(patch)
  })

  it('skips partial updates (no _exists)', () => {
    const patch: Patch = {
      'e1/Position': { x: 50 },
    }
    const result = migratePatch(patch, componentsByName)
    expect(result).toBe(patch)
  })

  it('handles mixed patch — only migrates entries that need it', () => {
    const patch: Patch = {
      'e1/Position': { _exists: true, x: 1 }, // needs migration
      'e2/Velocity': { _exists: true, vx: 5 }, // no migrations defined
      'e3/Position': { _exists: true, _version: 'add_w', x: 9 }, // already current
      'e4/Position': { _exists: false }, // deletion
    }
    const result = migratePatch(patch, componentsByName)

    expect(result).not.toBe(patch)
    // Only e1/Position migrated
    expect(result['e1/Position']).toEqual({
      _exists: true,
      _version: 'add_w',
      x: 1,
      z: 0,
      w: 1,
    })
    // Others unchanged
    expect(result['e2/Velocity']).toEqual({ _exists: true, vx: 5 })
    expect(result['e3/Position']).toEqual({
      _exists: true,
      _version: 'add_w',
      x: 9,
    })
    expect(result['e4/Position']).toEqual({ _exists: false })
  })
})
