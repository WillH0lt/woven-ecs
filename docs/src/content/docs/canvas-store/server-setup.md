---
title: Server Setup
description: Configure the multiplayer server with different runtimes and storage backends
---

Example server implementations:
* [Bun server example](https://github.com/WillH0lt/woven-ecs/tree/main/packages/canvas-store-server/examples/bun)
* [Node.js server example](https://github.com/WillH0lt/woven-ecs/tree/main/packages/canvas-store-server/examples/node)

## Quick Start

```typescript
import { createServer } from 'node:http'
import { acceptConnection, FileStorage, RoomManager } from '@woven-ecs/canvas-store-server'
import { WebSocketServer } from 'ws'

const manager = new RoomManager({ idleTimeout: 60_000 })

const server = createServer((_req, res) => res.writeHead(200).end('ok'))
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const conn = acceptConnection({
    socket: ws,
    url: req.url ?? '',
    request: req,
    manager,
    authorize: async ({ roomId, token }) => {
      const claims = await validateToken(token) // your verifier
      if (claims.roomId !== roomId) throw new Error('token does not match this room')
      return {
        permissions: claims.canWrite ? 'readwrite' : 'readonly',
        metadata: { claims }, // optional — exposed via room.getSessionMetadata()
      }
    },
    roomOptions: (roomId) => ({
      createStorage: () => new FileStorage({ dir: './data', roomId }),
    }),
  })

  ws.on('message', (data) => conn.onMessage(String(data)))
  ws.on('close', conn.onClose)
  ws.on('error', conn.onError)

  conn.ready.catch((err) => ws.close(1008, (err as Error).message))
})

server.listen(8080)
```

That's the full setup. No URL parsing, no manual `handleSocketConnect`/`onTokenRefresh` plumbing — `acceptConnection` owns the protocol and re-runs `authorize` whenever the client sends a fresh token. If `authorize` throws on a refresh, the room closes the socket; the client's normal reconnect flow then mints a new token and retries.

### `acceptConnection` is runtime-agnostic

It depends only on a `WebSocketLike` socket (`{ send, close }`) and a URL string. Adapting to Bun, Deno, or uWebSockets is a matter of forwarding events from the runtime's WebSocket events into `conn.onMessage` / `conn.onClose` / `conn.onError`:

```typescript
// Bun
Bun.serve({
  fetch(req, server) {
    if (server.upgrade(req, { data: { req } })) return
    return new Response('ok')
  },
  websocket: {
    open(ws) {
      const conn = acceptConnection({
        socket: ws,
        url: ws.data.req.url,
        request: ws.data.req,
        manager,
        authorize: async ({ roomId, token }) => {
          const claims = await validateToken(token)
          if (claims.roomId !== roomId) throw new Error('mismatch')
          return { permissions: claims.canWrite ? 'readwrite' : 'readonly' }
        },
      })
      ws.data.conn = conn
      conn.ready.catch((err) => ws.close(1008, (err as Error).message))
    },
    message(ws, message) { ws.data.conn?.onMessage(String(message)) },
    close(ws) { ws.data.conn?.onClose() },
  },
})
```

### Per-session metadata

The optional `metadata` field returned from `authorize` is stored on the session and refreshed automatically when the client swaps tokens. Read it back with `conn.getMetadata()`, or via `room.getSessionMetadata(sessionId)` once `ready` resolves — useful for caching the verified token or claims when the server later makes outbound calls on the user's behalf.

```typescript
const { room, sessionId } = await conn.ready
const meta = room.getSessionMetadata(sessionId)
//   ^? unknown — type via the generic on acceptConnection<TRequest, TMeta>

// Or, at any point after ready, without destructuring:
const sameMeta = conn.getMetadata() // undefined until ready resolves
```

## Storage Backends

`canvas-store-server` provides some built-in storage options, but you can also implement your own by adhering to the `Storage` interface:

```typescript
import { MemoryStorage, FileStorage } from '@woven-ecs/canvas-store-server';

// In-memory (development)
new MemoryStorage();

// File-based (simple persistence)
new FileStorage({ dir: './data', roomId: 'doc-123' });

// Custom (implement the Storage interface)
class PostgresStorage implements Storage {
  async load(): Promise<RoomSnapshot | null> {
    // Load from database
  }
  async save(snapshot: RoomSnapshot): Promise<void> {
    // Save to database
  }
}
```

## Permissions

Each session has a permission level: `readwrite` or `readonly`. With `acceptConnection`, you return permissions from `authorize`. Without it (low-level path), pass them to `handleSocketConnect`:

```typescript
const sessionId = room.handleSocketConnect({
  socket: ws,
  clientId,
  permissions: 'readonly', // or 'readwrite'
});
```

- **`readwrite`** — client can send and receive patches.
- **`readonly`** — client can only receive patches.

You can change permissions dynamically:

```typescript
room.setSessionPermissions(sessionId, 'readwrite');
const perms = room.getSessionPermissions(sessionId);
```

To list all connected sessions:

```typescript
const sessions = room.getSessions();
// [{ sessionId, clientId, permissions, metadata }, ...]
```

## Low-level API

If `acceptConnection` doesn't fit your setup — custom URL params, non-standard handshake, fully-custom auth flow — drop down to the lower-level building blocks. You're then responsible for parsing the URL, calling your verifier, and wiring `onTokenRefresh`:

```typescript
import { RoomManager, FileStorage } from '@woven-ecs/canvas-store-server'

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, 'http://_')
  const roomId = url.searchParams.get('roomId')!
  const clientId = url.searchParams.get('clientId')!
  const token = url.searchParams.get('token')!

  // Defined locally so it closes over `roomId` and is reused for refresh.
  const authorize = async (t: string) => {
    const claims = await validateToken(t)
    if (claims.roomId !== roomId) throw new Error('mismatch')
    return { permissions: claims.canWrite ? 'readwrite' : 'readonly' as const }
  }

  let auth
  try { auth = await authorize(token) }
  catch { ws.close(1008, 'Unauthorized'); return }

  const room = await manager.getOrCreateRoom(roomId, {
    createStorage: () => new FileStorage({ dir: './data', roomId }),
    onTokenRefresh: (_, info) => authorize(info.token),
  })

  const sessionId = room.handleSocketConnect({
    socket: ws,
    clientId,
    permissions: auth.permissions,
  })

  ws.on('message', (data) => room.handleSocketMessage(sessionId, String(data)))
  ws.on('close', () => room.handleSocketClose(sessionId))
  ws.on('error', () => room.handleSocketError(sessionId))
})
```

### Graceful shutdown

Rooms persist on a throttled timer, so a process that exits abruptly can lose
edits made since the last save. Call `manager.closeAll()` from your signal
handlers: it's `async` and, before resolving, disconnects every client and
flushes each room to storage — so `await` it before exiting.

```typescript
async function shutdown(signal: string) {
  console.log(`${signal} received, flushing rooms...`)
  server.close() // stop accepting new connections
  await manager.closeAll() // disconnect clients, then flush every room
  process.exit(0)
}

// Kubernetes sends SIGTERM on rollout/scale-down; SIGINT is Ctrl-C locally.
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
```
