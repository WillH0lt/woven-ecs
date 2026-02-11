import {
  addComponent,
  type Context,
  createEntity,
  defineComponent,
  defineQuery,
  defineSystem,
  field,
  World,
} from '@woven-ecs/core'
import { useSyncExternalStore } from 'react'

// Define ECS components
const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
})

const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
})

const Size = defineComponent({
  width: field.float32().default(50),
  height: field.float32().default(50),
})

const Color = defineComponent({
  red: field.uint8().default(255),
  green: field.uint8().default(0),
  blue: field.uint8().default(0),
})

// Create the ECS world
const world = new World([Velocity, Position, Size, Color])

// Query for entities with Position, Size, and Color (tracking changes)
const blocks = defineQuery((q) => q.tracking(Position, Size, Color))

// Movement system - handles physics and boundary collision
const movementSystem = defineSystem((ctx: Context) => {
  for (const eid of blocks.current(ctx)) {
    const pos = Position.write(ctx, eid)
    const vel = Velocity.write(ctx, eid)
    const size = Size.read(ctx, eid)

    // Apply velocity
    pos.x += vel.x
    pos.y += vel.y

    // Bounce off walls (DVD screensaver style)
    if (pos.x <= 0 || pos.x + size.width >= window.innerWidth) {
      vel.x *= -1
      pos.x = Math.max(0, Math.min(pos.x, window.innerWidth - size.width))
    }

    if (pos.y <= 0 || pos.y + size.height >= window.innerHeight) {
      vel.y *= -1
      pos.y = Math.max(0, Math.min(pos.y, window.innerHeight - size.height))
    }
  }
})

// Initialize entities
world.nextSync((ctx) => {
  for (let i = 0; i < 15; i++) {
    const entity = createEntity(ctx)

    addComponent(ctx, entity, Velocity, {
      x: (Math.random() - 0.5) * 4 + (Math.random() > 0.5 ? 1 : -1),
      y: (Math.random() - 0.5) * 4 + (Math.random() > 0.5 ? 1 : -1),
    })
    addComponent(ctx, entity, Position, {
      x: Math.random() * (window.innerWidth - 100),
      y: Math.random() * (window.innerHeight - 100),
    })
    addComponent(ctx, entity, Size, {
      width: Math.random() * 100 + 50,
      height: Math.random() * 100 + 50,
    })
    addComponent(ctx, entity, Color, {
      red: Math.floor(Math.random() * 256),
      green: Math.floor(Math.random() * 256),
      blue: Math.floor(Math.random() * 256),
    })
  }
})

interface EntityState {
  position: { x: number; y: number }
  size: { width: number; height: number }
  color: { red: number; green: number; blue: number }
}

// Define an external store
let state: Record<number, EntityState> = {}
let listeners: Array<() => void> = []
const store = {
  subscribe(listener: () => void) {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  },
  getSnapshot() {
    return state
  },
  emit() {
    for (const listener of listeners) {
      listener()
    }
  },
}

// Subscribe to ECS changes and update the store
world.subscribe(blocks, (ctx, { added, removed, changed }) => {
  for (const entityId of added) {
    state[entityId] = {
      position: Position.snapshot(ctx, entityId),
      size: Size.snapshot(ctx, entityId),
      color: Color.snapshot(ctx, entityId),
    }
  }

  for (const entityId of removed) {
    delete state[entityId]
  }

  for (const entityId of changed) {
    if (state[entityId]) {
      state[entityId] = {
        position: Position.snapshot(ctx, entityId),
        size: Size.snapshot(ctx, entityId),
        color: Color.snapshot(ctx, entityId),
      }
    }
  }

  if (added.length > 0 || removed.length > 0 || changed.length > 0) {
    state = { ...state } // Trigger React re-render
    store.emit()
  }
})

// Animation loop
function loop() {
  requestAnimationFrame(loop)
  world.sync()
  world.execute(movementSystem)
}
loop()

function App() {
  const entities = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const handleClick = (entityId: number) => {
    world.nextSync((ctx) => {
      const color = Color.write(ctx, entityId)
      color.red = Math.floor(Math.random() * 256)
      color.green = Math.floor(Math.random() * 256)
      color.blue = Math.floor(Math.random() * 256)
    })
  }

  return (
    <div className="container">
      {Object.entries(entities).map(([eid, entity]) => (
        <button
          type="button"
          key={eid}
          className="block"
          onClick={() => handleClick(Number(eid))}
          style={{
            width: entity.size.width,
            height: entity.size.height,
            left: entity.position.x,
            top: entity.position.y,
            backgroundColor: `rgb(${entity.color.red}, ${entity.color.green}, ${entity.color.blue})`,
          }}
        />
      ))}
    </div>
  )
}

export default App
