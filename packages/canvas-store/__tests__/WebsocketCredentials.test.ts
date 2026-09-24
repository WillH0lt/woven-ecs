import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebsocketAdapter, type WebsocketAdapterOptions, WebsocketCredentialError } from '../src/adapters/Websocket'
import { Origin } from '../src/constants'

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
    void Promise.resolve().then(() => {
      if (this.readyState !== 0) return
      this.readyState = Socket.OPEN
      this.dispatchEvent(new Event('open'))
    })
  }
}
const connections: WebsocketAdapter[] = []
beforeEach(() => {
  vi.useFakeTimers()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function credentials(token = 'fresh', seconds = 600) {
  return { token, expiresAt: Date.now() / 1000 + seconds }
}
function adapter(getCredentials: NonNullable<WebsocketAdapterOptions['getCredentials']>, startOffline = false) {
  const connection = new WebsocketAdapter({
    url: 'wss://editor.example',
    documentId: 'zine',
    clientId: 'client',
    getCredentials,
    startOffline,
    components: [],
    singletons: [],
    usePersistence: false,
  })
  connections.push(connection)
  return connection
}
it('obtains fresh credentials for the initial connection and every reconnect', async () => {
  const get = vi.fn().mockResolvedValueOnce(credentials('first')).mockResolvedValueOnce(credentials('second'))
  const connection = adapter(get)
  await connection.init()
  expect(new URL(Socket.instances[0]!.url).searchParams.get('token')).toBe('first')
  Socket.instances[0]!.close()
  await vi.advanceTimersByTimeAsync(500)
  expect(new URL(Socket.instances[1]!.url).searchParams.get('token')).toBe('second')
  expect(connection.isOnline).toBe(true)
  expect(get).toHaveBeenCalledTimes(2)
})
it('refreshes a live socket before expiry without reconnecting', async () => {
  const get = vi.fn().mockImplementation(async () => credentials(`token-${get.mock.calls.length}`))
  const connection = adapter(get)
  await connection.init()
  await vi.advanceTimersByTimeAsync(540_000)
  expect(Socket.instances).toHaveLength(1)
  expect(Socket.instances[0]!.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'auth-refresh', token: 'token-2' }))
  expect(connection.isOnline).toBe(true)
})
it('retries an initial credential failure without opening an unauthenticated socket', async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockImplementation(async () => credentials())
  await adapter(get).init()
  expect(Socket.instances).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(500)
  expect(Socket.instances).toHaveLength(1)
})
it('backs off refresh failures, keeps offline edits, and reconnects with new credentials', async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce(credentials('old'))
    .mockRejectedValueOnce(new Error('network'))
    .mockImplementation(async () => credentials('new'))
  const connection = adapter(get)
  await connection.init()
  await vi.advanceTimersByTimeAsync(540_000)
  expect(connection.isOnline).toBe(false)
  connection.push([{ origin: Origin.ECS, syncBehavior: 'document', patch: { 'entity/Position': { x: 42 } } }])
  await vi.advanceTimersByTimeAsync(500)
  expect(new URL(Socket.instances[1]!.url).searchParams.get('token')).toBe('new')
  expect(JSON.parse(Socket.instances[1]!.send.mock.calls[0]![0]).documentPatches).toEqual([
    { 'entity/Position': { x: 42 } },
  ])
})
it('stops retries when the application disconnects after credential denial', async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce(credentials())
    .mockImplementationOnce(async () => {
      connection.disconnect()
      throw new Error('Access denied')
    })
    .mockImplementation(async () => credentials('restored'))
  const connection = adapter(get)
  await connection.init()
  await vi.advanceTimersByTimeAsync(540_000)
  expect(connection.isOnline).toBe(false)
  await vi.advanceTimersByTimeAsync(600_000)
  expect(get).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
  await connection.reconnect()
  expect(connection.isOnline).toBe(true)
})
it('honors the credential provider rate-limit delay', async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(new WebsocketCredentialError('rate limited', 60_000))
    .mockImplementation(async () => credentials())
  await adapter(get).init()
  await vi.advanceTimersByTimeAsync(59_999)
  expect(get).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(get).toHaveBeenCalledTimes(2)
})
it('ignores a late credential response after disconnect', async () => {
  let complete!: (value: ReturnType<typeof credentials>) => void
  const get = vi.fn(
    () =>
      new Promise<ReturnType<typeof credentials>>((resolve) => {
        complete = resolve
      }),
  )
  const connection = adapter(get)
  const pending = connection.init()
  connection.disconnect()
  expect(get).toHaveBeenCalledWith()
  complete(credentials())
  await pending
  expect(Socket.instances).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})
