---
title: Components & Singletons
description: Define typed data containers to add to your entities
---

A *component* holds data that can be attached to entities. In a typical application you'll define many component types, each representing a specific aspect of your entity state like position or velocity.

A *singleton* is similar but exists once per world rather than per entity—useful for global state like time, input, or configuration.

In woven-ecs, components are defined using `defineComponent` and singletons using `defineSingleton`, both with a schema that declares each field and its type.

```ts
import { defineComponent, defineSingleton, field } from '@woven-ecs/core';

// Define a Position component
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
});

// Define the Camera singleton
const Camera = defineSingleton({
  aspectRatio: field.float32().default(16 / 9),
  zoom: field.float32().default(1),
});

```

## Adding and Removing Components

Components are added and removed from entities using dedicated functions:

```ts
import { 
  createEntity,
  addComponent,
  removeComponent,
  hasComponent
} from '@woven-ecs/core';

const entityId = createEntity(ctx);

// Add a component with initial values
addComponent(ctx, entityId, Position, { x: 10, y: 20, z: 0 });

// Add a component with default values
addComponent(ctx, entityId, Velocity);

// Check if an entity has a component
if (hasComponent(ctx, entityId, Position)) {
  // Entity has position
}

// Remove a component
removeComponent(ctx, entityId, Position);
```

These methods throw an error if you try to use them on a non-existent entity. To bypass this check, pass `false` as the last argument:

```ts
// Skip existence check - useful for recently deleted entities
addComponent(ctx, entityId, Position, { x: 0, y: 0 }, false);
removeComponent(ctx, entityId, Position, false);
hasComponent(ctx, entityId, Position, false);
```

This is useful when working with entities that were recently deleted but whose data you still need to access (e.g., in a `.removed()` query callback).



## Fields

woven-ecs provides a variety of field types through the `field` builder object. Each type maps to efficient typed array storage under the hood, enabling cache-friendly iteration and zero-copy sharing between threads.

All fields have a default value (typically `0`, `false`, or empty string) unless you specify otherwise with `.default()`.

| Type | Default | JavaScript Type | Description |
| --- | --- | --- | --- |
| **`boolean()`** | false | boolean | Standard true/false value. Stored as a single byte. |
| **`int8()`, `uint8()`** | 0 | number | 8-bit signed (-128 to 127) or unsigned (0 to 255) integer. |
| **`int16()`, `uint16()`** | 0 | number | 16-bit signed or unsigned integer. |
| **`int32()`, `uint32()`** | 0 | number | 32-bit signed or unsigned integer. |
| **`float32()`** | 0 | number | Single-precision floating point number. Good balance of precision and memory. |
| **`float64()`** | 0 | number | Double-precision floating point, equivalent to JavaScript's native `number` type. |
| **`string().max(n)`** | '' | string | String type with a maximum byte length, `.max(n)` is optional, default is `512 bytes`. |
| **`binary().max(n)`** | [] | Uint8Array | Raw byte data with a maximum length, `.max(n)` is optional, default is `256 bytes`. Useful for serialized data or custom formats. |
| **`enum(E)`** | first value | E | Type-safe enumeration. Values stored as compact indices. |
| **`array(type, max)`** | [] | Array | Variable-length array up to `max` elements. The type can be any numeric type, `string`, `boolean`, or `binary`. |
| **`tuple(type, n)`** | [0,...] | tuple | Fixed-length array of exactly `n` elements. More efficient than variable arrays. |
| **`buffer(type).size(n)`** | [0,...] | TypedArray | Fixed-size buffer returning a typed array view. `type` must be one of the numeric types. `Buffer` is more efficient than tuples and arrays. |
| **`ref()`** | null | number \| null | Reference to another entity. Automatically validated. |

### Numeric Fields

The numeric field types correspond directly to JavaScript's typed arrays. Choose the smallest type that fits your data range to minimize memory usage:

```ts
const Stats = defineComponent({
  level: field.uint8(),        // 0-255 is plenty for character levels
  experience: field.uint32(),  // Large numbers need more bits
  attackPower: field.float32(), // Fractional values need floats
});
```

### Strings and Binary Data

String fields store UTF-8 encoded text with a maximum byte length. The `.max(n)` method sets this limit, and the default is 512 bytes if not specified:

```ts
const Profile = defineComponent({
  username: field.string().max(32),
  bio: field.string().max(256).default('No bio yet'),
});
```

