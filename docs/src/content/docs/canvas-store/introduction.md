---
title: Introduction
description: Build collaborative canvas applications with persistence, undo/redo, and real-time sync
---

The `@woven-ecs/canvas-store` and `@woven-ecs/canvas-store-server` packages provide a complete solution for building collaborative applications. They handle persistence (IndexedDB), undo/redo (history management), and real-time collaboration (WebSocket sync) while maintaining state convergence across multiple clients.

## Installation

```bash
# Client package
npm install @woven-ecs/canvas-store

# Server package (for multiplayer)
npm install @woven-ecs/canvas-store-server
```

## Getting Started

### 1. Define Components with Sync Behaviors

Use `defineCanvasComponent` and `defineCanvasSingleton` to create your components/singletons. The `sync` option determines how the store handles that particular component:

```typescript
import { field } from '@woven-ecs/core';
import { defineCanvasComponent, defineCanvasSingleton } from '@woven-ecs/canvas-store';

// Persisted to server, synced to all clients, supports undo/redo
const Shape = defineCanvasComponent(
  { name: 'shape', sync: 'document' },
  {
    x: field.float32(),
    y: field.float32(),
    width: field.float32(),
    height: field.float32(),
  }
);

// Synced to all clients but not persisted (e.g., cursors)
const Cursor = defineCanvasComponent(
  { name: 'cursor', sync: 'ephemeral' },
  {
    clientId: field.string(),
    x: field.float32(),
    y: field.float32(),
  }
);

// Local only - persisted to IndexedDB but not synced
const Camera = defineCanvasSingleton(
  { name: 'camera', sync: 'local' },
  {
    zoom: field.float32(),
    position: field.tuple(field.float32(), 2),
  }
);

// Not persisted or synced - transient state
const npc = defineCanvasComponent(
  { name: 'npc', sync: 'none' },
  {
    name: field.string(),
  }
);
```

### 2. Create the CanvasStore

```typescript
import { CanvasStore, Synced } from '@woven-ecs/canvas-store';

const store = new CanvasStore({
  persistence: {
    enabled: true,
    documentId: 'my-document',
  },
  history: {
    enabled: true,
  },
  websocket: {
    enabled: true,
    documentId: 'my-document',
    url: 'wss://your-server.com',
    clientId: crypto.randomUUID(),
  },
});

await store.initialize({
  components: [Shape, Cursor],
  singletons: [Camera],
});
```

### 3. Add a Synced Entity

The `Synced` component is required for any entity to be tracked by the store. The `id` field is a stable identifier for proper tracking across sessions and clients.

```typescript
import { World, createEntity, addComponent } from '@woven-ecs/core';
import { Synced } from '@woven-ecs/canvas-store';

import { Shape, Cursor } from './components';

const world = new World([Shape, Cursor, Synced]);

// Create synced entities
world.execute((ctx) => {
  const eid = createEntity(ctx);
  addComponent(ctx, eid, Shape, { x: 100, y: 100, width: 50, height: 50 });

  // Add the Synced component with a stable UUID
  addComponent(ctx, eid, Synced, { id: crypto.randomUUID() });
});
```

:::tip
If you're generating IDs on the client, use globally unique IDs like UUIDs to avoid collisions in multiplayer scenarios.
:::

### 4. Sync the Store Every Frame

```typescript
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

And that's it! The store will automatically handle persistence, undo/redo, and real-time sync based on the sync behaviors you defined for your components.

## Next Steps

- [Components & Singletons](/canvas-store/components-singletons/) - Schema migrations and excluding fields from history
- [Client Setup](/canvas-store/client-setup/) - Connection management, offline support, and undo/redo
- [Server Setup](/canvas-store/server-setup/) - Configure the multiplayer server
