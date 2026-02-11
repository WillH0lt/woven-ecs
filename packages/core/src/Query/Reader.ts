import { SINGLETON_ENTITY_ID } from '../Component'
import { EventType } from '../EventBuffer'
import type { Context } from '../types'
import type { QueryCache } from './Cache'
import type { QueryMasks } from './Masks'

/**
 * Reads events from EventBuffer and processes them for a query.
 * Maintains state for incremental reading and computes added/removed/changed lazily.
 */
export class QueryReader {
  private lastIndex: number

  // Track the last processed event range to avoid reprocessing
  private lastPrevEventIndex: number = -1
  private lastCurrEventIndex: number = -1

  // Event range for cache updates (all events since last read)
  private prevExecutionIndex: number = 0

  // Event range for results (only events since prevEventIndex - last frame)
  private prevFrameIndex: number = 0

  private toIndex: number = 0

  // results computed from last processed events
  added: number[] = []
  removed: number[] = []
  changed: number[] = []

  constructor(startIndex: number) {
    this.lastIndex = startIndex
  }

  /**
   * Check for new events and update the cache.
   */
  updateCache(ctx: Context, cache: QueryCache, masks: QueryMasks): void {
    // currEventIndex limits visibility to events before execute batch started.
    // undefined means "use live write index" for direct query calls outside execute/sync.
    const currentIndex = ctx.currEventIndex ?? ctx.eventBuffer.getWriteIndex()
    const prevIndex = ctx.prevEventIndex

    // Skip if we've already processed this exact event range
    if (prevIndex === this.lastPrevEventIndex && currentIndex === this.lastCurrEventIndex) {
      return
    }

    // Reset for new event range
    this.added = []
    this.removed = []
    this.changed = []
    this.lastPrevEventIndex = prevIndex
    this.lastCurrEventIndex = currentIndex

    this.prevExecutionIndex = this.lastIndex
    this.prevFrameIndex = prevIndex

    this.toIndex = currentIndex
    this.lastIndex = currentIndex

    // Process events to update cache and compute results in one pass
    this.processEventsAndComputeResults(ctx, cache, masks)
  }

  /**
   * Special update method for singleton queries that only tracks changes.
   * Singleton queries don't use the cache, so we only process CHANGED events.
   */
  updateSingletonChanged(ctx: Context, masks: QueryMasks): void {
    // Use currEventIndex if set, otherwise use live write index
    const currentIndex = ctx.currEventIndex ?? ctx.eventBuffer.getWriteIndex()
    const prevIndex = ctx.prevEventIndex

    // Skip if we've already processed this exact event range
    if (prevIndex === this.lastPrevEventIndex && currentIndex === this.lastCurrEventIndex) {
      return
    }

    // Reset for new event range
    this.changed = []
    this.lastPrevEventIndex = prevIndex
    this.lastCurrEventIndex = currentIndex

    // Results range: only events since prevEventIndex (last frame's events)
    this.prevFrameIndex = prevIndex
    this.toIndex = currentIndex
    this.lastIndex = currentIndex

    const result = ctx.eventBuffer.collectEntitiesInRange(this.prevFrameIndex, EventType.CHANGED, masks.tracking)

    if (result.entities.size > 0) {
      this.changed.push(SINGLETON_ENTITY_ID)
    }
  }

  /**
   * Rebuild the cache by scanning all entities in the entity buffer.
   * Used when event buffer overflow prevents incremental updates.
   */
  private rebuildCacheFromEntityBuffer(ctx: Context, cache: QueryCache, masks: QueryMasks): void {
    const entityBuffer = ctx.entityBuffer
    const maxEntities = ctx.maxEntities

    // Clear the cache and rebuild from scratch
    cache.clear()

    for (let entityId = 0; entityId < maxEntities; entityId++) {
      if (entityBuffer.has(entityId) && entityBuffer.matches(entityId, masks)) {
        cache.add(entityId)
      }
    }
  }

