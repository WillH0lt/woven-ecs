---
title: Best Practices
description: Guidelines for structuring and writing systems in Woven-ECS
---

When you're first starting it's best to keep things small and simple. But when you're ready to build some larger applications, here are some general ECS tips I've found helpful:

### Project Structure

Organize your ECS code into dedicated folders, with one file per component/singleton:

```
src/
├── components/
│   ├── index.ts          # Re-exports all components
│   ├── Position.ts       # One component per file
│   ├── Velocity.ts
│   ├── Sprite.ts
│   ├── Health.ts
│   └── Hovered.ts        # Marker components too
├── systems/
│   ├── capture/          # Systems grouped by phase
│   │   ├── index.ts
│   │   ├── frameSystem.ts
│   │   ├── keyboardSystem.ts
│   │   └── mouseSystem.ts
│   ├── update/
│   │   ├── index.ts
│   │   ├── movementSystem.ts
│   │   └── collisionSystem.ts
│   └── render/
│       ├── index.ts
│       └── spriteRenderSystem.ts
├── singletons/
│   ├── index.ts          # Re-exports all singletons
│   ├── Camera.ts         # One singleton per file
│   ├── Frame.ts
│   ├── Keyboard.ts
│   └── Mouse.ts
├── helpers/              # Shared utilities
│   ├── index.ts
│   └── intersect.ts
└── world.ts              # World setup and game loop
```

Each component and singleton gets its own file for clarity. Systems are organized into subdirectories by execution phase.

### System Phases

Structure your game loop into distinct phases that run in a predictable order:

| Phase | Purpose | Examples |
|-------|---------|----------|
| **Capture** | Snapshot external state | Record delta time, read keyboard/mouse, sync external data |
| **Update** | Application/Game logic | application state mutations, gameplay rules, collisions |
| **Render** | Present to screen | update UI, Draw sprites, render to canvas |

**Capture** is about figuring out what's happening right now. Capture systems read from external sources (DOM events, timers, network) and write to singletons or marker components that the rest of your application can query. By the end of this phase, the current frame's context is fully captured and ready for processing.

**Update** is where your application logic lives. Systems in this phase react to the input state that was just captured. This is the core of what makes ECS powerful: behaviors are defined by component composition, so adding a `Draggable` component to any entity automatically opts it into your drag system. The loose coupling means you can add new entity types without touching existing systems.

**Render** is read-only. Systems in this phase transform your ECS state into something visual: drawing sprites, updating DOM elements, or feeding data to a WebGL renderer. Since render systems only read component data, they never interfere with game logic, making it safe to skip frames or run at a different rate if needed.

Each phase gets its own subdirectory with an `index.ts` that re-exports its systems:

```typescript
// systems/capture/index.ts
export { frameSystem } from "./frameSystem";
export { keyboardSystem } from "./keyboardSystem";
export { mouseSystem } from "./mouseSystem";

// systems/update/index.ts
export { movementSystem } from "./movementSystem";
export { collisionSystem } from "./collisionSystem";
```

```typescript
// world.ts
import * as capture from './systems/capture';
import * as update from './systems/update';
import * as render from './systems/render';

function gameLoop() {
  world.sync();

  // Phases execute in order
  world.execute(capture.frameSystem, capture.keyboardSystem, capture.mouseSystem);
  world.execute(update.movementSystem, update.collisionSystem);
  world.execute(render.spriteRenderSystem);

  requestAnimationFrame(gameLoop);
}
```

Separating phases makes data flow predictable: capture systems write external state into the ECS, update systems read that state and modify game state, render systems read the final state and draw.

### General Guidelines

**Keep systems focused.** Each system should do one thing well. Small, focused systems are easier to test and reason about.

**Use `read()` when not modifying.** Calling `write()`, `copy()`, or `patch()` marks a component as changed, which triggers change detection in tracking queries. If you're only reading data, use `read()` to avoid false positives:

```typescript
// Good - velocity is only read, not modified
const vel = Velocity.read(ctx, eid);
const pos = Position.write(ctx, eid);
pos.x += vel.x;

// Bad - unnecessarily marks Velocity as changed
const vel = Velocity.write(ctx, eid);
const pos = Position.write(ctx, eid);
pos.x += vel.x;
```

**Prefer composition over flags.** Instead of adding boolean flags to components, add or remove marker components:

```typescript
// Avoid: flag inside component
const Enemy = defineComponent({
  health: field.float32(),
  isStunned: field.boolean(),  // Flag that changes behavior
});

// Prefer: separate marker component
const Enemy = defineComponent({ health: field.float32() });
const Stunned = defineComponent({});  // Add/remove to change state

// Now you can query directly for stunned enemies
const stunnedEnemies = defineQuery((q) => q.with(Enemy, Stunned));
```

This approach lets you write separate systems for different states and use queries to efficiently find entities in each state.

**Store derived data in components.** If you compute something expensive that multiple systems need, store it in a component rather than recomputing:

```typescript
// BoundingBox is computed once by a dedicated system
const BoundingBox = defineComponent({
  minX: field.float32(),
  minY: field.float32(),
  maxX: field.float32(),
  maxY: field.float32(),
});

// boundsSystem computes bounds from Position + Size
// collisionSystem and renderSystem both read BoundingBox
```

## Hacks

This isn't really a best practice, but just in case you need it:

**Direct buffer access.** For maximum performance in hot loops, you can bypass the `read()`/`write()` API and write directly to the underlying TypedArrays. This skips change tracking entirely, so it could be useful if you need to make a change that you don't want to show up in `changed(ctx)` queries. Use with caution!

```typescript
const moveSystem = defineSystem((ctx) => {
  // Get the internal component instances
  const positionComponent = Position._getInstance(ctx);
  const velocityComponent = Velocity._getInstance(ctx);

  // Access the raw TypedArray buffers
  const posX = positionComponent.buffer.x;
  const posY = positionComponent.buffer.y;
  const velX = velocityComponent.buffer.x;
  const velY = velocityComponent.buffer.y;

  // Write directly using entity IDs as indices
  for (const eid of movingEntities.current(ctx)) {
    posX[eid] += velX[eid];
    posY[eid] += velY[eid];
  }
});
```

This is slightly faster than calling `write()` for each entity, but comes with tradeoffs:
- **No change tracking**: Tracking queries won't detect these modifications
- **Type safety**: You're working with raw arrays, so there's no compile-time checking
- **Doesn't work with all field types**: Only works with numeric primitive fields or buffers, other field types may encode data, like string length or array length, and won't work unless you replicate that encoding logic. 
