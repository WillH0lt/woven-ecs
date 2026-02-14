# @woven-ecs/canvas-store

Persistence, undo/redo, and real-time collaboration for canvas applications built with [@woven-ecs/core](https://www.npmjs.com/package/@woven-ecs/core).

## Features

- **Undo/Redo** - Full history tracking with configurable depth
- **Persistence** - Automatic IndexedDB storage for offline support
- **Real-time collaboration** - WebSocket sync with conflict resolution
- **Migrations** - Version your component schemas with automatic migrations
- **Framework agnostic** - Works with any UI framework

## Installation

```bash
npm install @woven-ecs/core @woven-ecs/canvas-store
```

## Usage

```typescript
import { World } from '@woven-ecs/core';
import {
  CanvasStore,
  defineCanvasComponent,
  defineCanvasSingleton,
} from '@woven-ecs/canvas-store';

// Define synced components
const Rectangle = defineCanvasComponent(
  {
    x: field.float32(),
    y: field.float32(),
    width: field.float32(),
    height: field.float32(),
  },
  {
    sync: 'full',    // Sync all fields
    version: 1,      // Schema version for migrations
  }
);

// Create the store
const store = new CanvasStore({
  documentId: 'my-document',
  usePersistence: true,
  useHistory: true,
  websocket: {
    url: 'wss://your-server.com',
  },
});

await store.initialize({
  components: [Rectangle],
  singletons: [],
});

// Connect to the ECS world
const world = new World([Rectangle]);
store.connectWorld(world);

// Undo/redo
store.undo();
store.redo();
```

## Sync Behaviors

Control how each component syncs across clients:

```typescript
// Full sync - all field changes are synchronized
const Position = defineCanvasComponent({ ... }, { sync: 'full' });

// Partial sync - only specified fields sync
const Selection = defineCanvasComponent({ ... }, { sync: ['selectedIds'] });

// Local only - no synchronization
const LocalState = defineCanvasComponent({ ... }, { sync: 'none' });
```

## Migrations

Handle schema changes across versions:

```typescript
const Shape = defineCanvasComponent(
  {
    x: field.float32(),
    y: field.float32(),
    color: field.string(),  // Added in v2
  },
  {
    version: 2,
    migrations: [
      {
        from: 1,
        to: 2,
        migrate: (data) => ({
          ...data,
          color: '#000000',  // Default for existing shapes
        }),
      },
    ],
  }
);
```

## Server

For real-time collaboration, use [@woven-ecs/canvas-store-server](https://www.npmjs.com/package/@woven-ecs/canvas-store-server).

## Documentation

- [Full Documentation](https://woven-ecs.dev)
- [Core ECS Guide](https://woven-ecs.dev/guide/getting-started/)

## License

MIT
