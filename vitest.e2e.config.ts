import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cross-package end-to-end tests live in the repo-root __tests__ directory.
// Anchoring `include` here keeps this run from also picking up the per-package
// suites under packages/*/__tests__.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      root: __dirname,
      include: ['__tests__/**/*.test.ts'],
    },
  }),
)
