import { defineComponent, defineSingleton, field } from '@woven-ecs/core'

export const Position = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
})

export const Velocity = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
})

export const Acceleration = defineComponent({
  x: field.float32(),
  y: field.float32(),
  z: field.float32(),
})

export const Color = defineComponent({
  r: field.float32().default(1),
  g: field.float32().default(1),
  b: field.float32().default(1),
})

export const DeathTime = defineComponent({
  value: field.float32(),
})

export const Size = defineComponent({
  value: field.float32().default(0.1),
})

export const Attractor = defineComponent({
  strength: field.float32().default(2),
  targetX: field.float32(),
  targetY: field.float32(),
  targetZ: field.float32(),
})

export const Mouse = defineSingleton({
  x: field.float32(),
  y: field.float32(),
})

export const Time = defineSingleton({
  delta: field.float32(),
  current: field.float32(),
})

export const Config = defineSingleton({
  particlesPerSecond: field.float32(),
  particleLifetimeSeconds: field.float32(),
  particleSize: field.float32(),
})
