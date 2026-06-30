/**
 * Runtime-agnostic connection helper.
 *
 * `acceptConnection` parses the wire-protocol query parameters, runs the
 * caller-provided `authorize` function, registers the session, and wires
 * `onTokenRefresh` to call the same `authorize` again. The caller gets
 * back a small handle with the methods their WebSocket runtime needs to
 * forward events into the room.
 *
 * Works with any runtime that can produce a `WebSocketLike` (`{ send,
 * close }`) and the request's URL. Adapters for specific libraries (`ws`,
 * Bun, Deno, uWebSockets) live in user code or thin wrappers.
 */

import type { Room, RoomOptions } from './Room'
import type { RoomManager } from './RoomManager'
import type { SessionPermission } from './types'
import type { WebSocketLike } from './WebSocketLike'

/** Information passed to the consumer's `authorize` function. */
export interface AuthorizeInfo<TRequest = unknown> {
  /** Room ID parsed from the connect URL's `roomId` query parameter. */
  roomId: string
  /** Client ID parsed from the connect URL's `clientId` query parameter. */
  clientId: string
  /** Token presented by the client — from the URL on connect, from the
   * `auth-refresh` frame on refresh. */
  token: string
  /** The runtime request object (Node `IncomingMessage`, Bun `Request`,
   * etc.), passed through verbatim from `acceptConnection`'s `request`
   * argument. `undefined` on token refresh — the room sees only the
   * refresh frame, not the original HTTP request, so connect-time data
   * like headers and IPs aren't available there. */
  request: TRequest | undefined
}

/** Return value of `authorize`. Throw to reject the connection or
 * refresh — the runtime adapter is expected to close the socket on a
 * connect rejection; refresh rejection is handled inside the room. */
export interface AuthorizeResult<TMeta = unknown> {
  permissions: SessionPermission
  /** Optional value the room will store on the session and expose via
   * `room.getSessionMetadata(sessionId)`. Refreshed automatically when
   * the client swaps tokens. Useful for caching the verified token /
   * claims for later outbound calls on the user's behalf. */
  metadata?: TMeta
}

export interface AcceptConnectionOptions<TRequest = unknown, TMeta = unknown> {
  socket: WebSocketLike
  /** Connect URL — accepts a full `wss://host/?...` URL or a path-and-query
   * string like `/?roomId=...&clientId=...&token=...` (which is what
   * Node's `ws` library hands you in `req.url`). */
  url: string
  /** Optional runtime request object passed through to `authorize` so
   * consumers can inspect headers, IP, custom params, etc. */
  request?: TRequest
  manager: RoomManager
  /** Verify the token and decide on permissions. Called once on connect,
   * then again every time the client sends an `auth-refresh` frame. */
  authorize: (info: AuthorizeInfo<TRequest>) => AuthorizeResult<TMeta> | Promise<AuthorizeResult<TMeta>>
  /** Per-room options applied when `manager.getOrCreateRoom` actually
   * creates the room. Subsequent connections to an existing room reuse
   * the original options. `onTokenRefresh` is owned by `acceptConnection`
   * — set it via `authorize` instead. */
  roomOptions?: (roomId: string) => Omit<RoomOptions, 'onTokenRefresh'>
}

/** Resolved value of `Connection.ready` once the session is live. */
export interface ConnectionReady {
  room: Room
  sessionId: string
}

/** Returned synchronously from `acceptConnection`. The runtime adapter
 * forwards WS events to these methods immediately — `onMessage` buffers any
 * frames that arrive before {@link Connection.ready} resolves and replays them
 * in order, so the client's first `reconnect` is never dropped during the async
 * authorize + room-load window. */
export interface Connection<TMeta = unknown> {
  /**
   * Resolves once authorize and room-load complete, the session is registered,
   * and buffered frames have been replayed — its value carries the live `room`
   * and `sessionId`. Rejects with {@link ConnectRequestError} on a malformed
   * URL, or whatever `authorize` threw on auth failure: close the socket (e.g.
   * code 1008) from a `.catch`. Rejects with {@link ConnectionClosedError} if
   * the socket closes before it became ready — benign, and the socket is
   * already closed, so a generic `.catch` that closes it again is a harmless
   * no-op.
   */
  ready: Promise<ConnectionReady>
  /** Returns the latest metadata attached to this session, or `undefined`
   * before `ready` resolves. Updated when `authorize` runs again on a token
   * refresh. */
  getMetadata(): TMeta | undefined
  /** Forward incoming WS message data here (string-decoded). Buffered until
   * `ready` resolves, then forwarded to the room. */
  onMessage(data: string): void
  /** Call when the WS closes. */
  onClose(): void
  /** Call when the WS errors. */
  onError(): void
}

export class ConnectRequestError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing-room-id' | 'missing-client-id' | 'missing-token' | 'invalid-url',
  ) {
    super(message)
    this.name = 'ConnectRequestError'
  }
}

