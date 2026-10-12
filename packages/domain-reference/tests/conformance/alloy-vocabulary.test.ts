/**
 * Conformance — **the Alloy drift guard**.
 *
 * `alloy/subject-admission.als` transcribes [SD §4.7.1]'s table by hand: one `one sig T_x` per fact
 * class, one `fun F_y` per family, and `isADeclaredFamily` enumerating the families a row may
 * declare. Nothing checked the transcription, and at the time `npm run alloy` ran nowhere in CI, so
 * it fell **three fact classes and one whole family** behind the vocabulary without a word:
 * `documentIssuance` went missing at catalog `0.6.2`, and `survey` and `estimate` were added by
 * [A10] at `0.7.1` — the most recent round made it worse and nothing said so.
 *
 * A stale spec is worse than no spec, because its commands still come back green. S1
 * (`everyTypeDeclaresOneOfTheTwelveFamilies`) proves every transcribed row declares a declared
 * family; it cannot notice a row that was never transcribed. The hole was in the quantifier's
 * domain, which is exactly the class of defect a model checker cannot see — `all t: Type | …` is
 * silent about the `Type`s you forgot to write down.
 *
 * So this file asserts, **in both directions**, that the spec and the vocabulary name the same fact
 * classes and the same families.
 *
 * ## Why this file does I/O when the package does not
 *
 * The same reason `documents.test.ts` gives: `src/` reads no file and imports nothing from the
 * repository, and a guard against drift between the code and a hand-maintained artifact has to read
 * the artifact. The reading lives here, in a test, and nothing in `src/` depends on it.
 *
 * ## Why it needs no JVM
 *
 * It parses the `.als` as **text**. That is deliberate: it keeps this guard in the vitest suite,
 * which CI runs on every PR, instead of behind a JVM. The analyzer now runs in CI too, but in its
 * own `Alloy (domain-reference)` job path-filtered to `packages/domain-reference/alloy/**` — so a
 * change to the **vocabulary** is covered by this test and never waits on Java. The division of
 * labour is the point: the analyzer proves things about the model, and this test proves the model is
 * about the right things.
 *
 * ## The spelling rule
 *
 * Alloy has no dotted identifiers, so the spec spells `weight.net` as `T_weightNet` — a rule the
 * `.als` states at [SD §4.7.1] note 5's transcription. The mapping is applied **forwards** (dot
 * removed, next letter upper-cased) and compared **case-sensitively**, rather than normalising both
 * sides by lower-casing: a lossy normaliser would accept `T_Survey` and `T_WEIGHTNET` as conforming
 * spellings of the vocabulary's names, and the names are the thing being checked.
 *
 * ## Why a parse failure is a test failure
 *
 * `declaredTypes` asserts its parsed count equals the raw count of `^one sig T_` lines. A line the
 * pattern cannot read — a reformatted declaration, a second constraint in the braces — would
 * otherwise drop out of **both** directions of the comparison and leave the guard quietly passing on
 * a file it had stopped understanding.
 *
 * ## Failure messages
 *
 * Every failure names the **fact class**, the **file and line** (or `absent`), and the **family the
 * vocabulary declares** — the three things a reader needs in order to go and edit the right line.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ASSERTION_TYPES,
  CANONICAL_SUBJECT_FAMILY,
  SUBJECT_FAMILIES,
  type AssertionType,
} from '../../src/index'

const ALLOY_DIR = fileURLToPath(new URL('../../alloy/', import.meta.url))

const SUBJECT_ADMISSION = 'subject-admission.als'

const SPEC = readFileSync(`${ALLOY_DIR}${SUBJECT_ADMISSION}`, 'utf8')

/**
 * The other two specs, which must contain **no** type enumeration of their own.
 *
 * They abstract over `Type` instead of listing its members, which is why this guard covers the
 * corpus by covering one file. Asserted rather than assumed: a list added to either of them would
 * be a list nothing checks, and the hole would be the one this file exists to close.
 */
