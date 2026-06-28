# PLAN — Server-rollback recovery ("reverse resync")

## Problem

The persistence save is throttled (`saveThrottleMs`, default 10s — `Room.ts`). If the
server process crashes and a new instance reloads the last snapshot, it comes back at
timestamp `T_s`, having lost every op applied in `(T_s, T_crash]`. Today nothing heals
this: the client keeps its own copy locally, but the reconnect protocol only fills gaps
*from* the server, so the shared document silently diverges and lost edits never return.

## Approach

Mirror the server's existing catch-up path **in reverse**. The server already keeps a
per-field timestamp map and diffs it to catch up out-of-date clients
(`Room.buildDiff(since)`). We add the symmetric direction: when the server detects a
client is *ahead* of it, it asks that client to send everything after `T_s`, and the
client runs the same field-level diff over its own state + a mirrored timestamp map.

### Why this is sound (confirmed by reading the code)

- **Persistence is atomic-to-a-point.** `getSnapshot()` + `FileStorage.save` write the
  whole `{timestamp, state, timestamps}` in one shot. A restore is internally consistent
  at `T_s`, so a **scalar cutoff is sufficient** — the client never needs the server's
  full map, just the single number `T_s`.
- **Detection is trivial server-side.** `handleReconnect` already receives
  `req.lastTimestamp` and holds `this.timestamp`. `req.lastTimestamp > this.timestamp`
  ⇒ the client saw ops the server lost.
- **The heal rides the existing patch path.** The client's resync payload is sent as a
  normal `patch`, so `applyAndBroadcast` acks it, re-persists, bumps the timestamp above
  everything, and propagates to other clients for free.
- **Granularity is per-field**, to match the server (`FieldTimestamps`). Buffer fields
  cost one timestamp for the whole field, so the map stays bounded by components×fields.

## Protocol change

One new **server→client** message; **no** new client→server message (reuses `patch`).

```ts
// added to ServerMessage in BOTH packages' types.ts
interface ResyncRequest {
  type: 'resync'
  since: number   // the restored server's current timestamp (T_s)
}
```

Backward compatibility: additive. Old clients hit the `switch` default and ignore it
(they simply don't heal, i.e. today's behavior), so **no `PROTOCOL_VERSION` bump is
strictly required**. Leaving it at 2. (Revisit if we later make resync mandatory.)

---

## Phase 1 — Session-only healing (core mechanism)

Heals any client that witnessed the lost ops and **has not reloaded** since. This is the
bulk of the value and ships independently.

### Server (`canvas-store-server`)

- [x] `src/types.ts`: add `ResyncRequest` to `ServerMessage`.
- [x] `src/Room.ts` `handleReconnect`: detect `req.lastTimestamp > this.timestamp` and
      send `{ type: 'resync', since }`. (Normal `buildDiff` response kept; it's ~empty
      when the client is ahead.)
- [x] Ordering: capture `since` *before* `applyAndBroadcast`, so the client's own
      inbound offline buffer doesn't mask the cutoff, and readonly clients never resync.

### Client (`canvas-store`)

- [x] `src/types.ts`: add `ResyncRequest` to `ServerMessage` + `FieldTimestamps`.
- [x] `src/adapters/Websocket.ts`: mirrored per-field timestamp map (`recordTimestamps`):
  - on `ack`: record `inFlight.get(messageId)` fields at `ack.timestamp`.
  - on `patch`: record the filtered broadcast fields at `msg.timestamp`.
  - mirrors server `updateTimestamps` reset for `_exists:false`; overwrites (not `max`).
- [x] `src/adapters/Websocket.ts`: `case 'resync'` → `buildResyncPatch(since)` sent as a
      normal `patch`; folds in offlineBuffer + documentSendBuffer + inFlight.
- [x] WS adapter keeps its **own document mirror** (`this.state`), updated in `push()`
      from every document mutation (any origin), the same way ECS/Persistence track their
      state. `applyToState` mirrors the server's `applyPatch` (tombstones kept, buffer
      deltas materialized). `buildResyncPatch` reads this mirror — no cross-adapter
      callback. (Replaced an earlier `getDocumentState` callback into the ECS adapter,
      which was rejected as hidden coupling.)

### Tests (Phase 1) — all green (395 total)

- [x] Server: sends `resync` iff `lastTimestamp > timestamp`; not for level/behind; not
      for readonly; `since` captured pre-apply.
- [x] Server: full rollback heal round-trip via `MemoryStorage` (load earlier snapshot →
      witness reconnects → replies → room reconverges).
- [x] Client: reverse diff sends only fields after `since`, pulled from current state.
- [x] Client: re-asserts a windowed deletion; folds offline edits; records remote-write
      timestamps; sends nothing when nothing is after `since`.

---

## Phase 2 — Cross-session healing (durable tombstones)

Lets a client heal even after a page reload.

- [x] Persist the client timestamp map into the `-ws` meta store next to `lastTimestamp`
      / `offlineBuffer`. No custom debounce needed — `KeyValueStore` already buffers and
      collapses repeat puts to one flush/interval (and flushes on close). Loaded in
      `init()`; the document mirror is reseeded separately by the persistence adapter via
      the mutation router.
