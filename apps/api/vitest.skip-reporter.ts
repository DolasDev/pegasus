/**
 * Loud-skip reporter — makes silently-skipped test files impossible to miss.
 *
 * The DB-dependent integration suites guard with `describe.skipIf(!hasDb)`
 * (hasDb = Boolean(process.env['DATABASE_URL'])). When Postgres/Docker is
 * unavailable, those suites skip and the run still exits 0 — a green run that
 * never exercised the repository layer. CI is protected by the fail-fast guard
 * in vitest.global-setup.ts; this reporter covers local runs by printing a
 * loud red banner whenever entire test files were skipped.
 *
 * Vitest 4 reporter API (`onTestRunEnd`); wired in vitest.config.ts via
 * `reporters: ['default', './vitest.skip-reporter.ts']`.
 */

import type { Reporter, TestModule } from 'vitest/node'

const RED_BOLD = '\x1b[1;31m'
const RESET = '\x1b[0m'

export default class SkipReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    let skippedModules = 0
    let skippedTests = 0

    for (const module of testModules) {
      const tests = [...module.children.allTests()]
      const skippedInModule = tests.filter((t) => t.result().state === 'skipped').length
      skippedTests += skippedInModule
      // A module counts as skipped when Vitest marks the whole file skipped,
      // or when every test it collected ended up skipped (e.g. a top-level
      // `describe.skipIf` wrapping the entire file).
      if (module.state() === 'skipped' || (tests.length > 0 && skippedInModule === tests.length)) {
        skippedModules += 1
      }
    }

    if (skippedModules === 0) return

    const lines = [
      '',
      '════════════════════════════════════════════════════════════════════',
      `⚠  ${skippedModules} test file${skippedModules === 1 ? '' : 's'} SKIPPED entirely (${skippedTests} skipped tests in total).`,
      '   These are the DB-dependent suites — this run did NOT exercise the',
      '   repository layer. Start Docker (docker compose up -d postgres) or',
      '   set DATABASE_URL to run them.',
      '════════════════════════════════════════════════════════════════════',
      '',
    ]
    console.error(`${RED_BOLD}${lines.join('\n')}${RESET}`)
  }
}
