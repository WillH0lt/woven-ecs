---
title: Multithreading
description: Run systems in parallel across Web Workers
---

Woven-ECS is designed from the ground up for multithreaded execution. Systems can run in parallel across Web Workers. Data sharing is handled automatically with SharedArrayBuffers, while the World manages the execution and queuing.

## Worker Systems

Worker systems are always defined in separate files.

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

Back on your main thread, define the worker system:

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

### System Priority

The World automatically queues worker system executions based on priority, high to low. You can set the priority when defining a worker system:

```typescript
const highPrioritySystem = defineWorkerSystem(url, { priority: 'high' });
const normalSystem = defineWorkerSystem(url, { priority: 'medium' }); // default
const lowPrioritySystem = defineWorkerSystem(url, { priority: 'low' });
```

### Security Requirements

Woven-ECS worker systems use `SharedArrayBuffers` for high-performance data sharing, which require specific HTTP headers to be set. If you're using Vite, add the following to your `vite.config.ts`:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  }
})

```

## Partitioned Queries

To control the parallelization of a query, you can use the `partitioned` option. This divides the query's matching entities into roughly equal subsets, one for each worker thread. For example, with 4 threads, entities are partitioned based on their ID:

```
Thread 0: entities where id % 4 === 0
Thread 1: entities where id % 4 === 1
Thread 2: entities where id % 4 === 2
Thread 3: entities where id % 4 === 3
```

In worker systems, you control whether a query is partitioned using `{ partitioned: true }`:

```typescript "{ partitioned: true }"
// physics-worker.ts
import { defineQuery, setupWorker } from '@woven-ecs/core'
import { Attractor, Position, Velocity } from './components'

const particlesQuery = defineQuery((q) => q.with(Position, Velocity))
const attractorsQuery = defineQuery((q) => q.with(Attractor))

setupWorker((ctx) => {
  // PARTITIONED: Each worker gets a unique subset of particles
  const particles = particlesQuery.current(ctx, { partitioned: true })

  for (const eid of particles) {
    const pos = Position.write(ctx, eid)
    const vel = Velocity.write(ctx, eid)

    // Read from ALL attractors (unpartitioned) to calculate forces
    // default is { partitioned: false }
    for (const attractorId of attractorsQuery.current(ctx)) {
      const attractor = Attractor.read(ctx, attractorId)
      // Apply attraction force...
    }

    pos.x += vel.x
    pos.y += vel.y
  }
})
```

Partitioning ensures each particle is handled by exactly one thread, preventing duplicate processing. Attractors remain unpartitioned, allowing all threads to read them when calculating forces.

The same `partitioned` option works also with other query methods:

```typescript
const added = query.added(ctx, { partitioned: true })
const removed = query.removed(ctx, { partitioned: true })
const changed = query.changed(ctx, { partitioned: true })
```

## Limitations

### No Resource Access

Workers cannot access resources:

```typescript
// This only works in main thread systems!
const { renderer } = getResources(ctx);
```

### No DOM Access

Workers cannot access the DOM, window, or document:

```typescript
// Won't work in workers:
document.getElementById('game'); // Error!
```

### Overhead

Be sure to test if parallelization is actually making your application faster. For small workloads, the overhead of threading may outweigh the benefits. Only use worker systems for CPU-intensive tasks that can be effectively parallelized.