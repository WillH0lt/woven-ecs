const BufferConstructor: new (byteLength: number) => ArrayBufferLike =
  typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer

/**
 * Buffer layout:
 * Dense array: [count, entity0, entity1, entity2, ...]
 * Sparse array: [sparseIdx0, sparseIdx1, ...] - maps entityId -> index in dense array (or 0xFFFFFFFF if not present)
 */
const DENSE_COUNT_INDEX = 0
const DENSE_DATA_START = 1
const SPARSE_NOT_PRESENT = 0xffffffff

/**
 * QueryCache implements a sparse set stored in SharedArrayBuffer.
 * This allows query results to be shared across threads with O(1) add/remove/has operations.
 *
 * Uses a sparse-dense set pattern:
 * - Dense array: contiguous entity IDs for fast iteration
 * - Sparse array: maps entity ID -> dense index for O(1) lookup
 */
export class QueryCache {
  private denseBuffer: ArrayBufferLike
  private sparseBuffer: ArrayBufferLike
  private dense: Uint32Array
  private sparse: Uint32Array
  private maxEntities: number

  /**
   * Create a new QueryCache
   * @param maxEntities - Maximum number of entities that can be cached
   */
  constructor(maxEntities: number) {
    this.maxEntities = maxEntities

    // Dense buffer: count + maxEntities entity IDs
    this.denseBuffer = new BufferConstructor((DENSE_DATA_START + maxEntities) * 4)
    this.dense = new Uint32Array(this.denseBuffer)
    this.dense[DENSE_COUNT_INDEX] = 0

    // Sparse buffer: one slot per possible entity
    this.sparseBuffer = new BufferConstructor(maxEntities * 4)
    this.sparse = new Uint32Array(this.sparseBuffer)
    // Initialize all to "not present"
    this.sparse.fill(SPARSE_NOT_PRESENT)
  }

  /**
   * Get the number of entities in the cache
   */
  get count(): number {
    return this.dense[DENSE_COUNT_INDEX]
  }

  /**
   * Add an entity to the cache - O(1)
   * @param entityId - The entity ID to add
   */
  add(entityId: number): void {
    const sparse = this.sparse
    // Already in cache?
    if (sparse[entityId] !== SPARSE_NOT_PRESENT) {
      return
    }

    const dense = this.dense
    const count = dense[DENSE_COUNT_INDEX]
    if (count >= this.maxEntities) {
      throw new Error('QueryCache is full')
    }

    // Add to dense array
    dense[DENSE_DATA_START + count] = entityId
    // Update sparse array to point to new dense index
    sparse[entityId] = count
    // Increment count
    dense[DENSE_COUNT_INDEX] = count + 1
  }

  /**
   * Remove an entity from the cache - O(1) using swap-and-pop
   * @param entityId - The entity ID to remove
   */
  remove(entityId: number): void {
    const sparse = this.sparse
    const denseIdx = sparse[entityId]
    if (denseIdx === SPARSE_NOT_PRESENT) {
      return // Not in cache
    }

    const dense = this.dense
    const count = dense[DENSE_COUNT_INDEX]
    const lastIdx = count - 1

    if (denseIdx !== lastIdx) {
      // Swap with last element
      const lastEntityId = dense[DENSE_DATA_START + lastIdx]
      dense[DENSE_DATA_START + denseIdx] = lastEntityId
      sparse[lastEntityId] = denseIdx
    }

    // Mark as not present and decrement count
    sparse[entityId] = SPARSE_NOT_PRESENT
    dense[DENSE_COUNT_INDEX] = lastIdx
  }

  /**
   * Check if an entity is in the cache - O(1)
   * @param entityId - The entity ID to check
   */
  has(entityId: number): boolean {
    return this.sparse[entityId] !== SPARSE_NOT_PRESENT
  }

  /**
   * Clear all entities from the cache - O(n)
   */
  clear(): void {
    const count = this.dense[DENSE_COUNT_INDEX]
    // Reset sparse entries for all cached entities
    for (let i = 0; i < count; i++) {
      const entityId = this.dense[DENSE_DATA_START + i]
      this.sparse[entityId] = SPARSE_NOT_PRESENT
    }
    // Reset count
    this.dense[DENSE_COUNT_INDEX] = 0
  }

  /**
   * Get cached entities as an array (for compatibility)
   * Note: Creates a new array - prefer using the iterator for better performance
   */
  toArray(): number[] {
    const count = this.dense[DENSE_COUNT_INDEX]
    const result = new Array(count)
    for (let i = 0; i < count; i++) {
      result[i] = this.dense[DENSE_DATA_START + i]
    }
    return result
  }

  /**
   * Get a view of the dense array without copying
   * This is the fastest way to access the cached entities
   */
  getDenseView(): Uint32Array {
    const count = this.dense[DENSE_COUNT_INDEX]
    return this.dense.subarray(DENSE_DATA_START, DENSE_DATA_START + count)
  }
}
