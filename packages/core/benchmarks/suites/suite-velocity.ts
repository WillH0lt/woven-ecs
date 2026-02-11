import type { BenchmarkContext } from '../types'

export default {
  name: 'Velocity',
  iterations: 10000,
  setup(ctx: BenchmarkContext) {
    ctx.setup()
  },
  async perform(ctx: BenchmarkContext) {
    const entity = ctx.createEntity()
    ctx.addPositionComponent(entity)
    ctx.addVelocityComponent(entity)

    await ctx.updateMovementSystem()
  },
}
