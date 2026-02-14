# @woven-ecs/canvas-store-server

Real-time collaboration server for [@woven-ecs/canvas-store](https://www.npmjs.com/package/@woven-ecs/canvas-store) clients.

## Features

- **Room-based collaboration** - Multiple users editing the same document
- **Conflict resolution** - Last-write-wins with field-level timestamps
- **Pluggable storage** - In-memory, file-based, or custom backends
- **Runtime agnostic** - Works with Node.js, Bun, Deno, or any WebSocket server

## Installation

```bash
npm install @woven-ecs/canvas-store-server
```

## Usage

### With Node.js (ws)

```typescript
import { WebSocketServer } from 'ws';
import { RoomManager, MemoryStorage } from '@woven-ecs/canvas-store-server';

const wss = new WebSocketServer({ port: 8080 });
const storage = new MemoryStorage();
const rooms = new RoomManager({ storage });

wss.on('connection', (ws, req) => {
  const documentId = new URL(req.url, 'http://localhost').searchParams.get('documentId');

  rooms.handleConnection(ws, {
    documentId,
    permission: 'read-write',
  });
});
```

### With Bun

```typescript
import { RoomManager, MemoryStorage } from '@woven-ecs/canvas-store-server';

const storage = new MemoryStorage();
const rooms = new RoomManager({ storage });

Bun.serve({
  port: 8080,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const documentId = url.searchParams.get('documentId');
      server.upgrade(req, { data: { documentId } });
      return;
    }
    return new Response('Not found', { status: 404 });
  },
  websocket: {
    open(ws) {
      rooms.handleConnection(ws, {
        documentId: ws.data.documentId,
        permission: 'read-write',
      });
    },
    message(ws, message) {
      // Handled by RoomManager
    },
    close(ws) {
      // Handled by RoomManager
    },
  },
});
```

## Storage Backends

### MemoryStorage

In-memory storage for development and testing:

```typescript
import { MemoryStorage } from '@woven-ecs/canvas-store-server';

const storage = new MemoryStorage();
```

### FileStorage

Persist documents to the filesystem:

```typescript
import { FileStorage } from '@woven-ecs/canvas-store-server';

const storage = new FileStorage({
  directory: './data',
});
```

### Custom Storage

Implement the `Storage` interface for databases like PostgreSQL, Redis, etc:

```typescript
import type { Storage, RoomSnapshot } from '@woven-ecs/canvas-store-server';

class PostgresStorage implements Storage {
  async load(documentId: string): Promise<RoomSnapshot | null> {
    // Load from database
  }

  async save(documentId: string, snapshot: RoomSnapshot): Promise<void> {
    // Save to database
  }
}
```

## Permissions

Control read/write access per connection:

```typescript
rooms.handleConnection(ws, {
  documentId: 'doc-123',
  permission: 'read-only',  // or 'read-write'
});
```

## Client

Connect from the browser using [@woven-ecs/canvas-store](https://www.npmjs.com/package/@woven-ecs/canvas-store):

```typescript
import { CanvasStore } from '@woven-ecs/canvas-store';

const store = new CanvasStore({
  documentId: 'doc-123',
  websocket: {
    url: 'wss://your-server.com/ws',
  },
});
```

## Documentation

- [Full Documentation](https://woven-ecs.dev)

## License

MIT
