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
    // A full-stack CDK synth is CPU-bound and runs inside the test body, and the
    // 5s default was never a considered budget for it. aws-cdk-lib 2.267 /
    // constructs 10.8.1 synthesize ~2.5x slower than 2.261 / 10.4.2 (first synth
    // in a file 221ms -> 930ms, measured serially), which is fine on CI but not
    // when `pool: 'forks'` fans out across a 12-core dev box while turbo runs 15
    // package tasks at once — the contention pushed the first test of several
    // files past 5s locally while the same commit stayed green on CI. These
    // assertions are about template shape, never latency, so give them room
    // instead of letting core count decide whether the suite is green.
    testTimeout: 30_000,
  },
})
