---
title: Client Setup
description: Configure EditorStore for offline and multiplayer use
---

## Basic Setup (Offline Only)

```typescript
import { World } from '@woven-ecs/core';
import { EditorStore, Synced } from '@woven-ecs/editor-store';

const store = new EditorStore({
  documentId: 'my-document',
  usePersistence: true,  // Enable IndexedDB
  useHistory: true,      // Enable undo/redo
});

await store.initialize({
  components: [Position, Velocity, Shape],
  singletons: [DocumentSettings],
});

// Create world with all components including Synced
const world = new World([Position, Velocity, Shape, Synced]);
store.connectWorld(world);
```

## With Multiplayer

```typescript
const store = new EditorStore({
  documentId: 'my-document',
  usePersistence: true,
  useHistory: true,
  websocket: {
    url: 'wss://your-server.com',
    clientId: crypto.randomUUID(),
  },
});

await store.initialize({
  components: [Position, Cursor],
  singletons: [DocumentSettings],
});

// Connect when ready
await store.connect();
```

## Sync Loop

Call `sync()` every frame to propagate changes:

```typescript
function gameLoop(ctx) {
  // Your game logic...
  movementSystem(ctx);

  // Sync state with persistence/network/history
  store.sync(ctx);
}

world.execute(gameLoop);
```

## Connection Management

```typescript
// Check connection status
if (store.isOnline) {
  console.log('Connected to server');
}

// Manually disconnect/reconnect
store.disconnect();
await store.connect();

// Clean up when done
store.close();
```

## Offline Support

When offline, changes are buffered locally:

1. Changes are saved to IndexedDB (if `usePersistence: true`)
2. On reconnect, buffered changes are sent to the server
3. Server sends any changes that happened while offline

## Version Mismatch Handling

```typescript
const store = new EditorStore({
  documentId: 'my-doc',
  websocket: { url: 'wss://server.com' },
  onVersionMismatch: (serverVersion) => {
    // Prompt user to refresh
    alert('Please refresh to get the latest version');
  },
});
```