- [x] Test: reload between the ops and the reconnect; a windowed **edit** still heals
      using the persisted timestamps + reseeded mirror.
- [x] **Deletions now heal across a reload.** `PersistenceAdapter` retains a tombstone
      (`store.put(key, {_exists:false})`) instead of hard-deleting, so the reloaded mirror
      carries the deletion and `buildResyncPatch` re-asserts it. Migration skips `_exists !==
      true` so tombstones pass through untouched; `readPersistedDocument` filters them so
      `seedRoom` semantics are unchanged; the partial-update branch skips a tombstoned base.
      Tests updated (`'retains a tombstone on deletion'`, `'user deletions persist...'`) and a
      cross-session deletion-heal test added.
- [~] **GC for tombstones — won't do (decided).** A correct GC would need the server to
      advertise its last-*durable* timestamp; the team decided tracking that isn't worth the
      cost. Tombstones (and timestamp-map entries) accumulate; accepted as a known
      limitation for now.
- [ ] Minor: init-timing. A resync that arrives before the first post-reload `sync()` has
      reseeded the mirror would heal incompletely. The window is narrow (resync needs a
      network RTT; first `sync()` runs within a frame of `initialize()` resolving). Revisit
      only if it shows up in practice (options: defer answering resync until the mirror is
      seeded, or have the WS adapter persist its own mirror — at the cost of duplicating
      the doc).

---

## Phase 3 — Hardening (separate from the rollback feature)

- [x] `FileStorage.save` made crash-safe: write to a unique temp file then atomic
      `rename` over the target, so a mid-write crash can't leave a truncated, unparseable
      file (which `load()` would treat as "no state", resetting the room). Saves are also
      serialized via a `writeChain` — the room issues fire-and-forget saves that can
      overlap, and concurrent renames onto one target race (intermittently fail on
      Windows); chaining keeps them ordered, last-issued-wins. Tests added
      (`FileStorage.test.ts`): round-trip, missing/corrupt load, atomic replace + no temp
      leftovers, serialized concurrent saves.
- [x] `saveThrottleMs` is already exposed via `RoomOptions` — it's the hard ceiling on the
      loss window; tune per deployment. No code change needed.

---

## Known limits (document, don't fix in P1)

- **~10s loss ceiling**: equal to `saveThrottleMs`. Healing only recovers ops some
  reconnecting client still holds; if no witness reconnects, the data is gone.
- **Concurrent post-recovery edits**: targeted reverse-diff minimizes the clobber
  surface vs a full-doc push, but residual LWW-by-arrival races are inherent.
- **Multi-client**: several ahead-clients each send their slice; overlaps are small,
  identical re-asserts are harmless, and the room converges.

## Notes / rationale captured during design

- Per-field (not per-component) to reuse the server's `buildDiff` shape exactly.
- Scalar `since` is enough *because* persistence is atomic; revisit only if the server's
  storage backend ever becomes per-key/uneven.
- `lastTimestamp` (and the map) must be set, not `max`'d: after a rollback the client
  must drop back into the server's restored timestamp domain, or detection
  (`lastTimestamp > timestamp`) would re-fire on every reconnect until the server's
  counter climbed back past `T_crash`.
- Detection invariant: the server timestamp must be a per-document counter persisted
  *inside* the snapshot and advanced only on apply — which it is
  (`Room.timestamp` is part of `RoomSnapshot`).

## End-to-end test (cross-package)

- [x] `__tests__/rollbackRecovery.e2e.test.ts` (repo root) wires the **real**
      `WebsocketAdapter` to the **real** `Room` over an in-memory socket bridge — real JSON
      wire messages, neither half mocked — proving the two independently-implemented
      protocol sides actually agree. 9 tests across two suites:
      - rollback recovery: bridge sanity, heal when a witness reconnects, windowed-deletion
        heal, and a healthy reconnect that triggers no resync.
      - client/server state merge: field-level merge of concurrent edits, same-field
        last-writer-wins, fresh-client catch-up, offline edits merging with server-side
        changes made while away, and a sparse buffer-delta append materializing through the
        server. (In-flight strip ordering stays in the unit suites — the synchronous bridge
        can't model sub-message TCP ordering.)
      Run via `pnpm test:e2e` (dedicated `vitest.e2e.config.ts` anchored at root so it
      doesn't re-run the package suites); `pnpm test` runs package suites then e2e. Root
      `__tests__` added to Biome scope; Biome's build-artifact ignores fixed
      (`!**/build/**`, `!**/.tsup/**`) so `lint:ci` is clean locally.

## Status

- [x] Phase 1 complete (session-only healing) — types, server detection, client map +
      reverse diff, own-state mirror, tests.
- [x] Phase 2 complete (cross-session healing) — persisted timestamp map + retained
      tombstones; edits and deletions both heal across a reload. Tombstone GC declined.
- [x] Phase 3 complete (hardening) — `FileStorage` atomic write + serialized saves;
      `saveThrottleMs` already configurable.

All 402 tests pass; both packages typecheck clean. (Pre-existing `migrations.test.ts`
mock-typing errors are unrelated and untouched.)
