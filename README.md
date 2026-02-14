<p align="center">
  <img src="docs/src/assets/logo.png" alt="Woven ECS Logo" width="50" />
</p>

<p align="center">
  <a href="https://github.com/WillH0lt/woven-ecs/actions/workflows/ci.yml"><img src="https://github.com/WillH0lt/woven-ecs/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@woven-ecs/core"><img src="https://img.shields.io/npm/v/@woven-ecs/core" alt="npm" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <a href="https://woven-ecs.dev">Read the Docs →</a>
</p>

# Woven-ECS

A high-performance, multithreaded Entity Component System (ECS) framework for TypeScript.

- **Multithreaded**: Execute systems in parallel across worker threads with automatic entity partitioning
- **Change Tracking**: Query for entities that were added, removed, or changed since last frame
- **Powerful Queries**: Filter entities by component presence with `with`, `without`, and `any` operators
- **Entity References**: Reference other entities with automatic validation
- **Zero dependencies** - Lightweight core with no external runtime dependencies

## Packages

| Package | Description |
|---------|-------------|
| [@woven-ecs/core](./packages/core) | Core ECS framework with components, systems, queries, and multi-threading |
| [@woven-ecs/canvas-store](./packages/canvas-store) | Persistence, undo/redo, and real-time collaboration for design and whiteboard applications |
| [@woven-ecs/canvas-store-server](./packages/canvas-store-server) | Server for real-time collaboration with @woven-ecs/canvas-store clients |

## Installation

```bash
npm install @woven-ecs/core
```

## Quick Start

```typescript
import {
  addComponent,
  createEntity,
  defineComponent,
  defineQuery,
  defineSystem,
  field,
  World,
} from '@woven-ecs/core';

// Define components with typed fields
const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
});

// Define a query to find entities with both components
const movingEntities = defineQuery((q) =>
  q.with(Position, Velocity)
);

// Define a system to process matching entities
const movementSystem = defineSystem((ctx) => {
  for (const eid of movingEntities.current(ctx)) {
    const pos = Position.write(ctx, eid);
    const vel = Velocity.read(ctx, eid);
    pos.x += vel.x;
    pos.y += vel.y;
  }
});

// Create the world
const world = new World([Position, Velocity]);

// Create an entity with Position and Velocity components
world.execute((ctx) => { 
  const entity = createEntity(ctx);
  addComponent(ctx, entity, Position, { x: 0, y: 0 });
  addComponent(ctx, entity, Velocity, { x: 1, y: 1 });
})

// Game loop
function loop() {
  world.execute(movementSystem);
  requestAnimationFrame(loop);
}

loop();
```

## Documentation

- [Quick Start](https://woven-ecs.dev/quick-start/)
- [World](https://woven-ecs.dev/docs/world/)
- [Entities](https://woven-ecs.dev/docs/entities/)
- [Components & Singletons](https://woven-ecs.dev/docs/components-singletons/)
- [Systems](https://woven-ecs.dev/docs/systems/)
- [Queries](https://woven-ecs.dev/docs/queries/)
- [Multithreading](https://woven-ecs.dev/docs/multithreading/)
- [Best Practices](https://woven-ecs.dev/docs/best-practices/)

## Examples

| Example | Description |
|---------|-------------|
| [React Binding](./examples/react-binding) | Integrating woven-ecs with React using `useSyncExternalStore`. |
| [Three.js + Workers](./examples/worker-system-with-threejs) | Multithreaded particle physics with Three.js rendering.|

## Canvas Store

The [`@woven-ecs/canvas-store`](./packages/canvas-store) and [`@woven-ecs/canvas-store-server`](./packages/canvas-store-server) packages extend Woven-ECS with everything you need to build multiplayer editor applications like infinite canvases or other creative design tools.

- **Real-time Sync** — WebSocket-based multiplayer with conflict resolution. Multiple users can edit the same document simultaneously.
- **Local-First** — Your app works offline by default. Data lives on the client and syncs to the server when connected.
- **Undo/Redo** — Full history tracking with configurable depth. Users can undo and redo changes across sessions.
- **Persistence** — Automatic IndexedDB storage for offline support. Changes are saved locally and synced when back online.
- **Migrations** — Version your component schemas with automatic migrations. Evolve your data model without breaking existing documents.
- **Configurable** — Configure sync behavior per component: persist to server, sync ephemerally, store locally, or skip entirely.

[Learn more →](https://woven-ecs.dev/canvas-store/introduction/)

## Local Development

```bash
git clone https://github.com/WillH0lt/woven-ecs.git
cd woven-ecs
pnpm install
pnpm build
pnpm test
```

## License

MIT License.

## Community

- [GitHub Issues](https://github.com/WillH0lt/woven-ecs/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/WillH0lt/woven-ecs/discussions) - Questions and ideas
