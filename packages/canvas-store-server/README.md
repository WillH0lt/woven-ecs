<p align="center">
  <img src="../../docs/src/assets/logo.png" alt="Woven ECS Logo" width="50" />
</p>

<p align="center">
  <a href="https://woven-ecs.dev/canvas-store/server-setup/">Read the Docs →</a>
</p>


# Canvas Store Server

Real-time collaboration server for [@woven-ecs/canvas-store](https://www.npmjs.com/package/@woven-ecs/canvas-store) clients.

## Installation

```bash
npm install @woven-ecs/canvas-store-server
```

## Examples

| Example | Description |
|---------|-------------|
| [Node.js](./examples/ws) | WebSocket server using the `ws` library. |
| [Bun](./examples/bun) | Native Bun WebSocket server. |

## Usage

```typescript
import { WebSocketServer } from 'ws';
import { RoomManager, FileStorage } from '@woven-ecs/canvas-store-server';

const manager = new RoomManager();
const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, 'http://localhost');
  const roomId = url.searchParams.get('roomId') ?? 'default';
  const clientId = url.searchParams.get('clientId')!;

  const room = await manager.getOrCreateRoom(roomId, {
    createStorage: () => new FileStorage({ dir: './data', roomId }),
  });

  const sessionId = room.handleSocketConnect({
    socket: ws,
    clientId,
    permissions: 'readwrite',
  });

  ws.on('message', (data) => room.handleSocketMessage(sessionId, String(data)));
  ws.on('close', () => room.handleSocketClose(sessionId));
});
```

## Storage Backends

```typescript
import { MemoryStorage, FileStorage } from '@woven-ecs/canvas-store-server';

// In-memory (development)
new MemoryStorage();

// File-based (simple persistence)
new FileStorage({ dir: './data', roomId: 'doc-123' });

// Custom (implement the Storage interface)
class PostgresStorage implements Storage {
  async load(): Promise<RoomSnapshot | null> { /* ... */ }
  async save(snapshot: RoomSnapshot): Promise<void> { /* ... */ }
}
```

## Client

Connect from the browser using [@woven-ecs/canvas-store](../canvas-store/):

```typescript
import { CanvasStore } from '@woven-ecs/canvas-store';

const store = new CanvasStore({
  websocket: {
    enabled: true,
    documentId: 'my-document',
    url: 'wss://your-server.com',
    clientId: crypto.randomUUID(),
  },
});
```

## Documentation

- [Server Setup](https://woven-ecs.dev/canvas-store/server-setup/)
- [Client Setup](https://woven-ecs.dev/canvas-store/client-setup/)
- [API Reference](https://woven-ecs.dev/reference/canvas-store-server/)

## License

MIT
