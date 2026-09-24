import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebsocketAdapter } from '../src/adapters/Websocket'

class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  })
  constructor(public url: string) {
    super()
    Socket.instances.push(this)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function adapter(getCredentials?: () => Promise<{ token: string }>) {
  return new WebsocketAdapter({
    url: 'wss://editor.example',
    documentId: 'zine',
    clientId: 'client',
    getCredentials,
    components: [],
    singletons: [],
    usePersistence: false,
  })
}

it('does not resume retries when a pending handshake fails after access was revoked', async () => {
  const connection = adapter()
  const pending = connection.init()
  connection.disconnect()
  Socket.instances[0]!.dispatchEvent(new Event('error'))
  await pending
  await vi.advanceTimersByTimeAsync(60_000)
  expect(Socket.instances).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('closes a handshake that opens after disconnect without sending edits', async () => {
  const connection = adapter()
  const pending = connection.init()
  connection.disconnect()
  const socket = Socket.instances[0]!
  socket.readyState = Socket.OPEN
  socket.dispatchEvent(new Event('open'))
  await pending
  expect(socket.close).toHaveBeenCalled()
  expect(socket.send).not.toHaveBeenCalled()
  expect(connection.isOnline).toBe(false)
  connection.close()
})

it('requests fresh credentials on an explicit reconnect', async () => {
  let token = 'old'
  const connection = adapter(async () => ({ token }))
  const initial = connection.init()
  await vi.advanceTimersByTimeAsync(0)
  Socket.instances[0]!.readyState = Socket.OPEN
  Socket.instances[0]!.dispatchEvent(new Event('open'))
  await initial
  connection.disconnect()
  token = 'fresh'
  const resumed = connection.reconnect()
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.instances[1]!
  expect(new URL(socket.url).searchParams.get('token')).toBe('fresh')
  socket.readyState = Socket.OPEN
  socket.dispatchEvent(new Event('open'))
  await resumed
  expect(connection.isOnline).toBe(true)
  expect(socket.send).toHaveBeenCalledOnce()
  connection.close()
})
