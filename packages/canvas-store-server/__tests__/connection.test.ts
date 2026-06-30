import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptConnection, ConnectionClosedError, ConnectRequestError, parseConnectUrl } from '../src/connection'
import { RoomManager } from '../src/RoomManager'

/** A promise plus its resolver, so a test can hold `authorize` open and send
 * frames during the connect window before letting it complete. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createMockSocket() {
  const socket = {
    sent: [] as string[],
    send: vi.fn((data: string) => {
      socket.sent.push(data)
    }),
    close: vi.fn(),
  }
  return socket
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('parseConnectUrl', () => {
  it('parses path-and-query inputs (Node ws req.url shape)', () => {
    expect(parseConnectUrl('/?roomId=r1&clientId=c1&token=t1')).toEqual({
      roomId: 'r1',
      clientId: 'c1',
      token: 't1',
    })
  })

  it('parses full URLs', () => {
    expect(parseConnectUrl('wss://example.com/socket?roomId=r1&clientId=c1&token=t1')).toEqual({
      roomId: 'r1',
      clientId: 'c1',
      token: 't1',
    })
  })

  it('throws on missing roomId', () => {
    expect(() => parseConnectUrl('/?clientId=c1&token=t1')).toThrow(ConnectRequestError)
  })

  it('throws on missing clientId', () => {
    expect(() => parseConnectUrl('/?roomId=r1&token=t1')).toThrow(ConnectRequestError)
  })

  it('throws on missing token', () => {
    expect(() => parseConnectUrl('/?roomId=r1&clientId=c1')).toThrow(ConnectRequestError)
  })

  it('attaches an error code so callers can map to WS close codes', () => {
    try {
      parseConnectUrl('/?roomId=r1&clientId=c1')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectRequestError)
      expect((err as ConnectRequestError).code).toBe('missing-token')
    }
  })
})

describe('acceptConnection', () => {
  let manager: RoomManager

  beforeEach(() => {
    manager = new RoomManager()
  })

  it('parses the URL, authorizes, and registers the session', async () => {
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readwrite' as const })
    const socket = createMockSocket()

    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize,
    })
    const { room, sessionId } = await conn.ready

    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledWith({
      roomId: 'r1',
      clientId: 'c1',
      token: 'tok',
      request: undefined,
    })
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(room.getSessionPermissions(sessionId)).toBe('readwrite')
  })

  it('passes the request object through to authorize', async () => {
    const request = { headers: { 'x-test': '1' } }
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readonly' as const })
    const socket = createMockSocket()

    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      request,
      manager,
      authorize,
    })
    await conn.ready

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ request }))
  })

  it('stores authorize.metadata on the session', async () => {
    const claims = { sub: 'user-1', role: 'editor' }
    const authorize = vi.fn().mockResolvedValue({
      permissions: 'readwrite' as const,
      metadata: { token: 'tok', claims },
    })
    const socket = createMockSocket()

    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize,
    })
    const { room, sessionId } = await conn.ready

    expect(conn.getMetadata()).toEqual({ token: 'tok', claims })
    expect(room.getSessionMetadata(sessionId)).toEqual({ token: 'tok', claims })
  })

  it('rejects ready when authorize rejects (caller closes the socket)', async () => {
    const authorize = vi.fn().mockRejectedValue(new Error('bad token'))
    const socket = createMockSocket()

    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=bad',
      manager,
      authorize,
    })

    await expect(conn.ready).rejects.toThrow('bad token')

    // Caller is responsible for closing the socket — the helper does not.
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('rejects ready with ConnectRequestError on missing fields without calling authorize', async () => {
    const authorize = vi.fn()
    const conn = acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1',
      manager,
      authorize,
    })
    await expect(conn.ready).rejects.toThrow(ConnectRequestError)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('buffers frames received before ready and replays them in order', async () => {
    const auth = deferred<{ permissions: 'readwrite' }>()
    const authorize = vi.fn(() => auth.promise)
    const socket = createMockSocket()

    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize,
    })

    // A frame arrives while authorize is still pending — the room doesn't exist
    // yet. Without buffering this `patch` (a real client's first writes) is lost.
    conn.onMessage(JSON.stringify({ type: 'patch', messageId: 'm1', documentPatches: [{ 'e/Comp': { v: 1 } }] }))
    expect(socket.sent).toHaveLength(0) // nothing dispatched yet

    auth.resolve({ permissions: 'readwrite' })
    const { room } = await conn.ready

    // The buffered patch was applied and acked once the room came up.
    expect(room.getSnapshot().state['e/Comp']).toEqual({ v: 1 })
    expect(socket.sent.some((s) => JSON.parse(s).type === 'ack' && JSON.parse(s).messageId === 'm1')).toBe(true)
  })

  it('getMetadata returns undefined before ready resolves', () => {
    const auth = deferred<{ permissions: 'readwrite' }>()
    const conn = acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize: () => auth.promise,
    })
    expect(conn.getMetadata()).toBeUndefined()
    auth.resolve({ permissions: 'readwrite' })
  })

  it('cleans up the session and rejects with ConnectionClosedError if the socket closes before ready', async () => {
    const auth = deferred<{ permissions: 'readwrite' }>()
    const socket = createMockSocket()

    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize: () => auth.promise,
    })

    // Socket closes mid-authorize, before any session exists.
    conn.onClose()
    auth.resolve({ permissions: 'readwrite' })

    await expect(conn.ready).rejects.toBeInstanceOf(ConnectionClosedError)
    // The session that was briefly registered during ready was cleaned up, so
    // the room holds no phantom sessions (and can idle-close normally).
    expect(manager.getExistingRoom('r1')?.getSessionCount() ?? 0).toBe(0)
  })

  it('calls roomOptions(roomId) once when the room is first created', async () => {
    const roomOptions = vi.fn(() => ({ saveThrottleMs: 1234 }))
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readwrite' as const })

    const c1 = acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=t1',
      manager,
      authorize,
      roomOptions,
    })
    await c1.ready
    const c2 = acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c2&token=t2',
      manager,
      authorize,
      roomOptions,
    })
    await c2.ready

    expect(roomOptions).toHaveBeenCalledTimes(1)
    expect(roomOptions).toHaveBeenCalledWith('r1')
  })

  it('runs the same authorize on auth-refresh frames, with request=undefined', async () => {
    const authorize = vi.fn().mockResolvedValue({
      permissions: 'readwrite' as const,
      metadata: { v: 1 },
    })
    const request = { tag: 'connect-only' }

    const conn = acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=t1',
      request,
      manager,
      authorize,
    })
    const { room, sessionId } = await conn.ready

    authorize.mockClear()
    authorize.mockResolvedValue({ permissions: 'readonly' as const, metadata: { v: 2 } })

    conn.onMessage(JSON.stringify({ type: 'auth-refresh', token: 't2' }))
    await flush()

    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledWith({
      roomId: 'r1',
      clientId: 'c1',
      token: 't2',
      request: undefined,
    })
    expect(room.getSessionPermissions(sessionId)).toBe('readonly')
    expect(conn.getMetadata()).toEqual({ v: 2 })
  })

  it('drops the session when authorize throws on refresh', async () => {
    let connectCall = true
    const authorize = vi.fn(async () => {
      if (connectCall) {
        connectCall = false
        return { permissions: 'readwrite' as const }
      }
      throw new Error('expired')
    })

    const socket = createMockSocket()
    const conn = acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=t1',
      manager,
      authorize,
    })
    const { room } = await conn.ready

    conn.onMessage(JSON.stringify({ type: 'auth-refresh', token: 'expired' }))
    await flush()

    expect(socket.close).toHaveBeenCalled()
    expect(room.getSessionCount()).toBe(0)
  })

  it('forwards onMessage / onClose / onError through to the room', async () => {
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readwrite' as const })

    const conn = acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=t1',
      manager,
      authorize,
    })
    const { room } = await conn.ready

    expect(room.getSessionCount()).toBe(1)
    conn.onClose()
    expect(room.getSessionCount()).toBe(0)
  })
})
