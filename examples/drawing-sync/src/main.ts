import { CanvasComponentDef, CanvasStore, Synced } from '@woven-ecs/canvas-store'
import { addComponent, type Context, createEntity, defineQuery, type EntityId, field, World } from '@woven-ecs/core'

// ─── Component ───────────────────────────────────────────────────────────────
// A stroke is a flat buffer of [x0, y0, x1, y1, …] world-space points plus a
// colour. `points` is a `field.buffer`, which is exactly the field type the new
// sparse-delta sync optimizes: appending points sends only the new tail over the
// wire instead of the whole array.

const POINTS_CAPACITY = 1024

const StrokeSchema = {
  points: field.buffer(field.float32()).size(POINTS_CAPACITY * 2),
  pointCount: field.uint32().default(0),
  r: field.uint8().default(0),
  g: field.uint8().default(0),
  b: field.uint8().default(0),
}

// The points buffer is fixed at full capacity, but only the first `pointCount`
// points are meaningful. Override snapshot() to send just the used slice — that
// way the initial add and reconnect snapshots don't ship a long tail of zeros.
// (Mid-stroke appends already sync as small deltas regardless.)
class StrokeDef extends CanvasComponentDef<typeof StrokeSchema> {
  constructor() {
    super({ name: 'stroke', sync: 'document' }, StrokeSchema)
  }

  snapshot(ctx: Context, entityId: EntityId) {
    const snap = super.snapshot(ctx, entityId)
    snap.points = snap.points.slice(0, snap.pointCount * 2)
    return snap
  }
}

const Stroke = new StrokeDef()

// ─── World + store ─────────────────────────────────────────────────────────--

const world = new World([Synced, Stroke], { maxEntities: 10_000 })
const strokes = defineQuery((q) => q.tracking(Stroke))

const statusEl = document.getElementById('status') as HTMLSpanElement

const store = new CanvasStore({
  // Enable undo/redo. The History adapter bundles changes into a checkpoint
  // after ~1s of inactivity, so each finished stroke becomes one undo step
  // (rapid back-to-back strokes may group together).
  history: true,
  websocket: {
    url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`,
    documentId: 'drawing-demo',
    clientId: crypto.randomUUID(),
    token: 'demo', // the demo server accepts any non-empty token
    onConnectivityChange: (online) => {
      statusEl.textContent = online ? 'online' : 'offline'
      statusEl.style.color = online ? '#0a0' : '#a00'
    },
  },
})
await store.initialize({ components: [Stroke], singletons: [] })

// ─── Drawing input ─────────────────────────────────────────────────────────--
// Pointer handlers append points into the active stroke. Each mutation runs in
// a `world.execute` tick; the render loop's `store.sync(ctx)` then diffs the
// change and ships it (as an append delta) to the server.

const MIN_DISTANCE = 2 // skip points closer than this (screen px) to limit density

let activeStroke: number | null = null
let lastX = 0
let lastY = 0

function startStroke(x: number, y: number): void {
  world.execute((ctx) => {
    const eid = createEntity(ctx)
    addComponent(ctx, eid, Synced, { id: crypto.randomUUID() })
    addComponent(ctx, eid, Stroke, {
      points: [x, y],
      pointCount: 1,
      r: Math.floor(Math.random() * 200),
      g: Math.floor(Math.random() * 200),
      b: Math.floor(Math.random() * 200),
    })
    activeStroke = eid
  })
  lastX = x
  lastY = y
}

function extendStroke(x: number, y: number): void {
  if (activeStroke === null) return
  if (Math.hypot(x - lastX, y - lastY) < MIN_DISTANCE) return
  lastX = x
  lastY = y
  world.execute((ctx) => {
    const stroke = Stroke.write(ctx, activeStroke!)
    const i = stroke.pointCount
    if (i >= POINTS_CAPACITY) return
    stroke.points[i * 2] = x
    stroke.points[i * 2 + 1] = y
    stroke.pointCount = i + 1
  })
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId)
  startStroke(e.clientX, e.clientY)
})
canvas.addEventListener('pointermove', (e) => {
  if (activeStroke === null) return
  extendStroke(e.clientX, e.clientY)
})
const endStroke = () => {
  activeStroke = null
}
canvas.addEventListener('pointerup', endStroke)
canvas.addEventListener('pointercancel', endStroke)

// ─── Rendering ─────────────────────────────────────────────────────────────--

const c = canvas.getContext('2d')!
let dpr = 1

function resize(): void {
  dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
}
resize()
window.addEventListener('resize', resize)

function render(ctx: Context): void {
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, window.innerWidth, window.innerHeight)
  c.lineWidth = 3
  c.lineJoin = 'round'
  c.lineCap = 'round'

  for (const eid of strokes.current(ctx)) {
    const s = Stroke.read(ctx, eid)
    if (s.pointCount === 0) continue

    c.strokeStyle = `rgb(${s.r}, ${s.g}, ${s.b})`
    c.fillStyle = c.strokeStyle

    if (s.pointCount === 1) {
      c.beginPath()
      c.arc(s.points[0], s.points[1], 1.5, 0, Math.PI * 2)
      c.fill()
      continue
    }

    c.beginPath()
    c.moveTo(s.points[0], s.points[1])
    for (let i = 1; i < s.pointCount; i++) {
      c.lineTo(s.points[i * 2], s.points[i * 2 + 1])
    }
    c.stroke()
  }
}

// ─── Undo / redo ─────────────────────────────────────────────────────────--
// `store.undo()` / `store.redo()` queue an inverse/forward patch; the loop's
// next `store.sync(ctx)` applies it to the world (and broadcasts it, so peers
// see undos too).

const undoBtn = document.getElementById('undo') as HTMLButtonElement
const redoBtn = document.getElementById('redo') as HTMLButtonElement

undoBtn.addEventListener('click', () => store.undo())
redoBtn.addEventListener('click', () => store.redo())

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault()
    store.undo()
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault()
    store.redo()
  }
})

// ─── Loop ──────────────────────────────────────────────────────────────────--
// Each frame: run the store sync (pull local edits → send; apply remote edits),
// then redraw every stroke currently in the world.

function frame(): void {
  requestAnimationFrame(frame)
  world.execute((ctx) => {
    store.sync(ctx)
    render(ctx)
  })
  undoBtn.disabled = !store.canUndo()
  redoBtn.disabled = !store.canRedo()
}
frame()
