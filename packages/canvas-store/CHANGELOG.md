# @woven-ecs/canvas-store

## 1.3.1

### Patch Changes

- fa42914: Fix documents sometimes loading blank after an interrupted or laggy initial sync.

  The websocket resume cursor (`lastTimestamp`) now advances when document patches are **applied** (in `pull()`), not when they're received, and it no longer advances on the ack of an ephemeral (cursor/presence) send. Previously either could push the persisted cursor ahead of the stored document, so a reload or reconnect mid-load would request an empty diff from the server and never recover the document.

  Ephemeral state now travels without a timestamp: `PatchBroadcast.timestamp` is present only alongside `documentPatches`, so ephemeral changes can never be mistaken for document progress.

## 1.3.0

### Minor Changes

- c1c711d: Add server-rollback recovery so clients can heal a server that restarts from a stale (throttled) snapshot and loses acked ops.

  - Server (`Room`): on reconnect, if a client reports a higher `lastTimestamp` than the server holds, it sends a `resync` request; the client replies with a normal patch through the usual apply/broadcast path.
  - Client (`WebsocketAdapter`): mirrors the server's per-field timestamp map and its own document state, and answers `resync` with a precise reverse diff (only fields newer than the server's cutoff, plus any unconfirmed local edits). The timestamp map is persisted, so healing also works across a page reload.
  - `PersistenceAdapter` now retains tombstones instead of hard-deleting, so windowed deletions are re-asserted across a reload instead of being resurrected.
  - `FileStorage` writes are now crash-safe (temp file + atomic rename) and serialized, so a mid-write crash can't truncate the snapshot and concurrent saves can't race.

  The protocol change is additive (`resync`); older clients simply ignore it.

## 1.2.0

### Minor Changes

- 3efcc67: Add `seedRoom` and `readPersistedDocument` for one-shot seeding of a server room from a local/offline document — e.g. adopting an anonymous, IndexedDB-only draft into a server-backed room on sign-in. `seedRoom` connects, sends the document as a single `patch`, and resolves once the server acks it; `readPersistedDocument` reads the persisted document for an id without standing up a `CanvasStore`.

## 1.1.2

### Patch Changes

- 5757600: Serialize `PersistenceAdapter` writes so concurrent persists can't drop a buffer delta

  `push()` fired `persistMutations()` fire-and-forget, and each call did an async read-modify-write per key (`get` → materialize buffer deltas → `put`). Under rapid mutations — e.g. dragging a brush or nudge tool, which persists on every pointer move — two calls overlapped: both read the same stored base before either wrote back, and the second `put` clobbered the first, silently dropping a buffer delta.

  Because deltas are encoded against the ECS adapter's advancing `prevState`, a dropped delta left the stored base behind the delta baseline. The next `applyBufferDelta` then zero-filled the indices the lost delta had grown into and never restored them, persisting stray `0` values (e.g. a pen stroke springing a vertex at the world origin) that only surfaced on reload.

  `push()` now chains each `persistMutations` on a `writeChain` promise, so the get → materialize → put sequence stays atomic and in order.

## 1.1.1

### Patch Changes

- d668bfe: Fix refs to same-tick entities serializing as `null` in `EcsAdapter.pull`

  When a synced ref field (e.g. a block's `layerId`) pointed at an entity created later in the **same tick**, the outbound patch serialized the ref as `null` — the target wasn't in the `entityId → stableId` map yet, since the map was built incrementally in event order. A follow-up partial diff for that ref then overwrote the full create-patch, so the component was never persisted/synced (it reappeared missing on reload).

  `pull()` now resolves refs in two passes: pass 1 registers a stable id for every synced entity touched in the batch, then pass 2 builds patches with ref translation as an order-independent pure map lookup. As a side effect the per-event `Synced` read in the main loop is gone (the stable id comes from the pass-1 map), so refs serialize correctly regardless of creation order with fewer ECS reads overall.

## 1.1.0

### Minor Changes

- e796270: Sync `field.buffer` components as sparse deltas instead of resending the whole array.

  Buffer fields (e.g. pen-stroke point arrays) now sync only their changed runs over the websocket — appends and tail edits ship a compact `{ __buf, len, runs }` delta rather than the full array on every change, turning per-stroke traffic from roughly O(N²) to O(N). Patches buffered between sends are also coalesced into a single merged patch.

  Deltas are a transport optimization only: server room state, IndexedDB persistence, and undo history all materialize them back into full arrays, so snapshots, reconnects, and existing persisted documents are unaffected (no data migration needed).

  This bumps the wire protocol (`PROTOCOL_VERSION` 1 → 2). A v2 client and a v1 server (or vice versa) are **not** interoperable — the version handshake disconnects mismatched peers — so upgrade and deploy `@woven-ecs/canvas-store` and `@woven-ecs/canvas-store-server` together. The two packages are now `linked` so their versions stay in lockstep.
