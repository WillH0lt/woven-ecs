---
title: How It Works
description: Understand the architecture and data flow of the editor store
---

The editor store sits between your ECS world and three subsystems: **persistence** (IndexedDB), **history** (undo/redo), and **network** (WebSocket sync). Each frame, it captures changes from the world and routes them to the appropriate subsystems based on each component's sync behavior.

## Local-First Architecture

The editor store uses a local-first architecture inspired by [Figma's multiplayer system](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/). Changes are applied locally first, then synced to the server when connected. This makes the app feel instant and work fully offline.

### Last-Writer-Wins Conflict Resolution

When two clients change the same field on the same entity simultaneously, the last write to reach the server wins.

The server maintains a simple counter that increments with each change, the timestamps are tracked **per-field**:

```
Server state:
{
  "timestamp": 14,
  "state": {
    "57d7ab01-341d-4b48-94b8-c213c1a2df64/block": {
      "tag": "text",
      "position": [679.999, 940.000],
      "size": [42.468, 28.791],
      "rotateZ": 0,
      "flip": [false, false],
      "rank": "auAOc",
      "_exists": true,
      "_version": null
    },
  },
  "timestamps": {
    "57d7ab01-341d-4b48-94b8-c213c1a2df64/block": {
      "tag": 1,
      "position": 14,
      "size": 12,
      "rotateZ": 1,
      "flip": 12,
      "rank": 1, 
      "_exists": 1,
      "_version": 1
    },
  }
}
```

When a client sends changes, the server increments its counter and assigns that timestamp to each modified field. When broadcasting to other clients, the server includes its current timestamp so clients know how "caught up" they are.

### Efficient Resync

Clients track the latest timestamp they've received from the server. When reconnecting after being offline, the client sends this timestamp:

```
Client → Server: "I last saw timestamp 42"
Server: Finds all fields with timestamp > 42
Server → Client: Only the changed fields (not the entire document)
```

This makes reconnection efficient—clients only download what changed while they were away, not the entire document.

When working offline the  clients also cache their local changes in an offline buffer. When reconnecting, the client:


### Avoiding Flicker

Changes are applied locally immediately (for responsiveness), but incoming server changes could temporarily overwrite your unacknowledged changes, causing "flicker." The store avoids this by tracking which changes are unacknowledged and ignoring conflicting server updates until acknowledgement.

```
You: Shape.x = 100 (applied locally, sent to server)
Server: Shape.x = 50 (from another client, older)
         ↓
     Ignored because you have an unacknowledged change to Shape.x
         ↓
Server: ACK your Shape.x = 100
         ↓
     Now server changes to Shape.x are applied normally
```

### Client-Generated Entity IDs

Entities can be created offline because each client generates its own unique IDs. The `Synced` component stores a UUID that identifies the entity across all clients and sessions:

```typescript
addComponent(ctx, eid, Synced, { id: crypto.randomUUID() });
```

Since UUIDs are globally unique, two clients creating entities simultaneously will never collide.

## The Sync Loop

Every frame, you call `store.sync(ctx)` which:

1. **Captures changes** - Detects which entities and components were added, removed, or modified
2. **Routes to subsystems** - Sends changes to persistence, history, and/or network based on sync behavior
3. **Applies incoming changes** - Merges changes from the network or undo/redo back into the world

```
┌─────────────────────────────────────────────────────────────┐
│                        Your App                             │
│                                                             │
│   world.execute((ctx) => {                                  │
│     // 1. Your game/app logic modifies entities             │
│     movementSystem(ctx);                                    │
│                                                             │
│     // 2. Sync captures and routes changes                  │
│     store.sync(ctx);                                        │
│   });                                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      EditorStore                            │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │ Persistence │  │   History   │  │   Network   │        │
│   │  (IndexedDB)│  │ (Undo/Redo) │  │ (WebSocket) │        │
│   └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Sync Behaviors

Each component declares how it should be handled:

| Behavior | Persistence | History | Network | Example |
|----------|-------------|---------|---------|---------|
| `'document'` | Server DB | Yes | All clients | Shapes, text content |
| `'ephemeral'` | No | No | All clients | Cursors, selections |
| `'local'` | IndexedDB | Yes | No | Camera position, preferences |
| `'none'` | No | No | No | Transient calculations |

When you modify a component, the store checks its sync behavior and only sends it to the relevant subsystems:

```typescript
// This change goes to: Server DB + History + Network
Shape.write(ctx, eid).x = 100;

// This change goes to: Network only (no persistence, no undo)
Cursor.write(ctx, eid).x = mouseX;

// This change goes to: IndexedDB + History (no network)
Camera.write(ctx).zoom = 2.0;
```

## Change Detection

The store uses the ECS change tracking built into Woven-ECS. When you call `.write()` on a component, it's automatically marked as changed. The store then queries for all changed entities each frame:

```typescript
// Internally, the store does something like:
for (const eid of syncedEntities.changed(ctx)) {
  const changes = captureChanges(eid);
  routeToSubsystems(changes);
}
```

This means you don't need to manually notify the store of changes—just modify components normally and call `sync()`.

## Network Synchronization

When multiplayer is enabled, the store:

1. **Sends local changes** - Serializes changed components and sends them to the server
2. **Receives remote changes** - Deserializes incoming changes and applies them to entities
3. **Resolves conflicts** - Uses last-write-wins (the server defines the order)

The server acts as a relay and persistence layer. It broadcasts changes to all connected clients and stores the authoritative document state.

### Why Not OTs or CRDTs?

Operational Transforms (OTs) power apps like Google Docs but are complex to implement correctly—they handle character-by-character text editing with a combinatorial explosion of possible states. Since visual editors don't need that level of granularity, we can use a simpler approach.

Full CRDTs (Conflict-free Replicated Data Types) are designed for decentralized systems with no central authority. Since we have a server, we can simplify: the server is the authority, so we don't need the overhead of decentralized consensus. We take inspiration from CRDT research (particularly last-writer-wins registers) but with a leaner implementation.

```
Client A                    Server                    Client B
    │                          │                          │
    │──── Shape moved ────────▶│                          │
    │                          │──── Shape moved ────────▶│
    │                          │                          │
    │                          │◀──── Cursor moved ───────│
    │◀──── Cursor moved ───────│                          │
    │                          │                          │
```

## Offline Support

The local-first architecture means your app works fully offline. When the network is unavailable:

1. **Local changes still work** - Users can continue editing normally
2. **Changes are persisted locally** - Saved to IndexedDB so nothing is lost
3. **Changes are buffered for sync** - Queued to send when back online

When reconnecting:

1. The client downloads a fresh copy of the document from the server
2. Offline edits are reapplied on top of the latest server state
3. The reapplied changes are sent to the server
4. Normal real-time sync resumes

This means users never have to think about connectivity—they just work, and everything syncs automatically when possible.

## History Management

Undo/redo in multiplayer is tricky. The naive approach—"put back what I did"—can overwrite other people's changes that happened after yours.

### The Guiding Principle

We use a simple principle to guide the design: **if you undo a lot, copy something, and redo back to the present, the document should not change.**

This is a common workflow (undo to find something, copy it, redo to get back) and it would be surprising if the document looked different afterward. This principle means that undo and redo must be aware of each other:

- An **undo** operation modifies redo history at the time of the undo
- A **redo** operation modifies undo history at the time of the redo

### How It Works

Each user has their own undo/redo stack that only tracks their changes:

```
You move Shape A → recorded in your undo stack
Teammate moves Shape B → NOT in your undo stack (it's in theirs)
You undo → Shape A moves back, Shape B stays where your teammate put it
```

This means you can only undo your own changes, which is intuitive—you wouldn't expect pressing Ctrl+Z to undo something someone else did.

### Recording Changes

For components with `sync: 'document'` or `sync: 'local'`, changes are recorded in the history stack:

1. Each `sync()` call that contains changes creates a history entry
2. Calling `undo()` reverts the world to the previous state
3. Calling `redo()` reapplies the undone changes

Use [checkpoints](/editor-store/history/) to group multiple changes into a single undo step (e.g., for drag operations).
