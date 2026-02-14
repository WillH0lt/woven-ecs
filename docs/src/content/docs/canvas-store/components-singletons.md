---
title: Components & Singletons
description: Define synced components and singletons with migrations
---

Canvas Store uses custom component and singleton definitions that include metadata for syncing, history, and migrations.

* `defineComponent` -> `defineCanvasComponent`
* `defineSingleton` -> `defineCanvasSingleton`

```typescript
import { field } from '@woven-ecs/core';
import { defineCanvasComponent } from '@woven-ecs/canvas-store';

const Position = defineCanvasComponent({
  name: 'position',        // Stable identifier for persistence
  sync: 'document',        // Sync behavior
}, {
  x: field.float32(),
  y: field.float32(),
});

// Ephemeral component (cursors, not persisted)
const Cursor = defineCanvasComponent({
  name: 'cursor',
  sync: 'ephemeral',
}, {
  clientId: field.string(),
  x: field.float32(),
  y: field.float32(),
});

// Sync only to local storage, not server
const camera = defineCanvasSingleton({
  name: 'camera',
  sync: 'local',
}, {
  zoom: field.float32(),
  panX: field.float32(),
  panY: field.float32(),
});

```

## Excluding Fields from History

Some fields shouldn't trigger undo/redo:

```typescript
import { UploadStatus } from './types';

const Asset = defineCanvasComponent({
  name: 'asset',
  sync: 'document',
  excludeFromHistory: ['uploadStatus'], // Won't create undo/redo entries
}, {
  url: field.string(),
  uploadStatus: field.enum(UploadStatus),
});
```

## Schema Migrations

If you are simply adding or removing a field to the schema then you don't need to create a new migration, the data will be loaded with default values for the new fields, and the removed fields will be ignored. However, if you need to transform existing data you can add migrations to the component definition. Each migration has a unique name and an `upgrade` function that transforms the data from the previous version to the new version. The migrations run in the order they are defined in the `migrations` array. The `upgrade` function receives the old data and should return the new data.

```typescript
import { rgbToHsv } from './helpers';

// previous version had RGB fields
// const Color = defineCanvasComponent({
//   name: 'color',
//   sync: 'document',
// }, {
//   red: field.float32(),
//   green: field.float32(),
//   blue: field.float32(),
// });

// migrate old RGB data to new HSV format
const Color = defineCanvasComponent({
  name: 'color',
  sync: 'document',
  migrations: [
    {
      name: 'v1-rgb-to-hsv',
      upgrade: (data) => {
        const { hue, saturation, value } = rgbToHsv(data.red, data.green, data.blue);
        return { hue, saturation, value };
      },
    },
  ],
}, {
  hue: field.float32(),
  saturation: field.float32(),
  value: field.float32(),
});
```

The version string is saved along with the component data. The migrated data is saved locally immediately after it's loaded and it's synced to the server lazily only when it's modified.

### Supersedes

If a migration has a bug, use `supersedes` to skip it for data that hasn't reached it yet. The `upgrade` function receives a `from` argument indicating the previous version, so it can handle both paths:

```typescript
const Color = defineCanvasComponent({
  name: 'color',
  sync: 'document',
  migrations: [
    {
      name: 'v1-rgb-to-hsv',
      upgrade: (data) => {
        // Bug: hue is in radians (0-2π) but should be degrees (0-360)
        const { hue, saturation, value } = rgbToHsv(data.red, data.green, data.blue);
        return { hue, saturation, value };
      },
    },
    {
      name: 'v2-fix-hue-radians',
      supersedes: 'v1-rgb-to-hsv',
      upgrade: (data, from) => {
        if (from === 'v1-rgb-to-hsv') {
          // Data already has wrong hue, convert radians to degrees
          return { ...data, hue: data.hue * (180 / Math.PI) };
        }
        // Data skipped v1, do correct conversion from RGB
        const hsv = rgbToHsv(data.red, data.green, data.blue);
        return { 
          hue: hsv.hue * (180 / Math.PI),
          saturation: hsv.saturation,
          value: hsv.value
        };
      },
    },
  ],
}, {
  hue: field.float32(),
  saturation: field.float32(),
  value: field.float32(),
});
```

- **Unmigrated data (v0):** Skips v1, runs v2 with `from: null` — converts RGB correctly
- **Data at v1:** Runs v2 with `from: 'v1-rgb-to-hsv'` — fixes the radians→degrees bug

:::caution[Destructive migrations are permanent]
Once users run a migration that discards data (like removing fields or lossy conversions), that data is gone. You cannot fix this with `supersedes`—the original data no longer exists. Always preserve fields you might need later, even if deprecated.
:::
