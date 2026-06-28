# @woven-ecs/canvas-store-server

## 1.3.0

### Minor Changes

- c1c711d: Add server-rollback recovery so clients can heal a server that restarts from a stale (throttled) snapshot and loses acked ops.

  - Server (`Room`): on reconnect, if a client reports a higher `lastTimestamp` than the server holds, it sends a `resync` request; the client replies with a normal patch through the usual apply/broadcast path.
  - Client (`WebsocketAdapter`): mirrors the server's per-field timestamp map and its own document state, and answers `resync` with a precise reverse diff (only fields newer than the server's cutoff, plus any unconfirmed local edits). The timestamp map is persisted, so healing also works across a page reload.
  - `PersistenceAdapter` now retains tombstones instead of hard-deleting, so windowed deletions are re-asserted across a reload instead of being resurrected.
  - `FileStorage` writes are now crash-safe (temp file + atomic rename) and serialized, so a mid-write crash can't truncate the snapshot and concurrent saves can't race.

  The protocol change is additive (`resync`); older clients simply ignore it.

## 1.1.0

### Minor Changes

- e796270: Sync `field.buffer` components as sparse deltas instead of resending the whole array.

  Buffer fields (e.g. pen-stroke point arrays) now sync only their changed runs over the websocket — appends and tail edits ship a compact `{ __buf, len, runs }` delta rather than the full array on every change, turning per-stroke traffic from roughly O(N²) to O(N). Patches buffered between sends are also coalesced into a single merged patch.

  Deltas are a transport optimization only: server room state, IndexedDB persistence, and undo history all materialize them back into full arrays, so snapshots, reconnects, and existing persisted documents are unaffected (no data migration needed).

  This bumps the wire protocol (`PROTOCOL_VERSION` 1 → 2). A v2 client and a v1 server (or vice versa) are **not** interoperable — the version handshake disconnects mismatched peers — so upgrade and deploy `@woven-ecs/canvas-store` and `@woven-ecs/canvas-store-server` together. The two packages are now `linked` so their versions stay in lockstep.
