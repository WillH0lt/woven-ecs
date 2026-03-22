---
title: World
description: The container that orchestrates entities, components, and systems
---

A world serves as the container for all your entities, components, and systems. Most applications will have exactly one world.

## Creating a World

```typescript
import { World } from '@woven-ecs/core';
import { Position, Velocity, Health } from './components';

const world = new World([Position, Velocity, Health], {
  maxEntities: 10_000,
  maxEvents: 131_072,
  threads: navigator.hardwareConcurrency,
  resources: {
    canvas: document.getElementById('game'),
    settings: { difficulty: 'hard' },
  }
});
```

The constructor takes two arguments:

1. **Component definitions** - An array of component and singleton definitions to register with the world. All components must be registered at world creation time.

2. **Options** (optional) - A configuration object with the following properties:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `threads` | number | navigator.hardwareConcurrency | Number of worker threads for parallel system execution |
| `maxEntities` | number | 10,000 | Maximum number of entities the world can contain. Note that removed entities continue to count against this total for 1 extra frame while their IDs are reclaimed. |
| `maxEvents` | number | 131,072 | Size of the event ring buffer. Should be large enough to hold all events within a frame |
| `resources` | unknown | undefined | User-defined resources accessible from systems via `getResources(ctx)` |

## The Game Loop

Execute your systems by calling `execute()`:

```typescript
await world.execute(movementSystem, collisionSystem, renderSystem);
```

You'll typically call this in your game loop using `requestAnimationFrame`:

```typescript
function gameLoop() {
  world.execute(inputSystem, physicsSystem, renderSystem);
  requestAnimationFrame(gameLoop);
}
```

Systems passed to `execute()` run in the order provided.

## Context

The context object is needed to interact with the world and its entities. Inside systems, the context is automatically passed as the first argument:

```ts
const spawnSystem = defineSystem((ctx: Context) => {
  const entity = createEntity(ctx);
  addComponent(ctx, entity, Position);
});
```

Outside of systems (e.g., from UI callbacks or initialization code), use `world.execute` for immediate execution or `world.nextSync` to defer until the next frame:

```ts
// Immediate execution
world.execute((ctx: Context) => {
  const entity = createEntity(ctx);
  addComponent(ctx, entity, Position, { x: 0, y: 0 });
});

// Deferred until next frame (preferred for event handlers)
button.onclick = () => {
  world.nextSync((ctx: Context) => {
    const entity = createEntity(ctx);
  });
};
```

The `nextSync()` function returns a cancel function if you need to abort the scheduled callback.

## Sync

Call `world.sync()` once per frame at the start of your game loop:

```typescript
function loop() {
  world.sync();
  world.execute(systems);
  requestAnimationFrame(loop);
}

loop();
```

Calling `sync()` does three things:
1. Updates `ctx.time` with the current frame's timing data (`deltaMs`, `elapsedMs`, `frame`)
2. Executes any callbacks scheduled with `world.nextSync()`
3. Invokes callbacks for all [subscriptions](/docs/queries/#subscriptions) with their accumulated changes

It's recommended to call `sync()` once per frame at the start of your game loop, before executing systems.

### Timing

Every context includes a `time` object with timing information, updated each time `sync()` is called:

```ts
const movementSystem = defineSystem((ctx) => {
  const dt = ctx.time.deltaMs / 1000; // seconds since last sync

  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
  }
});
```

| Property | Type | Description |
|----------|------|-------------|
| `time.deltaMs` | number | Milliseconds since the previous `sync()` call. 0 on the first call. |
| `time.elapsedMs` | number | Total milliseconds elapsed since the first `sync()` call. |
| `time.frame` | number | Number of times `sync()` has been called. Starts at 0. |

All systems within a frame see the same `time` values.

## Resources

Resources let you pass objects like renderers, cameras, HTML element refs, or anything really to your systems. Provide resources when creating the world:

```typescript
const world = new World(components, {
  resources: {
    renderer: new WebGLRenderer(),
    camera: new PerspectiveCamera(),
    input: { keys: new Set() },
  },
});
```

Access resources from within systems:

```typescript
import { getResources } from '@woven-ecs/core';

const renderSystem = defineSystem((ctx) => {
  const { renderer, camera } = getResources(ctx);
  // Use renderer and camera
});
```

:::caution
Resources are only accessible from main thread systems. Worker systems cannot access resources since they run in separate threads.
:::

## Cleanup

When you're done with a world, dispose of it to free resources:

```typescript
world.dispose();
```

This terminates all worker threads, clears subscriptions, and releases internal state. The SharedArrayBuffers used for entity and component storage will be garbage collected once no references remain.
