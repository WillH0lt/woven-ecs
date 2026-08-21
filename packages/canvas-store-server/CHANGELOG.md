# @woven-ecs/canvas-store-server

## 2.0.2

### Patch Changes

- 9657f0f: Persist tombstones so deletions survive a room reload.

  `getSnapshot()` stripped `{ _exists: false }` entries (and their timestamps) from the persisted document. `buildDiff` can only send what is in `state`, so once a room had been evicted and reloaded, a deletion was invisible to any client that had not already applied it. That client kept the entity in its cached copy, showed it in its view, and — believing the server still had it — only ever sent partial patches for it, which the server drops. Delete something on one machine, open a cached copy on another after the room has gone idle, and the deleted thing was back for good. Any snapshot taken from that client (e.g. for publishing) carried the phantom with it.

  Tombstones are now kept in the snapshot, so a reconnecting client with an older cursor receives the deletion exactly as it would from a live room. Consumers that read `snapshot.state` must skip `_exists === false` entries — the same rule that already applied to a live room's in-memory state.

  Tombstones are kept indefinitely: each is a key plus one flag and one timestamp, and a document accumulates only as many as it has had deletions. Compacting them would re-open the resurrection window for whichever deletions were dropped.

## 2.0.1

### Patch Changes

- 92ae45c: Stop dropping document writes that are sent but never acknowledged, and stop a lost write from corrupting the room.

  **`canvas-store`** — `inFlight` was the only record of writes that had left the client without an ack, and `connectWs()` cleared it on every reconnect. `flush()` has already drained those patches out of `documentSendBuffer`, and the `reconnect` frame carries `offlineBuffer`, not `inFlight` — so a socket that died mid-flight (a sleeping machine, a network blip, a server restart, an auth-driven reconnect) lost them silently, with no error on either side.

  The damage outlives the missing edit. The ECS adapter advances `prevState` optimistically at pull time, so after the loss it still believes the server holds the component: every later edit to it ships as a _partial_ diff against a key the server has never seen. Lose an entity's create this way and the entity is unrecoverable — the client can never be talked into re-sending a full record for it, and the loss only surfaces on the next reload, when the entity silently fails to come back.

  In-flight patches are now folded back into `offlineBuffer` on disconnect, which persists to IndexedDB and replays on the next connect. Document delivery is at-least-once; re-delivery is safe because field writes are last-writer-wins and buffer deltas address absolute indices (see `applyBufferDelta`), so applying one twice is idempotent.

  `flush()` now also clears the _persisted_ offline buffer when it drains it, not just the in-memory copy. `init()` reloads that buffer, so leaving it behind replayed those writes on every future session — tolerable when it only ever held offline edits, but not once it can hold a real create, which would resurrect entities deleted since.

  **`canvas-store-server`** — `applyPatch` no longer lets a partial field update bring a record into being. Landing on a missing or tombstoned key, a value without `_exists: true` is now dropped instead of becoming the whole record.

  Materializing it produced a record with no `_exists`, which no client can ever load: `push()` pass 1 only creates entities for `_exists: true` and routes everything else to a partial update that requires the entity to already be there. Such a row was invisible to every client yet counted as state on the server — present in `getSnapshot()`, shipped in `buildDiff`, written to storage. It also silently resurrected deleted entities as fragments holding only whatever fields happened to be in flight, which is reachable through ordinary concurrent editing: one client deletes a component while another, which has not applied that deletion yet, patches a single field on it.

  Only a full add creates a record now, so server and client agree on what exists. Note this path is shared with ephemeral state, whose first write after a session is removed already carries `_exists: true`.

## 2.0.0

### Major Changes

- 0e335e0: **Breaking:** `acceptConnection` now returns synchronously instead of a `Promise`. This fixes a connect-time race where the client's first `reconnect` frame was dropped, leaving the document stuck loading forever.

  The client sends `reconnect` the instant the socket opens — which is _during_ the async authorize + room-load window. Consumers that `await acceptConnection` and only then attached their message listener lost that first frame: in Node the `ws` library discards messages with no listener; in Bun the `message` handler ran while `ws.data.conn` was still `null` and the `?.` swallowed it. Either way `handleReconnect` never ran, so the server never sent the `synced` signal or the initial document snapshot.

  `acceptConnection` is now synchronous so you wire the socket's message listener in the same tick the socket opens, before any frame can be dispatched. Frames forwarded via `onMessage` before the connection is ready are buffered and replayed in order.

  Migration:

  ```diff
  - wss.on('connection', async (ws, req) => {
  -   let conn
  -   try {
  -     conn = await acceptConnection({ socket: ws, url: req.url ?? '', manager, authorize })
  -   } catch (err) {
  -     ws.close(1008, err.message)
  -     return
  -   }
  -   ws.on('message', (data) => conn.onMessage(String(data)))
  -   ws.on('close', conn.onClose)
  -   ws.on('error', conn.onError)
  - })
  + wss.on('connection', (ws, req) => {
  +   const conn = acceptConnection({ socket: ws, url: req.url ?? '', manager, authorize })
  +   ws.on('message', (data) => conn.onMessage(String(data)))
  +   ws.on('close', conn.onClose)
  +   ws.on('error', conn.onError)
  +   conn.ready.catch((err) => ws.close(1008, err.message))
  + })
  ```

  - `Connection` no longer exposes `room` / `sessionId` directly — they're carried on the resolved value of the new `Connection.ready` promise (`const { room, sessionId } = await conn.ready`).
  - Authorize and URL-parse failures now reject `ready` rather than throwing from `acceptConnection`; close the socket from `ready.catch`.
  - New `ConnectionClosedError` is the `ready` rejection when the socket closes before the connection became ready (benign). New `ConnectionReady` type for the resolved value.
  - Bun consumers: make the `open` handler **non-async** and assign `ws.data.conn` synchronously (see the updated Bun example).

## 1.4.0

### Minor Changes

- 392cf9d: Add a sync signal and graceful-shutdown persistence.

  - The server now sends a `synced` message right after delivering a client's initial state — even for an empty room — so clients can distinguish "still loading" from "genuinely empty". Older clients ignore the unknown message type.
  - `CanvasStore` exposes `isSynced` (latches `true` once the initial document is applied, immediately for local-only stores) and a `websocket.onSync` callback.
  - `Room.flush()` awaits a final write to storage, and `RoomManager.closeAll()` is now async — close sockets first, then flush every room in parallel. Await it from a SIGTERM/SIGINT handler so in-flight state survives a restart.

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

## 1.1.0

### Minor Changes

- e796270: Sync `field.buffer` components as sparse deltas instead of resending the whole array.

  Buffer fields (e.g. pen-stroke point arrays) now sync only their changed runs over the websocket — appends and tail edits ship a compact `{ __buf, len, runs }` delta rather than the full array on every change, turning per-stroke traffic from roughly O(N²) to O(N). Patches buffered between sends are also coalesced into a single merged patch.

  Deltas are a transport optimization only: server room state, IndexedDB persistence, and undo history all materialize them back into full arrays, so snapshots, reconnects, and existing persisted documents are unaffected (no data migration needed).

  This bumps the wire protocol (`PROTOCOL_VERSION` 1 → 2). A v2 client and a v1 server (or vice versa) are **not** interoperable — the version handshake disconnects mismatched peers — so upgrade and deploy `@woven-ecs/canvas-store` and `@woven-ecs/canvas-store-server` together. The two packages are now `linked` so their versions stay in lockstep.
