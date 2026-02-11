---
title: World
description: The container that orchestrates entities, components, and systems
---

The World is the central orchestrator in Woven-ECS. It manages entity allocation, component registration, system execution, and event processing.

## Creating a World

```typescript
import { World } from '@woven-ecs/core';
import { Position, Velocity, Health, Time } from './components';

const world = new World([Position, Velocity, Health, Time], {
  maxEntities: 10000,
  maxEvents: 131072,
  threads: 4,
  resources: {
    canvas: document.getElementById('game'),
  },
});
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxEntities` | 10,000 | Maximum number of concurrent entities |
| `maxEvents` | 131,072 | Size of the event ring buffer |
| `threads` | `navigator.hardwareConcurrency` | Number of worker threads |
| `resources` | `undefined` | Custom data passed to systems |

## Entity Management

### Creating Entities

```typescript
import { createEntity } from '@woven-ecs/core';

const ctx = world._getContext();
const entity = createEntity(ctx);
```

### Removing Entities

```typescript
import { removeEntity, isAlive } from '@woven-ecs/core';

removeEntity(ctx, entity);

// Entity is marked dead but data is preserved
console.log(isAlive(ctx, entity)); // false

// Queries can still read the entity's final state in .removed()
```

### Entity Lifecycle

1. **Creation**: `createEntity()` allocates an ID and marks entity alive
2. **Active**: Entity can have components added/removed and data modified
3. **Removal**: `removeEntity()` marks entity dead, triggers REMOVED events
4. **Reclamation**: After all systems see the removal, ID can be reused

## System Execution

### execute()

Run one or more systems:

```typescript
await world.execute(
  inputSystem,
  physicsSystem,
  renderSystem,
);
```

Systems execute in order:
- Main thread systems run synchronously
- Worker systems run in parallel
- `execute()` awaits all workers before returning

### sync()

Process subscriptions and deferred callbacks:

```typescript
world.sync();
```

Call `sync()` at the start of each frame to:
- Invoke subscription callbacks for query changes
- Execute callbacks scheduled with `nextSync()`

## Subscriptions

React to entity changes on the main thread:

```typescript
const unsubscribe = world.subscribe(
  myQuery,
  (ctx, { added, removed, changed }) => {
    // Handle changes
  }
);
```

Subscriptions are invoked during `world.sync()`.

### Deferred Execution

Schedule code to run at the next `sync()`:

```typescript
world.nextSync((ctx) => {
  // This runs at the start of the next frame
  createEntity(ctx);
});
```

Useful for creating/removing entities from event handlers without disrupting the current frame.

## Resources

Pass application state to systems:

```typescript
const world = new World(components, {
  resources: {
    renderer: new WebGLRenderer(),
    camera: new PerspectiveCamera(),
    input: { mouse: { x: 0, y: 0 } },
  },
});
```

Access in systems:

```typescript
import { getResources } from '@woven-ecs/core';

const renderSystem = defineSystem((ctx) => {
  const { renderer, camera } = getResources(ctx);
  // Use renderer and camera
});
```

:::caution
Resources are only available in main thread systems. Worker systems cannot access resources.
:::

## Context

The Context contains all runtime state:

```typescript
const ctx = world._getContext();
```

| Property | Description |
|----------|-------------|
| `entityBuffer` | Tracks entity alive state and component masks |
| `eventBuffer` | Ring buffer of entity/component change events |
| `pool` | Thread-safe entity ID allocation |
| `components` | Map of component ID to component instance |
| `threadIndex` | Current thread index (0 for main) |
| `threadCount` | Total number of threads |
| `readerId` | Unique ID for query result caching |
| `resources` | User-provided resources |

## Cleanup

Dispose the world when done:

```typescript
world.dispose();
```

This terminates worker threads and releases SharedArrayBuffers.

## Memory Layout

The World allocates several SharedArrayBuffers:

### Entity Buffer

Tracks entity state and component composition:

```
Per entity: [metadata byte][component bitmask bytes...]
- Metadata: alive flag + generation counter
- Bitmask: 1 bit per registered component
```

### Event Buffer

Ring buffer for change events:

```
[write index (4 bytes)][events...]

Per event (8 bytes):
- Entity ID (4 bytes)
- Event type (1 byte)
- Padding (1 byte)
- Component ID (2 bytes)
```

### Component Buffers

Each component has its own buffer:

```
[entity 0 fields][entity 1 fields][entity 2 fields]...
```

### Pool

Bitset for entity ID allocation:

```
[hint (4 bytes)][bits...]
- Each bit represents one entity ID
- 1 = in use, 0 = available
```

## Thread Safety

Woven-ECS uses several mechanisms for thread safety:

1. **SharedArrayBuffer**: Memory visible to all threads
2. **Atomics**: Lock-free operations for concurrent access
3. **Partitioned Queries**: Each worker processes different entities
4. **Event Ring Buffer**: Lock-free event recording

This enables true parallel execution without locks or message passing overhead.
