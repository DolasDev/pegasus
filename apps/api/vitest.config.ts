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
      // branches/functions dropped 0.01 each when #685 deleted the
      // trip-planning import_export whitelist: removing a COVERED branch and
      // covered config code lowers the ratio even though nothing became
      // untested — lines (92.33) and statements (91.06) are byte-identical to
      // the pre-change measurement. Re-pinned to measured; `autoUpdate` only
      // ever raises a floor, so a deletion has to be re-pinned by hand.
      thresholds: {
        lines: 92.37,
        branches: 80.26,
        functions: 89.06,
        statements: 91.11,
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
