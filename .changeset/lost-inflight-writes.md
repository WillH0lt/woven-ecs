---
'@woven-ecs/canvas-store': patch
'@woven-ecs/canvas-store-server': patch
---

Stop dropping document writes that are sent but never acknowledged, and stop a lost write from corrupting the room.

**`canvas-store`** — `inFlight` was the only record of writes that had left the client without an ack, and `connectWs()` cleared it on every reconnect. `flush()` has already drained those patches out of `documentSendBuffer`, and the `reconnect` frame carries `offlineBuffer`, not `inFlight` — so a socket that died mid-flight (a sleeping machine, a network blip, a server restart, an auth-driven reconnect) lost them silently, with no error on either side.

The damage outlives the missing edit. The ECS adapter advances `prevState` optimistically at pull time, so after the loss it still believes the server holds the component: every later edit to it ships as a _partial_ diff against a key the server has never seen. Lose an entity's create this way and the entity is unrecoverable — the client can never be talked into re-sending a full record for it, and the loss only surfaces on the next reload, when the entity silently fails to come back.

In-flight patches are now folded back into `offlineBuffer` on disconnect, which persists to IndexedDB and replays on the next connect. Document delivery is at-least-once; re-delivery is safe because field writes are last-writer-wins and buffer deltas address absolute indices (see `applyBufferDelta`), so applying one twice is idempotent.

`flush()` now also clears the _persisted_ offline buffer when it drains it, not just the in-memory copy. `init()` reloads that buffer, so leaving it behind replayed those writes on every future session — tolerable when it only ever held offline edits, but not once it can hold a real create, which would resurrect entities deleted since.

**`canvas-store-server`** — `applyPatch` no longer lets a partial field update bring a record into being. Landing on a missing or tombstoned key, a value without `_exists: true` is now dropped instead of becoming the whole record.

Materializing it produced a record with no `_exists`, which no client can ever load: `push()` pass 1 only creates entities for `_exists: true` and routes everything else to a partial update that requires the entity to already be there. Such a row was invisible to every client yet counted as state on the server — present in `getSnapshot()`, shipped in `buildDiff`, written to storage. It also silently resurrected deleted entities as fragments holding only whatever fields happened to be in flight, which is reachable through ordinary concurrent editing: one client deletes a component while another, which has not applied that deletion yet, patches a single field on it.

Only a full add creates a record now, so server and client agree on what exists. Note this path is shared with ephemeral state, whose first write after a session is removed already carries `_exists: true`.
