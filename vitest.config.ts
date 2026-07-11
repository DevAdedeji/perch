import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // workspace packages export TS sources — alias them so vitest transforms them
    alias: {
      '@perch/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@perch/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts']
  }
})
