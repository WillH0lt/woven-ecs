---
title: Best Practices
description: Recommended patterns for using Editor Store
---

## Use Appropriate Sync Behaviors

```typescript
// Document data - persisted and synced
const Shape = defineEditorComponent({ name: 'Shape', sync: 'document' }, {...});

// Ephemeral - synced but not persisted (cursors, selections)
const Cursor = defineEditorComponent({ name: 'Cursor', sync: 'ephemeral' }, {...});

// Local - persisted locally only (camera, preferences)
const Camera = defineEditorComponent({ name: 'Camera', sync: 'local' }, {...});
```

## Always Add Synced Component

Every entity that needs persistence or sync must have the `Synced` component with a stable UUID:

```typescript
const entity = createEntity(ctx);
addComponent(ctx, entity, Synced);
Synced.write(ctx, entity).id = crypto.randomUUID();
addComponent(ctx, entity, Position);
// ... other components
```

## Use Checkpoints for Multi-Step Operations

Any operation that makes multiple changes over time (dragging, bulk edits) should use checkpoints:

```typescript
function dragOperation(entities) {
  const checkpoint = store.createCheckpoint();

  return {
    update(delta) {
      for (const eid of entities) {
        const pos = Position.write(ctx, eid);
        pos.x += delta.x;
        pos.y += delta.y;
      }
    },
    commit() {
      store.onSettled(() => {
        store.squashToCheckpoint(checkpoint);
      }, { frames: 30 });
    },
  };
}
```

## Handle Version Mismatches

When deploying updates that change component schemas, handle version mismatches gracefully:

```typescript
const store = new EditorStore({
  documentId: 'my-doc',
  websocket: { url: 'wss://server.com' },
  onVersionMismatch: (serverVersion) => {
    // Prompt user to refresh
    alert('Please refresh to get the latest version');
  },
});
```

## Use Migrations for Schema Changes

When adding or changing fields, use migrations to handle existing data:

```typescript
const Shape = defineEditorComponent(
  {
    name: 'Shape',
    sync: 'document',
    migrations: [
      {
        name: 'v1-add-rotation',
        upgrade: (data) => ({ ...data, rotation: 0 }),
      },
    ],
  },
  {
    rotation: field.float32(),
  }
);
```

## Sync Every Frame

Call `store.sync(ctx)` at the end of every frame to ensure changes propagate:

```typescript
function gameLoop(ctx) {
  inputSystem(ctx);
  movementSystem(ctx);
  renderSystem(ctx);

  // Always sync at the end
  store.sync(ctx);
}
```
