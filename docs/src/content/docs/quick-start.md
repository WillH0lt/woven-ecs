---
title: Quick Start
description: Install Woven-ECS and create your first ECS application
---

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
```

### 2. Create the World

The World is the container that manages all entities, components, and systems:

```typescript
import { World } from '@woven-ecs/core';
import { Position, Velocity } from './components';

// Create a world with the defined components
const world = new World([Position, Velocity]);
```

### 3. Create Entities and Add Components

```typescript
import { createEntity, addComponent, type Context } from '@woven-ecs/core';

// Initialize the world with an entity
world.execute((ctx: Context) => {
  // Create an entity
  const particle = createEntity(ctx);

  // Add components and set data
  addComponent(ctx, particle, Position, { x: 100, y: 50, z: 0 });
  addComponent(ctx, particle, Velocity, { x: 1, y: 1, z: 0 });
});
```

### 4. Define Queries

Queries find entities that have specific component combinations:

```typescript
import { defineQuery, type QueryBuilder } from '@woven-ecs/core';

// Find all entities with Position and Velocity
const particles = defineQuery((q: QueryBuilder) =>
  q.with(Position, Velocity)
);

```

### 5. Define Systems

Systems are functions that process entities:

```typescript
import { defineSystem, type Context } from '@woven-ecs/core';

const movementSystem = defineSystem((ctx: Context) => {
  for (const eid of particles.current(ctx)) {
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
function loop() {
  world.execute(movementSystem);
  requestAnimationFrame(loop);
}

loop();
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
  addComponent,
  type Context,
  type QueryBuilder,
} from '@woven-ecs/core';

// Components
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
});

const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
});


// Query
const particles = defineQuery((q: QueryBuilder) =>
  q.with(Position, Velocity)
);

// System
const movementSystem = defineSystem((ctx: Context) => {
  for (const eid of particles.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);
    
    pos.x += vel.x;
    pos.y += vel.y;
    pos.z += vel.z;
  }
});

// World
const world = new World([Position, Velocity]);

// Initialize with an entity
world.execute((ctx: Context) => {
  const particle = createEntity(ctx);
  addComponent(ctx, particle, Position, { x: 100, y: 50, z: 0 });
  addComponent(ctx, particle, Velocity, { x: 1, y: 1, z: 0 });
});

// Game loop
function loop() {
  world.execute(movementSystem);
  requestAnimationFrame(loop);
}

loop();

```

## Next Steps

- [Components](/docs/components-singletons/) - Learn about all available field types
- [Systems](/docs/systems/) - Explore worker systems for multithreading
- [Queries](/docs/queries/) - Master change tracking queries
