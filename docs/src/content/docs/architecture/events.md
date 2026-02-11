---
title: Events & Subscriptions
description: Track entity and component changes reactively
---

Woven-ECS tracks all changes to entities and components through an event system. This enables reactive queries and subscriptions.

## Event Types

The framework records these event types:

| Event | Trigger |
|-------|---------|
| `ADDED` | Entity created with `createEntity()` |
| `REMOVED` | Entity removed with `removeEntity()` |
| `COMPONENT_ADDED` | Component added with `addComponent()` |
| `COMPONENT_REMOVED` | Component removed with `removeComponent()` |
| `CHANGED` | Component data modified via `.write()` |

## Event Buffer

Events are stored in a lock-free ring buffer:

```typescript
const world = new World(components, {
  maxEvents: 131072,  // Default size
});
```

When the buffer fills, oldest events are overwritten. Size it based on:
- Entities created/destroyed per frame
- Components added/removed per frame
- Components modified per frame

## Reactive Queries

Queries can filter entities by recent events:

### added()

Entities that started matching the query:

```typescript
const enemies = defineQuery((q) => q.with(Enemy, Health));

// New enemies this frame
for (const eid of enemies.added(ctx)) {
  console.log('Enemy spawned:', eid);
}
```

An entity is "added" when:
- It's created with `createEntity()` and has the required components
- It gains a required component via `addComponent()`

### removed()

Entities that stopped matching the query:

```typescript
for (const eid of enemies.removed(ctx)) {
  // Entity was destroyed or lost Enemy/Health component
  // Component data is still readable here!
  const finalHealth = Health.read(ctx, eid);
  console.log('Enemy died with health:', finalHealth.current);
}
```

### changed()

Entities with tracked component changes:

```typescript
const tracked = defineQuery((q) =>
  q.with(Position).tracking(Velocity)
);

for (const eid of tracked.changed(ctx)) {
  // Velocity.write() was called on this entity
  const vel = Velocity.read(ctx, eid);
  console.log('New velocity:', vel.x, vel.y);
}
```

:::note
Only components in `tracking()` trigger change events. Regular `with()` components don't.
:::

### Combined Queries

```typescript
// Added or changed this frame
for (const eid of query.addedOrChanged(ctx)) { }

// Added or removed this frame
for (const eid of query.addedOrRemoved(ctx)) { }

// Removed or changed this frame
for (const eid of query.removedOrChanged(ctx)) { }

// Any event this frame
for (const eid of query.addedOrChangedOrRemoved(ctx)) { }
```

## Subscriptions

Subscribe to query changes on the main thread:

```typescript
const playerQuery = defineQuery((q) =>
  q.with(Player, Health).tracking(Health)
);

const unsubscribe = world.subscribe(
  playerQuery,
  (ctx, { added, removed, changed }) => {
    for (const eid of added) {
      console.log('Player joined');
    }

    for (const eid of removed) {
      console.log('Player left');
    }

    for (const eid of changed) {
      const health = Health.read(ctx, eid);
      console.log('Player health:', health.current);
    }
  }
);
```

### Invoking Subscriptions

Subscriptions are invoked during `world.sync()`:

```typescript
// Game loop
while (running) {
  world.sync();  // Triggers all subscription callbacks
  await world.execute(systems);
}
```

### Unsubscribing

```typescript
const unsubscribe = world.subscribe(query, callback);

// Later...
unsubscribe();
```

## Deferred Operations

Schedule code to run at the next `sync()`:

```typescript
button.addEventListener('click', () => {
  world.nextSync((ctx) => {
    // Safe to create entities here
    const entity = createEntity(ctx);
    addComponent(ctx, entity, Player);
  });
});
```

This avoids creating entities during event handlers, which could disrupt the current frame.

## Event Window

Events are processed within a time window:

```
Frame 1:                    Frame 2:
├─ create entity A          ├─ query.added() returns [A]
├─ modify entity A          ├─ query.changed() returns [A]
├─ execute()                ├─ execute()
└─ window advances          └─ window advances
```

The context tracks:
- `prevEventIndex`: Start of current window
- `currEventIndex`: End of current window (write position)

After `execute()`, the window advances and old events become invisible to queries.

## Singleton Events

Singletons use a special entity ID (`SINGLETON_ENTITY_ID = 0xFFFFFFFF`):

```typescript
const TimeQuery = defineQuery((q) => q.tracking(Time));

// Check if Time singleton changed
for (const eid of TimeQuery.changed(ctx)) {
  // eid === SINGLETON_ENTITY_ID
  const time = Time.read(ctx);
  console.log('Time updated:', time.elapsed);
}
```

## Soft Deletion

When entities are removed, their data is preserved until all systems have seen the removal:

```typescript
removeEntity(ctx, entity);

// Entity is marked dead
console.log(isAlive(ctx, entity)); // false

// But data is still readable in removed() queries
for (const eid of query.removed(ctx)) {
  const pos = Position.read(ctx, eid);  // Works!
  console.log('Final position:', pos.x, pos.y);
}

// After execute(), the entity ID may be reused
```

This enables cleanup logic to read final component state.

## Best Practices

### 1. Use tracking() Sparingly

Every `.write()` call on a tracked component records an event:

```typescript
// Creates an event every frame for every entity
for (const eid of query.current(ctx)) {
  Position.write(ctx, eid).x += 1;
}
```

Only track components you need to observe for changes.

### 2. Check added() Before current()

For initialization logic:

```typescript
// Initialize new entities
for (const eid of enemies.added(ctx)) {
  setupEnemy(eid);
}

// Process all entities
for (const eid of enemies.current(ctx)) {
  updateEnemy(eid);
}
```

### 3. Size the Event Buffer Appropriately

Calculate worst-case events per frame:

```
Events = entities_created + entities_removed +
         components_added + components_removed +
         component_writes_on_tracked
```

Add headroom for bursts.

### 4. Use nextSync() for Event Handlers

```typescript
// Don't create entities directly in event handlers
socket.on('spawn', (data) => {
  world.nextSync((ctx) => {
    const entity = createEntity(ctx);
    // ...
  });
});
```
