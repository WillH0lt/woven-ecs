/**
 * Wire protocol version. Bump this when the message format between
 * client and server changes in a backwards-incompatible way.
 *
 * v2: buffer fields may be sent as sparse deltas (see `bufferDelta.ts`).
 */
export const PROTOCOL_VERSION = 2
