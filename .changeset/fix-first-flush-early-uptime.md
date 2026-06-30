---
"@woven-ecs/canvas-store": patch
---

Fix the first patch send being delayed when editing within the first second of page load. `WebsocketAdapter` gated its first flush on `performance.now() - lastSendTime >= sendInterval`, but `lastSendTime` started at `0` and `performance.now()` is relative to page/process start — so an edit made in the first second after load sat buffered until a later send. `lastSendTime` now starts at `-Infinity`, so the first push always flushes immediately; throttling resumes as before afterward.
