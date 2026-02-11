/**
 * Minimal WebSocket interface so we aren't tied to any library.
 * Compatible with the `ws` package, browser WebSocket, Bun, and most runtimes.
 */
export interface WebSocketLike {
  send(data: string): void
  close(): void
}
