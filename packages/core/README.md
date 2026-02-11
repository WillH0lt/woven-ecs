# @woven-ecs/core

The core Entity Component System (ECS) framework for TypeScript with first-class multithreading support.

## Features

- **Multithreaded execution** - Run systems in parallel across Web Workers using SharedArrayBuffer
- **Typed components** - Define components with strongly-typed fields (float32, uint8, strings, refs, etc.)
- **Reactive queries** - Query for added, removed, or changed entities each frame
- **Singletons** - Global state accessible from any system
- **Zero dependencies** - Lightweight runtime with no external dependencies

## Installation

```bash
npm install @woven-ecs/core
```

## Usage

```typescript
import {
  World,
  defineComponent,
  defineQuery,
  defineSystem,
  field,
  createEntity,
} from '@woven-ecs/core';

// Define components
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

// Define queries
const movingEntities = defineQuery((q) =>
  q.with(Position, Velocity)
);

// Define systems
const movementSystem = defineSystem((ctx) => {
  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);
    pos.x += vel.x;
    pos.y += vel.y;
  }
});

// Create world and add an entity
const world = new World([Position, Velocity]);
world.execute((ctx) => {
  const entity = createEntity(ctx);
  Position.write(ctx, entity).x = 100;
  Velocity.write(ctx, entity).x = 1;
});

// Game loop
function loop() {
  world.execute(movementSystem);
  requestAnimationFrame(loop);
}

loop();
```

## Worker Systems

Offload heavy computation to Web Workers:

```typescript
// physics-worker.ts
import { setupWorker, defineQuery } from '@woven-ecs/core';
import { Position, Velocity } from './components';

const query = defineQuery((q) => q.with(Position, Velocity));

setupWorker((ctx) => {
  for (const eid of query.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);
    pos.x += vel.x;
    pos.y += vel.y;
  }
});

// main.ts
import { defineWorkerSystem } from '@woven-ecs/core';

const physicsSystem = defineWorkerSystem(
  new URL('./physics-worker.ts', import.meta.url).href,
  { threads: 4 }
);

await world.execute(physicsSystem);
```

## Documentation

- [Getting Started](https://woven-ecs.dev/guide/getting-started/)
- [Components](https://woven-ecs.dev/architecture/components/)
- [Systems](https://woven-ecs.dev/architecture/systems/)
- [Queries](https://woven-ecs.dev/architecture/queries/)
- [Multithreading](https://woven-ecs.dev/advanced/multithreading/)

## License

MIT
