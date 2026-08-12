import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
    globalSetup: './vitest.global-setup.ts',
    // Loud banner when entire test files skip (DB-dependent suites without
    // Postgres) — see vitest.skip-reporter.ts. Setting `reporters` explicitly
    // disables Vitest's auto-enabled github-actions annotations reporter, so
    // re-add it when running in GHA (mirrors Vitest's own default logic).
    reporters: [
      'default',
      ...(process.env['GITHUB_ACTIONS'] === 'true' ? ['github-actions' as const] : []),
      './vitest.skip-reporter.ts',
    ],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 92.14,
        branches: 79.54,
        functions: 88.61,
        statements: 90.79,
        autoUpdate: true,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: '@pegasus/domain',
        replacement: path.resolve(__dirname, '../../packages/domain/src/index.ts'),
      },
    ],
  },
})
