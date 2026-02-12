---
title: editor-store
description: API reference for @woven-ecs/editor-store
---

## EditorStore

The main synchronization hub that routes mutations between adapters (ECS, History, WebSocket, Persistence).

### new EditorStore(options)

Creates an editor store instance.

```typescript
const store = new EditorStore({
  documentId: 'my-document',
  usePersistence: true,
  useHistory: true,
  websocket: {
    url: 'wss://api.example.com',
    clientId: crypto.randomUUID(),
  },
});
```

### EditorStoreOptions

| Option | Type | Description |
|--------|------|-------------|
| `documentId` | `string` | Unique identifier for the document |
| `usePersistence` | `boolean` | Enable IndexedDB persistence |
| `useHistory` | `boolean` | Enable undo/redo support |
| `websocket` | `object` | WebSocket adapter options |
| `onVersionMismatch` | `function` | Called when server protocol version differs |

### EditorStore Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize(options)` | `Promise<void>` | Initialize all adapters |
| `sync(ctx)` | `void` | Synchronize mutations (call every frame) |
| `undo()` | `boolean` | Undo last change |
| `redo()` | `boolean` | Redo last undone change |
| `canUndo()` | `boolean` | Check if undo is available |
| `canRedo()` | `boolean` | Check if redo is available |
| `createCheckpoint()` | `string \| null` | Create a history checkpoint |
| `revertToCheckpoint(id)` | `boolean` | Revert all changes since checkpoint |
| `squashToCheckpoint(id)` | `boolean` | Combine changes since checkpoint into one undo step |
| `onSettled(callback, options)` | `void` | Called after N frames with no mutations |
| `connect()` | `Promise<void>` | Connect/reconnect WebSocket |
| `disconnect()` | `void` | Disconnect WebSocket |
| `close()` | `void` | Close all adapters |

### EditorStore Properties

| Property | Type | Description |
|----------|------|-------------|
| `documentId` | `string` | The document identifier |
| `isOnline` | `boolean` | Whether WebSocket is connected |

---

## Editor Components

### defineEditorComponent(options, schema)

Creates a component with sync behavior and stable naming for persistence.

```typescript
const Shape = defineEditorComponent(
  {
    name: 'shapes',
    sync: 'document',
    migrations: [
      { name: 'v1', upgrade: (data) => ({ ...data, color: data.color ?? '#000' }) }
    ],
    excludeFromHistory: ['lastSelected'],
  },
  {
    x: field.float64(),
    y: field.float64(),
    color: field.string().max(16).default('#0f3460'),
  },
);
```

### defineEditorComponent Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Stable identifier for storage/sync |
| `sync` | `SyncBehavior` | How changes propagate |
| `migrations` | `ComponentMigration[]` | Data migration chain |
| `excludeFromHistory` | `string[]` | Fields to exclude from undo/redo |

### EditorComponentDef Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Stable storage identifier |
| `sync` | `SyncBehavior` | Sync behavior setting |
| `migrations` | `ComponentMigration[]` | Migration chain |
| `excludeFromHistory` | `string[]` | Fields excluded from history |
| `currentVersion` | `string \| null` | Latest migration version |

---

## Editor Singletons

### defineEditorSingleton(options, schema)

Creates a singleton with sync behavior and stable naming.

```typescript
const Camera = defineEditorSingleton(
  { name: 'camera', sync: 'local' },
  {
    x: field.float64().default(0),
    y: field.float64().default(0),
    zoom: field.float64().default(1),
  },
);
```

### defineEditorSingleton Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Stable identifier for storage/sync |
| `sync` | `SingletonEditorBehavior` | How changes propagate (excludes `'ephemeral'`) |
| `migrations` | `ComponentMigration[]` | Data migration chain |
| `excludeFromHistory` | `string[]` | Fields to exclude from undo/redo |

---

## Sync Behaviors

```typescript
type SyncBehavior =
  | 'document'   // Persisted to database, synced to all clients
  | 'ephemeral'  // Synced via WebSocket only (cursors, selections)
  | 'local'      // Persisted locally only (preferences, camera)
  | 'none';      // Not synced or stored

type SingletonEditorBehavior = Exclude<SyncBehavior, 'ephemeral'>;
```

---

## Synced Component

Built-in component that marks entities for persistence/sync.

```typescript
import { Synced } from '@woven-ecs/editor-store';

// Add to entities you want persisted
addComponent(ctx, entity, Synced, { id: crypto.randomUUID() });
```

### Synced Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable UUID for persistence |

---

## WebsocketAdapter

Real-time multiplayer synchronization adapter.

### WebsocketAdapterOptions

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | WebSocket server URL |
| `clientId` | `string` | Unique client identifier |
| `documentId` | `string` | Document identifier |
| `usePersistence` | `boolean` | Enable offline buffer persistence |
| `startOffline` | `boolean` | Start disconnected |
| `token` | `string` | Authentication token |
| `onVersionMismatch` | `function` | Protocol version mismatch handler |

---

## Migrations

### ComponentMigration

```typescript
interface ComponentMigration {
  name: string;
  supersedes?: string;
  upgrade: (data: Record<string, unknown>, from: string | null) => Record<string, unknown>;
}
```

### migrateComponentData(data, currentVersion, migrations)

Migrate component data through applicable migrations.

```typescript
const result = migrateComponentData(
  { x: 0, y: 0 },
  null,
  [{ name: 'v1', upgrade: (data) => ({ ...data, z: 0 }) }]
);
// result: { data: { x: 0, y: 0, z: 0 }, version: 'v1', changed: true }
```

**Returns:** `MigrationResult`

```typescript
interface MigrationResult {
  data: Record<string, unknown>;
  version: string | null;
  changed: boolean;
}
```

### validateMigrations(migrations)

Validate migrations array for correctness. Throws on duplicate names, missing supersede targets, or conflicts.

```typescript
validateMigrations([
  { name: 'v1', upgrade: (data) => data },
  { name: 'v2', upgrade: (data) => data },
]);
```

---

## Types

### Patch

A map of keys to values representing component changes.

```typescript
type Patch = Record<string, ComponentData>;

// Key format:
// Components: "<entityId>/<componentName>"
// Singletons: "SINGLETON/<singletonName>"

// Examples:
{ "uuid-123/Position": { _exists: true, x: 0, y: 0 } }  // Add
{ "uuid-123/Position": { x: 10 } }                       // Update
{ "uuid-123/Position": { _exists: false } }              // Delete
```

### ComponentData

```typescript
type ComponentData = Record<string, unknown> & {
  _exists?: boolean;
  _version?: string;
};
```

### VersionMismatchResponse

```typescript
interface VersionMismatchResponse {
  type: 'version-mismatch';
  serverProtocolVersion: number;
}
```
