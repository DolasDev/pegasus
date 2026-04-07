import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
    globalSetup: './vitest.global-setup.ts',
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: [
      {
        find: '@pegasus/domain',
        replacement: path.resolve(__dirname, '../../packages/domain/src/index.ts'),
      },
      {
        find: /^@prisma\/client$/,
        replacement: path.resolve(__dirname, 'src/generated/prisma/client.ts'),
      },
    ],
  },
})
