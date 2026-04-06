import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
    globalSetup: './vitest.global-setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@pegasus/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
    },
  },
})
