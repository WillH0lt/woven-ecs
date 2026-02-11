---
title: Components & Singletons
description: Define synced components and singletons with migrations
---

## Defining Synced Components

Use `defineEditorComponent` instead of `defineComponent`:

```typescript
import { defineEditorComponent, field } from '@woven-ecs/editor-store';

const Position = defineEditorComponent(
  {
    name: 'Position',        // Stable identifier for persistence
    sync: 'document',        // Sync behavior
  },
  {
    x: field.float32(),
    y: field.float32(),
  }
);

// Ephemeral component (cursors, not persisted)
const Cursor = defineEditorComponent(
  {
    name: 'Cursor',
    sync: 'ephemeral',
  },
  {
    clientId: field.string(),
    x: field.float32(),
    y: field.float32(),
  }
);
```

## Excluding Fields from History

Some fields shouldn't trigger undo/redo:

```typescript
const Selection = defineEditorComponent(
  {
    name: 'Selection',
    sync: 'document',
    excludeFromHistory: ['hoverHighlight'], // Won't create undo entries
  },
  {
    selected: field.boolean(),
    hoverHighlight: field.boolean(),
  }
);
```

## Schema Migrations

Handle schema changes across versions:

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
      {
        name: 'v2-add-opacity',
        upgrade: (data) => ({ ...data, opacity: 1 }),
      },
    ],
  },
  {
    rotation: field.float32(),
    opacity: field.float32(),
  }
);
```

Migrations run automatically when loading older data.

## Defining Synced Singletons

```typescript
import { defineEditorSingleton } from '@woven-ecs/editor-store';

const DocumentSettings = defineEditorSingleton(
  {
    name: 'DocumentSettings',
    sync: 'document',
  },
  {
    title: field.string(),
    gridSize: field.uint32(),
  }
);

// Local-only singleton
const ViewportSettings = defineEditorSingleton(
  {
    name: 'ViewportSettings',
    sync: 'local',
  },
  {
    zoom: field.float32(),
    panX: field.float32(),
    panY: field.float32(),
  }
);
```
