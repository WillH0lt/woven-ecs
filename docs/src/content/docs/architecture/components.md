---
title: Components
description: Define typed data containers for your entities
---

Components are the data building blocks of your ECS application. Each component is a collection of typed fields that can be attached to entities.

## Defining Components

Use `defineComponent` to create a component definition:

```typescript
import { defineComponent, field } from '@woven-ecs/core';

const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
});
```

## Field Types

Woven-ECS provides a rich set of field types stored in typed arrays for performance.

### Numeric Fields

```typescript
// Unsigned integers
field.uint8()   // 0 to 255
field.uint16()  // 0 to 65,535
field.uint32()  // 0 to 4,294,967,295

// Signed integers
field.int8()    // -128 to 127
field.int16()   // -32,768 to 32,767
field.int32()   // -2,147,483,648 to 2,147,483,647

// Floating point
field.float32() // Single precision
field.float64() // Double precision
```

### Boolean

```typescript
const Flags = defineComponent({
  isActive: field.boolean(),
  isVisible: field.boolean().default(true),
});
```

### String

Strings require a maximum length to allocate buffer space:

```typescript
const Player = defineComponent({
  name: field.string().max(32),
  id: field.string().max(16).default('unknown'),
});
```

### Binary Data

For raw byte data:

```typescript
const Sprite = defineComponent({
  data: field.binary().max(1024),
});
```

### Enum

Type-safe enums with runtime validation:

```typescript
enum State {
  Idle = 0,
  Walking = 1,
  Running = 2,
  Jumping = 3,
}

const Character = defineComponent({
  state: field.enum(State).default(State.Idle),
});
```

### Arrays and Tuples

```typescript
const Path = defineComponent({
  // Variable-length array (up to 10 float32 values)
  waypoints: field.array(field.float32(), 10),
});

const Transform = defineComponent({
  // Fixed-length tuple (exactly 3 float32 values)
  scale: field.tuple(field.float32(), 3),
});
```

### Buffers

For efficient typed array access without copying:

```typescript
const Mesh = defineComponent({
  // Returns a Float32Array subarray view
  vertices: field.buffer(field.float32()).size(300),
});
```

### Entity References

Reference other entities with automatic validation:

```typescript
const Parent = defineComponent({
  entity: field.ref(),
});

const Target = defineComponent({
  target: field.ref(),
});
```

## Default Values

All field types support default values:

```typescript
const Health = defineComponent({
  current: field.uint16().default(100),
  max: field.uint16().default(100),
  regeneration: field.float32().default(0.5),
});
```

## Reading and Writing Components

### Read Access

Use `.read()` for read-only access when you don't need to modify data:

```typescript
const pos = Position.read(ctx, entityId);
console.log(pos.x, pos.y, pos.z);
```

### Write Access

Use `.write()` when you need to modify component data:

```typescript
const pos = Position.write(ctx, entityId);
pos.x += velocity.x;
pos.y += velocity.y;
```

:::caution
Using `.write()` marks the component as changed, triggering change events. Use `.read()` when you only need to read data.
:::

### Bulk Updates

Use `.copy()` to update multiple fields at once:

```typescript
Position.copy(ctx, entityId, { x: 100, y: 200, z: 0 });
```

### Snapshots

Get a plain JavaScript object copy:

```typescript
const snapshot = Position.snapshot(ctx, entityId);
// { x: 100, y: 200, z: 0 }
```

## Singletons

Singletons are components that exist once per world, useful for global state:

```typescript
import { defineSingleton, field } from '@woven-ecs/core';

const Time = defineSingleton({
  delta: field.float32(),
  elapsed: field.float32(),
});

const Config = defineSingleton({
  gravity: field.float32().default(-9.8),
  maxSpeed: field.float32().default(100),
});
```

Access singletons without an entity ID:

```typescript
// Reading
const time = Time.read(ctx);
console.log(time.delta);

// Writing
const config = Config.write(ctx);
config.gravity = -15;
```

## Adding and Removing Components

```typescript
import { addComponent, removeComponent, hasComponent } from '@woven-ecs/core';

// Add a component to an entity
addComponent(ctx, entityId, Velocity);

// Check if entity has a component
if (hasComponent(ctx, entityId, Velocity)) {
  // ...
}

// Remove a component
removeComponent(ctx, entityId, Velocity);
```

## Component Storage

Components store data in SharedArrayBuffers with the following layout:

```
[entity 0 data][entity 1 data][entity 2 data]...
```

Each entity's data contains all fields packed sequentially. This layout enables:

- **Cache-friendly iteration**: Processing entities sequentially reads contiguous memory
- **Zero-copy sharing**: Workers access the same memory without serialization
- **Predictable memory**: No garbage collection pressure after initialization
