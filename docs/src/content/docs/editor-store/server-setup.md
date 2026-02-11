---
title: Server Setup
description: Configure the multiplayer server with different runtimes and storage backends
---

## Node.js with ws

```typescript
import { WebSocketServer } from 'ws';
import { RoomManager, FileStorage } from '@woven-ecs/editor-store-server';

const wss = new WebSocketServer({ port: 8080 });

const rooms = new RoomManager({
  createStorage: (roomId) => new FileStorage({
    dir: './data',
    roomId,
  }),
});

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, 'http://localhost');
  const documentId = url.searchParams.get('documentId')!;
  const clientId = url.searchParams.get('clientId')!;

  const room = await rooms.getRoom(documentId);
  const sessionId = room.handleSocketConnect({
    socket: ws,
    clientId,
    permissions: 'read-write',
  });

  ws.on('message', (data) => {
    room.handleSocketMessage(sessionId, data.toString());
  });

  ws.on('close', () => {
    room.handleSocketClose(sessionId);
  });
});
```

## Bun

```typescript
import { RoomManager, MemoryStorage } from '@woven-ecs/editor-store-server';

const rooms = new RoomManager({
  createStorage: () => new MemoryStorage(),
});

Bun.serve({
  port: 8080,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      server.upgrade(req, { data: { url } });
      return;
    }
    return new Response('Not found', { status: 404 });
  },
  websocket: {
    async open(ws) {
      const documentId = ws.data.url.searchParams.get('documentId');
      const clientId = ws.data.url.searchParams.get('clientId');

      const room = await rooms.getRoom(documentId);
      ws.data.sessionId = room.handleSocketConnect({
        socket: ws,
        clientId,
        permissions: 'read-write',
      });
      ws.data.room = room;
    },
    message(ws, message) {
      ws.data.room.handleSocketMessage(ws.data.sessionId, message.toString());
    },
    close(ws) {
      ws.data.room.handleSocketClose(ws.data.sessionId);
    },
  },
});
```

## Storage Backends

```typescript
import { MemoryStorage, FileStorage } from '@woven-ecs/editor-store-server';

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

## Conflict Resolution

The server uses **last-write-wins at the field level**:

- Each field has a timestamp tracking when it was last modified
- When two clients edit the same field, the later timestamp wins
- Different fields on the same component can be edited simultaneously without conflict

This provides a good balance between simplicity and collaborative editing support.
