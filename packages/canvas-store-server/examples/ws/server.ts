import { createServer } from 'node:http'
import { acceptConnection, FileStorage, RoomManager } from '@woven-ecs/canvas-store-server'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 8087

const manager = new RoomManager({
  idleTimeout: 60_000,
})

/**
 * Stub: accepts any token and grants `readwrite`. Replace with your own
 * verification — e.g. `jose.jwtVerify(token, key, ...)` and a check that
 * the token's claims authorize the requested room.
 *
 * Called once on connect, then again every time the client sends an
 * `auth-refresh` frame. Throw to drop the session.
 */
async function authorize({ token, roomId }: { token: string; roomId: string }) {
  if (!token) throw new Error('Missing token')
  return {
    permissions: 'readwrite' as const,
    metadata: { token, roomId },
  }
}

const server = createServer((_req, res) => {
  res.writeHead(200).end('ok')
})

const wss = new WebSocketServer({ server })

wss.on('connection', async (ws, req) => {
  let conn: Awaited<ReturnType<typeof acceptConnection>>
  try {
    conn = await acceptConnection({
      socket: ws,
      url: req.url ?? '',
      request: req,
      manager,
      authorize: ({ token, roomId }) => authorize({ token, roomId }),
      roomOptions: (roomId) => ({
        createStorage: () => new FileStorage({ dir: './data', roomId }),
      }),
    })
  } catch (err) {
    ws.close(1008, (err as Error).message)
    return
  }

  ws.on('message', (data) => conn.onMessage(String(data)))
  ws.on('close', conn.onClose)
  ws.on('error', conn.onError)

  console.log(`Client ${conn.sessionId} joined room ${conn.room.getSessionCount()} active session(s) total`)
})

server.listen(PORT, () => {
  console.log(`ECS sync server listening on ws://localhost:${PORT}`)
  console.log(`Connect: ws://localhost:${PORT}?roomId=myRoom&clientId=myClient&token=demo`)
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\nReceived ${signal}, flushing rooms...`)
  // Stop accepting new connections, then persist all rooms before exiting.
  server.close()
  try {
    await manager.closeAll()
    console.log('Rooms flushed.')
  } catch (err) {
    console.error('Error during shutdown flush:', err)
  }
  process.exit(0)
}

// k8s sends SIGTERM on rollout/scale-down; SIGINT is Ctrl-C in local dev.
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
