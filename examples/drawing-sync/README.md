# drawing-sync

A minimal real-time collaborative drawing app — a stripped-down stand-in for
woven-canvas's pen tool — used to exercise `@woven-ecs/canvas-store` end to end,
including the sparse **buffer-field delta** sync.

Each stroke is a single entity with a `field.buffer` of `[x, y]` points. As you
draw, points are appended to that buffer every frame; the sync layer ships only
the appended tail (a delta) rather than the whole array on each change.

## Run

```bash
pnpm install        # from the woven-ecs repo root
pnpm --filter drawing-sync dev
```

Open the printed URL (e.g. http://localhost:5173). Draw with the mouse or a
pen/stylus. **Open a second tab** to the same URL and watch strokes appear in
both, live.

The sync server runs inside the Vite dev server (see `vite.config.ts`), so a
single command starts both the client and the multiplayer backend. Clients
connect to `ws://<host>/sync`; room state is held in memory and lives as long as
the dev server is running.

## What to look at

- `src/main.ts` — the whole client: a `Stroke` component, a `CanvasStore` wired
  to the websocket, pointer handlers that append points, and a render loop.
- `vite.config.ts` — a tiny Vite plugin that hosts `RoomManager` /
  `acceptConnection` from `@woven-ecs/canvas-store-server` on `/sync`.

To see the delta encoding on the wire, open DevTools → Network → the `/sync`
WebSocket → Messages, and draw a long stroke: outbound frames carry only the new
points (`{"__buf":1,"len":…,"runs":[[offset,[…]]]}`), not the growing array.
