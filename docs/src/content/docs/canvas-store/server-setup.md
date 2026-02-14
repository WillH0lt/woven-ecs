---
title: Server Setup
description: Configure the multiplayer server with different runtimes and storage backends
---

Example server implementations:
* [Bun server example](https://github.com/WillH0lt/woven-ecs/tree/main/packages/canvas-store-server/examples/bun)
* [Node.js server example](https://github.com/WillH0lt/woven-ecs/tree/main/packages/canvas-store-server/examples/node)


## Node.js with ws

You will need to manually wire RoomManager to your WebSocket server. Here's a minimal example using the `ws` library and file-based storage:

```typescript
import { createServer } from 'node:http'
import { FileStorage, RoomManager } from '@woven-ecs/canvas-store-server'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 8087

const manager = new RoomManager({
  idleTimeout: 60_000, // Close empty rooms after 60s (default: 30s)
})

const server = createServer((_req, res) => {
  res.writeHead(200).end('ok')
})

const wss = new WebSocketServer({ server })

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)
  const roomId = url.searchParams.get('roomId') ?? 'default'
  const clientId = url.searchParams.get('clientId')
  // const token = url.searchParams.get('token')

  if (!clientId) {
    ws.close(1008, 'Missing clientId query parameter')
    return
  }

  // Example: validate the token and determine permissions.
  // Replace this with your own authentication logic.
  // const auth = await validateToken(token);
  // if (!auth) { ws.close(1008, "Unauthorized"); return; }
  // const permissions = auth.canWrite ? "readwrite" : "readonly";

  const room = await manager.getOrCreateRoom(roomId, {
    saveThrottleMs: 5_000,
    createStorage: () => new FileStorage({ dir: './data', roomId }),
  })

  const sessionId = room.handleSocketConnect({
    socket: ws,
    clientId,
    permissions: 'readwrite',
  })

  ws.on('message', (data) => room.handleSocketMessage(sessionId, String(data)))
  ws.on('close', () => room.handleSocketClose(sessionId))
  ws.on('error', () => room.handleSocketError(sessionId))

  console.log(`Client ${clientId} connected to room ${roomId} (${room.getSessionCount()} active)`)
})

server.listen(PORT, () => {
  console.log(`ECS sync server listening on ws://localhost:${PORT}`)
  console.log(`Connect: ws://localhost:${PORT}?roomId=myRoom&clientId=myClient`)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  manager.closeAll()
  server.close()
  process.exit(0)
})

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

Each session connects with a permission level: `readwrite` or `readonly`.

```typescript
const sessionId = room.handleSocketConnect({
  socket: ws,
  clientId,
  permissions: 'readonly', // or 'readwrite'
});
```

- **`readwrite`** - Client can send and receive patches
- **`readonly`** - Client can only receive patches

You can change permissions dynamically:

```typescript
// Upgrade a viewer to editor
room.setSessionPermissions(sessionId, 'readwrite');

// Downgrade to read-only
room.setSessionPermissions(sessionId, 'readonly');

// Check current permissions
const perms = room.getSessionPermissions(sessionId);
```

To list all connected sessions:

```typescript
const sessions = room.getSessions();
// [{ sessionId, clientId, permissions }, ...]
```
