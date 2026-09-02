---
"@woven-ecs/core": patch
---

Preserve the entity generation counter when a removed entity's ID is reclaimed. `EntityBuffer.delete` used to zero the whole slot, so a reused ID came back with the same generation as its previous occupant and stale `field.ref()` values resolved to the new entity instead of reading as null.
