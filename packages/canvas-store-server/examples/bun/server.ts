import { acceptConnection, type Connection, FileStorage, RoomManager } from '../../src/index'

interface SessionMeta {
  token: string
  roomId: string
}

interface WSData {
  /** Original request URL — needed because acceptConnection parses query params. */
  url: string
  /** Set in `open` once authorization succeeds. */
  conn: Connection<SessionMeta> | null
}

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
    metadata: { token, roomId } satisfies SessionMeta,
  }
}

const server = Bun.serve<WSData>({
  port: PORT,

  fetch(req, server) {
    const upgraded = server.upgrade(req, {
      data: { url: req.url, conn: null },
    })
    if (!upgraded) return new Response('WebSocket upgrade failed', { status: 400 })
  },

  websocket: {
    async open(ws) {
      try {
        ws.data.conn = await acceptConnection<unknown, SessionMeta>({
          socket: ws,
          url: ws.data.url,
          manager,
          authorize: ({ token, roomId }) => authorize({ token, roomId }),
          roomOptions: (roomId) => ({
            createStorage: () => new FileStorage({ dir: './data', roomId }),
          }),
        })
        console.log(`Client ${ws.data.conn.sessionId} joined a room`)
      } catch (err) {
        ws.close(1008, (err as Error).message)
      }
    },

    message(ws, message) {
      ws.data.conn?.onMessage(String(message))
    },

    close(ws) {
      ws.data.conn?.onClose()
    },
  },
})

console.log(`ECS sync server listening on ws://localhost:${server.port}`)
console.log(`Connect: ws://localhost:${server.port}?roomId=myRoom&clientId=myClient&token=demo`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\nReceived ${signal}, flushing rooms...`)
  // Stop accepting new connections, then persist all rooms before exiting.
  server.stop()
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
