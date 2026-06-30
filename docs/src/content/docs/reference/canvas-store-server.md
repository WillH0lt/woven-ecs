---
title: canvas-store-server
description: API reference for @woven-ecs/canvas-store-server
---

## acceptConnection

Runtime-agnostic connection helper. Parses the wire-protocol query parameters, runs your `authorize`, registers the session, wires `onTokenRefresh` to the same `authorize`, and returns a handle to forward WS events into.

```typescript
const conn = acceptConnection({
  socket,
  url: req.url ?? '',
  request: req,        // optional, passed through to authorize
  manager,
  authorize: async ({ roomId, clientId, token, request }) => ({
    permissions: 'readwrite',
    metadata: { /* anything */ },
  }),
  roomOptions: (roomId) => ({ /* RoomOptions for first connect to this room */ }),
})

// Forward events from your runtime — attach synchronously, do NOT await first:
ws.on('message', (data) => conn.onMessage(String(data)))
ws.on('close', conn.onClose)
ws.on('error', conn.onError)

// Close the socket on auth/URL failure:
conn.ready.catch((err) => ws.close(1008, err.message))
// Or use the live room/session once ready:
const { room, sessionId } = await conn.ready
```

### AcceptConnectionOptions

| Option | Type | Description |
|--------|------|-------------|
| `socket` | `WebSocketLike` | The connected socket. |
| `url` | `string` | Connect URL — full (`wss://host/?…`) or path-and-query (`/?…`). |
| `request` | `unknown` | Optional runtime request object passed verbatim to `authorize`. |
| `manager` | `RoomManager` | The room manager. |
| `authorize` | `function` | `(info) => { permissions, metadata? } \| Promise<...>`. Called on connect AND on every `auth-refresh` frame. Throw to reject. |
| `roomOptions` | `function` | `(roomId) => Omit<RoomOptions, 'onTokenRefresh'>`. Applied when the room is first created; ignored on subsequent connects to an existing room. |

### AuthorizeInfo

| Field | Type | Description |
|-------|------|-------------|
| `roomId` | `string` | Parsed from the URL's `roomId` query parameter. |
| `clientId` | `string` | Parsed from the URL's `clientId` query parameter. |
| `token` | `string` | The presented token — from the URL on connect, from the `auth-refresh` frame on refresh. |
| `request` | `TRequest \| undefined` | The original request object — `undefined` on token refresh. |

### Connection (return value)

| Field | Type | Description |
|-------|------|-------------|
| `ready` | `Promise<{ room, sessionId }>` | Resolves once authorize + room-load complete, the session is registered, and buffered frames are replayed. Rejects with `ConnectRequestError` (bad URL), whatever `authorize` threw (auth failure), or `ConnectionClosedError`. |
| `getMetadata()` | `TMeta \| undefined` | Returns the latest metadata for this session. |
| `onMessage(data)` | `void` | Forward an incoming WS message string. |
| `onClose()` | `void` | Call when the WS closes. |
| `onError()` | `void` | Call when the WS errors. |

### parseConnectUrl

Standalone helper that pulls `{ roomId, clientId, token }` out of a connect URL. Exposed so consumers building custom flows can keep the wire-protocol contract in one place. Throws `ConnectRequestError` with a `code` (`missing-room-id` / `missing-client-id` / `missing-token` / `invalid-url`) on malformed input.

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
| `onTokenRefresh` | `function` | - | Called when a client sends an `auth-refresh` frame mid-session. Signature: `(room, { sessionId, clientId, token }) => { permissions, metadata? } \| Promise<...>`. Returns the new permissions and optionally replacement metadata; throw to drop the session. Connect-time auth is the caller's responsibility — verify before calling `handleSocketConnect`. Owned by `acceptConnection` when you're using that helper. |
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
| `getSessionMetadata(sessionId)` | `unknown` | Get the metadata attached to a session via `handleSocketConnect` or `onTokenRefresh`. |
| `setSessionMetadata(sessionId, metadata)` | `void` | Replace the metadata for a session. |
| `close()` | `void` | Close room and all connections |

### handleSocketConnect Options

```typescript
room.handleSocketConnect({
  socket: websocket,
  clientId: 'client-uuid',
  permissions: 'readwrite',  // or 'readonly'
  metadata: { /* optional, per-session value the room will hold */ },
});
```

The caller is expected to have authenticated the connection before this point and resolved `permissions` accordingly. Most users should use [`acceptConnection`](#acceptconnection) instead — it handles URL parsing, authorization, and refresh wiring for you.

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
| `closeAll()` | `Promise<void>` | Disconnect all clients and flush every room to storage |

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
type ClientMessage = PatchRequest | ReconnectRequest | AuthRefreshRequest;
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

### AuthRefreshRequest

Sent by a client to swap the auth token on a live connection. Routed to the room's `onAuthRefresh` handler, which is expected to verify the new token and update permissions via `setSessionPermissions`. Throwing closes the session.

```typescript
interface AuthRefreshRequest {
  type: 'auth-refresh';
  token: string;
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
