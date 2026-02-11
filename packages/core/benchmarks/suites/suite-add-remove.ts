import type { BenchmarkContext } from '../types'

export default {
  name: 'Add/Remove',
  iterations: 10000,
  setup(ctx: BenchmarkContext) {
    ctx.setup()
  },
  async perform(ctx: BenchmarkContext) {
    const entity1 = ctx.createEntity()
    const entity2 = ctx.createEntity()

    ctx.addPositionComponent(entity1)
    ctx.addVelocityComponent(entity1)

    ctx.addPositionComponent(entity2)
    ctx.addVelocityComponent(entity2)

    await ctx.updateMovementSystem()

    ctx.removePositionComponent(entity1)

    await ctx.updateMovementSystem()

    ctx.destroyEntity(entity1)
    ctx.destroyEntity(entity2)
  },
}
