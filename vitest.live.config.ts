import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Config des tests « live » (appels réels API) :
//   npx vitest run -c vitest.live.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
  },
})
