import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoomSnapshot } from '../types'
import type { Storage } from './Storage'

export interface FileStorageOptions {
  dir: string
  roomId: string
}

/**
 * Saves snapshots as JSON files. Simple, good for prototyping.
 */
export class FileStorage implements Storage {
  private filePath: string
  private dir: string

  /**
   * Serializes saves so their temp-write → rename steps can't overlap. The room
   * issues saves fire-and-forget (a throttled flush plus one on close), so two
   * can be in flight at once; concurrent renames onto the same target race (and
   * on Windows intermittently fail). Chaining keeps them ordered, so the last
   * save issued is the last one written.
   */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: FileStorageOptions) {
    this.dir = options.dir
    this.filePath = join(options.dir, `${options.roomId}.json`)
  }

  async load(): Promise<RoomSnapshot | null> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data) as RoomSnapshot
    } catch {
      return null
    }
  }

  async save(snapshot: RoomSnapshot): Promise<void> {
    const run = this.writeChain.then(() => this.writeAtomic(snapshot))
    // Keep the chain alive even if this write rejects, but still surface the
    // error to this caller.
    this.writeChain = run.catch(() => {
      // no-op
    })
    return run
  }

  /**
   * Write to a unique temp file, then atomically rename it over the target.
   * A plain writeFile can leave a half-written, unparseable file if the process
   * dies mid-write — and load() treats a parse failure as "no state", resetting
   * the whole room to empty. rename(2) is atomic on the same filesystem, so a
   * reader always sees either the previous complete snapshot or the new one.
   */
  private async writeAtomic(snapshot: RoomSnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmpPath = `${this.filePath}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(tmpPath, JSON.stringify(snapshot), 'utf-8')
      await rename(tmpPath, this.filePath)
    } catch (err) {
      // Best-effort cleanup so a failed write doesn't leave a temp file behind.
      await unlink(tmpPath).catch(() => {
        // no-op
      })
      throw err
    }
  }
}
