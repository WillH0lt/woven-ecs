export const Origin = {
  ECS: 1,
  History: 2,
  Persistence: 3,
  Websocket: 4,
} as const

export type Origin = (typeof Origin)[keyof typeof Origin]

/**
 * Wire protocol version. Bump this when the message format between
 * client and server changes in a backwards-incompatible way.
 */
export const PROTOCOL_VERSION = 1
