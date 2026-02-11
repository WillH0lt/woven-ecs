import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    conditions: ['@woven-ecs/source'],
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
