---
"@woven-ecs/canvas-store": minor
---

Add `seedRoom` and `readPersistedDocument` for one-shot seeding of a server room from a local/offline document — e.g. adopting an anonymous, IndexedDB-only draft into a server-backed room on sign-in. `seedRoom` connects, sends the document as a single `patch`, and resolves once the server acks it; `readPersistedDocument` reads the persisted document for an id without standing up a `CanvasStore`.
