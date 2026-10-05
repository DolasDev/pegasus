/**
 * Conformance — **`fork-time` §(b)(5)'s three typed time primitives, and the fact that `src/`
 * publishes none of them.**
 *
 * The behavioural half of `time-value-shape-refuses.ts`, which holds the two **shape** claims at
 * compile time. This file holds the **absence** claim, and it exists in this form because the
 * compile-time version of it was a false green: `keyof typeof model` enumerates a module's value
 * namespace, all three primitives are type aliases, and a type alias has no `keyof`-able witness.
 * Tampered by exporting `LocalDateRange` from `primitives.ts`, the type-level assertion passed.
 *
 * So the absence of a **type** needs a reader, and reading `src/` as text is what a reader is.
 * `documents.test.ts` already reads the prose for the same reason the package cannot: `src/` imports
 * nothing from the repository, so a guard against drift between the code and a binding document has
 * to do the I/O in a test.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url))

/** Every `.ts` file under `src/`, path and text. `src/` has one level of subdirectory (`rules/`). */
function sources(dir = SRC_DIR, prefix = ''): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) return sources(at + '/', `${prefix}${entry.name}/`)
    if (!entry.name.endsWith('.ts')) return []
    return [{ file: `${prefix}${entry.name}`, text: readFileSync(at, 'utf8') }]
  })
}

const SOURCES = sources()

/**
 * `fork-time` §(b)(5) and §1's summary, verbatim as names:
 *
 * > "**TimeValue is typed, and the type is part of the contract:** `LocalDate` · `LocalDateRange`
 * > (the delivery spread) · `ZonedInstant` (instant **plus the IANA zone of the place the fact
 * > occurred**, not the publisher's). No bare ISO strings; no zoneless instants."
 */
const FORK_TIME_PRIMITIVES = ['LocalDate', 'LocalDateRange', 'ZonedInstant'] as const

describe('[fork-time §(b)(5)] the typed time primitives, recorded unadopted', () => {
  it('reads every module under `src/`, so the scan is not silently empty', () => {
    // A guard that extracts nothing passes forever. `src/` has modules at both levels and
    // `primitives.ts` is the one that would carry these, so both are asserted by name.
    expect(SOURCES.length).toBeGreaterThan(15)
    expect(SOURCES.map((s) => s.file)).toContain('primitives.ts')
    expect(SOURCES.some((s) => s.file.startsWith('rules/'))).toBe(true)
  })

  it('publishes none of the three', () => {
    // The inversion is the point, and it is `source-registry.test.ts`'s `[A9 §1]` pattern: the day a
    // round adopts one of these, this fails BY NAME and sends the reader back to amend the finding
    // in [SD §4.7] note 5 and in `time-value-shape-refuses.ts` rather than leaving a stale claim
    // standing. It is not an exemption list and it must never become one.
    const published = FORK_TIME_PRIMITIVES.flatMap((name) =>
      SOURCES.filter((source) =>
        new RegExp(String.raw`export\s+(?:type|interface)\s+${name}\b`).test(source.text),
      ).map((source) => `${name} in src/${source.file}`),
    )
    expect(
      published,
      '[fork-time §(b)(5)] is adopted — amend [SD §4.7] note 5 and time-value-shape-refuses.ts',
    ).toEqual([])
  })

  it('publishes `Instant` with an offset and no zone, which is what makes the gap real', () => {
    // Not "no zone type exists" — "the type that stands in its place says offset". The quotation is
    // `primitives.ts`'s own docstring, so a round that re-specifies `Instant` as zoned trips this
    // before it trips anything else.
    const primitives = SOURCES.find((s) => s.file === 'primitives.ts')
    expect(primitives).toBeDefined()
    expect(primitives?.text).toContain('An instant on the wire. ISO-8601 with an offset.')
    expect(primitives?.text).not.toContain('IANA')
  })
})