const ABSTRACTING_SPECS = ['custody.als', 'cardinality.als'] as const

/** `file:line` — where to go and edit. */
function locate(file: string, text: string, offset: number): string {
  return `${file}:${text.slice(0, offset).split('\n').length}`
}

/** One `one sig T_x extends Type {} { family = F_y }` row of the transcribed table. */
interface DeclaredType {
  /** The Alloy identifier, `T_` included, exactly as written. */
  readonly sig: string
  /** The family identifier, `F_` included, exactly as written. */
  readonly family: string
  readonly at: string
}

const DECLARATION =
  /^one sig (T_[A-Za-z0-9_]+)\s+extends Type \{\}\s*\{\s*family = (F_[A-Za-z0-9_]+)\s*\}/gm

function declaredTypes(): readonly DeclaredType[] {
  const found: DeclaredType[] = []
  for (let m = DECLARATION.exec(SPEC); m !== null; m = DECLARATION.exec(SPEC)) {
    const [, sig, family] = m
    if (sig === undefined || family === undefined) continue
    found.push({ sig, family, at: locate(SUBJECT_ADMISSION, SPEC, m.index) })
  }
  DECLARATION.lastIndex = 0
  return found
}

const DECLARED = declaredTypes()

/** `weight.net` → `T_weightNet`. [SD §4.7.1] note 5's rule, applied forwards. */
function toSig(type: string): string {
  return `T_${type.replace(/\.([a-z])/g, (_, letter: string) => letter.toUpperCase())}`
}

/** `goods` → `F_goods`. */
function toFamilySig(family: string): string {
  return `F_${family}`
}

const FAMILY_NAMES = Object.keys(SUBJECT_FAMILIES)

describe('the Alloy spec transcribes the vocabulary', () => {
  it('parses every `one sig T_` line it is asked to check', () => {
    const lines = SPEC.match(/^one sig T_/gm) ?? []
    expect(
      DECLARED.length,
      `${lines.length} \`one sig T_\` lines in ${SUBJECT_ADMISSION} but only ${DECLARED.length} ` +
        'could be read as `one sig T_x extends Type {} { family = F_y }`. An unparsed declaration ' +
        'drops out of both directions of this guard — fix the pattern or the line, do not ignore it.',
    ).toBe(lines.length)
  })

  it('declares one type per vocabulary fact class', () => {
    const declared = new Set(DECLARED.map((row) => row.sig))
    const absent = ASSERTION_TYPES.filter((type) => !declared.has(toSig(type))).map(
      (type) =>
        `${type}: absent — expected \`one sig ${toSig(type)} extends Type {} ` +
        `{ family = ${toFamilySig(CANONICAL_SUBJECT_FAMILY[type])} }\``,
    )
    expect(
      absent,
      `fact classes the vocabulary declares and ${SUBJECT_ADMISSION} does not`,
    ).toEqual([])
  })

  it('declares no type the vocabulary does not', () => {
    const expected = new Set(ASSERTION_TYPES.map(toSig))
    const extra = DECLARED.filter((row) => !expected.has(row.sig)).map(
      (row) => `${row.sig} at ${row.at}: not a member of ASSERTION_TYPES`,
    )
    expect(extra, `types ${SUBJECT_ADMISSION} declares and the vocabulary does not`).toEqual([])
  })

  it('gives each type the family the vocabulary gives it', () => {
    const bySig = new Map(DECLARED.map((row) => [row.sig, row]))
    const wrong: string[] = []
    for (const type of ASSERTION_TYPES) {
      const row = bySig.get(toSig(type))
      if (row === undefined) continue
      const expectedFamily = toFamilySig(CANONICAL_SUBJECT_FAMILY[type])
      if (row.family !== expectedFamily) {
        wrong.push(
          `${type} at ${row.at}: declares \`family = ${row.family}\`, ` +
            `vocabulary says \`${expectedFamily}\``,
        )
      }
    }
    expect(wrong, 'types whose declared family contradicts CANONICAL_SUBJECT_FAMILY').toEqual([])
  })
})

