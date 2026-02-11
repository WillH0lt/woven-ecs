---
title: Queries
description: Find and track entities matching component criteria
---

Queries are the primary way to find entities in Woven-ECS. They filter entities by component presence and track changes over time.

## Defining Queries

Use `defineQuery` with a builder function:

```typescript
import { defineQuery } from '@woven-ecs/core';

const movingEntities = defineQuery((q) =>
  q.with(Position, Velocity)
);
```

Queries are lazy - they're defined at module scope and initialized on first use.

## Query Operators

### with()

Entities must have **all** specified components:

```typescript
// Entities with Position AND Velocity AND Health
const query = defineQuery((q) =>
  q.with(Position, Velocity, Health)
);
```

### without()

Entities must **not** have specified components:

```typescript
// Entities with Health but NOT Dead
const aliveEntities = defineQuery((q) =>
  q.with(Health).without(Dead)
);
```

### any()

Entities must have **at least one** of the specified components:

```typescript
// Entities with (Player OR Enemy OR NPC)
const characters = defineQuery((q) =>
  q.any(Player, Enemy, NPC)
);

// Combine with other operators
const movingCharacters = defineQuery((q) =>
  q.with(Position, Velocity)
   .any(Player, Enemy, NPC)
   .without(Frozen)
);
```

### tracking()

Track changes to specific components:

```typescript
// Track when Velocity changes
const velocityTracked = defineQuery((q) =>
  q.with(Position).tracking(Velocity)
);

// tracking() also adds the component to with()
// This is equivalent to:
const equivalent = defineQuery((q) =>
  q.with(Position, Velocity).tracking(Velocity)
);
```

## Query Methods

### current()

Get all entities currently matching the query:

```typescript
for (const eid of query.current(ctx)) {
  // Process entity
}
```

Returns a `Uint32Array` for optimal iteration performance.

### added()

Get entities that started matching since last check:

```typescript
for (const eid of query.added(ctx)) {
  // Entity was just created or gained required components
  console.log('New entity:', eid);
}
```

### removed()

Get entities that stopped matching since last check:

```typescript
for (const eid of query.removed(ctx)) {
  // Entity was destroyed or lost required components
  // Component data is still readable here!
  const finalPos = Position.read(ctx, eid);
  console.log('Entity removed at:', finalPos.x, finalPos.y);
}
```

### changed()

Get entities with tracked component changes:

```typescript
const tracked = defineQuery((q) =>
  q.with(Position).tracking(Velocity)
);

for (const eid of tracked.changed(ctx)) {
  // Velocity was modified via .write()
  console.log('Velocity changed for:', eid);
}
```

### Combined Methods

```typescript
// Added or changed
for (const eid of query.addedOrChanged(ctx)) { }

// Added or removed
for (const eid of query.addedOrRemoved(ctx)) { }

// Removed or changed
for (const eid of query.removedOrChanged(ctx)) { }

// Any change at all
for (const eid of query.addedOrChangedOrRemoved(ctx)) { }
```

## Query Options

### Partitioning

Control how queries distribute entities across worker threads:

```typescript
// Force partitioning on (default when threadCount > 1)
for (const eid of query.current(ctx, { partitioned: true })) { }

// Force partitioning off (process all entities in this thread)
for (const eid of query.current(ctx, { partitioned: false })) { }
```

When partitioned, each worker receives:
```
entities where entityId % threadCount === threadIndex
```

## Subscriptions

React to query changes on the main thread:

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

// Call sync() to trigger subscriptions
world.sync();

// Unsubscribe when done
unsubscribe();
```

## Performance Considerations

### Query Caching

Queries cache their results per frame. Multiple calls to `current()` return the same array:

```typescript
const a = query.current(ctx);
const b = query.current(ctx);
console.log(a === b); // true
```

### Event Window

Change methods (`added`, `removed`, `changed`) work within an event window:

1. Events are recorded as entities/components change
2. Queries read events from `prevEventIndex` to `currEventIndex`
3. After `world.execute()`, the window advances

```typescript
// Frame 1
createEntity(ctx); // Records ADDED event

// Frame 2 - after execute()
query.added(ctx); // Returns the new entity
```

### Bitmask Matching

Internally, queries use bitmasks for O(1) component matching:

```
Entity bitmask:  [1][0][1][1][0][0][0][1]
Query with mask: [0][0][1][1][0][0][0][0]
Query without:   [0][0][0][0][0][0][0][1]

Match = (entity & with) === with && (entity & without) === 0
```

## Common Patterns

### Filtering by State

```typescript
enum State { Idle, Moving, Attacking }

const StateComponent = defineComponent({
  value: field.enum(State),
});

// Query all, filter in system
const allCharacters = defineQuery((q) => q.with(StateComponent));

const attackSystem = defineSystem((ctx) => {
  for (const eid of allCharacters.current(ctx)) {
    const state = StateComponent.read(ctx, eid);
    if (state.value === State.Attacking) {
      // Handle attack
    }
  }
});
```

### Parent-Child Relationships

```typescript
const Parent = defineComponent({
  entity: field.ref(),
});

// Find children of a specific parent
const children = defineQuery((q) => q.with(Parent));

function getChildren(ctx: Context, parentId: EntityId) {
  const result: EntityId[] = [];
  for (const eid of children.current(ctx)) {
    const parent = Parent.read(ctx, eid);
    if (parent.entity === parentId) {
      result.push(eid);
    }
  }
  return result;
}
```

### Spatial Queries

Woven-ECS queries are component-based, not spatial. For spatial queries, maintain a spatial index component:

```typescript
const SpatialCell = defineComponent({
  cellX: field.int32(),
  cellY: field.int32(),
});

// Update cell when position changes
const spatialSystem = defineSystem((ctx) => {
  for (const eid of spatialQuery.changed(ctx)) {
    const pos = Position.read(ctx, eid);
    const cell = SpatialCell.write(ctx, eid);
    cell.cellX = Math.floor(pos.x / CELL_SIZE);
    cell.cellY = Math.floor(pos.y / CELL_SIZE);
  }
});
```
