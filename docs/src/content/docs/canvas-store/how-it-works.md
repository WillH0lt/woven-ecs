---
title: How It Works
description: Understand the architecture and data flow of Canvas Store
---

Canvas Store sits between your ECS world and three subsystems: **persistence** (IndexedDB), **history** (undo/redo), and **network** (WebSocket sync). Each frame, it captures changes from the world and routes them to the appropriate subsystems based on each component's sync behavior.

## Local-First Architecture

Canvas Store uses a local-first architecture inspired by [Figma's multiplayer system](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/). Changes are applied locally first, then synced to the server when connected. This makes the app feel instant and work fully offline.

### Last-Writer-Wins Conflict Resolution

When two clients change the same field on the same entity simultaneously, the last write to reach the server wins.

The server maintains a simple counter that increments with each change, the timestamps are tracked **per-field**:

```
Server state:
{
  "timestamp": 14,
  "state": {
    "57d7ab01-341d-4b48-94b8-c213c1a2df64/block": {
      "tag": "text",
      "position": [679.999, 940.000],
      "size": [42.468, 28.791],
      "rotateZ": 0,
      "flip": [false, false],
      "rank": "auAOc",
      "_exists": true,
      "_version": null
    },
  },
  "timestamps": {
    "57d7ab01-341d-4b48-94b8-c213c1a2df64/block": {
      "tag": 1,
      "position": 14,
      "size": 12,
      "rotateZ": 1,
      "flip": 12,
      "rank": 1, 
      "_exists": 1,
      "_version": 1
    },
  }
}
```

When a client sends changes, the server increments its counter and assigns that timestamp to each modified field. When broadcasting to other clients, the server includes its current timestamp so clients can cache it in case they go offline.

### Efficient Resync

When working offline the clients cache their local changes in an offline buffer. These changes are a patch that can be applied on top of the last known server state when reconnecting.

Clients track the latest timestamp they've received from the server. When reconnecting after being offline, the client sends the last known timestamp:

On reconnect:
```
Client → Server: {
  lastTimestamp: number
  patch: <client's offline changes since lastTimestamp>
}

Server: 
  Finds all fields with timestamp > lastTimestamp
  builds a patch to get the client back to the current server state

Server → Client: {
  timestamp: number
  patch: <server's changes since lastTimestamp>
}

Server → other clients: {
  timestamp: number
  patch: <changes sent by reconnecting client>
}
```

This makes reconnection efficient -- clients only download what changed while they were away, not the entire document.
