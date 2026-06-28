import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileStorage } from '../src/storage/FileStorage'
import type { RoomSnapshot } from '../src/types'

describe('FileStorage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-store-fs-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const snap = (timestamp: number): RoomSnapshot => ({
    timestamp,
    state: { 'e1/Pos': { _exists: true, x: timestamp } },
    timestamps: { 'e1/Pos': { _exists: timestamp, x: timestamp } },
  })

  it('round-trips a snapshot', async () => {
    const fs = new FileStorage({ dir, roomId: 'room-1' })
    await fs.save(snap(3))
    expect(await fs.load()).toEqual(snap(3))
  })

  it('returns null when no file exists', async () => {
    expect(await new FileStorage({ dir, roomId: 'missing' }).load()).toBeNull()
  })

  it('returns null on a corrupt file', async () => {
    await writeFile(join(dir, 'corrupt.json'), '{ this is not json', 'utf-8')
    expect(await new FileStorage({ dir, roomId: 'corrupt' }).load()).toBeNull()
  })

  it('atomically replaces an existing snapshot and leaves no temp files', async () => {
    const fs = new FileStorage({ dir, roomId: 'room-1' })
    await fs.save(snap(1))
    await fs.save(snap(2))

    expect(await fs.load()).toEqual(snap(2))
    expect(await readdir(dir)).toEqual(['room-1.json'])
  })

  it('serializes concurrent saves; last issued wins, no temp files linger', async () => {
    const fs = new FileStorage({ dir, roomId: 'room-1' })
    // Saves are chained, so they apply in call order and the file is always one
    // complete, parseable snapshot — never a half-written mix or a lost rename.
    await Promise.all([fs.save(snap(1)), fs.save(snap(2)), fs.save(snap(3))])

    expect(await fs.load()).toEqual(snap(3))
    expect(await readdir(dir)).toEqual(['room-1.json'])
  })
})
