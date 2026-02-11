---
title: Systems
description: Process entities with systems running on main thread or workers
---

Systems are functions that process entities each frame. Woven-ECS supports both main thread systems and worker systems for parallel execution.

## Main Thread Systems

Define systems that run on the main thread using `defineSystem`:

```typescript
import { defineSystem, defineQuery } from '@woven-ecs/core';

const movingEntities = defineQuery((q) => q.with(Position, Velocity));

const movementSystem = defineSystem((ctx) => {
  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);

    pos.x += vel.x;
    pos.y += vel.y;
  }
});
```

## Worker Systems

For CPU-intensive work, run systems in Web Workers:

### Define the Worker

Create a separate file for your worker:

```typescript
// physics-worker.ts
import { setupWorker, defineQuery, type Context } from '@woven-ecs/core';
import { Position, Velocity, Acceleration } from './components';

setupWorker(execute);

const entities = defineQuery((q) => q.with(Position, Velocity, Acceleration));

function execute(ctx: Context) {
  for (const eid of entities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.write(ctx, eid);
    const acc = Acceleration.read(ctx, eid);

    // Apply acceleration
    vel.x += acc.x;
    vel.y += acc.y;

    // Apply velocity
    pos.x += vel.x;
    pos.y += vel.y;
  }
}
```

### Create the Worker System

```typescript
import { defineWorkerSystem } from '@woven-ecs/core';

const physicsSystem = defineWorkerSystem(
  new URL('./physics-worker.ts', import.meta.url).href,
  {
    threads: 4,        // Number of worker threads
    priority: 'high',  // 'low' | 'medium' | 'high'
  }
);
```

### How Worker Partitioning Works

When a query runs in a worker, entities are automatically partitioned across threads:

```
Thread 0: entities where id % 4 === 0
Thread 1: entities where id % 4 === 1
Thread 2: entities where id % 4 === 2
Thread 3: entities where id % 4 === 3
```

This ensures each entity is processed by exactly one thread, enabling safe parallel writes.

## Executing Systems

Use `world.execute()` to run systems:

```typescript
// Run a single system
await world.execute(movementSystem);

// Run multiple systems
await world.execute(
  spawnerSystem,
  physicsSystem,  // Runs in parallel workers
  renderSystem,
);
```

### Execution Order

Systems execute in the order provided:

1. Main thread systems run synchronously
2. Worker systems run in parallel
3. `execute()` returns when all systems complete

```typescript
await world.execute(
  inputSystem,      // 1. Runs first (main thread)
  physicsSystem,    // 2. Runs in workers (parallel)
  collisionSystem,  // 3. Also runs in workers (parallel with physics)
  renderSystem,     // 4. Runs after workers complete (main thread)
);
```

## System Priority

Worker systems can have priority levels that affect startup order:

```typescript
const highPrioritySystem = defineWorkerSystem(url, { priority: 'high' });
const normalSystem = defineWorkerSystem(url, { priority: 'medium' });
const lowPrioritySystem = defineWorkerSystem(url, { priority: 'low' });
```

Higher priority systems begin execution first when running in parallel.

## Accessing Resources

Pass custom resources to systems through the World constructor:

```typescript
const world = new World([Position, Velocity], {
  resources: {
    canvas: document.getElementById('game'),
    renderer: new WebGLRenderer(),
    camera: new Camera(),
  },
});
```

Access resources in systems:

```typescript
import { getResources } from '@woven-ecs/core';

const renderSystem = defineSystem((ctx) => {
  const { renderer, camera } = getResources(ctx);

  for (const eid of renderableEntities.current(ctx)) {
    // Use renderer and camera...
  }
});
```

:::note
Resources are only available in main thread systems. Workers cannot access resources.
:::

## The Context Object

Every system receives a `Context` object containing:

```typescript
interface Context {
  entityBuffer: EntityBuffer;    // Entity state tracking
  eventBuffer: EventBuffer;      // Change events
  pool: Pool;                    // Entity ID allocation
  components: Map<number, any>;  // Component instances
  threadIndex: number;           // Current thread (0 for main)
  threadCount: number;           // Total thread count
  readerId: number;              // Unique reader ID for queries
  resources: unknown;            // User resources
}
```

## Best Practices

### Separate Read and Write

Minimize write access to improve cache performance:

```typescript
// Good: Read-only access when possible
const vel = Velocity.read(ctx, eid);
const pos = Position.write(ctx, eid);
pos.x += vel.x;

// Avoid: Unnecessary write access
const vel = Velocity.write(ctx, eid); // Don't need write here
```

### Batch Similar Operations

Process all entities of one type before moving to another:

```typescript
// Good: Process all movement, then all rendering
const movementSystem = defineSystem((ctx) => {
  for (const eid of moving.current(ctx)) {
    // Update positions
  }
});

const renderSystem = defineSystem((ctx) => {
  for (const eid of renderable.current(ctx)) {
    // Render
  }
});
```

### Use Workers for Heavy Computation

Move CPU-intensive work to workers:

- Physics simulation
- Pathfinding
- Particle updates
- AI calculations
