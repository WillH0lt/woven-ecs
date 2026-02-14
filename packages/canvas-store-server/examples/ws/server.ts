import { createServer } from 'node:http'
import { FileStorage, RoomManager } from '@woven-ecs/canvas-store-server'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 8087

const manager = new RoomManager({
  idleTimeout: 60_000,
})

const server = createServer((_req, res) => {
  res.writeHead(200).end('ok')
})

const wss = new WebSocketServer({ server })

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)
  const roomId = url.searchParams.get('roomId') ?? 'default'
  const clientId = url.searchParams.get('clientId')
  // const token = url.searchParams.get('token')

  if (!clientId) {
    ws.close(1008, 'Missing clientId query parameter')
    return
  }

  // Example: validate the token and determine permissions.
  // Replace this with your own authentication logic.
  // const auth = await validateToken(token);
  // if (!auth) { ws.close(1008, "Unauthorized"); return; }
  // const permissions = auth.canWrite ? "readwrite" : "readonly";

  const room = await manager.getOrCreateRoom(roomId, {
    createStorage: () => new FileStorage({ dir: './data', roomId }),
  })

  const sessionId = room.handleSocketConnect({
    socket: ws,
    clientId,
    permissions: 'readwrite',
  })

  ws.on('message', (data) => room.handleSocketMessage(sessionId, String(data)))
  ws.on('close', () => room.handleSocketClose(sessionId))
  ws.on('error', () => room.handleSocketError(sessionId))

  console.log(`Client ${clientId} connected to room ${roomId} (${room.getSessionCount()} active)`)
})

server.listen(PORT, () => {
  console.log(`ECS sync server listening on ws://localhost:${PORT}`)
  console.log(`Connect: ws://localhost:${PORT}?roomId=myRoom&clientId=myClient`)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  manager.closeAll()
  server.close()
  process.exit(0)
})
