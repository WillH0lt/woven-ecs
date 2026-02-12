---
title: Entities
description: Lightweight identifiers that group components together
---

In Woven-ECS an *entity* is simply a unique identifier -- it's an integer that serves as a key to group components together. Unlike object-oriented approaches where entities might be class instances containing data, Woven-ECS entities carry no data themselves. They're lightweight handles that the ECS uses to look up component data stored in contiguous, cache-friendly buffers.

## Creating Entities

Create entities using the `createEntity` function with a context:

```ts
import { createEntity, World, type Context } from '@woven-ecs/core';
import { Position, Velocity } from './components';

const world = new World([Position, Velocity]);

world.execute((ctx: Context) => {
  const entityId = createEntity(ctx);
});
```

The function returns the entity's ID immediately, which you can use to add components:

```ts
const player = createEntity(ctx);
addComponent(ctx, player, Position, { x: 100, y: 200 });
addComponent(ctx, player, Velocity, { x: 0, y: 0 });
addComponent(ctx, player, Health, { current: 100, max: 100 });
```

## Removing Entities

Remove entities with `removeEntity`:

```ts
import { removeEntity } from '@woven-ecs/core';

removeEntity(ctx, entityId);
```

When an entity is removed:
1. It's immediately marked as dead
2. Component data is preserved briefly so queries can access final values
3. The entity ID becomes available for reuse after all systems have processed the removal

This design lets you read component data from recently removed entities using query methods like `.removed()`:

```ts
const despawnSystem = defineSystem((ctx: Context) => {
  for (const id of enemyQuery.removed(ctx)) {
    // Entity is gone, but we can still read its final position
    const pos = Position.read(ctx, id);
    spawnExplosion(ctx, pos.x, pos.y);
  }
});
```

## Checking Entity State

Use `isAlive` to check whether an entity still exists:

```ts
import { isAlive } from '@woven-ecs/core';

if (isAlive(ctx, entityId)) {
  // Entity exists and can be used
}
```

This is useful when you've stored an entity ID and need to verify it's still valid before operating on it.
