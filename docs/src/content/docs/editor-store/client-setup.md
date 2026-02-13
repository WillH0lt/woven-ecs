---
title: Client Setup
description: Configure EditorStore for offline and multiplayer use
---

Set up the Editor Store with persistence, undo/redo, and multiplayer sync:

```typescript
import { World } from '@woven-ecs/core';
import { EditorStore, Synced } from '@woven-ecs/editor-store';

const store = new EditorStore({
  documentId: 'my-document',
  usePersistence: true,
  useHistory: true,
  websocket: {
    url: 'wss://your-server.com',
    clientId: crypto.randomUUID(),
    startOffline: false,
    token: 'auth-token',
  },
  onVersionMismatch: (serverVersion) => {
    alert('Please refresh to get the latest version');
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

### EditorStore Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `documentId` | `string` | Required | Unique identifier for the document. Used to namespace IndexedDB storage and identify the document on the server. |
| `usePersistence` | `boolean` | `false` | Enable persistence to IndexedDB. Document state and offline buffer survive page reloads. |
| `useHistory` | `boolean` | `false` | Enable undo/redo functionality. Allows calling `undo()`, `redo()`, `canUndo()`, `canRedo()`, and checkpoint operations. |
| `onVersionMismatch` | `function` | `undefined` | Callback invoked when server reports a protocol version mismatch. Receives the server's protocol version number. |
| `websocket` | `object` | `undefined` | WebSocket configuration for multiplayer sync. See WebSocket Options below. |

### WebSocket Options

When the `websocket` option is provided, it accepts the following configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | Required | WebSocket server URL (e.g., `wss://your-server.com`). |
| `clientId` | `string` | Required | Unique identifier for this client. This ID gets sent to other users when broadcasting changes. |
| `startOffline` | `boolean` | `false` | Start in offline mode without connecting. Changes are queued until `connect()` is called. |
| `token` | `string` | `undefined` | Authentication token sent as a query parameter (`?token=...`) to the server. |


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

When the client detects a version mismatch with the server (e.g. due to a new deployment), you can handle it with the `onVersionMismatch` callback. The typical course of action is to prompt the user to refresh the page until the client side code  and server are on the same version.

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
