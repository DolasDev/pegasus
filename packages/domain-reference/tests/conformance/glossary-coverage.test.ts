/**
 * Conformance — **the disclosure rule, mechanised.**
 *
 * This package's README states the rule in one sentence: "Every rule in `src/` cites the section
 * that decided it. A rule with no citation and no `[ORIGINAL]` marker is a defect: the documents'
 * disclosure rule applies here too." [SD §0] is where it comes from — "where a source supports only
 * part of a rule, the supported part and the authored part are separated".
 *
 * Up to now that was a sentence a reviewer had to enforce by reading. Here it is a check: **every
 * term the glossary covers must have a docstring, and that docstring must carry either a citation
 * or an explicit `[ORIGINAL]` / `[SYNTHESIS]` marker.**
 *
 * ## What it deliberately does not do
 *
 * It does not auto-fix. A generator that invented a citation to silence its own gate would be doing
 * the one thing [SD §0] forbids, and a marker added to make a test pass is a marker that means
 * nothing. Failures are reported, with the symbol and the file, and the repair is a real docstring.
 *
 * ## What "a citation" means here
 *
 * A reference to a document in the authority chain (`[SD §x]`, `[A8 §x]`, `[A3 §x]`,
 * `[fork-order]`, `[fork-time]`, `[F1]`, the review rounds, `findings-from-alloy`), a corpus
 * reference (`` `src:…` ``), or a regulation citation (`§375.503`, `§B.3.f`). Those are the three
 * forms the documents themselves use.
 */
import { describe, expect, it } from 'vitest'

import {
  GLOSSARY_COMMAND,
  collectDisclosureFailures,
  type DisclosureFailure,
} from '../../tools/generate-glossary'

/**
 * These suites drive the TypeScript compiler API to regenerate the glossary, which takes seconds,
 * not milliseconds — and a CI runner is slower than a workstation. vitest's default 5s timeout
 * passed locally and timed out in CI (PR #712), which is the wrong way round: the machine that
 * gates the branch was the one that could not run the check. The budget is generous on purpose —
 * it exists to stop a hang, not to police how fast tsc is.
 */
const COMPILER_TIMEOUT_MS = 120_000

function report(failures: readonly DisclosureFailure[]): string {
  return failures
    .map(
      (failure) =>
        `  ${failure.category} \`${failure.term}\`: ${failure.problem}\n` +
        `    declared by \`${failure.declaredBy}\` in ${failure.file}`,
    )
    .join('\n')
}

describe('[SD §0] disclosure, over every term the glossary covers', () => {
  it(
    'every covered term has a docstring carrying a citation or an explicit marker',
    () => {
      const failures = collectDisclosureFailures()
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} term(s) fail the disclosure rule. Write a docstring — do not weaken ` +
            `this check, and do not invent a citation to silence it ([SD §0]).\n\n${report(failures)}\n\n` +
            `After fixing, regenerate the glossary: \`${GLOSSARY_COMMAND}\`.`,
        )
      }
      expect(failures).toEqual([])
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'the gate is live — it reads real symbols, so it can report a real failure',
    () => {
      // The check is only worth having if it is capable of failing. `collectDisclosureFailures`
      // resolves every term through `checker.getExportsOfModule` over `src/index.ts`, so a term that
      // stops being exported throws rather than quietly dropping out of the glossary — which is the
      // half of the guarantee an "expect([]).toEqual([])" assertion cannot show on its own.
      expect(typeof collectDisclosureFailures).toBe('function')
      expect(collectDisclosureFailures()).toBeInstanceOf(Array)
    },
    COMPILER_TIMEOUT_MS,
  )
})
