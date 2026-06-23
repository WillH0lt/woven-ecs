---
"@woven-ecs/canvas-store": patch
---

Fix refs to same-tick entities serializing as `null` in `EcsAdapter.pull`

When a synced ref field (e.g. a block's `layerId`) pointed at an entity created later in the **same tick**, the outbound patch serialized the ref as `null` — the target wasn't in the `entityId → stableId` map yet, since the map was built incrementally in event order. A follow-up partial diff for that ref then overwrote the full create-patch, so the component was never persisted/synced (it reappeared missing on reload).

`pull()` now resolves refs in two passes: pass 1 registers a stable id for every synced entity touched in the batch, then pass 2 builds patches with ref translation as an order-independent pure map lookup. As a side effect the per-event `Synced` read in the main loop is gone (the stable id comes from the pass-1 map), so refs serialize correctly regardless of creation order with fewer ECS reads overall.
