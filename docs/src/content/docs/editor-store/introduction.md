---
title: Introduction
description: Build collaborative editors with persistence, undo/redo, and real-time sync
---

The `@woven-ecs/editor-store` and `@woven-ecs/editor-store-server` packages provide a complete solution for building collaborative applications. They handle persistence (IndexedDB), undo/redo (history management), and real-time collaboration (WebSocket sync) while maintaining state convergence across multiple clients.

## Installation

```bash
# Client package
npm install @woven-ecs/editor-store

# Server package (for multiplayer)
npm install @woven-ecs/editor-store-server
```

## Getting Started

### 1. Define Components with Sync Behaviors

Use `defineEditorComponent` and `defineEditorSingleton` to create your components/singletons. The `sync` option determines how the store handles that particular component:

```typescript
import { field } from '@woven-ecs/core';
import { defineEditorComponent, defineEditorSingleton } from '@woven-ecs/editor-store';

// Persisted to server, synced to all clients, supports undo/redo
const Shape = defineEditorComponent(
  { name: 'shape', sync: 'document' },
  {
    x: field.float32(),
    y: field.float32(),
    width: field.float32(),
    height: field.float32(),
  }
);

// Synced to all clients but not persisted (e.g., cursors)
const Cursor = defineEditorComponent(
  { name: 'cursor', sync: 'ephemeral' },
  {
    clientId: field.string(),
    x: field.float32(),
    y: field.float32(),
  }
);

// Local only - persisted to IndexedDB but not synced
const Camera = defineEditorSingleton(
  { name: 'camera', sync: 'local' },
  {
    zoom: field.float32(),
    position: field.tuple(field.float32(), 2),
  }
);

// Not persisted or synced - transient state
const npc = defineEditorComponent(
  { name: 'npc', sync: 'none' },
  {
    name: field.string(),
  }
);
```

### 2. Create the EditorStore

```typescript
import { EditorStore, Synced } from '@woven-ecs/editor-store';

const store = new EditorStore({
  documentId: 'my-document',
  usePersistence: true,  // Optional: Enable IndexedDB
  useHistory: true,      // Optional: Enable undo/redo
  websocket: {           // Optional: enable multiplayer
    url: 'wss://your-server.com',
    clientId: crypto.randomUUID(), // Unique ID that identifies this client
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
import { Synced } from '@woven-ecs/editor-store';

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

- [Components & Singletons](/editor-store/components-singletons/) - Schema migrations and excluding fields from history
- [Client Setup](/editor-store/client-setup/) - Connection management and offline support
- [Server Setup](/editor-store/server-setup/) - Configure the multiplayer server
- [History](/editor-store/history/) - Advanced undo/redo and change batching
