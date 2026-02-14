---
title: Queries
description: Find and track entities matching component criteria
---

A query selects entities based on which components they have. Queries are defined at module scope using `defineQuery()` and can be shared across multiple systems.

Queries are automatically kept in sync as entities gain and lose components. The performance cost of maintaining a query scales with the number of component changes (additions and removals) rather than the total entity count.

## Building a Query

Queries use a builder pattern to express their constraints:

```typescript
import { defineQuery, defineSystem } from '@woven-ecs/core';
import { Position, Velocity, Enemy, Dead } from './components';

// Query for all entities with both Position and Velocity, but not Dead
const activeMovers = defineQuery((q) =>
  q.with(Position, Velocity).without(Dead)
);

const movementSystem = defineSystem((ctx) => {
  for (const eid of activeMovers.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);

    pos.x += vel.x;
    pos.y += vel.y;
  }
});
```

First you define which components an entity must and must not have to match the query:

- **`with(...components)`** - an entity must have *all* listed components
- **`any(...components)`** - an entity must have *at least one* of the listed components
- **`without(...components)`** - an entity must have *none* of the listed components

Each method accepts any number of component types, and they can be chained for complex filters:

```typescript
// Position AND (Player OR Enemy) AND NOT Dead
const activeCharacters = defineQuery((q) =>
  q.with(Position).any(Player, Enemy).without(Dead)
);
```

The query's `current()` method returns an array of entity IDs you can iterate over in your system.

:::tip
Queries are only updated between system executions, so you don't need to worry about the entity array changing while you iterate. Adding or removing components during iteration won't affect the current frame's results.
:::

## Reactive Queries

Beyond getting the current set of matching entities, queries can detect changes over time.

:::tip
A single query can track additions, removals, and changes simultaneously. This is more efficient than creating separate queries for each.
:::

### Added and Removed Entities

Detect when entities start or stop matching your query:

```typescript
const boxes = defineQuery((q) => q.with(Box, Transform));

const boxLifecycleSystem = defineSystem((ctx) => {
  // Entities that gained both Box and Transform since last frame
  for (const eid of boxes.added(ctx)) {
    initializeBox(eid);
  }

  // Entities that lost Box or Transform (or were destroyed) since last frame
  for (const eid of boxes.removed(ctx)) {
    cleanupBox(eid);
  }
});
```

The `added` and `removed` lists include all entities that would have been added to or removed from the `current` list since the system last executed (typically the previous frame).

:::tip
If an entity is both added and then removed between system executions, it will *not* appear in the `added` list (and vice versa). There's currently no way to query for such short-lived entities.
:::

### Tracking Changes

Detect when a component's field values have been modified via `write()`, `copy()`, or `patch()`:

```typescript
// Track changes to the Transform component
const transformedEntities = defineQuery((q) =>
  q.with(Box).tracking(Transform)
);

// This query is equivalent to querying q.with(Box, Transform)
// for the current/added/removed methods. The difference is that
// you can now query with .changed(), which returns an array of 
// entities that had their Transform modified since the last frame.

const updateBoundsSystem = defineSystem((ctx) => {
  for (const eid of transformedEntities.changed(ctx)) {
    recalculateBounds(eid);
  }
});
```

The `tracking()` method both requires the component (like `with()`) and enables change detection for it. You can track multiple components by listing them all in the `tracking()` call.

:::note
Newly added entities will *not* appear in the `changed` list, even if their fields were written to after the component was added. An entity will be in at most one of `added`, `removed`, or `changed` — they never overlap.
:::

### Combined Methods

For convenience, you can request lists that combine reactive states:

```typescript
const query = defineQuery((q) => q.with(Box).tracking(Transform));

// Entities that are new OR have changed transforms
for (const eid of query.addedOrChanged(ctx)) { /* ... */ }

// Entities that are new OR were removed
for (const eid of query.addedOrRemoved(ctx)) { /* ... */ }

// Entities that were removed OR changed
for (const eid of query.removedOrChanged(ctx)) { /* ... */ }

// All reactive events
for (const eid of query.addedOrChangedOrRemoved(ctx)) { /* ... */ }
```

## Subscriptions

React to query changes on the main thread without a system:

```typescript
const unsubscribe = world.subscribe(
  movingEntities,
  (ctx, { added, removed, changed }) => {
    for (const eid of added) {
      console.log('Entity started moving:', eid);
    }
    for (const eid of removed) {
      console.log('Entity stopped moving:', eid);
    }
  }
);

// Call sync() in your game loop to trigger subscriptions
function loop() {
  world.sync();
  ...
  requestAnimationFrame(loop);
}

// Unsubscribe when done
unsubscribe();
```

This can be useful for UI updates. Subscriptions receive the same reactive lists as systems, but they run immediately when you call `world.sync()` rather than during the system execution phase.
