# React Binding Example

Demonstrates integrating woven-ecs with React using `useSyncExternalStore`.

## What it does

Bouncing colored blocks (DVD screensaver style) rendered by React and driven by ECS:

- **Position, Velocity, Size, Color** components define entity data
- **Movement system** applies velocity and bounces blocks off screen edges
- **Query subscription** syncs ECS state changes to a React-compatible store
- **Click a block** to randomly change its color

## Key concepts

### Syncing ECS to React

The example creates an external store that React can subscribe to:

```ts
const store = {
  subscribe(listener: () => void) { /* ... */ },
  getSnapshot() { return state },
}

// React component
const entities = useSyncExternalStore(store.subscribe, store.getSnapshot)
```

### Subscribing to query changes

When entities are added, removed, or changed, update the store and notify React:

```ts
world.subscribe(blocks, (ctx, { added, removed, changed }) => {
  // Update state for each changed entity...
  state = { ...state } // New reference triggers React re-render
  store.emit()
})
```

### Mutating ECS from React

Use `world.nextSync()` to safely queue mutations from event handlers:

```ts
const handleClick = (entityId: number) => {
  world.nextSync((ctx) => {
    const color = Color.write(ctx, entityId)
    color.red = Math.floor(Math.random() * 256)
    // ...
  })
}
```

## Running

```bash
pnpm install
pnpm dev
```
