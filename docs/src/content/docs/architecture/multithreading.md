---
title: Multithreading
description: Run systems in parallel across Web Workers
---

Woven-ECS is designed from the ground up for multithreaded execution. Systems can run in parallel across Web Workers, sharing data through SharedArrayBuffer without copying.

## How It Works

### SharedArrayBuffer

All ECS data is stored in SharedArrayBuffers - memory regions visible to all threads simultaneously:

```
Main Thread ──┬── SharedArrayBuffer ──┬── Worker 1
              │   (Components, etc.)  │
              │                       ├── Worker 2
              │                       │
              │                       └── Worker 3
```

No serialization or message passing is needed - workers read and write the same memory directly.

### Work Partitioning

Worker systems automatically partition entities across threads:

```typescript
// With 4 worker threads:
// Worker 0 processes: entities 0, 4, 8, 12, ...
// Worker 1 processes: entities 1, 5, 9, 13, ...
// Worker 2 processes: entities 2, 6, 10, 14, ...
// Worker 3 processes: entities 3, 7, 11, 15, ...
```

This ensures each entity is processed by exactly one worker, enabling safe parallel writes without locks.

## Creating Worker Systems

### 1. Create the Worker File

```typescript
// physics-worker.ts
import {
  setupWorker,
  defineQuery,
  type Context,
} from '@woven-ecs/core';
import { Position, Velocity, Acceleration } from './components';

// Register this as a worker
setupWorker(execute);

// Define queries at module scope
const physicsEntities = defineQuery((q) =>
  q.with(Position, Velocity, Acceleration)
);

function execute(ctx: Context) {
  const dt = 1 / 60; // Fixed timestep

  for (const eid of physicsEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.write(ctx, eid);
    const acc = Acceleration.read(ctx, eid);

    // Integrate velocity
    vel.x += acc.x * dt;
    vel.y += acc.y * dt;
    vel.z += acc.z * dt;

    // Integrate position
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
  }
}
```

### 2. Define the Worker System

```typescript
// main.ts
import { defineWorkerSystem } from '@woven-ecs/core';

const physicsSystem = defineWorkerSystem(
  new URL('./physics-worker.ts', import.meta.url).href,
  {
    threads: 4,
    priority: 'high',
  }
);
```

### 3. Execute the System

```typescript
await world.execute(
  inputSystem,      // Main thread
  physicsSystem,    // 4 workers in parallel
  renderSystem,     // Main thread (after workers complete)
);
```

## Worker Options

```typescript
defineWorkerSystem(url, {
  threads: 4,        // Number of worker threads
  priority: 'high',  // Startup priority
});
```

### threads

Number of worker instances to spawn. Defaults to `navigator.hardwareConcurrency`.

Consider:
- CPU cores available
- Other workers in your application
- Nature of the workload (CPU vs memory bound)

### priority

Controls startup order when multiple worker systems execute:

- `'high'`: Starts first
- `'medium'`: Default
- `'low'`: Starts last

Higher priority systems begin execution sooner, useful for critical-path systems.

## Query Partitioning

By default, queries partition results when `threadCount > 1`:

```typescript
// In a worker with threadIndex=1, threadCount=4:
for (const eid of query.current(ctx)) {
  // Only receives entities where eid % 4 === 1
}
```

Override partitioning per-query:

```typescript
// Force all entities (useful for read-only operations)
for (const eid of query.current(ctx, { partitioned: false })) {
  // Receives ALL entities
}
```

## Thread Context

Workers receive context with thread information:

```typescript
function execute(ctx: Context) {
  console.log(ctx.threadIndex); // 0, 1, 2, or 3
  console.log(ctx.threadCount); // 4
}
```

## Limitations

### No Resource Access

Workers cannot access resources:

```typescript
// This only works in main thread systems!
const { renderer } = getResources(ctx);
```

Solution: Use workers for computation, main thread for rendering/IO.

### No DOM Access

Workers cannot access the DOM, window, or document:

```typescript
// Won't work in workers:
document.getElementById('game'); // Error!
```

### Component Registration

Workers automatically receive component definitions when initialized. Ensure all components are registered with the World before executing worker systems.

## Best Practices

### 1. Batch Similar Work

Group related computations in the same worker:

```typescript
// Good: One worker handles all physics
const physicsWorker = defineWorkerSystem('./physics.ts');

// Less efficient: Separate workers for position/velocity
const positionWorker = defineWorkerSystem('./position.ts');
const velocityWorker = defineWorkerSystem('./velocity.ts');
```

### 2. Minimize Cross-Thread Dependencies

Design systems to be independent:

```typescript
// Good: Each system reads/writes its own data
// Physics: reads Acceleration, writes Velocity/Position
// AI: reads Position of others, writes own Velocity

// Avoid: Systems that need results from other workers
```

### 3. Use Read-Only When Possible

Read operations are always thread-safe:

```typescript
// Safe: Multiple workers reading the same component
const pos = Position.read(ctx, eid);

// Also safe: Workers writing to DIFFERENT entities (partitioned)
const pos = Position.write(ctx, eid);
```

### 4. Profile Your Workload

Not all work benefits from parallelization:

- **Good for workers**: Physics, AI, pathfinding, particle updates
- **Keep on main thread**: Rendering, audio, input handling

Overhead of worker coordination can exceed benefits for simple operations.

## Example: Particle System

```typescript
// particle-worker.ts
import { setupWorker, defineQuery } from '@woven-ecs/core';
import { Position, Velocity, Acceleration, Life } from './components';

setupWorker(execute);

const particles = defineQuery((q) =>
  q.with(Position, Velocity, Acceleration, Life)
);

function execute(ctx: Context) {
  for (const eid of particles.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.write(ctx, eid);
    const acc = Acceleration.read(ctx, eid);
    const life = Life.write(ctx, eid);

    // Apply gravity
    vel.y += acc.y;

    // Apply damping
    vel.x *= 0.98;
    vel.y *= 0.98;
    vel.z *= 0.98;

    // Update position
    pos.x += vel.x;
    pos.y += vel.y;
    pos.z += vel.z;

    // Age particle
    life.remaining -= 1;
  }
}
```

With 100,000 particles across 4 workers, each worker processes ~25,000 particles in parallel.
