---
title: woven-ecs
description: API reference for @woven-ecs/core
---

## Components

### defineComponent(schema)

Creates a component definition with typed fields.

```typescript
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
});
```

**Returns:** `ComponentDef<T>`

### defineSingleton(schema)

Creates a singleton component (one instance per world).

```typescript
const Time = defineSingleton({
  delta: field.float32(),
  elapsed: field.float32(),
});
```

**Returns:** `SingletonDef<T>`

### ComponentDef Methods

| Method | Description |
|--------|-------------|
| `.read(ctx, entityId)` | Read-only access to component data |
| `.write(ctx, entityId)` | Read-write access (triggers change events) |
| `.copy(ctx, entityId, data)` | Bulk update fields |
| `.snapshot(ctx, entityId)` | Get plain object copy |
| `.default()` | Get default field values |

### SingletonDef Methods

| Method | Description |
|--------|-------------|
| `.read(ctx)` | Read-only access |
| `.write(ctx)` | Read-write access |
| `.copy(ctx, data)` | Bulk update |
| `.snapshot(ctx)` | Get plain object copy |

---

## Field Types

### Numeric

```typescript
field.uint8()    // 0 to 255
field.uint16()   // 0 to 65,535
field.uint32()   // 0 to 4,294,967,295
field.int8()     // -128 to 127
field.int16()    // -32,768 to 32,767
field.int32()    // -2B to 2B
field.float32()  // Single precision float
field.float64()  // Double precision float
```

### Other Types

```typescript
field.boolean()              // true/false
field.string().max(length)   // UTF-8 string
field.binary().max(length)   // Raw bytes
field.enum(EnumType)         // Type-safe enum
field.ref()                  // Entity reference
```

### Containers

```typescript
field.array(elementType, maxLength)  // Variable-length array
field.tuple(elementType, length)     // Fixed-length tuple
field.buffer(numericType).size(n)    // TypedArray view
```

### Modifiers

```typescript
field.float32().default(0)  // Set default value
```

---

## Entity Management

### createEntity(ctx)

Allocates a new entity ID.

```typescript
const entity = createEntity(ctx);
```

**Returns:** `EntityId` (number)

### removeEntity(ctx, entityId)

Marks an entity as dead. Data is preserved until all systems see the removal.

```typescript
removeEntity(ctx, entity);
```

### addComponent(ctx, entityId, componentDef, data?)

Attaches a component to an entity.

```typescript
addComponent(ctx, entity, Position);
addComponent(ctx, entity, Velocity, { x: 1, y: 0 });
```

### removeComponent(ctx, entityId, componentDef)

Detaches a component from an entity.

```typescript
removeComponent(ctx, entity, Velocity);
```

### hasComponent(ctx, entityId, componentDef)

Checks if an entity has a component.

```typescript
if (hasComponent(ctx, entity, Velocity)) { }
```

**Returns:** `boolean`

### isAlive(ctx, entityId)

Checks if an entity exists and is not removed.

```typescript
if (isAlive(ctx, entity)) { }
```

**Returns:** `boolean`

### getBackrefs(ctx, targetId, componentDef, fieldName)

Finds entities referencing a target via a ref field.

```typescript
const children = getBackrefs(ctx, parentId, Parent, 'entity');
```

**Returns:** `EntityId[]`

---

## Queries

### defineQuery(builder)

Creates a query definition.

```typescript
const query = defineQuery((q) =>
  q.with(Position, Velocity)
   .without(Dead)
   .any(Player, Enemy)
   .tracking(Health)
);
```

### Query Builder Methods

| Method | Description |
|--------|-------------|
| `.with(...components)` | Must have ALL components |
| `.without(...components)` | Must NOT have components |
| `.any(...components)` | Must have AT LEAST ONE |
| `.tracking(...components)` | Track changes (also adds to `with`) |

### QueryDef Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.current(ctx, options?)` | `Uint32Array` | All matching entities |
| `.added(ctx, options?)` | `number[]` | Newly matching entities |
| `.removed(ctx, options?)` | `number[]` | No longer matching |
| `.changed(ctx, options?)` | `number[]` | Tracked components changed |
| `.addedOrChanged(ctx)` | `number[]` | Added or changed |
| `.addedOrRemoved(ctx)` | `number[]` | Added or removed |
| `.removedOrChanged(ctx)` | `number[]` | Removed or changed |
| `.addedOrChangedOrRemoved(ctx)` | `number[]` | Any change |

### Query Options

```typescript
interface QueryOptions {
  partitioned?: boolean;  // Override automatic partitioning
}
```

---

## Systems

### defineSystem(fn)

Creates a main thread system.

```typescript
const system = defineSystem((ctx: Context) => {
  // Process entities
});
```

**Returns:** `System`

### defineWorkerSystem(url, options?)

Creates a worker system.

```typescript
const system = defineWorkerSystem(
  new URL('./worker.ts', import.meta.url).href,
  { threads: 4, priority: 'high' }
);
```

**Options:**
- `threads`: Number of worker threads (default: `navigator.hardwareConcurrency`)
- `priority`: `'low'` | `'medium'` | `'high'` (default: `'medium'`)

**Returns:** `WorkerSystem`

### setupWorker(fn)

Registers a worker's execute function.

```typescript
// In worker file
setupWorker(execute);

function execute(ctx: Context) {
  // Process entities
}
```

### getResources(ctx)

Gets user resources (main thread only).

```typescript
const { renderer, camera } = getResources(ctx);
```

---

## World

### new World(components, options?)

Creates a new ECS world.

```typescript
const world = new World([Position, Velocity, Time], {
  maxEntities: 10000,
  maxEvents: 131072,
  threads: 4,
  resources: { canvas },
});
```

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `maxEntities` | 10,000 | Maximum concurrent entities |
| `maxEvents` | 131,072 | Event ring buffer size |
| `threads` | `hardwareConcurrency` | Worker thread count |
| `resources` | `undefined` | Custom data for systems |

### World Methods

| Method | Description |
|--------|-------------|
| `execute(...systems)` | Run systems (returns Promise) |
| `sync()` | Process subscriptions and deferred callbacks |
| `subscribe(query, callback)` | Subscribe to query changes |
| `nextSync(callback)` | Schedule callback for next sync |
| `dispose()` | Cleanup and terminate workers |

---
