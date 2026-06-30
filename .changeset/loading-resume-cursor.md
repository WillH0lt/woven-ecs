---
"@woven-ecs/canvas-store": patch
"@woven-ecs/canvas-store-server": patch
---

Fix documents sometimes loading blank after an interrupted or laggy initial sync.

The websocket resume cursor (`lastTimestamp`) now advances when document patches are **applied** (in `pull()`), not when they're received, and it no longer advances on the ack of an ephemeral (cursor/presence) send. Previously either could push the persisted cursor ahead of the stored document, so a reload or reconnect mid-load would request an empty diff from the server and never recover the document.

Ephemeral state now travels without a timestamp: `PatchBroadcast.timestamp` is present only alongside `documentPatches`, so ephemeral changes can never be mistaken for document progress.
