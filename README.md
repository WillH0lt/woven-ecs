![CI](https://github.com/WillH0lt/woven-ecs/actions/workflows/ci.yml/badge.svg)
[![npm](https://img.shields.io/npm/v/@woven-ecs/core)](https://www.npmjs.com/package/@woven-ecs/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

# woven-ecs

A high-performance, multi-threaded Entity Component System (ECS) framework for TypeScript.

- **Multi-threaded** - Run systems in parallel across Web Workers using SharedArrayBuffer
- **Type-safe** - Full TypeScript support with inferred component types
- **Data-oriented** - Components stored in typed arrays for cache-friendly access
- **Reactive queries** - Track entity additions, removals, and component changes
- **Zero dependencies** - Lightweight core with no external runtime dependencies

## Packages

| Package | Description |
|---------|-------------|
| [@woven-ecs/core](./packages/core) | Core ECS framework with components, systems, queries, and multi-threading |
| [@woven-ecs/editor-store](./packages/editor-store) | Persistence, undo/redo, and real-time collaboration for editor applications |
| [@woven-ecs/editor-store-server](./packages/editor-store-server) | Server for real-time collaboration with @woven-ecs/editor-store clients |

## Installation

```bash
npm install @woven-ecs/core
```

## Quick Start

```typescript
import {
  World,
  defineComponent,
  defineQuery,
  defineSystem,
  field,
  createEntity,
} from '@woven-ecs/core';

// Define components with typed fields
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

// Define a query to find entities with both components
const movingEntities = defineQuery((q) =>
  q.with(Position, Velocity)
);

// Define a system to process matching entities
const movementSystem = defineSystem((ctx) => {
  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);
    pos.x += vel.x;
    pos.y += vel.y;
  }
});

// Create the world
const world = new World([Position, Velocity]);

// On the first sync create an entity with Position and Velocity components
world.nextSync((ctx) => { 
  const entity = createEntity(ctx);
  Position.write(ctx, entity).x = 0;
  Velocity.write(ctx, entity).x = 1;
})

// Game loop
function loop() {
  world.sync();
  world.execute(movementSystem);
  requestAnimationFrame(loop);
}

loop();
```

## Multithreading

Run computationally intensive systems across multiple CPU cores:

```typescript
// physics-worker.ts
import { setupWorker, defineQuery } from '@woven-ecs/core';

const physicsQuery = defineQuery((q) =>
  q.with(Position, Velocity)
);

setupWorker((ctx) => {
  for (const eid of physicsQuery.current(ctx)) {
    // Process entities in parallel
  }
});

// main.ts
const physicsSystem = defineWorkerSystem(
  new URL('./physics-worker.ts', import.meta.url).href,
  { threads: 4 }
);

await world.execute(physicsSystem);
```

## Documentation

Visit the [documentation site](https://woven-ecs.dev) for guides on:

- [Getting Started](https://woven-ecs.dev/guide/getting-started/)
- [Components](https://woven-ecs.dev/architecture/components/)
- [Systems](https://woven-ecs.dev/architecture/systems/)
- [Queries](https://woven-ecs.dev/architecture/queries/)
- [Multithreading](https://woven-ecs.dev/advanced/multithreading/)

## Local Development

```bash
git clone https://github.com/WillH0lt/woven-ecs.git
cd woven-ecs
pnpm install
pnpm build
pnpm test
```

## License

MIT License.

## Community

- [GitHub Issues](https://github.com/WillH0lt/woven-ecs/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/WillH0lt/woven-ecs/discussions) - Questions and ideas
