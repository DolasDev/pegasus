import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts'],
    // Use forked processes instead of worker threads so that CDK's NodejsFunction
    // can spawn esbuild child processes. Turbo wraps npm scripts in a context
    // where process.stdout is a WritableWorkerStdio, which is incompatible with
    // child_process.spawn's stdio option. Running vitest tests in forked child
    // processes gives each test file a real writable stdout stream.
    pool: 'forks',
  },
})
