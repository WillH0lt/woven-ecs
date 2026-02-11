import { defineQuery, setupWorker } from '@woven-ecs/core'
import { Acceleration, Attractor, Position, Time, Velocity } from './components'

// Define queries
const particlesQuery = defineQuery((q) => q.with(Position, Velocity, Acceleration))
const attractorsQuery = defineQuery((q) => q.with(Attractor))

// Setup the worker with physics simulation logic
setupWorker((ctx) => {
  const time = Time.read(ctx)

  const particles = particlesQuery.current(ctx, { partitioned: true })

  // Apply acceleration to velocity
  for (const eid of particles) {
    const pos = Position.write(ctx, eid)
    const vel = Velocity.write(ctx, eid)
    const acc = Acceleration.read(ctx, eid)

    vel.x += acc.x * time.delta
    vel.y += acc.y * time.delta
    vel.z += acc.z * time.delta

    // Apply damping
    const damping = 0.98
    vel.x *= damping
    vel.y *= damping
    vel.z *= damping

    // Apply attraction forces
    for (const attractorId of attractorsQuery.current(ctx)) {
      const attractor = Attractor.read(ctx, attractorId)

      // Calculate direction to target
      const dx = attractor.targetX - pos.x
      const dy = attractor.targetY - pos.y
      const dz = attractor.targetZ - pos.z

      // Calculate distance
      const distSq = dx * dx + dy * dy + dz * dz
      const dist = Math.sqrt(distSq)

      // Avoid division by zero and too strong forces at close range
      if (dist > 0.1) {
        // Normalize direction and apply force
        const force = attractor.strength / (distSq + 1)
        vel.x += (dx / dist) * force * time.delta
        vel.y += (dy / dist) * force * time.delta
        vel.z += (dz / dist) * force * time.delta
      }
    }

    // Apply velocity to position
    pos.x += vel.x * time.delta
    pos.y += vel.y * time.delta
    pos.z += vel.z * time.delta
  }
})