:::caution
The maximum is in *bytes*, not characters. Multi-byte UTF-8 characters (like emoji or non-Latin scripts) consume more space. A 32-byte limit might only fit 8-10 emoji characters.
:::

Binary fields work similarly but store raw `Uint8Array` data:

```ts
const CustomData = defineComponent({
  payload: field.binary().max(1024),
});
```

### Enums

Enums provide type-safe storage for a fixed set of values. Define an enum and pass it to the field builder:

```ts
const Direction = {
  North: "north",
  East: "east",
  South: "south",
  West: "west",
} as const;

const Movement = defineComponent({
  facing: field.enum(Direction).default(Direction.North),
});
```

It also works with TypeScript enums:

```ts
enum Direction {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

const Movement = defineComponent({
  facing: field.enum(Direction).default(Direction.North),
});
```

Enum values are stored as compact integer indices, making them much more efficient than strings while providing full type safety.

### Arrays and Tuples

When you need multiple values of the same type, woven-ecs offers two options:

**Arrays** have variable length up to a declared maximum:

```ts
const Path = defineComponent({
  waypoints: field.array(field.float32(), 100), // Up to 100 floats
});
```

**Tuples** have a fixed length known at definition time:

```ts
const Transform = defineComponent({
  position: field.tuple(field.float32(), 3), // Js type is [number, number, number]
  rotation: field.tuple(field.float32(), 4), // Js type is [number, number, number, number]
});
```

`tuple` is more memory-efficient than `array` since it doesn't need to store length information. `array` uses a proxy object to manage variable length, which incurs some overhead.

### Buffers

For high-performance scenarios where you need direct typed array access without any allocation overhead, use buffer fields:

```ts
const Mesh = defineComponent({
  vertices: field.buffer(field.float32()).size(300), // 100 vec3 positions
  indices: field.buffer(field.uint16()).size(600),   // 200 triangles
});
```

## Entity References

Applications frequently need to express relationships between entities. woven-ecs provides `field.ref()` for this purpose:

```ts
const Parent = defineComponent({
  entity: field.ref(),
});

const Target = defineComponent({
  target: field.ref(),
});
```

References store an entity ID or `null`. When the referenced entity is removed, the field automatically resets to `null`, preventing dangling references and ensuring data integrity.

### Finding Backreferences

While `field.ref()` provides forward references (child → parent), you often need to traverse relationships in the opposite direction (parent → children). The `getBackrefs` function finds all entities that reference a target entity through a specific ref field:

```ts
import { getBackrefs } from '@woven-ecs/core';

const Child = defineComponent({
  parent: field.ref(),
});

// Create a parent with multiple children
const parent = createEntity(ctx);
const child1 = createEntity(ctx);
const child2 = createEntity(ctx);

addComponent(ctx, child1, Child, { parent });
addComponent(ctx, child2, Child, { parent });

// Find all entities that reference 'parent' via the Child.parent field
const children = getBackrefs(ctx, parent, Child, 'parent');
// Returns: [child1, child2] (order not guaranteed)
```

This pattern enables you to model hierarchical relationships without maintaining separate lists that could become stale.

## Accessing Component Data

### Read and Write

Use `.read()` when you only need to inspect data, and `.write()` when you need to modify it:

```ts
// Read-only access - efficient, no change tracking
const pos = Position.read(ctx, entity);
console.log(`Position: ${pos.x}, ${pos.y}, ${pos.z}`);

// Write access - marks component as changed
const pos = Position.write(ctx, entity);
pos.x += velocity.x * deltaTime;
pos.y += velocity.y * deltaTime;
```

:::caution
Using `.write()` marks the component as modified, which triggers change detection in queries. Always use `.read()` when you don't need to modify data.
:::

### Copy and Patch

For writing multiple fields at once, woven-ecs provides two methods with different behaviors:

**`.copy()`** sets all fields—any fields not specified in the data object are reset to their default values:

```ts
// Sets x=100, y=200, z=0 (z gets default value of 0)
Position.copy(ctx, entity, { x: 100, y: 200 });
```

**`.patch()`** updates only the specified fields, leaving all other fields untouched:

```ts
// Only updates x and y, z remains at its current value
Position.patch(ctx, entity, { x: 100, y: 200 });
```