/** Rejection reason for `Connection.ready` when the socket closed before the
 * connection finished authorizing/loading. Not an error condition — the
 * session (if any) is cleaned up and there's nothing for the caller to do. */
export class ConnectionClosedError extends Error {
  constructor() {
    super('Socket closed before the connection was ready')
    this.name = 'ConnectionClosedError'
  }
}

/**
 * Register a connection and return a handle the caller forwards WS events into.
 *
 * Returns **synchronously** so the caller can wire its socket's message
 * listener in the same tick the socket opens — closing the window where a
 * client's first frame (`reconnect`, sent immediately on open) would be dropped
 * while authorize + room-load are still running. Frames forwarded via
 * `onMessage` before {@link Connection.ready} resolves are buffered and replayed
 * in order. Auth/URL failures surface as a `ready` rejection (not a throw), so
 * close the socket from `ready.catch`.
 */
export function acceptConnection<TRequest = unknown, TMeta = unknown>(
  options: AcceptConnectionOptions<TRequest, TMeta>,
): Connection<TMeta> {
  const { socket, url, request, manager, authorize, roomOptions } = options

  // Buffer frames until the room is wired. `dispatch` is null while we're still
  // authorizing/loading; once ready it forwards straight to the room.
  const pending: string[] = []
  let dispatch: ((data: string) => void) | null = null
  let onCloseImpl: (() => void) | null = null
  let onErrorImpl: (() => void) | null = null
  let closed = false
  let room: Room | undefined
  let sessionId: string | undefined

  const ready = (async (): Promise<ConnectionReady> => {
    const { roomId, clientId, token } = parseConnectUrl(url)
    const result = await authorize({ roomId, clientId, token, request })

    // Only build the room options for the first connect to this roomId —
    // RoomManager ignores options on subsequent calls anyway, but the
    // factory may do real work (storage setup, etc.) that we don't want
    // to redo per connect.
    const isFirstConnect = manager.getExistingRoom(roomId) === undefined
    const r = await manager.getOrCreateRoom(
      roomId,
      isFirstConnect
        ? {
            ...(roomOptions?.(roomId) ?? {}),
            onTokenRefresh: async (_, info) =>
              // `request` is connect-time only — refresh frames carry only
              // the new token. Authorize policy that needs request-time
              // data should encode it into the token claims at mint time.
              authorize({
                roomId,
                clientId: info.clientId,
                token: info.token,
                request: undefined,
              }),
          }
        : {},
    )

    const sid = r.handleSocketConnect({
      socket,
      clientId,
      permissions: result.permissions,
      metadata: result.metadata,
    })

    room = r
    sessionId = sid
    dispatch = (data) => r.handleSocketMessage(sid, data)
    onCloseImpl = () => r.handleSocketClose(sid)
    onErrorImpl = () => r.handleSocketError(sid)

    // The socket may have closed during authorize/load. The early onClose()
    // was a no-op then (no session existed yet), so clean up the session we
    // just registered and drop the buffered frames — there's nobody to serve.
    if (closed) {
      r.handleSocketClose(sid)
      throw new ConnectionClosedError()
    }

    // Replay anything that arrived while we were authorizing/loading, in order.
    for (const data of pending) dispatch(data)
    pending.length = 0

    return { room: r, sessionId: sid }
  })()

  return {
    ready,
    getMetadata: () =>
      room !== undefined && sessionId !== undefined
        ? (room.getSessionMetadata(sessionId) as TMeta | undefined)
        : undefined,
    onMessage: (data) => {
      if (dispatch) dispatch(data)
      else if (!closed) pending.push(data)
    },
    onClose: () => {
      closed = true
      onCloseImpl?.()
    },
    onError: () => {
      closed = true
      onErrorImpl?.()
    },
  }
}

/**
 * Pull the wire-protocol query parameters out of the connect URL.
 * Accepts a full URL or a `req.url`-style path-and-query.
 */
export function parseConnectUrl(input: string): { roomId: string; clientId: string; token: string } {
  let parsed: URL
  try {
    // Use a dummy base for path-only inputs (e.g. `/?roomId=...`); a full
    // URL passes through unchanged.
    parsed = new URL(input, 'http://_')
  } catch {
    throw new ConnectRequestError(`Could not parse connect URL: ${input}`, 'invalid-url')
  }

  const roomId = parsed.searchParams.get('roomId') ?? ''
  const clientId = parsed.searchParams.get('clientId') ?? ''
  const token = parsed.searchParams.get('token') ?? ''

  if (!roomId) throw new ConnectRequestError('Missing roomId query parameter', 'missing-room-id')
  if (!clientId) throw new ConnectRequestError('Missing clientId query parameter', 'missing-client-id')
  if (!token) throw new ConnectRequestError('Missing token query parameter', 'missing-token')

  return { roomId, clientId, token }
}
