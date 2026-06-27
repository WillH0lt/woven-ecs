import { openStore } from './storage'
import type { ClientMessage, Patch, ServerMessage } from './types'

/**
 * Read the locally-persisted document for `documentId` and return it as a single
 * patch — the same store the {@link PersistenceAdapter} writes (db name =
 * `documentId`, object store `state`, keys `"<stableId>/<componentName>"`).
 *
 * Returns `{}` when no persisted state exists. Does not create the database when
 * the environment can tell us it is absent (`indexedDB.databases()`), so probing
 * an unknown id does not litter an empty database.
 */
export async function readPersistedDocument(documentId: string): Promise<Patch> {
  if (typeof indexedDB === 'undefined') return {}
  // Avoid materializing the DB just to probe a non-existent document.
  if (typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases()
    if (dbs.length > 0 && !dbs.some((d) => d.name === documentId)) return {}
  }
  const store = await openStore(documentId, 'state')
  try {
    const entries = await store.getAllEntries()
    const patch: Patch = {}
    for (const [key, value] of entries) {
      if (value && typeof value === 'object') patch[key] = value as Patch[string]
    }
    return patch
  } finally {
    store.close()
  }
}

export interface SeedRoomOptions {
  /** WebSocket endpoint (the same `url` the editor connects to). */
  url: string
  /** Room id (the document / zine id). */
  roomId: string
  /** Auth token — must carry a write role for the server to apply the patch. */
  token: string
  /**
   * Document to push. When omitted, the locally-persisted document for
   * `documentId` (defaulting to `roomId`) is read via {@link readPersistedDocument}.
   */
  document?: Patch
  /** Persistence document id, when it differs from `roomId`. Defaults to `roomId`. */
  documentId?: string
  /** Client id for the connection. Defaults to a random UUID. */
  clientId?: string
  /** Give up (resolve `false`) after this many ms. Default 20000. */
  timeoutMs?: number
}

/**
 * Push a whole document into a server room over a one-shot WebSocket, without
 * standing up a {@link CanvasStore}.
 *
 * Connects, sends the document as a single `patch`, and resolves `true` once the
 * server acks it (the ack is sent after the server has applied the patch and
 * scheduled persistence). Resolves `false` on timeout, protocol-version
 * mismatch, or a connection error.
 *
 * Seeding an empty room is the intended use — adopting an offline / local-only
 * document into a server-backed room (e.g. an anonymous draft claimed on
 * sign-in). The server materializes each component value as-is, and other
 * clients consume it through the same inbound path that persistence restore
 * uses, so buffer fields (e.g. stroke point arrays) round-trip correctly.
 */
export async function seedRoom(options: SeedRoomOptions): Promise<boolean> {
  const { url, roomId, token, clientId = crypto.randomUUID(), documentId = roomId, timeoutMs = 20_000 } = options
  const document = options.document ?? (await readPersistedDocument(documentId))
  // Nothing to seed is success — the room is already as complete as the source.
  if (Object.keys(document).length === 0) return true

  return new Promise<boolean>((resolve) => {
    let ws: WebSocket
    let timer: ReturnType<typeof setTimeout>
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // already closing/closed
      }
      resolve(ok)
    }

    try {
      const u = new URL(url)
      u.searchParams.set('roomId', roomId)
      u.searchParams.set('clientId', clientId)
      u.searchParams.set('token', token)
      ws = new WebSocket(u.toString())
    } catch {
      resolve(false)
      return
    }

    timer = setTimeout(() => finish(false), timeoutMs)
    const messageId = `seed-${clientId}`

    ws.addEventListener('open', () => {
      const msg: ClientMessage = { type: 'patch', messageId, documentPatches: [document] }
      ws.send(JSON.stringify(msg))
    })
    ws.addEventListener('message', (event: MessageEvent) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as ServerMessage
      } catch {
        return
      }
      if (msg.type === 'ack' && msg.messageId === messageId) finish(true)
      else if (msg.type === 'version-mismatch') finish(false)
    })
    ws.addEventListener('error', () => finish(false))
    ws.addEventListener('close', () => finish(false))
  })
}
