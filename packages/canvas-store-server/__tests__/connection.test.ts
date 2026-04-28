import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptConnection, ConnectRequestError, parseConnectUrl } from '../src/connection'
import { RoomManager } from '../src/RoomManager'

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

    const conn = await acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize,
    })

    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledWith({
      roomId: 'r1',
      clientId: 'c1',
      token: 'tok',
      request: undefined,
    })
    expect(conn.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(conn.room.getSessionPermissions(conn.sessionId)).toBe('readwrite')
  })

  it('passes the request object through to authorize', async () => {
    const request = { headers: { 'x-test': '1' } }
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readonly' as const })
    const socket = createMockSocket()

    await acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      request,
      manager,
      authorize,
    })

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ request }))
  })

  it('stores authorize.metadata on the session', async () => {
    const claims = { sub: 'user-1', role: 'editor' }
    const authorize = vi.fn().mockResolvedValue({
      permissions: 'readwrite' as const,
      metadata: { token: 'tok', claims },
    })
    const socket = createMockSocket()

    const conn = await acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=tok',
      manager,
      authorize,
    })

    expect(conn.getMetadata()).toEqual({ token: 'tok', claims })
    expect(conn.room.getSessionMetadata(conn.sessionId)).toEqual({ token: 'tok', claims })
  })

  it('rethrows when authorize rejects (caller closes the socket)', async () => {
    const authorize = vi.fn().mockRejectedValue(new Error('bad token'))
    const socket = createMockSocket()

    await expect(
      acceptConnection({
        socket,
        url: '/?roomId=r1&clientId=c1&token=bad',
        manager,
        authorize,
      }),
    ).rejects.toThrow('bad token')

    // Caller is responsible for closing the socket — the helper does not.
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('rejects with ConnectRequestError on missing fields without calling authorize', async () => {
    const authorize = vi.fn()
    await expect(
      acceptConnection({
        socket: createMockSocket(),
        url: '/?roomId=r1&clientId=c1',
        manager,
        authorize,
      }),
    ).rejects.toThrow(ConnectRequestError)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('calls roomOptions(roomId) once when the room is first created', async () => {
    const roomOptions = vi.fn(() => ({ saveThrottleMs: 1234 }))
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readwrite' as const })

    await acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=t1',
      manager,
      authorize,
      roomOptions,
    })
    await acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c2&token=t2',
      manager,
      authorize,
      roomOptions,
    })

    expect(roomOptions).toHaveBeenCalledTimes(1)
    expect(roomOptions).toHaveBeenCalledWith('r1')
  })

  it('runs the same authorize on auth-refresh frames, with request=undefined', async () => {
    const authorize = vi.fn().mockResolvedValue({
      permissions: 'readwrite' as const,
      metadata: { v: 1 },
    })
    const request = { tag: 'connect-only' }

    const conn = await acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=t1',
      request,
      manager,
      authorize,
    })

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
    expect(conn.room.getSessionPermissions(conn.sessionId)).toBe('readonly')
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
    const conn = await acceptConnection({
      socket,
      url: '/?roomId=r1&clientId=c1&token=t1',
      manager,
      authorize,
    })

    conn.onMessage(JSON.stringify({ type: 'auth-refresh', token: 'expired' }))
    await flush()

    expect(socket.close).toHaveBeenCalled()
    expect(conn.room.getSessionCount()).toBe(0)
  })

  it('forwards onMessage / onClose / onError through to the room', async () => {
    const authorize = vi.fn().mockResolvedValue({ permissions: 'readwrite' as const })

    const conn = await acceptConnection({
      socket: createMockSocket(),
      url: '/?roomId=r1&clientId=c1&token=t1',
      manager,
      authorize,
    })

    expect(conn.room.getSessionCount()).toBe(1)
    conn.onClose()
    expect(conn.room.getSessionCount()).toBe(0)
  })
})
