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

## Core Concepts

### EditorStore

The `EditorStore` acts as a synchronization hub between your ECS world and external systems:

```
ECS World ←→ EditorStore ←→ IndexedDB (persistence)
                        ←→ History (undo/redo)
                        ←→ WebSocket (multiplayer)
```

Every frame, the store pulls mutations from each adapter and pushes them to all others, ensuring state convergence.

### Sync Behaviors

Components and singletons can have different sync behaviors:

| Behavior | Persisted | Synced | Undo/Redo | Use Case |
|----------|-----------|--------|-----------|----------|
| `'document'` | Server DB | All clients | Yes | Core document data |
| `'ephemeral'` | No | All clients | No | Cursors, selections |
| `'local'` | IndexedDB only | No | Yes | Camera position, preferences |
| `'none'` | No | No | No | Transient state |

### The Synced Component

Entities that need persistence or sync must have the `Synced` component:

```typescript
import { Synced } from '@woven-ecs/editor-store';

// When creating entities
const entity = createEntity(ctx);
addComponent(ctx, entity, Synced);
Synced.write(ctx, entity).id = crypto.randomUUID();
```

The stable UUID enables entities to be tracked across sessions and clients.
