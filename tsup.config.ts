import { defineConfig } from 'tsup'

export default defineConfig({
  sourcemap: true,
  experimentalDts: true,
  minify: false,
  format: ['esm', 'cjs'],
  outDir: 'build'
})
