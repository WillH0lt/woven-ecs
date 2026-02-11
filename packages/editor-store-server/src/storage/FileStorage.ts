import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.filePath, JSON.stringify(snapshot), 'utf-8')
  }
}
