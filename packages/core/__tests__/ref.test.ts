import { describe, expect, it } from 'vitest'
import { addComponent, createEntity, defineComponent, field, getBackrefs, removeEntity, World } from '../src'

describe('Ref Field', () => {
  describe('Basic Ref Operations', () => {
    it('should create a component with a ref field', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId })
      const child = Child.read(ctx, childId)

      expect(child.parent).toBe(parentId)
    })

    it('should default to null', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const childId = createEntity(ctx)
      addComponent(ctx, childId, Child, {})
      const child = Child.read(ctx, childId)

      expect(child.parent).toBeNull()
    })

    it('should allow setting ref to null', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId })
      expect(Child.read(ctx, childId).parent).toBe(parentId)

      Child.write(ctx, childId).parent = null
      expect(Child.read(ctx, childId).parent).toBeNull()
    })

    it('should allow changing ref to another entity', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parent1 = createEntity(ctx)
      const parent2 = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parent1 })
      expect(Child.read(ctx, childId).parent).toBe(parent1)

      Child.write(ctx, childId).parent = parent2
      expect(Child.read(ctx, childId).parent).toBe(parent2)
    })

    it('should support multiple ref fields', () => {
      const Friendship = defineComponent({
        a: field.ref(),
        b: field.ref(),
      })
      const world = new World([Friendship])
      const ctx = world._getContext()

      const person1 = createEntity(ctx)
      const person2 = createEntity(ctx)
      const friendshipId = createEntity(ctx)

      addComponent(ctx, friendshipId, Friendship, { a: person1, b: person2 })
      const friendship = Friendship.read(ctx, friendshipId)

      expect(friendship.a).toBe(person1)
      expect(friendship.b).toBe(person2)
    })
  })

  describe('Lazy Validation (nullify on read)', () => {
    it('should return null when referenced entity is deleted', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const Parent = defineComponent({
        name: field.string().max(50),
      })
      const world = new World([Child, Parent])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      addComponent(ctx, parentId, Parent, { name: 'Parent' })

      const childId = createEntity(ctx)
      addComponent(ctx, childId, Child, { parent: parentId })

      expect(Child.read(ctx, childId).parent).toBe(parentId)

      // Delete the parent
      removeEntity(ctx, parentId)

      // Child's ref should now be null when read (lazy validation)
      expect(Child.read(ctx, childId).parent).toBeNull()
    })

    it('should nullify multiple refs to the same deleted entity on read', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const child1 = createEntity(ctx)
      const child2 = createEntity(ctx)
      const child3 = createEntity(ctx)

      addComponent(ctx, child1, Child, { parent: parentId })
      addComponent(ctx, child2, Child, { parent: parentId })
      addComponent(ctx, child3, Child, { parent: parentId })

      removeEntity(ctx, parentId)

      // All refs should return null when read
      expect(Child.read(ctx, child1).parent).toBeNull()
      expect(Child.read(ctx, child2).parent).toBeNull()
      expect(Child.read(ctx, child3).parent).toBeNull()
    })

    it('should persist the nullification after first read', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId })
      removeEntity(ctx, parentId)

      // First read triggers lazy nullification
      expect(Child.read(ctx, childId).parent).toBeNull()

      // Second read should also be null (stored value was updated)
      expect(Child.read(ctx, childId).parent).toBeNull()
    })

    it('should handle writable access with dead refs', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const newParentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId })
      removeEntity(ctx, parentId)

      // Read via writable should also return null
      expect(Child.write(ctx, childId).parent).toBeNull()

      // Should be able to set a new valid ref
      Child.write(ctx, childId).parent = newParentId
      expect(Child.read(ctx, childId).parent).toBe(newParentId)
    })
  })

  describe('Edge Cases', () => {
    it('should handle self-referencing entity', () => {
      const Node = defineComponent({
        next: field.ref(),
      })
      const world = new World([Node])
      const ctx = world._getContext()

      const nodeId = createEntity(ctx)
      addComponent(ctx, nodeId, Node, { next: nodeId })

      expect(Node.read(ctx, nodeId).next).toBe(nodeId)

      // Deleting should not cause infinite loop
      removeEntity(ctx, nodeId)
      expect(ctx.entityBuffer.has(nodeId)).toBe(false)
    })

    it('should handle circular refs', () => {
      const Node = defineComponent({
        next: field.ref(),
      })
      const world = new World([Node])
      const ctx = world._getContext()

      const node1 = createEntity(ctx)
      const node2 = createEntity(ctx)

      addComponent(ctx, node1, Node, { next: node2 })
      addComponent(ctx, node2, Node, { next: node1 })

      // Delete node1
      removeEntity(ctx, node1)

      expect(ctx.entityBuffer.has(node1)).toBe(false)
      expect(ctx.entityBuffer.has(node2)).toBe(true)

      // node2's ref to node1 should now be null (lazy validation)
      expect(Node.read(ctx, node2).next).toBeNull()
    })

    it('should handle deletion of entity without any refs to it', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const loneEntity = createEntity(ctx)
      const childId = createEntity(ctx)
      addComponent(ctx, childId, Child, { parent: null })

      // Should delete without issues
      removeEntity(ctx, loneEntity)
      expect(ctx.entityBuffer.has(loneEntity)).toBe(false)
    })

    it('should handle chain of refs where middle entity is deleted', () => {
      const Node = defineComponent({
        next: field.ref(),
      })
      const world = new World([Node])
      const ctx = world._getContext()

      const node1 = createEntity(ctx)
      const node2 = createEntity(ctx)
      const node3 = createEntity(ctx)

      addComponent(ctx, node1, Node, { next: node2 })
      addComponent(ctx, node2, Node, { next: node3 })
      addComponent(ctx, node3, Node, { next: null })

      // Delete middle node
      removeEntity(ctx, node2)

      // node1's ref should be null now
      expect(Node.read(ctx, node1).next).toBeNull()
      // node3 should still be valid
      expect(ctx.entityBuffer.has(node3)).toBe(true)
      expect(Node.read(ctx, node3).next).toBeNull()
    })

    it('should detect stale refs after entity ID recycling', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child], { maxEntities: 10 })
      const ctx = world._getContext()

      // Create parent and child with ref
      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)
      addComponent(ctx, childId, Child, { parent: parentId })

      expect(Child.read(ctx, childId).parent).toBe(parentId)

      // Delete the parent - this frees the ID for reuse
      removeEntity(ctx, parentId)
      ctx.pool.free(parentId)

      // Create a new entity - it should get the recycled ID
      const newEntityId = createEntity(ctx)
      expect(newEntityId).toBe(parentId) // Same ID, but different entity

      // The child's ref should be null because generation changed
      expect(Child.read(ctx, childId).parent).toBeNull()
    })

    it('should correctly reference new entity after ID recycling', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child], { maxEntities: 10 })
      const ctx = world._getContext()

      // Create and delete an entity to recycle its ID
      const oldParentId = createEntity(ctx)
      removeEntity(ctx, oldParentId)
      ctx.pool.free(oldParentId)

      // Create a new entity with recycled ID
      const newParentId = createEntity(ctx)
      expect(newParentId).toBe(oldParentId)

      // Create a child and set ref to the new entity
      const childId = createEntity(ctx)
      addComponent(ctx, childId, Child, { parent: newParentId })

      // Ref should be valid because we set it after the new entity was created
      expect(Child.read(ctx, childId).parent).toBe(newParentId)
    })
  })

  describe('Snapshot with Ref Fields', () => {
    it('should return unpacked entity ID in snapshot, not packed value', () => {
      const Child = defineComponent({
        parent: field.ref(),
        name: field.string().max(50),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId, name: 'child' })

      // Snapshot should return the actual entity ID, not the packed ref value
      const snapshot = Child.snapshot(ctx, childId)

      expect(snapshot.parent).toBe(parentId)
      expect(snapshot.name).toBe('child')
      // The packed value would be much larger due to generation bits
      // e.g., parentId=0 with generation=1 would be 0x2000000 (33554432)
      expect(typeof snapshot.parent).toBe('number')
    })

    it('should return null in snapshot for null refs', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const childId = createEntity(ctx)
      addComponent(ctx, childId, Child, { parent: null })

      const snapshot = Child.snapshot(ctx, childId)
      expect(snapshot.parent).toBeNull()
    })

    it('should return null in snapshot for deleted entity refs', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId })
      removeEntity(ctx, parentId)

      // Snapshot should return null for the stale ref
      const snapshot = Child.snapshot(ctx, childId)
      expect(snapshot.parent).toBeNull()
    })

    it('should correctly snapshot after writing ref back from snapshot', () => {
      // This tests the round-trip: snapshot -> modify -> write back
      const Child = defineComponent({
        parent: field.ref(),
        value: field.float64(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parentId, value: 42 })

      // Take snapshot
      const snapshot = Child.snapshot(ctx, childId)
      expect(snapshot.parent).toBe(parentId)

      // Write snapshot values back (simulating state machine pattern)
      const writable = Child.write(ctx, childId)
      writable.parent = snapshot.parent
      writable.value = snapshot.value + 1

      // Verify the ref is still valid
      expect(Child.read(ctx, childId).parent).toBe(parentId)
      expect(Child.read(ctx, childId).value).toBe(43)
    })
  })

  describe('getBackrefs', () => {
    it('should return empty array when no refs point to entity', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)

      const backrefs = getBackrefs(ctx, parentId, Child, 'parent')
      expect(backrefs).toEqual([])
    })

    it('should return entities that reference the target', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const child1 = createEntity(ctx)
      const child2 = createEntity(ctx)
      const child3 = createEntity(ctx)

      addComponent(ctx, child1, Child, { parent: parentId })
      addComponent(ctx, child2, Child, { parent: parentId })
      addComponent(ctx, child3, Child, { parent: null }) // No parent

      const backrefs = getBackrefs(ctx, parentId, Child, 'parent')
      expect(backrefs).toHaveLength(2)
      expect(backrefs).toContain(child1)
      expect(backrefs).toContain(child2)
      expect(backrefs).not.toContain(child3)
    })

    it('should work with multiple ref fields', () => {
      const Friendship = defineComponent({
        personA: field.ref(),
        personB: field.ref(),
      })
      const world = new World([Friendship])
      const ctx = world._getContext()

      const alice = createEntity(ctx)
      const bob = createEntity(ctx)
      const charlie = createEntity(ctx)

      const friendship1 = createEntity(ctx)
      const friendship2 = createEntity(ctx)

      addComponent(ctx, friendship1, Friendship, {
        personA: alice,
        personB: bob,
      })
      addComponent(ctx, friendship2, Friendship, {
        personA: alice,
        personB: charlie,
      })

      // Alice is personA in both friendships
      const aliceAsA = getBackrefs(ctx, alice, Friendship, 'personA')
      expect(aliceAsA).toHaveLength(2)
      expect(aliceAsA).toContain(friendship1)
      expect(aliceAsA).toContain(friendship2)

      // Alice is not personB in any friendship
      const aliceAsB = getBackrefs(ctx, alice, Friendship, 'personB')
      expect(aliceAsB).toHaveLength(0)

      // Bob is personB in one friendship
      const bobAsB = getBackrefs(ctx, bob, Friendship, 'personB')
      expect(bobAsB).toHaveLength(1)
      expect(bobAsB).toContain(friendship1)
    })

    it('should not include deleted entities', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parentId = createEntity(ctx)
      const child1 = createEntity(ctx)
      const child2 = createEntity(ctx)

      addComponent(ctx, child1, Child, { parent: parentId })
      addComponent(ctx, child2, Child, { parent: parentId })

      // Delete child1
      removeEntity(ctx, child1)

      const backrefs = getBackrefs(ctx, parentId, Child, 'parent')
      expect(backrefs).toHaveLength(1)
      expect(backrefs).toContain(child2)
      expect(backrefs).not.toContain(child1)
    })

    it('should update when refs change', () => {
      const Child = defineComponent({
        parent: field.ref(),
      })
      const world = new World([Child])
      const ctx = world._getContext()

      const parent1 = createEntity(ctx)
      const parent2 = createEntity(ctx)
      const childId = createEntity(ctx)

      addComponent(ctx, childId, Child, { parent: parent1 })

      expect(getBackrefs(ctx, parent1, Child, 'parent')).toContain(childId)
      expect(getBackrefs(ctx, parent2, Child, 'parent')).not.toContain(childId)

      // Change parent
      Child.write(ctx, childId).parent = parent2

      expect(getBackrefs(ctx, parent1, Child, 'parent')).not.toContain(childId)
      expect(getBackrefs(ctx, parent2, Child, 'parent')).toContain(childId)
    })

    it('should handle self-referencing entity', () => {
      const Node = defineComponent({
        next: field.ref(),
      })
      const world = new World([Node])
      const ctx = world._getContext()

      const nodeId = createEntity(ctx)
      addComponent(ctx, nodeId, Node, { next: nodeId })

      const backrefs = getBackrefs(ctx, nodeId, Node, 'next')
      expect(backrefs).toHaveLength(1)
      expect(backrefs).toContain(nodeId)
    })
  })
})
