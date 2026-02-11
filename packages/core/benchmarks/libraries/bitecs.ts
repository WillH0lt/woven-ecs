import {
  addComponent,
  addEntity,
  createWorld,
  defineComponent,
  defineQuery,
  defineSystem,
  type IWorld,
  removeComponent,
  removeEntity,
  Types,
} from 'bitecs'
import type { BenchmarkLibrary } from '../types'

let updateCount = 0
let query: any

const library: BenchmarkLibrary = {
  name: 'bitecs',
  suites: ['Add/Remove', 'Destroy', 'Velocity'],
  world: null,
  ctx: null,
  Position: null,
  Velocity: null,
  moveSystem: null,
  setup() {
    this.world = createWorld()

    const { f32, ui16 } = Types
    this.Position = defineComponent({ x: f32, y: f32 })
    this.Velocity = defineComponent({ x: f32, y: f32, speed: ui16 })

    query = defineQuery([this.Position, this.Velocity])

    const Position = this.Position
    const Velocity = this.Velocity
    this.moveSystem = defineSystem((world: IWorld) => {
      const ents = query(world)

      const posX = Position.x
      const posY = Position.y
      const velX = Velocity.x
      const velY = Velocity.y

      for (let i = 0; i < ents.length; i++) {
        const eid = ents[i]
        posX[eid] += velX[eid]
        posY[eid] += velY[eid]
        updateCount++
      }
      return world
    })
  },
  createEntity() {
    return addEntity(this.world)
  },
  addPositionComponent(entity: any) {
    addComponent(this.world, this.Position, entity)
    this.Position.x[entity] = 100
    this.Position.y[entity] = 100
  },
  addVelocityComponent(entity: any) {
    addComponent(this.world, this.Velocity, entity)
    this.Velocity.x[entity] = 1.2
    this.Velocity.x[entity] = 1.7
  },
  removePositionComponent(entity: any) {
    removeComponent(this.world, this.Position, entity)
  },
  removeVelocityComponent(entity: any) {
    removeComponent(this.world, this.Velocity, entity)
  },
  destroyEntity(entity: any) {
    removeEntity(this.world, entity)
  },
  cleanup() {
    updateCount = 0
  },
  updateMovementSystem() {
    this.moveSystem(this.world)
  },
  getMovementSystemUpdateCount() {
    return updateCount
  },
}

export default library
