---
"@woven-ecs/canvas-store": patch
---

Serialize `PersistenceAdapter` writes so concurrent persists can't drop a buffer delta

`push()` fired `persistMutations()` fire-and-forget, and each call did an async read-modify-write per key (`get` → materialize buffer deltas → `put`). Under rapid mutations — e.g. dragging a brush or nudge tool, which persists on every pointer move — two calls overlapped: both read the same stored base before either wrote back, and the second `put` clobbered the first, silently dropping a buffer delta.

Because deltas are encoded against the ECS adapter's advancing `prevState`, a dropped delta left the stored base behind the delta baseline. The next `applyBufferDelta` then zero-filled the indices the lost delta had grown into and never restored them, persisting stray `0` values (e.g. a pen stroke springing a vertex at the world origin) that only surfaced on reload.

`push()` now chains each `persistMutations` on a `writeChain` promise, so the get → materialize → put sequence stays atomic and in order.
