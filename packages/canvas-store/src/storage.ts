import { type IDBPDatabase, openDB } from 'idb'

const DEFAULT_FLUSH_INTERVAL_MS = 1000

export interface KeyValueStoreOptions {
  /**
   * Interval in ms between flushing pending writes to IndexedDB.
   * Set to 0 for immediate writes (no buffering).
   * Default: 1000
   */
  flushIntervalMs?: number
}

/**
 * Open (or create) a named IndexedDB database with a single object store
 * and return a lightweight key-value wrapper around it.
 */
export async function openStore(
  dbName: string,
  storeName: string,
  options?: KeyValueStoreOptions,
): Promise<KeyValueStore> {
  const db = await openDB(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName)
      }
    },
  })
  return new KeyValueStore(db, storeName, options)
}

type PendingOp = { type: 'put'; value: unknown } | { type: 'delete' }

/**
 * Thin key-value wrapper around a single IDBObjectStore.
 *
 * Writes (`put` / `delete`) are buffered in memory and flushed to
 * IndexedDB in a single transaction once per second.  Multiple writes
 * to the same key between flushes collapse into one operation, so
 * high-frequency callers (e.g. 60 fps mutations) only ever produce a
 * single IndexedDB write per interval.
 *
 * Reads (`get` / `getAllEntries`) check the pending buffer first so
 * callers always see the latest value.
 */
export class KeyValueStore {
  private pending = new Map<string, PendingOp>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushIntervalMs: number

  constructor(
    private db: IDBPDatabase,
    private storeName: string,
    options?: KeyValueStoreOptions,
  ) {
    this.flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
  }

  async get<T>(key: string): Promise<T | undefined> {
    const op = this.pending.get(key)
    if (op) {
      return op.type === 'put' ? (op.value as T) : undefined
    }
    return this.db.get(this.storeName, key)
  }

  put(key: string, value: unknown): void {
    this.pending.set(key, { type: 'put', value })
    this.scheduleFlush()
  }

  delete(key: string): void {
    this.pending.set(key, { type: 'delete' })
    this.scheduleFlush()
  }

  async getAllEntries(): Promise<[string, unknown][]> {
    const tx = this.db.transaction(this.storeName, 'readonly')
    const store = tx.objectStore(this.storeName)
    const keys = await store.getAllKeys()
    const values = await store.getAll()
    const result = new Map<string, unknown>()

    for (let i = 0; i < keys.length; i++) {
      result.set(keys[i] as string, values[i])
    }

    // Layer pending ops on top
    for (const [key, op] of this.pending) {
      if (op.type === 'put') {
        result.set(key, op.value)
      } else {
        result.delete(key)
      }
    }

    return Array.from(result.entries())
  }

  async clear(): Promise<void> {
    this.pending.clear()
    this.cancelFlush()
    const tx = this.db.transaction(this.storeName, 'readwrite')
    tx.objectStore(this.storeName).clear()
    await tx.done
  }

  close(): void {
    this.flushSync()
    this.db.close()
  }

  // --- Internal ---

  private scheduleFlush(): void {
    // Immediate mode: flush synchronously
    if (this.flushIntervalMs === 0) {
      this.flush().catch(console.error)
      return
    }

    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush().catch(console.error)
    }, this.flushIntervalMs)
  }

  private cancelFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Flush all pending writes in one transaction (fire-and-forget).
   */
  private async flush(): Promise<void> {
    if (this.pending.size === 0) return

    const ops = new Map(this.pending)
    this.pending.clear()

    const tx = this.db.transaction(this.storeName, 'readwrite')
    const store = tx.objectStore(this.storeName)

    for (const [key, op] of ops) {
      if (op.type === 'put') {
        store.put(op.value, key)
      } else {
        store.delete(key)
      }
    }

    await tx.done
  }

  /**
   * Best-effort synchronous flush on close — kicks off the write but
   * cannot await it since close() is synchronous.
   */
  private flushSync(): void {
    this.cancelFlush()
    if (this.pending.size === 0) return
    this.flush().catch(console.error)
  }
}