:::tip
Use `.patch()` when you want to update a subset of fields without affecting others. Use `.copy()` when you want to completely reset the component to a known state.
:::

### Snapshots

To get a plain JavaScript object (useful for serialization or debugging):

```ts
const snapshot = Position.snapshot(ctx, entity);
// Returns: { x: 100, y: 200, z: 0 }
console.log(JSON.stringify(snapshot));
```

## Adding Methods to Components

While keeping behavior out of components is a core ECS principle, there are situations where helper methods make sense. Just be sure to keep the logic focused on data manipulation rather than game logic.


```ts
const ColorSchema = {
  red: field.uint8().default(0),
  green: field.uint8().default(0),
  blue: field.uint8().default(0),
  alpha: field.uint8().default(255),
};

class ColorDef extends ComponentDef<typeof ColorSchema> {
  constructor() {
    super(ColorSchema);
  }

  /**
   * Convert a color to a hex string.
   */
  toHex(ctx: Context, entityId: EntityId): string {
    const { red, green, blue, alpha } = this.read(ctx, entityId);
    const rHex = red.toString(16).padStart(2, "0");
    const gHex = green.toString(16).padStart(2, "0");
    const bHex = blue.toString(16).padStart(2, "0");
    const aHex = alpha.toString(16).padStart(2, "0");
    return `#${rHex}${gHex}${bHex}${aHex}`;
  }

  /**
   * Set color from a hex string.
   */
  fromHex(ctx: Context, entityId: EntityId, hex: string): void {
    const color = this.write(ctx, entityId);
    color.red = Number.parseInt(hex.slice(1, 3), 16);
    color.green = Number.parseInt(hex.slice(3, 5), 16);
    color.blue = Number.parseInt(hex.slice(5, 7), 16);
    color.alpha = hex.length > 7 ? Number.parseInt(hex.slice(7, 9), 16) : 255;
  }
}

export const Color = new ColorDef();
```


## Singletons

Some data exists once per world rather than per-entity—global configuration, input state, timing information. Use `defineSingleton` for these cases:

```ts
import { defineSingleton, field } from '@woven-ecs/core';

const Time = defineSingleton({
  delta: field.float32(),
  elapsed: field.float32(),
  frame: field.uint32(),
});

const GameConfig = defineSingleton({
  gravity: field.float32().default(-9.81),
  maxEntities: field.uint32().default(10000),
});
```

Singletons support all the same field types and methods as components.

### Common Use Cases

Singletons are ideal for:

- **Time and frame data**: Delta time, elapsed time, frame count
- **Input state**: Keyboard, mouse, or gamepad state that systems need to read
- **Configuration**: Physics constants, rendering settings, game rules
- **Camera state**: View matrices, zoom level, target position
- **UI state**: Current screen, menu selection, dialog state

### Accessing Singletons

Access singletons without specifying an entity ID:

```ts
// Read global time
const time = Time.read(ctx);
console.log(`Frame ${time.frame}, delta: ${time.delta}ms`);

// Update configuration
const config = GameConfig.write(ctx);
config.gravity = -15;
```

Singletons also support `.copy()`, `.patch()`, and `.snapshot()` just like components:

```ts
// Reset time to initial state
Time.copy(ctx, { delta: 0, elapsed: 0, frame: 0 });

// Update only specific fields
GameConfig.patch(ctx, { gravity: -20 });

// Get a plain object for serialization
const snapshot = GameConfig.snapshot(ctx);
```

:::tip
Use singletons instead of module-level variables for global state. This keeps all your data within the ECS world, making it easier to serialize, reset, or run multiple worlds in parallel.
:::

## Storage Architecture

Under the hood, woven-ecs stores component data in contiguous typed arrays indexed by entity ID. All values for a given field across all entities are packed together:

```
Field "x": [entity0.x][entity1.x][entity2.x][entity3.x]...
Field "y": [entity0.y][entity1.y][entity2.y][entity3.y]...
```

This structure-of-arrays layout provides several benefits:

- **Cache efficiency**: Iterating over a single field reads contiguous memory
- **Thread safety**: `SharedArrayBuffer` enables zero-copy access from web workers
- **Predictable allocation**: No garbage collection pressure after initialization

It's important to note that the total memory allocated is maxEntities x memory size of all fields, regardless of how many entities are actually alive. This is a common tradeoff in ECS design for the sake of performance.