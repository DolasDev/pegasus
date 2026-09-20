/**
 * Conformance — **the glossary is generated, and this is what stops it drifting.**
 *
 * The ubiquitous-language document was deliberately not hand-written. Names already live in the
 * types and definitions already live in the JSDoc beside them, so a third hand-maintained copy
 * would be a third place to be wrong — the same defect [SD §1.1] deletes the generic `correlation`
 * bag for, and the same one [SD §4.7.2e] records when a binding document specified a record that
 * could not be published and nothing checked.
 *
 * So `docs/domain-reference/glossary.md` is generated from `src/`, and this test regenerates it
 * **in memory** and compares. A committed file that does not match the code is a failure, and the
 * failure names the command that fixes it.
 *
 * ## Why this test does I/O when the package does not
 *
 * `src/` reads no file. The generator does, because it must read the source text, the shipped data
 * tables and the analysis documents' headings; it therefore lives in `tools/`, outside `src/`, and
 * this test reads one file to compare against it. Nothing in `src/` depends on either.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  GLOSSARY_COMMAND,
  GLOSSARY_FILE,
  GLOSSARY_REPO_PATH,
  generateGlossary,
} from '../../tools/generate-glossary'

/**
 * These suites drive the TypeScript compiler API to regenerate the glossary, which takes seconds,
 * not milliseconds — and a CI runner is slower than a workstation. vitest's default 5s timeout
 * passed locally and timed out in CI (PR #712), which is the wrong way round: the machine that
 * gates the branch was the one that could not run the check. The budget is generous on purpose —
 * it exists to stop a hang, not to police how fast tsc is.
 */
const COMPILER_TIMEOUT_MS = 120_000

/**
 * The first line that differs, with a little context.
 *
 * A staleness test whose output is "expected a 92kB string to equal a 92kB string" is half a test:
 * the reader is back to diffing by hand, which is the cost this file exists to remove. Same
 * discipline as `documents.test.ts` — every failure locates the drift.
 */
function firstDifference(generated: string, committed: string): string {
  const left = generated.split('\n')
  const right = committed.split('\n')
  const limit = Math.max(left.length, right.length)
  for (let line = 0; line < limit; line += 1) {
    if (left[line] === right[line]) continue
    return [
      `first difference at ${GLOSSARY_REPO_PATH}:${line + 1}`,
      `  committed: ${JSON.stringify(right[line] ?? '<end of file>')}`,
      `  generated: ${JSON.stringify(left[line] ?? '<end of file>')}`,
      '',
      `The glossary is generated. Do not edit it by hand — run \`${GLOSSARY_COMMAND}\`,`,
      'or, if the definition itself is wrong, fix the JSDoc in `src/` and regenerate.',
    ].join('\n')
  }
  return 'the files differ only in trailing content'
}

describe('the generated glossary', () => {
  it(
    'is committed in the state the generator produces',
    () => {
      const generated = generateGlossary()
      const committed = readFileSync(GLOSSARY_FILE, 'utf8')
      if (generated !== committed) {
        throw new Error(
          `\`${GLOSSARY_REPO_PATH}\` is stale.\n\n${firstDifference(generated, committed)}`,
        )
      }
      expect(generated).toBe(committed)
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'regenerates identically — the output is a function of the code and nothing else',
    () => {
      // Byte-order sorting, not locale, and no clock, hostname or working directory in the output.
      // A generated file that is not reproducible turns its own staleness gate into noise.
      expect(generateGlossary()).toBe(generateGlossary())
    },
    COMPILER_TIMEOUT_MS,
  )

  it('carries the do-not-edit header, naming the generator and the command', () => {
    const committed = readFileSync(GLOSSARY_FILE, 'utf8')
    expect(committed).toContain('GENERATED FILE — DO NOT EDIT BY HAND')
    expect(committed).toContain('packages/domain-reference/tools/generate-glossary.ts')
    expect(committed).toContain(GLOSSARY_COMMAND)
  })
})
