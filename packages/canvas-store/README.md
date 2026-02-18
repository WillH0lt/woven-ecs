<p align="center">
  <img src="https://raw.githubusercontent.com/WillH0lt/woven-ecs/refs/heads/main/docs/src/assets/logo.png" alt="Woven ECS Logo" width="50" />
</p>

<p align="center">
  <a href="https://woven-ecs.dev/canvas-store/introduction/">Read the Docs →</a>
</p>


# Canvas Store

Persistence, undo/redo, and real-time collaboration for canvas applications built with [@woven-ecs/core](https://www.npmjs.com/package/@woven-ecs/core).

## Installation

```bash
npm install @woven-ecs/core @woven-ecs/canvas-store
```

## Features

- **Real-time Sync** — WebSocket-based multiplayer with conflict resolution. Multiple users can edit the same document simultaneously.
- **Local-First** — Your app works offline by default. Data lives on the client and syncs to the server when connected.
- **Undo/Redo** — Full history tracking with configurable depth. Users can undo and redo changes across sessions.
- **Persistence** — Automatic IndexedDB storage for offline support. Changes are saved locally and synced when back online.
- **Migrations** — Version your component schemas with automatic migrations. Evolve your data model without breaking existing documents.
- **Configurable** — Configure sync behavior per component: persist to server, sync ephemerally, store locally, or skip entirely.

## Usage

```typescript
import { World } from '@woven-ecs/core';
import { CanvasStore, Synced } from '@woven-ecs/canvas-store';

import { Position, Velocity, Shape } from './components';

const components = [Position, Velocity, Shape];

const store = new CanvasStore({
  persistence: {
    documentId: 'my-document',
  },
  history: true,
  websocket: {
    documentId: 'my-document',
    url: 'wss://your-server.com',
    clientId: crypto.randomUUID(),
  },
});

await store.initialize({
  components,
});

// Create world with all components including Synced
const world = new World([...components, Synced]);

function loop() {
  world.execute((ctx) => {
    // Sync changes to persistence/network/history
    store.sync(ctx);

    // ...the rest of your loop
  });
  requestAnimationFrame(loop);
}

loop();
```

## Server

For real-time collaboration, use [@woven-ecs/canvas-store-server](../canvas-store-server/).

## Documentation

- [Introduction](https://woven-ecs.dev/canvas-store/introduction/)
- [How It Works](https://woven-ecs.dev/canvas-store/how-it-works/)
- [Components & Singletons](https://woven-ecs.dev/canvas-store/components-singletons/)
- [Client Setup](https://woven-ecs.dev/canvas-store/client-setup/)
- [Server Setup](https://woven-ecs.dev/canvas-store/server-setup/)
- [API Reference](https://woven-ecs.dev/reference/canvas-store/)

## License

MIT
