---
title: Client Setup
description: Configure CanvasStore for offline and multiplayer use
---

Set up Canvas Store with persistence, undo/redo, and multiplayer sync:

```typescript
import { World } from '@woven-ecs/core';
import { CanvasStore, Synced } from '@woven-ecs/canvas-store';

import { Position, Velocity, Shape } from './components';

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
    startOffline: false,
    token: 'auth-token',
    onVersionMismatch: (serverVersion) => {
      alert('Please refresh to get the latest version');
    },
  },
});

await store.initialize({
  components: [Position, Velocity, Shape],
  singletons: [DocumentSettings],
});

// Create world with all components including Synced
const world = new World([Position, Velocity, Shape, Synced]);

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

## Configuration Options

### CanvasStore Options

| Option | Type | Description |
|--------|------|-------------|
| `persistence` | `PersistenceOptions` | Persistence configuration. See below. |
| `history` | `HistoryOptions` | History/undo-redo configuration. See below. |
| `websocket` | `WebsocketOptions` | WebSocket configuration. See below. |

### Persistence Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | Required | Enable IndexedDB persistence. |
| `documentId` | `string` | Required | Unique identifier for the document. Used to namespace IndexedDB storage. |

### History Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | Required | Enable undo/redo functionality. |
| `commitCheckpointAfterFrames` | `number` | `60` | Number of quiet frames (no mutations) before committing pending changes to the undo stack. |
| `maxHistoryStackSize` | `number` | `100` | Maximum number of undo steps to keep in history. Older entries are discarded. |

### WebSocket Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable WebSocket multiplayer sync. |
| `documentId` | `string` | Required | Unique identifier for the document on the server. |
| `url` | `string` | Required | WebSocket server URL (e.g., `wss://your-server.com`). |
| `clientId` | `string` | Required | Unique identifier for this client. This ID gets sent to other users when broadcasting changes. |
| `startOffline` | `boolean` | `false` | Start in offline mode without connecting. Changes are queued until `connect()` is called. |
| `token` | `string` | `undefined` | Authentication token sent as a query parameter (`?token=...`) to the server. |
| `onVersionMismatch` | `function` | `undefined` | Callback invoked when server reports a protocol version mismatch. Receives the server's protocol version number. |
| `onConnectivityChange` | `function` | `undefined` | Callback invoked when connection status changes. Receives a boolean (`true` when connected, `false` when disconnected). |


## Connection Management

```typescript
// Track connection status via callback
const store = new CanvasStore({
  websocket: {
    // ...other options
    onConnectivityChange: (isOnline) => {
      console.log(isOnline ? 'Connected to server' : 'Disconnected from server');
    },
  },
});

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

When the client detects a version mismatch with the server (e.g. due to a new deployment), you can handle it with the `onVersionMismatch` callback. The typical course of action is to prompt the user to refresh the page until the client side code and server are on the same version.

```typescript
const store = new CanvasStore({
  websocket: {
    enabled: true,
    documentId: 'my-doc',
    url: 'wss://server.com',
    clientId: crypto.randomUUID(),
    onVersionMismatch: (serverVersion) => {
      // Prompt user to refresh
      alert('Please refresh to get the latest version');
    },
  },
});
```

## History

Basic undo/redo operations:

```typescript
// Undo last change
if (store.canUndo()) {
  store.undo();
}

// Redo last undone change
if (store.canRedo()) {
  store.redo();
}
```

### Checkpoints

The canvas store automatically groups changes based on the time difference between mutations. You can customize this behavior by setting `commitCheckpointAfterFrames`. If you want more control over when checkpoints are created, you can create them manually:

```typescript
// Create checkpoint before a complex operation
const checkpoint = store.createCheckpoint();

// Make multiple changes...
moveEntities(ctx, selectedEntities);
updateProperties(ctx, selectedEntities);

// Wait for changes to settle, then squash into one undo step
store.onSettled(() => {
  store.squashToCheckpoint(checkpoint);
}, { frames: 2 });
```

`onSettled` waits for a period of inactivity (no local mutations) before invoking the callback. This is useful for grouping together a series of changes into a single undo step, even if the current changes trigger additional changes.

### Reverting Changes

Discard all changes since a checkpoint:

```typescript
const checkpoint = store.createCheckpoint();

try {
  riskyOperation(ctx);
} catch (e) {
  // Revert all changes since checkpoint
  store.onSettled(() => {
    store.revertToCheckpoint(checkpoint);
  }, { frames: 2 });
}
```
