---
"@woven-ecs/canvas-store-server": major
---

**Breaking:** `acceptConnection` now returns synchronously instead of a `Promise`. This fixes a connect-time race where the client's first `reconnect` frame was dropped, leaving the document stuck loading forever.

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
