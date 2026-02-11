import { World } from 'miniplex'

import type { BenchmarkLibrary } from '../types'

let updateCount = 0

const movementSystem = (world: World) => {
  let movingEntities: ReturnType<typeof world.with<'position' | 'velocity'>> | undefined

  /* Return the system */
  return () => {
    movingEntities ||= world.with('position', 'velocity')

    /* Get the index for the archetype we created earlier. */
    const { entities } = movingEntities

    /* Now apply the velocity to the position. */
    for (const { position, velocity } of entities) {
      position.x += velocity.x
      position.y += velocity.y

      updateCount++
    }
  }
}

const library: BenchmarkLibrary = {
  name: 'miniplex',
  suites: ['Add/Remove', 'Destroy', 'Velocity'],
  world: null as any,
  ctx: null as any,
  Position: null as any,
  Velocity: null as any,
  moveSystem: null as any,
  setup() {
    this.world = new World()
    this.moveSystem = movementSystem(this.world)
  },
  createEntity() {
    return this.world.add({})
  },
  addPositionComponent(entity) {
    /* Entities are just JavaScript objects, and components just properties on
           those objects. In Typescript, you get full type checking of all your
           entities and components. TypeScript is great and you should use it! (But
           miniplex will happily work without it, too.) */
    this.world.addComponent(entity, 'position', { x: 0, y: 0 })
  },
  addVelocityComponent(entity) {
    this.world.addComponent(entity, 'velocity', { x: 1, y: 2 })
  },
  removePositionComponent(entity) {
    this.world.removeComponent(entity, 'position')
  },
  removeVelocityComponent(entity) {
    this.world.removeComponent(entity, 'velocity')
  },
  destroyEntity(entity) {
    this.world.remove(entity)
  },
  cleanup() {
    updateCount = 0
    this.world = null
    this.moveSystem = null
  },
  updateMovementSystem() {
    this.moveSystem()
  },
  getMovementSystemUpdateCount() {
    return updateCount
  },
}

export default library
