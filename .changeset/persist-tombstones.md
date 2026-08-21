---
'@woven-ecs/canvas-store-server': patch
---

Persist tombstones so deletions survive a room reload.

`getSnapshot()` stripped `{ _exists: false }` entries (and their timestamps) from the persisted document. `buildDiff` can only send what is in `state`, so once a room had been evicted and reloaded, a deletion was invisible to any client that had not already applied it. That client kept the entity in its cached copy, showed it in its view, and — believing the server still had it — only ever sent partial patches for it, which the server drops. Delete something on one machine, open a cached copy on another after the room has gone idle, and the deleted thing was back for good. Any snapshot taken from that client (e.g. for publishing) carried the phantom with it.

Tombstones are now kept in the snapshot, so a reconnecting client with an older cursor receives the deletion exactly as it would from a live room. Consumers that read `snapshot.state` must skip `_exists === false` entries — the same rule that already applied to a live room's in-memory state.

Tombstones are kept indefinitely: each is a key plus one flag and one timestamp, and a document accumulates only as many as it has had deletions. Compacting them would re-open the resurrection window for whichever deletions were dropped.