  /**
   * Process events from the buffer, updating cache and computing results in a single pass.
   * Cache is updated for ALL events since lastIndex, but results only include events
   * since prevEventIndex (last frame).
   */
  private processEventsAndComputeResults(ctx: Context, cache: QueryCache, masks: QueryMasks): void {
    const maxEvents = ctx.maxEvents
    const entityBuffer = ctx.entityBuffer
    const dataView = ctx.eventBuffer.getDataView()

    const prevExecutionIndex = this.prevExecutionIndex
    const toIndex = this.toIndex
    let prevFrameIndex = this.prevFrameIndex

    // Handle buffer overflow for cache range - rebuild cache from entity buffer
    const cacheOverflow = toIndex - prevExecutionIndex > maxEvents
    if (cacheOverflow) {
      this.rebuildCacheFromEntityBuffer(ctx, cache, masks)
    }

    // Handle buffer overflow for results range - warn user and clamp
    const resultsOverflow = toIndex - prevFrameIndex > maxEvents
    if (resultsOverflow) {
      console.warn(
        `[ECS] Event buffer overflow: ${toIndex - prevFrameIndex} events since last frame, ` +
          `but maxEvents is ${maxEvents}. Some added/removed/changed events may be missed. ` +
          `Consider increasing maxEvents in World constructor.`,
      )
      prevFrameIndex = toIndex - maxEvents
    }

    // Determine event scan range:
    // - If cache overflowed: only scan from prevFrameIndex (for results only, cache already rebuilt)
    // - Otherwise: scan from prevExecutionIndex (for both cache updates and results)
    const scanFromIndex = cacheOverflow ? prevFrameIndex : prevExecutionIndex

    const scanFromSlot = scanFromIndex % maxEvents
    const toSlot = toIndex % maxEvents

    let eventsToScan = toSlot >= scanFromSlot ? toSlot - scanFromSlot : maxEvents - scanFromSlot + toSlot
    if (eventsToScan > maxEvents) eventsToScan = maxEvents

    // Track entity states for result computation
    const added = this.added
    const removed = this.removed
    const changed = this.changed

    added.length = 0
    removed.length = 0
    changed.length = 0

    const seen: { [key: number]: number } = {}

    const STATE_ADDED = 1
    const STATE_REMOVED = 2
    const STATE_CHANGED = 3

    const hasTracking = masks.hasTracking
    const trackingMask = masks.tracking

    for (let i = 0; i < eventsToScan; i++) {
      const slot = (scanFromSlot + i) % maxEvents
      const dataIndex = slot * 2
      const eventIndex = scanFromIndex + i

      // Check if this event is within the results range (last frame only)
      const inResultsRange = eventIndex >= prevFrameIndex

      // console.log(dataIndex);
      const entityId = Atomics.load(dataView, dataIndex)
      const packedData = Atomics.load(dataView, dataIndex + 1)
      const eventType = packedData & 0xff

      // Check cache state BEFORE any updates for this event
      const wasInCache = cache.has(entityId)
      const existingState = seen[entityId]

      if (eventType === EventType.REMOVED) {
        // Update cache (skip if cache was rebuilt - it's already correct)
        if (!cacheOverflow && wasInCache) {
          cache.remove(entityId)
        }

        // Compute results (only for events in results range)
        if (inResultsRange) {
          if (existingState === STATE_ADDED) {
            // Added then removed - cancel out
            const idx = added.indexOf(entityId)
            if (idx !== -1) {
              added[idx] = added[added.length - 1]
              added.length--
            }
            seen[entityId] = STATE_REMOVED
          } else if (existingState === STATE_CHANGED && wasInCache) {
            // Changed then removed - remove from changed, add to removed
            const idx = changed.indexOf(entityId)
            if (idx !== -1) {
              changed[idx] = changed[changed.length - 1]
              changed.length--
            }
            seen[entityId] = STATE_REMOVED
            removed.push(entityId)
          } else if (!existingState && wasInCache) {
            // Entity was in cache, now removed
            seen[entityId] = STATE_REMOVED
            removed.push(entityId)
          }
        }
      } else if (eventType === EventType.ADDED) {
        // Update cache (skip if cache was rebuilt - it's already correct)
        const matchesNow = entityBuffer.matches(entityId, masks)
        if (!cacheOverflow && !wasInCache && matchesNow) {
          cache.add(entityId)
        }

        // Compute results (only for events in results range)
        if (inResultsRange && !existingState && !wasInCache && matchesNow) {
          seen[entityId] = STATE_ADDED
          added.push(entityId)
        }
      } else if (eventType === EventType.COMPONENT_ADDED || eventType === EventType.COMPONENT_REMOVED) {
        // Update cache (skip if cache was rebuilt - it's already correct)
        const stillExists = entityBuffer.has(entityId)
        const matchesNow = stillExists && entityBuffer.matches(entityId, masks)
        if (!cacheOverflow) {
          if (matchesNow && !wasInCache) {
            cache.add(entityId)
          } else if (!matchesNow && wasInCache) {
            cache.remove(entityId)
          }
        }

        // Compute results (only for events in results range)
        if (inResultsRange && !existingState) {
          if (!wasInCache && matchesNow) {
            // Entity entered the query
            seen[entityId] = STATE_ADDED
            added.push(entityId)
          } else if (wasInCache && !matchesNow) {
            // Entity left the query
            seen[entityId] = STATE_REMOVED
            removed.push(entityId)
          }
        }
      } else if (eventType === EventType.CHANGED && hasTracking) {
        // No cache update needed for CHANGED events

        // Compute results (only for events in results range)
        if (inResultsRange && !existingState && wasInCache) {
          const componentId = (packedData >> 16) & 0xffff
          const byteIndex = componentId >> 3
          const bitIndex = componentId & 7

          if (byteIndex < trackingMask.length && (trackingMask[byteIndex] & (1 << bitIndex)) !== 0) {
            seen[entityId] = STATE_CHANGED
            changed.push(entityId)
          }
        }
      }
    }
  }
}
