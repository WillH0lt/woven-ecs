import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { defineConfig, type PluginOption } from 'vite'
import { WebSocketServer } from 'ws'
// Imported from source (relative) so the example runs without building the
// package. The app code below uses the `@woven-ecs/source` resolve condition
// for the same effect; Vite's config loader doesn't apply that condition, so
// the plugin reaches into the source directly.
import { acceptConnection, RoomManager } from '../../packages/canvas-store-server/src/index'

/**
 * Runs the canvas-store sync server inside the Vite dev server, so a single
 * `pnpm dev` gives you both the app and a working multiplayer backend. Clients
 * connect to `ws://<host>/sync`; Vite's own HMR socket is left untouched (it
 * uses the `vite-hmr` subprotocol, which we never match).
 */
function syncServerPlugin(): PluginOption {
  const manager = new RoomManager()
  const wss = new WebSocketServer({ noServer: true })

  return {
    name: 'woven-sync-server',
    configureServer(server) {
      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!req.url || !req.url.startsWith('/sync')) return // let Vite handle HMR
        wss.handleUpgrade(req, socket, head, (ws) => {
          acceptConnection({
            socket: { send: (d) => ws.send(d), close: () => ws.close() },
            url: req.url!,
            request: req,
            manager,
            // Demo server: every connection gets full read/write access.
            authorize: () => ({ permissions: 'readwrite' }),
          })
            .then((conn) => {
              ws.on('message', (data) => conn.onMessage(data.toString()))
              ws.on('close', () => conn.onClose())
              ws.on('error', () => conn.onError())
            })
            .catch(() => ws.close(1008, 'unauthorized'))
        })
      })
    },
  }
}

export default defineConfig({
  // Resolve workspace packages (@woven-ecs/*) from their TypeScript source.
  resolve: { conditions: ['@woven-ecs/source'] },
  plugins: [syncServerPlugin()],
})
