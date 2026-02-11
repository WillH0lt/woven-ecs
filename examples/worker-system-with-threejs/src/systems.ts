import {
  addComponent,
  createEntity,
  defineQuery,
  defineSystem,
  defineWorkerSystem,
  getResources,
  removeEntity,
} from '@woven-ecs/core'
import * as THREE from 'three'
import { Acceleration, Attractor, Color, Config, DeathTime, Mouse, Position, Size, Time, Velocity } from './components'

export interface Resources {
  instancedMesh: THREE.InstancedMesh
  camera: THREE.Camera
  maxParticles: number
}

// Create the worker system for physics
export const physicsSystem = defineWorkerSystem(new URL('./physicsWorker.ts', import.meta.url).href, {
  threads: Math.ceil(navigator.hardwareConcurrency / 4),
  priority: 'high',
})

// Query for renderable entities
const renderQuery = defineQuery((q) => q.with(Position, Color, Size))

// reusable objects
const tempMatrix = new THREE.Matrix4()
const tempColor = new THREE.Color()

// Rendering system
export const renderSystem = defineSystem((ctx) => {
  const { instancedMesh, maxParticles } = getResources<Resources>(ctx)
  let index = 0

  for (const eid of renderQuery.current(ctx)) {
    if (index >= maxParticles) break

    const pos = Position.read(ctx, eid)
    const color = Color.read(ctx, eid)
    const size = Size.read(ctx, eid)

    // Update matrix for this instance
    tempMatrix.makeScale(size.value, size.value, size.value)
    tempMatrix.setPosition(pos.x, pos.y, pos.z)
    instancedMesh.setMatrixAt(index, tempMatrix)

    // Update color for this instance
    tempColor.setRGB(color.r, color.g, color.b)
    instancedMesh.setColorAt(index, tempColor)

    index++
  }

  // Hide unused instances by scaling them to 0
  for (let i = index; i < maxParticles; i++) {
    tempMatrix.makeScale(0, 0, 0)
    instancedMesh.setMatrixAt(i, tempMatrix)
  }

  // Mark for update
  instancedMesh.instanceMatrix.needsUpdate = true
  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true
  }
})

const deathTimeQuery = defineQuery((q) => q.with(DeathTime))
export const reaperSystem = defineSystem((ctx) => {
  const time = Time.read(ctx)

  for (const eid of deathTimeQuery.current(ctx)) {
    const deathTime = DeathTime.read(ctx, eid)
    if (time.current >= deathTime.value) {
      removeEntity(ctx, eid)
    }
  }
})

// Attractor system queries and temps
const mouseQuery = defineQuery((q) => q.tracking(Mouse))
const attractors = defineQuery((q) => q.with(Attractor))
const raycaster = new THREE.Raycaster()
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const intersection = new THREE.Vector3()

export const attractorSystem = defineSystem((ctx) => {
  if (mouseQuery.changed(ctx).length > 0) {
    const { camera } = getResources<Resources>(ctx)
    const mouse = Mouse.read(ctx)

    raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera)
    raycaster.ray.intersectPlane(plane, intersection)

    for (const eid of attractors.current(ctx)) {
      const attractor = Attractor.write(ctx, eid)
      attractor.targetX = intersection.x
      attractor.targetY = intersection.y
      attractor.targetZ = 0
    }
  }
})

// Particle spawner system
export const spawnerSystem = defineSystem((ctx) => {
  const time = Time.read(ctx)
  const config = Config.read(ctx)
  const particlesToSpawn = Math.ceil(time.delta * config.particlesPerSecond)

  for (let i = 0; i < particlesToSpawn; i++) {
    const eid = createEntity(ctx)

    // Random spawn position in a sphere
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = 2 + Math.random() * 2

    addComponent(ctx, eid, Position, {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    })

    addComponent(ctx, eid, Velocity, {
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: (Math.random() - 0.5) * 2,
    })

    addComponent(ctx, eid, Acceleration, {
      x: 0,
      y: -1, // Gravity
      z: 0,
    })

    // Random color with some bias toward blue/purple
    const hue = Math.random() * 0.3 + 0.5 // 0.5-0.8 range (cyan to purple)
    const c = new THREE.Color().setHSL(hue, 0.8, 0.6)
    addComponent(ctx, eid, Color, {
      r: c.r,
      g: c.g,
      b: c.b,
    })

    addComponent(ctx, eid, Size, {
      value: config.particleSize + Math.random() * 0.15,
    })

    addComponent(ctx, eid, DeathTime, {
      value: time.current + config.particleLifetimeSeconds,
    })
  }
})
