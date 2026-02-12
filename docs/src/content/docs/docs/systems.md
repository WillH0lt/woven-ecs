---
title: Systems
description: Process entities with systems running on main thread or workers
---

Systems are functions that process entities each frame. Woven-ECS supports both main thread systems and worker systems for parallel execution.

## Main Thread Systems

Define systems that run on the main thread using `defineSystem`:

```ts
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

### Why `defineSystem` instead of plain callbacks?

You can pass plain callbacks to `world.execute()`:

```ts
world.execute((ctx) => { /* ... */ });
```

The difference is **event tracking**. Each system defined with `defineSystem` keeps track of the events that it has processed, so when you call `query.added(ctx)` or `query.changed(ctx)`, you get events since *that system* last ran. Plain callbacks share the world's sync-level tracking, so they all see events since the last `world.sync()` call.

Use `defineSystem` when your system uses reactive queries (`.added()`, `.removed()`, `.changed()`). Plain callbacks are fine for one-off logic or setup code that only uses `.current()`.

## Worker Systems

Worker systems are explained in detail in the [Multithreading](/docs/multithreading) section.
