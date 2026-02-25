import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@pegasus/domain': path.resolve(__dirname, '../domain/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
})
