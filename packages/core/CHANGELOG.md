# @woven-ecs/core

## 1.0.7

### Patch Changes

- b8638f1: Preserve the entity generation counter when a removed entity's ID is reclaimed. `EntityBuffer.delete` used to zero the whole slot, so a reused ID came back with the same generation as its previous occupant and stale `field.ref()` values resolved to the new entity instead of reading as null.

## 1.0.6

### Patch Changes

- a69e1b3: Fix element writes on writable boolean/string/binary tuple fields being silently lost.

  `write()` views of non-number tuples returned a detached copy, so `view.flags[0] = false` mutated a throwaway array while the buffer kept its old value — and the `[boolean, boolean]` typing gave no warning. Number tuples were unaffected (they return a live typed-array subarray), which made the asymmetry easy to miss.

  Writable non-number tuples now return a write-through proxy (same approach as `field.array`): element reads/writes go straight to the buffer, iteration and non-mutating array methods work, and length-preserving mutators (`reverse`, `sort`, `fill`, `copyWithin`) persist. Length-changing methods (`push`, `pop`, `shift`, `unshift`, `splice`) throw a `TypeError` instead of silently corrupting fixed-length data. Out-of-range element writes are ignored, matching array fields.

  Number tuples keep their zero-allocation subarray fast path — no proxy overhead on hot paths like position/size. Whole-tuple assignment (`view.flags = [false, false]`) is unchanged.
