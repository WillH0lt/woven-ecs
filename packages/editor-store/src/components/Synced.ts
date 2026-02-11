import { defineComponent, field } from '@woven-ecs/core'

export const Synced = defineComponent({
  id: field.string().max(36),
})
