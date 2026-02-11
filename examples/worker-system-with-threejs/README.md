# ECS + Three.js + Workers Demo

An interactive particle system demo showcasing the `@woven-ecs/core` framework integrated with Three.js and multithreaded physics simulation using Web Workers.

## Features

- **Entity Component System (ECS)**: Clean separation of data and logic using the ECS architecture
- **Multithreaded Physics**: Physics simulation distributed across 4 worker threads for parallel processing
- **Instanced Rendering**: Efficient rendering of up to 5000 particles using Three.js InstancedMesh
- **Interactive**: Click and hold to attract particles to your cursor
- **Real-time Stats**: FPS counter and particle count display

## Architecture

### Components
- **Position**: 3D coordinates (x, y, z)
- **Velocity**: Movement speed in each axis
- **Acceleration**: Forces applied to particles (gravity)
- **Color**: RGB color values
- **Size**: Particle size
- **Lifetime**: Time tracking for particle expiration
- **Attraction**: Force that pulls particles toward a target

### Systems

#### Physics System (Worker Thread)
Runs on 4 parallel worker threads with high priority:
- Applies acceleration to velocity
- Applies attraction forces to entities near the mouse cursor
- Updates positions based on velocity
- Manages particle lifetimes
- Uses velocity damping for realistic motion

#### Render System (Main Thread)
- Updates Three.js instanced mesh with entity positions
- Updates instance colors based on component data
- Efficiently renders thousands of particles per frame

#### Lifetime System (Main Thread)
- Removes particles that have exceeded their lifetime
- Maintains a steady particle count

## Running the Demo

```bash
# Install dependencies (from repo root)
pnpm install

# Start the dev server
cd examples/ecs-three
pnpm dev
```

Open your browser to `http://localhost:5173` (or the port shown in terminal)

## Interaction

- **Move mouse**: Watch particles flow and interact with physics
- **Click and hold**: Attract particles to your cursor position
- The demo spawns 50 particles per second up to a maximum of 5000 particles
- Particles have random colors (cyan to purple gradient) and lifetimes (3-7 seconds)

## Performance

The demo showcases excellent performance through:
- **Worker-based physics**: Physics calculations distributed across multiple CPU cores
- **Instanced rendering**: Single draw call for all particles
- **SharedArrayBuffer**: Zero-copy data sharing between main thread and workers
- **ECS architecture**: Cache-friendly data layout and query system

## Code Structure

```
src/
├── main.ts           # Application entry, Three.js setup, game loop
├── components.ts     # ECS component definitions
├── systems.ts        # System definitions (render, lifetime)
├── physicsWorker.ts  # Worker thread physics system
└── style.css         # Minimal styles
```

## Learn More

This demo illustrates key concepts of the `@woven-ecs/core` framework:
- Defining components with typed fields
- Creating worker systems for parallel execution
- Using queries to iterate over entities
- Integrating ECS with a rendering library (Three.js)
- Managing entity lifecycles

Check out the [ECS documentation](../../packages/ecs/README.md) for more information about the framework.
