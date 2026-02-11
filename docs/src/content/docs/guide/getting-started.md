---
title: Getting Started
description: Install Woven-ECS and create your first ECS application
---

This guide will walk you through installing Woven-ECS and creating a simple application.

## Installation

```bash
npm install @woven-ecs/core
```

## Basic Setup

### 1. Define Components

Components are data containers that can be attached to entities. Define them using `defineComponent` with typed fields:

```typescript
import { defineComponent, field } from '@woven-ecs/core';

export const Position = defineComponent({
  x: field.float32().default(0),
  y: field.float32().default(0),
  z: field.float32().default(0),
});

export const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
});

export const Health = defineComponent({
  current: field.uint16().default(100),
  max: field.uint16().default(100),
});
```

### 2. Create the World

The World is the container that manages all entities, components, and systems:

```typescript
import { World } from '@woven-ecs/core';
import { Position, Velocity, Health } from './components';

const world = new World([Position, Velocity, Health], {
  maxEntities: 10000,  // Maximum number of entities
});
```

### 3. Create Entities and Add Components

```typescript
import { createEntity, addComponent } from '@woven-ecs/core';

const ctx = world._getContext();

// Create an entity
const player = createEntity(ctx);

// Add components and set data
addComponent(ctx, player, Position);
addComponent(ctx, player, Velocity);
addComponent(ctx, player, Health);

// Write component data
const pos = Position.write(ctx, player);
pos.x = 100;
pos.y = 50;

const health = Health.write(ctx, player);
health.current = 80;
health.max = 100;
```

### 4. Define Queries

Queries find entities that have specific component combinations:

```typescript
import { defineQuery } from '@woven-ecs/core';

// Find all entities with Position and Velocity
const movingEntities = defineQuery((q) =>
  q.with(Position, Velocity)
);

// Find entities with Health but without a Shield component
const vulnerableEntities = defineQuery((q) =>
  q.with(Health).without(Shield)
);
```

### 5. Define Systems

Systems are functions that process entities:

```typescript
import { defineSystem } from '@woven-ecs/core';

const movementSystem = defineSystem((ctx) => {
  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);

    pos.x += vel.x;
    pos.y += vel.y;
    pos.z += vel.z;
  }
});
```

### 6. Run the Game Loop

```typescript
async function gameLoop() {
  while (running) {
    world.sync();
    await world.execute(movementSystem);
    requestAnimationFrame(gameLoop);
  }
}

gameLoop();
```

## Complete Example

Here's a complete example putting it all together:

```typescript
import {
  World,
  defineComponent,
  defineQuery,
  defineSystem,
  defineSingleton,
  field,
  createEntity,
} from '@woven-ecs/core';

// Components
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

// Singleton for delta time
const Time = defineSingleton({
  delta: field.float32(),
});

// Query
const movingEntities = defineQuery((q) =>
  q.with(Position, Velocity)
);

// System
const movementSystem = defineSystem((ctx) => {
  const time = Time.read(ctx);

  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);

    pos.x += vel.x * time.delta;
    pos.y += vel.y * time.delta;
  }
});

// Setup
const world = new World([Position, Velocity, Time]);
const ctx = world._getContext();

// Create some entities
for (let i = 0; i < 1000; i++) {
  const eid = createEntity(ctx);

  const pos = Position.write(ctx, eid);
  pos.x = Math.random() * 800;
  pos.y = Math.random() * 600;

  const vel = Velocity.write(ctx, eid);
  vel.x = (Math.random() - 0.5) * 100;
  vel.y = (Math.random() - 0.5) * 100;
}

// Game loop
let lastTime = performance.now();

async function loop() {
  const now = performance.now();
  const time = Time.write(ctx);
  time.delta = (now - lastTime) / 1000;
  lastTime = now;

  world.sync();
  await world.execute(movementSystem);

  requestAnimationFrame(loop);
}

loop();
```

## Next Steps

- [Components](/architecture/components/) - Learn about all available field types
- [Systems](/architecture/systems/) - Explore worker systems for multithreading
- [Queries](/architecture/queries/) - Master change tracking queries
