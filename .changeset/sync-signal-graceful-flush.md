---
"@woven-ecs/canvas-store": minor
"@woven-ecs/canvas-store-server": minor
---

Add a sync signal and graceful-shutdown persistence.

- The server now sends a `synced` message right after delivering a client's initial state — even for an empty room — so clients can distinguish "still loading" from "genuinely empty". Older clients ignore the unknown message type.
- `CanvasStore` exposes `isSynced` (latches `true` once the initial document is applied, immediately for local-only stores) and a `websocket.onSync` callback.
- `Room.flush()` awaits a final write to storage, and `RoomManager.closeAll()` is now async — close sockets first, then flush every room in parallel. Await it from a SIGTERM/SIGINT handler so in-flight state survives a restart.
