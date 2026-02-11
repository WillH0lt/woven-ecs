---
title: Introduction
description: Learn what Woven-ECS is and why you might want to use it
---

Woven-ECS is a high-performance Entity Component System (ECS) framework designed for TypeScript applications that need to process large numbers of entities efficiently, particularly in multithreaded environments.

## What is an ECS?

An Entity Component System is an architectural pattern commonly used in game development and simulations. It consists of three core concepts:

1. **Entities** are unique identifiers (simple numbers) that represent objects in your application
2. **Components** are plain data containers attached to entities (e.g., Position, Velocity, Health)
3. **Systems** are functions that process entities matching specific component combinations

This separation of data (components) from behavior (systems) enables better cache utilization, easier parallelization, and more flexible composition than traditional object-oriented approaches.

## Why Woven-ECS?

Woven-ECS was built with several goals in mind:

### Performance Through Multithreading

Woven-ECS uses SharedArrayBuffer to share data between the main thread and Web Workers without copying. Systems can run in parallel across multiple CPU cores, making it ideal for computationally intensive applications like physics simulations or particle systems.

### Type Safety

The framework is built TypeScript-first with full type inference. Component fields are strongly typed, and the query system provides autocomplete and type checking throughout.

### Data-Oriented Design

Components store their data in typed arrays (Float32Array, Uint8Array, etc.) for efficient memory layout and cache-friendly access patterns. This is particularly important when processing thousands of entities per frame.

### Reactive Queries

Beyond simple entity filtering, Woven-ECS tracks all changes to entities and components. You can query for entities that were:
- **Added**: Newly created or gained required components
- **Removed**: Destroyed or lost required components
- **Changed**: Had tracked component data modified

## Core Concepts Overview

```typescript
import {
  World,
  defineComponent,
  defineQuery,
  defineSystem,
  field,
  createEntity
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

// Create the world and add an entity
const world = new World([Position, Velocity]);
world.execute((ctx) => {
  const entity = createEntity(ctx);
  Position.write(ctx, entity).x = 0;
  Position.write(ctx, entity).y = 0;
  Velocity.write(ctx, entity).x = 1;
  Velocity.write(ctx, entity).y = 0.5;
});

// game loop
function loop() {
  world.execute(movementSystem);
  requestAnimationFrame(loop);
}

loop();
```

## Next Steps

- [Getting Started](/guide/getting-started/) - Install Woven-ECS and create your first project
- [Components](/architecture/components/) - Learn about defining and using components
- [Systems](/architecture/systems/) - Understand how to process entities
- [Queries](/architecture/queries/) - Master the query system for finding entities
