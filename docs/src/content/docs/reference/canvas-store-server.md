---
title: canvas-store-server
description: API reference for @woven-ecs/canvas-store-server
---

## Room

Manages a single collaborative document session with real-time synchronization.

### new Room(options?)

Creates a room instance.

```typescript
const room = new Room({
  storage: new FileStorage({ dir: './data', roomId: 'my-room' }),
  onDataChange: (room) => console.log('Data changed'),
  onSessionRemoved: (room, { sessionId, remaining }) => {
    if (remaining === 0) console.log('Room empty');
  },
  saveThrottleMs: 10000,
});
```

### RoomOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialSnapshot` | `RoomSnapshot` | - | Restore from a previous snapshot |
| `storage` | `Storage` | - | Pluggable persistence backend |
| `onDataChange` | `function` | - | Called when document state changes |
| `onSessionRemoved` | `function` | - | Called when a session disconnects |
| `saveThrottleMs` | `number` | 10000 | Minimum ms between persistence saves |

### Room Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `load()` | `Promise<void>` | Load state from storage |
| `handleSocketConnect(options)` | `string` | Register a new client connection, returns sessionId |
| `handleSocketMessage(sessionId, data)` | `void` | Process incoming WebSocket message |
| `handleSocketClose(sessionId)` | `void` | Handle client disconnection |
| `handleSocketError(sessionId)` | `void` | Handle client error |
| `getSnapshot()` | `RoomSnapshot` | Get current document state |
| `getSessionCount()` | `number` | Get number of connected sessions |
| `getSessions()` | `SessionInfo[]` | Get all session info |
| `getSessionPermissions(sessionId)` | `SessionPermission` | Get session permissions |
| `setSessionPermissions(sessionId, permissions)` | `void` | Update session permissions |
| `close()` | `void` | Close room and all connections |

### handleSocketConnect Options

```typescript
room.handleSocketConnect({
  socket: websocket,
  clientId: 'client-uuid',
  permissions: 'readwrite', // or 'readonly'
});
```

---

## RoomManager

Manages multiple rooms with automatic lifecycle management.

### new RoomManager(options)

Creates a room manager instance.

```typescript
const manager = new RoomManager({
  createStorage: (roomId) => new FileStorage({ dir: './data', roomId }),
  idleTimeout: 30000,
});
```

### RoomManagerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `createStorage` | `(roomId: string) => Storage` | - | Factory for creating storage per room |
| `idleTimeout` | `number` | 30000 | Auto-close empty rooms after this many ms |

### RoomManager Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getRoom(roomId)` | `Promise<Room>` | Get or create a room, loading from storage |
| `getExistingRoom(roomId)` | `Room \| undefined` | Get room only if it exists |
| `getRoomIds()` | `string[]` | List all active room IDs |
| `closeRoom(roomId)` | `void` | Close and remove a specific room |
| `closeAll()` | `void` | Shut down all rooms |

---

## Storage

### Storage Interface

```typescript
interface Storage {
  load(): Promise<RoomSnapshot | null>;
  save(snapshot: RoomSnapshot): Promise<void>;
}
```

### FileStorage

File-based persistence using JSON files.

```typescript
import { FileStorage } from '@woven-ecs/canvas-store-server';

const storage = new FileStorage({
  dir: './data',
  roomId: 'my-room',
});
```

### FileStorageOptions

| Option | Type | Description |
|--------|------|-------------|
| `dir` | `string` | Directory for storing snapshots |
| `roomId` | `string` | Room identifier (becomes filename) |

### MemoryStorage

In-memory storage for testing.

```typescript
import { MemoryStorage } from '@woven-ecs/canvas-store-server';

const storage = new MemoryStorage();
```

---

## Protocol Types

### PROTOCOL_VERSION

Current protocol version constant for client-server compatibility.

```typescript
import { PROTOCOL_VERSION } from '@woven-ecs/canvas-store-server';
```

### ClientMessage

Messages sent from client to server.

```typescript
type ClientMessage = PatchRequest | ReconnectRequest;
```

### PatchRequest

```typescript
interface PatchRequest {
  type: 'patch';
  messageId: string;
  documentPatches?: Patch[];
  ephemeralPatches?: Patch[];
}
```

### ReconnectRequest

```typescript
interface ReconnectRequest {
  type: 'reconnect';
  lastTimestamp: number;
  protocolVersion: number;
  documentPatches?: Patch[];
  ephemeralPatches?: Patch[];
}
```

### ServerMessage

Messages sent from server to client.

```typescript
type ServerMessage =
  | AckResponse
  | PatchBroadcast
  | ClientCountBroadcast
  | VersionMismatchResponse;
```

### AckResponse

```typescript
interface AckResponse {
  type: 'ack';
  messageId: string;
  timestamp: number;
}
```

### PatchBroadcast

```typescript
interface PatchBroadcast {
  type: 'patch';
  documentPatches?: Patch[];
  ephemeralPatches?: Patch[];
  clientId: string;
  timestamp: number;
}
```

### ClientCountBroadcast

```typescript
interface ClientCountBroadcast {
  type: 'clientCount';
  count: number;
}
```

### VersionMismatchResponse

```typescript
interface VersionMismatchResponse {
  type: 'version-mismatch';
  serverProtocolVersion: number;
}
```

---

## Data Types

### RoomSnapshot

Complete room state for persistence/restore.

```typescript
interface RoomSnapshot {
  timestamp: number;
  state: Record<string, ComponentData>;
  timestamps: Record<string, FieldTimestamps>;
}
```

### SessionInfo

```typescript
interface SessionInfo {
  sessionId: string;
  clientId: string;
  permissions: SessionPermission;
}
```

### SessionPermission

```typescript
type SessionPermission = 'readonly' | 'readwrite';
```

### ComponentData

```typescript
type ComponentData = Record<string, unknown> & {
  _exists?: boolean;
  _version?: string;
};
```

### FieldTimestamps

Per-field timestamps for conflict resolution.

```typescript
type FieldTimestamps = Record<string, number>;
```

### Patch

```typescript
type Patch = Record<string, ComponentData>;
```

---

## WebSocketLike

Interface for WebSocket compatibility (works with any WebSocket implementation).

```typescript
interface WebSocketLike {
  send(data: string): void;
  close(): void;
}
```
