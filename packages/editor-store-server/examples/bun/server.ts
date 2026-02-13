import { FileStorage, RoomManager } from '../../src/index'

interface WSData {
  sessionId: string | null
  roomId: string
  clientId: string
}

const PORT = Number(process.env.PORT) || 8087

const manager = new RoomManager({
  idleTimeout: 60_000,
})

const server = Bun.serve<WSData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url)
    const roomId = url.searchParams.get('roomId') ?? 'default'
    const clientId = url.searchParams.get('clientId')
    // const _token = url.searchParams.get('token')

    if (!clientId) {
      return new Response('Missing clientId query parameter', { status: 400 })
    }

    // Example: validate the token and determine permissions.
    // Replace this with your own authentication logic.
    // const auth = await validateToken(token);
    // if (!auth) { return new Response("Unauthorized", { status: 401 }); }
    // const permissions = auth.canWrite ? "readwrite" : "readonly";

    const upgraded = server.upgrade(req, {
      data: {
        sessionId: null,
        roomId,
        clientId,
        // permissions,
      },
    })

    if (!upgraded) {
      return new Response('WebSocket upgrade failed', { status: 400 })
    }
  },

  websocket: {
    async open(ws) {
      const { roomId, clientId } = ws.data
      const room = await manager.getOrCreateRoom(roomId, {
        createStorage: () => new FileStorage({ dir: './data', roomId }),
      })

      ws.data.sessionId = room.handleSocketConnect({
        socket: { send: (data) => ws.send(data), close: () => ws.close() },
        clientId,
        permissions: 'readwrite', // ws.data.permissions,
      })

      console.log(`Client ${clientId} connected to room ${roomId} (${room.getSessionCount()} active)`)
    },

    message(ws, message) {
      const { sessionId, roomId } = ws.data
      const room = manager.getExistingRoom(roomId)
      if (room && sessionId) room.handleSocketMessage(sessionId, String(message))
    },

    close(ws) {
      const { sessionId, roomId } = ws.data
      const room = manager.getExistingRoom(roomId)
      if (room && sessionId) room.handleSocketClose(sessionId)
    },
  },
})

console.log(`ECS sync server listening on ws://localhost:${server.port}`)
console.log(`Connect: ws://localhost:${server.port}?roomId=myRoom&clientId=myClient`)

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  manager.closeAll()
  server.stop()
  process.exit(0)
})
