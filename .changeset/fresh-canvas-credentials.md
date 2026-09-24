---
"@woven-ecs/canvas-store": major
---

Replace the websocket `token` option and `setToken()` methods with `getCredentials: () => Promise<WebsocketCredentials>`.

Return `{ token, expiresAt? }`, where `expiresAt` is Unix seconds. The store fetches credentials before each connection, refreshes expiring credentials on an open socket, and retries failures with backoff. Throw `WebsocketCredentialError(message, retryAfterMs)` to specify a minimum retry delay. Call `disconnect()` explicitly to stop connection attempts; late credential responses and socket events cannot restart a disconnected connection.

Migrate static tokens to `getCredentials: async () => ({ token })`. For expiring tokens, fetch fresh credentials in the callback and include `expiresAt` instead of calling `setToken()` from application timers. After an identity change, call `connect()` to request credentials again.
