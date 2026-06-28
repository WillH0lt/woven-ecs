---
"@woven-ecs/canvas-store": minor
"@woven-ecs/canvas-store-server": minor
---

Add server-rollback recovery so clients can heal a server that restarts from a stale (throttled) snapshot and loses acked ops.

- Server (`Room`): on reconnect, if a client reports a higher `lastTimestamp` than the server holds, it sends a `resync` request; the client replies with a normal patch through the usual apply/broadcast path.
- Client (`WebsocketAdapter`): mirrors the server's per-field timestamp map and its own document state, and answers `resync` with a precise reverse diff (only fields newer than the server's cutoff, plus any unconfirmed local edits). The timestamp map is persisted, so healing also works across a page reload.
- `PersistenceAdapter` now retains tombstones instead of hard-deleting, so windowed deletions are re-asserted across a reload instead of being resurrected.
- `FileStorage` writes are now crash-safe (temp file + atomic rename) and serialized, so a mid-write crash can't truncate the snapshot and concurrent saves can't race.

The protocol change is additive (`resync`); older clients simply ignore it.
