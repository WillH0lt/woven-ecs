import './style.css'
import { addComponent, createEntity, World } from '@woven-ecs/core'
import Stats from 'stats.js'
import * as THREE from 'three'
import { Pane, type TpChangeEvent } from 'tweakpane'
import * as comps from './components'
import { attractorSystem, physicsSystem, reaperSystem, renderSystem, spawnerSystem } from './systems'

const maxParticles = 100_000
const particlesPerSecond = 1000
const particleLifetimeSeconds = 5
const particleSize = 0.01

// Setup Three.js scene
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0a0f)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.z = 15
camera.position.y = 5
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio)
document.body.appendChild(renderer.domElement)

// Create instanced mesh for efficient particle rendering
const geometry = new THREE.SphereGeometry(1, 8, 8)
const material = new THREE.MeshBasicMaterial()
const instancedMesh = new THREE.InstancedMesh(geometry, material, maxParticles)

// Initialize instance colors array
instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3)

scene.add(instancedMesh)

// Create the ECS world with all components and resources
const world = new World(Array.from(Object.values(comps)), {
  maxEntities: maxParticles + 1, // +1 for attractor entity
  resources: {
    instancedMesh,
    camera,
    maxParticles: maxParticles,
  },
})

// Mouse interaction
document.addEventListener('mousemove', (e) => {
  world.nextSync((ctx) => {
    const mouse = comps.Mouse.write(ctx)

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
  })
})

// Window resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// Initialize config singleton
world.nextSync((ctx) => {
  const config = comps.Config.write(ctx)
  config.particlesPerSecond = particlesPerSecond
  config.particleLifetimeSeconds = particleLifetimeSeconds
  config.particleSize = particleSize
})

// Initialize attractors
world.nextSync((ctx) => {
  const eid = createEntity(ctx)

  addComponent(ctx, eid, comps.Attractor)
  const attraction = comps.Attractor.write(ctx, eid)
  attraction.strength = 500
  attraction.targetX = 0
  attraction.targetY = 0
  attraction.targetZ = 0
})

// Tweakpane UI
const pane = new Pane()
const params = {
  particlesPerSecond,
  particleLifetimeSeconds,
  particleSize,
}
pane
  .addBinding(params, 'particlesPerSecond', {
    min: 0,
    max: 3000,
    step: 100,
    label: 'Spawn Rate (particles/s)',
  })
  .on('change', (ev: TpChangeEvent<number>) => {
    world.nextSync((ctx) => {
      const config = comps.Config.write(ctx)
      config.particlesPerSecond = ev.value
    })
  })

pane
  .addBinding(params, 'particleLifetimeSeconds', {
    min: 1,
    max: 10,
    step: 1,
    label: 'Particle Lifetime (s)',
  })
  .on('change', (ev: TpChangeEvent<number>) => {
    world.nextSync((ctx) => {
      const config = comps.Config.write(ctx)
      config.particleLifetimeSeconds = ev.value
    })
  })

pane
  .addBinding(params, 'particleSize', {
    min: 0.01,
    max: 1,
    step: 0.01,
    label: 'Particle Size',
  })
  .on('change', (ev: TpChangeEvent<number>) => {
    world.nextSync((ctx) => {
      const config = comps.Config.write(ctx)
      config.particleSize = ev.value
    })
  })

// Main loop
let lastTime = performance.now()
const stats = new Stats()
document.body.appendChild(stats.dom)

// Visibility change handling - pause when tab is hidden
let isPaused = false
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isPaused = true
  } else {
    isPaused = false
    lastTime = performance.now()
  }
})

// loop
async function animate() {
  if (isPaused) {
    requestAnimationFrame(animate)
    return
  }

  stats.begin()
  const currentTime = performance.now()
  const deltaTime = (currentTime - lastTime) / 1000
  lastTime = currentTime

  world.nextSync((ctx) => {
    const time = comps.Time.write(ctx)
    time.delta = deltaTime
    time.current = currentTime / 1000
  })

  world.sync()
  await world.execute(spawnerSystem, reaperSystem, renderSystem, physicsSystem, attractorSystem)

  renderer.render(scene, camera)

  requestAnimationFrame(animate)
  stats.end()
}

animate()
