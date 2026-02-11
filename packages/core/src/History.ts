/**
 * History manages system execution indices for entity ID reclamation.
 *
 * The watermark approach delays entity reclamation until all systems have had
 * enough executions to process removal events. However, if a system runs
 * infrequently, it could block reclamation indefinitely.
 *
 * To handle this, History tracks:
 * - Rolling history of event indices per system
 * - When the event buffer is close to wrapping, excludes stale systems
 *   from watermark calculation to allow reclamation to proceed
 */

/** Number of system executions to wait before reclaiming entity IDs */
const RECLAIM_DELAY = 3

/** When buffer usage exceeds this ratio, start excluding stale systems */
const BUFFER_PRESSURE_THRESHOLD = 0.75

interface SystemHistory {
  /** Event buffer index from previous execution */
  prev: number
  /** Event buffer index at start of current execution */
  curr: number
  /** Rolling history of event indices (oldest first) */
  history: number[]
}

export class History {
  private systems = new Map<number, SystemHistory>()
  private lastReclaimIndex = 0
  private maxEvents: number
  private warnedStaleSystems = new Set<number>()

  constructor(maxEvents: number) {
    this.maxEvents = maxEvents
  }

  /**
   * Record that a system is about to execute at the given event index.
   * Returns the previous event index for this system (for query filtering).
   */
  recordExecution(systemId: number, currentEventIndex: number): number {
    let history = this.systems.get(systemId)
    if (!history) {
      history = { prev: 0, curr: 0, history: [] }
      this.systems.set(systemId, history)
    }

    // Shift curr to prev
    history.prev = history.curr
    history.curr = currentEventIndex

    // Add to rolling history
    history.history.push(currentEventIndex)
    if (history.history.length > RECLAIM_DELAY) {
      history.history.shift()
    }

    return history.prev
  }

  /**
   * Get the system's previous event index (for prevEventIndex in context).
   */
  getPrevIndex(systemId: number): number {
    return this.systems.get(systemId)?.prev ?? 0
  }

  /**
   * Calculate the watermark - the event index up to which we can safely reclaim.
   *
   * Returns null if no reclamation is possible yet.
   *
   * Under normal conditions, uses the minimum oldest history entry across all
   * systems that have built up enough history.
   *
   * Under buffer pressure (close to wrapping), excludes stale systems that
   * haven't run recently to allow reclamation to proceed.
   */
  calculateWatermark(currentEventIndex: number): number | null {
    if (this.systems.size === 0) {
      return null
    }

    // Calculate buffer usage to detect pressure
    const eventsInFlight = this.calculateEventsInFlight(currentEventIndex)
    const bufferUsage = eventsInFlight / this.maxEvents
    const underPressure = bufferUsage > BUFFER_PRESSURE_THRESHOLD

    // If under pressure, calculate a staleness threshold
    // Systems whose newest history entry is too old will be excluded
    let stalenessThreshold = 0
    if (underPressure) {
      // Exclude systems that haven't run in the last 25% of buffer capacity
      const staleWindow = Math.floor(this.maxEvents * 0.25)
      stalenessThreshold = this.wrapAwareSubtract(currentEventIndex, staleWindow)
    }

    let watermark: number | null = null
    let hasSystemWithInsufficientHistory = false

    for (const [_systemId, history] of this.systems) {
      // Check if this system has enough history
      if (history.history.length < RECLAIM_DELAY) {
        // Under pressure, skip systems without enough history
        if (underPressure) {
          continue
        }
        hasSystemWithInsufficientHistory = true
        continue
      }

      // Under pressure, check if this system is stale
      if (underPressure) {
        const newestEntry = history.history[history.history.length - 1]
        if (this.isOlderThan(newestEntry, stalenessThreshold)) {
          // This system is stale - exclude it from watermark calculation
          if (!this.warnedStaleSystems.has(_systemId)) {
            this.warnedStaleSystems.add(_systemId)
            console.warn(
              `[History] Stale system detected (id: ${_systemId}). ` +
                `System queries will miss some events. ` +
                `Consider increasing maxEvents or running the system more frequently.`,
            )
          }
          continue
        }
      }

      // Use the oldest entry in this system's history
      const oldestIndex = history.history[0]

      if (watermark === null || this.isOlderThan(oldestIndex, watermark)) {
        watermark = oldestIndex
      }
    }

    // If any system has insufficient history and we're not under pressure,
    // don't reclaim yet (unless watermark is still valid)
    if (hasSystemWithInsufficientHistory && !underPressure) {
      return null
    }

    // Only return watermark if it's past where we last reclaimed
    if (watermark !== null && this.isNewerThan(watermark, this.lastReclaimIndex)) {
      return watermark
    }

    return null
  }

  /**
   * Mark that reclamation has been performed up to the given index.
   */
  markReclaimed(index: number): void {
    this.lastReclaimIndex = index
  }

  /**
   * Get the last reclaim index (for reclaimRemovedEntityIds fromIndex).
   */
  getLastReclaimIndex(): number {
    return this.lastReclaimIndex
  }

  /**
   * Calculate events in flight (between last reclaim and current write index).
   */
  private calculateEventsInFlight(currentEventIndex: number): number {
    if (currentEventIndex >= this.lastReclaimIndex) {
      return currentEventIndex - this.lastReclaimIndex
    }
    // Wrapped around
    return this.maxEvents - this.lastReclaimIndex + currentEventIndex
  }

  /**
   * Wrap-aware subtraction for event indices.
   */
  private wrapAwareSubtract(index: number, amount: number): number {
    const result = index - amount
    if (result < 0) {
      return this.maxEvents + result
    }
    return result
  }

  /**
   * Check if indexA is older than indexB (accounting for wrap-around).
   */
  private isOlderThan(indexA: number, indexB: number): boolean {
    // Handle wrap-around: if the difference is more than half the buffer,
    // the "smaller" number is actually newer (it wrapped)
    const diff = indexB - indexA
    const halfBuffer = this.maxEvents / 2

    if (Math.abs(diff) < halfBuffer) {
      return indexA < indexB
    }
    // Wrapped: the larger number is actually older
    return indexA > indexB
  }

  /**
   * Check if indexA is newer than indexB (accounting for wrap-around).
   */
  private isNewerThan(indexA: number, indexB: number): boolean {
    if (indexA === indexB) return false
    return !this.isOlderThan(indexA, indexB)
  }

  /**
   * Clear all history (for dispose).
   */
  clear(): void {
    this.systems.clear()
    this.lastReclaimIndex = 0
    this.warnedStaleSystems.clear()
  }
}
