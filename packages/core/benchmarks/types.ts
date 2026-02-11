export interface BenchmarkOutput {
  library: BenchmarkLibrary
  sum: number
  updates: number
  skipped: boolean
}

export interface BenchmarkContext {
  setup(): void
  createEntity(): any
  addPositionComponent(entity: any): void
  addVelocityComponent(entity: any): void
  removePositionComponent(entity: any): void
  removeVelocityComponent(entity: any): void
  destroyEntity(entity: any): void
  cleanup(): void
  updateMovementSystem(): void | Promise<void>
  getMovementSystemUpdateCount(): number
}

export interface BenchmarkLibrary {
  name: string
  suites: string[]
  world: any
  ctx: any
  Position: any
  Velocity: any
  moveSystem: any
  setup(): void
  createEntity(): any
  addPositionComponent(entity: any): void
  addVelocityComponent(entity: any): void
  removePositionComponent(entity: any): void
  removeVelocityComponent(entity: any): void
  destroyEntity(entity: any): void
  cleanup(): void
  updateMovementSystem(): void
  getMovementSystemUpdateCount(): number
}