it('ignores old socket events after an explicit reconnect', async () => {
  const connection = adapter(async () => credentials())
  await connection.init()
  const old = Socket.instances[0]!
  await connection.reconnect()
  old.dispatchEvent(new Event('close'))
  old.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ type: 'version-mismatch', serverProtocolVersion: 999 }) }),
  )
  expect(connection.isOnline).toBe(true)
  expect(Socket.instances).toHaveLength(2)
})
it('never opens a socket with expired credentials', async () => {
  const get = vi.fn().mockImplementation(async () => credentials('expired', -1))
  await adapter(get).init()
  await vi.advanceTimersByTimeAsync(3_000)
  expect(get.mock.calls.length).toBeGreaterThan(1)
  expect(Socket.instances).toHaveLength(0)
})
it('closes at expiry if a refresh is still pending, then reconnects when it succeeds', async () => {
  let complete!: (value: ReturnType<typeof credentials>) => void
  const get = vi
    .fn()
    .mockResolvedValueOnce(credentials())
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
  const connection = adapter(get)
  await connection.init()
  await vi.advanceTimersByTimeAsync(600_000)
  expect(connection.isOnline).toBe(false)
  expect(get).toHaveBeenCalledTimes(2)
  complete(credentials('new'))
  await vi.advanceTimersByTimeAsync(0)
  expect(connection.isOnline).toBe(true)
  expect(new URL(Socket.instances[1]!.url).searchParams.get('token')).toBe('new')
})
it('does not let a cancelled request replace a newer connection', async () => {
  let complete!: (value: ReturnType<typeof credentials>) => void
  const get = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    .mockImplementation(async () => credentials('new'))
  const connection = adapter(get)
  const pending = connection.init()
  await connection.reconnect()
  complete(credentials('old'))
  await pending
  expect(Socket.instances).toHaveLength(1)
  expect(new URL(Socket.instances[0]!.url).searchParams.get('token')).toBe('new')
  expect(connection.isOnline).toBe(true)
})

it('uses non-expiring credentials without scheduling refresh timers', async () => {
  const get = vi.fn().mockResolvedValue({ token: 'permanent' })
  const connection = adapter(get)
  await connection.init()
  expect(new URL(Socket.instances[0]!.url).searchParams.get('token')).toBe('permanent')
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  expect(get).toHaveBeenCalledOnce()
  expect(connection.isOnline).toBe(true)
  Socket.instances[0]!.close()
  await vi.advanceTimersByTimeAsync(500)
  expect(get).toHaveBeenCalledTimes(2)
  expect(connection.isOnline).toBe(true)
})
it('clears the expiry timer when refreshed credentials no longer expire', async () => {
  const get = vi.fn().mockResolvedValueOnce(credentials()).mockResolvedValue({ token: 'permanent' })
  const connection = adapter(get)
  await connection.init()
  await vi.advanceTimersByTimeAsync(540_000)
  expect(Socket.instances[0]!.send).toHaveBeenLastCalledWith(
    JSON.stringify({ type: 'auth-refresh', token: 'permanent' }),
  )
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(600_000)
  expect(connection.isOnline).toBe(true)
  expect(get).toHaveBeenCalledTimes(2)
})
it('does not fetch credentials when starting offline until connect is requested', async () => {
  const get = vi.fn().mockResolvedValue({ token: 'fresh' })
  const connection = adapter(get, true)
  await connection.init()
  expect(get).not.toHaveBeenCalled()
  expect(Socket.instances).toHaveLength(0)
  await connection.reconnect()
  expect(get).toHaveBeenCalledOnce()
  expect(connection.isOnline).toBe(true)
})
it('rejects a malformed expiry instead of treating it as non-expiring', async () => {
  await adapter(async () => ({ token: 'invalid', expiresAt: Number.NaN })).init()
  expect(Socket.instances).toHaveLength(0)
})

it('does not retry when the application disconnects during the first credential request', async () => {
  const get = vi.fn(async () => {
    connection.disconnect()
    throw new Error('Access denied')
  })
  const connection = adapter(get)
  await connection.init()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(get).toHaveBeenCalledOnce()
  expect(Socket.instances).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})