describe('the Alloy spec transcribes the families', () => {
  /** `fun F_x : set Kind { … }` — the declaring surface. */
  const declaredFunctions = [...SPEC.matchAll(/^fun (F_[A-Za-z0-9_]+)\s*:\s*set Kind/gm)].map(
    (m) => m[1] as string,
  )

  /**
   * The `m = F_x` disjuncts of `isADeclaredFamily`.
   *
   * Checked separately from the `fun` list because they fail differently: a family can be declared
   * and left out of the predicate, which is what turns S1's `check … expect 0` SAT, and a family can
   * be in the predicate with no `fun` to name it, which is a parse error only the analyzer catches.
   * Both are checked here because this test is the cheap half: it runs in every `Test` job, while
   * the analyzer runs in its own path-filtered `Alloy (domain-reference)` job and therefore only
   * when the specs themselves change.
   */
  const predicate = SPEC.match(/pred isADeclaredFamily\[m: set Kind\] \{([\s\S]*?)\n\}/)
  const predicateMembers = [...(predicate?.[1] ?? '').matchAll(/m = (F_[A-Za-z0-9_]+)/g)].map(
    (m) => m[1] as string,
  )

  it('finds the `isADeclaredFamily` predicate at all', () => {
    expect(
      predicate,
      `\`pred isADeclaredFamily[m: set Kind] { … }\` not found in ${SUBJECT_ADMISSION} — it was ` +
        'renamed or reformatted, and this guard went blind rather than red.',
    ).not.toBeNull()
  })

  it('declares one `fun F_` per vocabulary family', () => {
    expect([...declaredFunctions].sort()).toEqual([...FAMILY_NAMES.map(toFamilySig)].sort())
  })

  it('admits exactly the vocabulary families in `isADeclaredFamily`', () => {
    expect([...predicateMembers].sort()).toEqual([...FAMILY_NAMES.map(toFamilySig)].sort())
  })

  it('names the family count in the assertion it checks', () => {
    const named = SPEC.match(/assert everyTypeDeclaresOneOfThe([A-Z][a-z]+)Families/)
    expect(
      named,
      'the S1 assertion spells the family count in its own name, so the count has to be ' +
        'maintained with the list — `assert everyTypeDeclaresOneOfThe<Count>Families` not found.',
    ).not.toBeNull()
    const words = [
      'Zero',
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
      'Eight',
      'Nine',
      'Ten',
      'Eleven',
      'Twelve',
      'Thirteen',
      'Fourteen',
      'Fifteen',
      'Sixteen',
      'Seventeen',
      'Eighteen',
      'Nineteen',
      'Twenty',
    ] as const
    expect(
      named?.[1],
      `${FAMILY_NAMES.length} families in SUBJECT_FAMILIES, so the assertion should be named ` +
        `\`everyTypeDeclaresOneOfThe${words[FAMILY_NAMES.length] ?? '<count>'}Families\``,
    ).toBe(words[FAMILY_NAMES.length])
  })
})

describe('the other specs abstract over types rather than enumerating them', () => {
  it.each(ABSTRACTING_SPECS)('%s declares no `one sig T_`', (file) => {
    const text = readFileSync(`${ALLOY_DIR}${file}`, 'utf8')
    const lines = [...text.matchAll(/^one sig T_[A-Za-z0-9_]+/gm)].map(
      (m) => `${locate(file, text, m.index)}: ${m[0]}`,
    )
    expect(
      lines,
      `${file} abstracts over \`Type\`; a type enumeration added here would be one this guard ` +
        'does not read. Either revert it or extend this file to cover it.',
    ).toEqual([])
  })
})

/** Compile-time: the two constants this file compares must stay keyed to each other. */
const _familyOfEveryType: Record<AssertionType, keyof typeof SUBJECT_FAMILIES> =
  CANONICAL_SUBJECT_FAMILY
void _familyOfEveryType
