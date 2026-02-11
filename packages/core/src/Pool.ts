// Atomic index pool for entity ID allocation across threads
// Uses SharedArrayBuffer and Atomics for thread-safe operations

const BufferConstructor: new (byteLength: number) => SharedArrayBuffer =
  typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : (ArrayBuffer as any)

/**
 * Returns the index of the Least Significant Bit in a number.
 *
 * @param value the number
 * @return the index of LSB (0-31), or -1 if value is 0
 */
function getLSBIndex(value: number): number {
  if (value === 0) return -1
  // Isolate the LSB: value & -value gives us a number with only the LSB set
  // Then use 31 - clz32 to get the bit position
  return 31 - Math.clz32(value & -value)
}

/**
 * Thread-safe pool for entity ID allocation using SharedArrayBuffer and Atomics.
 *
 * Layout:
 *   - Int32[0]: nextAvailable hint (bucket index, -1 if pool exhausted)
 *   - Int32[1...]: bit buckets (1 = available, 0 = used)
 *
 * Each bit in the buckets represents an entity ID slot.
 * A set bit (1) means the slot is available, cleared (0) means it's in use.
 *
 * @example
 * // create a pool of 1600 indexes
 * const pool = Pool.create(100 * 16);
 *
 * // get the next available index and make it unavailable
 * pool.get();
 * //=> 0
 * pool.get();
 * //=> 1
 *
 * // set index available
 * pool.free(0);
 * pool.get();
 * //=> 0
 *
 * pool.get();
 * //=> 2
 */
export class Pool {
  private buffer: SharedArrayBuffer
  private view: Int32Array
  private readonly bucketCount: number
  private readonly size: number

  // Index 0 is reserved for nextAvailable hint
  private static readonly HINT_INDEX = 0
  private static readonly DATA_OFFSET = 1

  /**
   * Create a Pool instance (private, use static create or fromTransfer)
   */
  private constructor(buffer: SharedArrayBuffer, bucketCount: number, size: number) {
    this.buffer = buffer
    this.view = new Int32Array(buffer)
    this.bucketCount = bucketCount
    this.size = size
  }

  /**
   * Creates a Pool of the specified size.
   *
   * @param size the size of the pool (number of entity slots)
   * @return a new Pool
   */
  static create(size: number): Pool {
    const bucketCount = Math.ceil(size / 32)
    // +1 for the nextAvailable hint at index 0
    const buffer = new BufferConstructor((bucketCount + 1) * 4)
    const view = new Int32Array(buffer)

    // Initialize all buckets to full (all bits set = all slots available)
    // Using 0xffffffff which is -1 as signed int32
    for (let i = Pool.DATA_OFFSET; i < bucketCount + Pool.DATA_OFFSET; i++) {
      view[i] = -1 // 0xffffffff = all 32 bits set
    }

    // Mask out bits beyond the requested size in the last bucket
    const bitsInLastBucket = size % 32
    if (bitsInLastBucket !== 0) {
      // Create a mask with only the valid bits set
      // e.g., for 5 bits: (1 << 5) - 1 = 0b11111
      const lastBucketIndex = bucketCount - 1 + Pool.DATA_OFFSET
      const mask = (1 << bitsInLastBucket) - 1
      view[lastBucketIndex] = mask
    }

    // Set nextAvailable hint to first bucket
    view[Pool.HINT_INDEX] = 0

    return new Pool(buffer, bucketCount, size)
  }

  /**
   * Create a Pool from a transferred SharedArrayBuffer (for workers)
   *
   * @param buffer - The SharedArrayBuffer from the main thread
   * @param bucketCount - Number of buckets in the pool
   * @param size - The size of the pool (number of entity slots)
   * @returns A Pool instance wrapping the shared buffer
   */
  static fromTransfer(buffer: SharedArrayBuffer, bucketCount: number, size: number): Pool {
    return new Pool(buffer, bucketCount, size)
  }

  /**
   * Get the underlying SharedArrayBuffer for transfer to workers
   */
  getBuffer(): SharedArrayBuffer {
    return this.buffer
  }

  /**
   * Get the bucket count for transfer to workers
   */
  getBucketCount(): number {
    return this.bucketCount
  }

  /**
   * Get the size of the pool
   */
  getSize(): number {
    return this.size
  }

  /**
   * Makes a given index available (thread-safe).
   *
   * @param index index to be freed
   */
  free(index: number): void {
    const bucket = (index >> 5) + Pool.DATA_OFFSET
    const mask = 1 << (index & 31)

    // Atomically set the bit to mark as available
    Atomics.or(this.view, bucket, mask)

    // Update hint - try to set it to this bucket if current hint is exhausted or higher
    const currentHint = Atomics.load(this.view, Pool.HINT_INDEX)
    const bucketIndex = bucket - Pool.DATA_OFFSET
    if (currentHint === -1 || bucketIndex < currentHint) {
      Atomics.store(this.view, Pool.HINT_INDEX, bucketIndex)
    }
  }

  /**
   * Gets the next available index in the pool (thread-safe).
   * Uses compare-and-swap to atomically claim an index.
   *
   * @return the next available index, or -1 if pool is exhausted
   */
  get(): number {
    // Retry loop for concurrent access
    for (let attempts = 0; attempts < this.bucketCount * 2; attempts++) {
      // Read the hint for where to start looking
      let hintBucket = Atomics.load(this.view, Pool.HINT_INDEX)

      if (hintBucket === -1) {
        // Hint says exhausted, but do a full scan to be sure
        hintBucket = 0
      }

      // Search from hint position
      for (let i = 0; i < this.bucketCount; i++) {
        const bucketIndex = ((hintBucket + i) % this.bucketCount) + Pool.DATA_OFFSET
        const record = Atomics.load(this.view, bucketIndex)

        if (record === 0) {
          // This bucket is full, continue searching
          continue
        }

        // Found a bucket with available slots
        const bitIndex = getLSBIndex(record)
        if (bitIndex === -1) continue

        const mask = 1 << bitIndex

        // Try to atomically claim this bit using compare-and-swap
        const oldValue = Atomics.compareExchange(this.view, bucketIndex, record, record & ~mask)

        if (oldValue === record) {
          // Successfully claimed! Update hint if this bucket is now empty
          const newValue = record & ~mask
          if (newValue === 0) {
            // Find next non-empty bucket for hint
            this.updateHint(bucketIndex - Pool.DATA_OFFSET)
          }

          return ((bucketIndex - Pool.DATA_OFFSET) << 5) + bitIndex
        }

        // CAS failed - another thread got there first, retry
        // Don't increment i, try the same bucket again with fresh data
      }

      // If we completed a full scan and found nothing, pool might be exhausted
      // But another thread might have freed something, so we retry a few times
    }

    // Pool is exhausted
    Atomics.store(this.view, Pool.HINT_INDEX, -1)
    throw new Error(`Entity pool exhausted: maximum of ${this.size} entities reached`)
  }

  /**
   * Update the nextAvailable hint after a bucket becomes empty
   */
  private updateHint(emptyBucket: number): void {
    // Scan for next non-empty bucket
    for (let i = 0; i < this.bucketCount; i++) {
      const bucketIndex = ((emptyBucket + i) % this.bucketCount) + Pool.DATA_OFFSET
      const value = Atomics.load(this.view, bucketIndex)
      if (value !== 0) {
        Atomics.store(this.view, Pool.HINT_INDEX, bucketIndex - Pool.DATA_OFFSET)
        return
      }
    }

    // All buckets are empty
    Atomics.store(this.view, Pool.HINT_INDEX, -1)
  }
}
