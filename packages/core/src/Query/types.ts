/**
 * Options for query methods
 */
export interface QueryOptions {
  /** Whether to partition results across workers based on the thread index */
  partitioned?: boolean
}
