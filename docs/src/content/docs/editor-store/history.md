---
title: Undo/Redo
description: History management with checkpoints and squashing
---

## Basic Usage

```typescript
// Undo last change
if (store.canUndo()) {
  store.undo();
}

// Redo
if (store.canRedo()) {
  store.redo();
}
```

## Checkpoints

Group multiple operations into a single undo step:

```typescript
// Create checkpoint before a complex operation
const checkpoint = store.createCheckpoint();

// Make multiple changes...
moveEntities(selectedEntities);
updateProperties(selectedEntities);

// Wait for changes to settle, then squash into one undo step
store.onSettled(() => {
  store.squashToCheckpoint(checkpoint);
}, { frames: 60 });
```

## Reverting Changes

```typescript
const checkpoint = store.createCheckpoint();

// Try an operation...
try {
  riskyOperation();
} catch (e) {
  // Revert all changes since checkpoint
  store.revertToCheckpoint(checkpoint);
}
```

## Drag Operations Example

Use checkpoints for multi-step operations like dragging:

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

## Excluding Fields from History

Some fields shouldn't create undo entries (e.g., hover states):

```typescript
const Selection = defineEditorComponent(
  {
    name: 'Selection',
    sync: 'document',
    excludeFromHistory: ['hoverHighlight'],
  },
  {
    selected: field.boolean(),
    hoverHighlight: field.boolean(),  // Changes won't be tracked
  }
);
```
