import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './vitest.global-setup.ts',
  },
  resolve: {
    alias: {
      '@pegasus/domain': path.resolve(__dirname, '../domain/src/index.ts'),
    },
  },
})
