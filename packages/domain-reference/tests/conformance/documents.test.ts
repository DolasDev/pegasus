/**
 * Conformance — **the drift guard**.
 *
 * Five rounds of human review were spent finding, by reading, the one class of defect this file
 * catches mechanically: a document and the vocabulary naming different things. [SD §4.7.2e] is the
 * record of what it costs when nobody checks — "a binding document… specifying a record that could
 * not be published" — and [SD §4.7.3]'s `weighing` / `unpacking` paragraph is the record of the
 * mirror case, a document's own prose naming act types the table does not contain.
 *
 * So this file reads the analysis documents and asserts, **in both directions**, that they and the
 * vocabulary name the same record types.
 *
 * ## Why this file does I/O when the package does not
 *
 * `src/` reads no file and imports nothing from the repository. A guard against drift between the
 * code and the prose has to read the prose; the reading lives here, in a test, and nothing in `src/`
 * depends on it.
 *
 * ## How extraction works, and what it deliberately does not attempt
 *
 * The documents are prose with code spans, so "every record type they name in backticks" needs a
 * rule for which backtick spans are naming a record type. Guessing wide — treating every lowerCamel
 * span as a candidate — cannot separate a `type` from a field name (`assertedAt`, `supersedes`,
 * `custodyBasis` are all spelled the same way), and a guard that reports three hundred field names
 * as drift is a guard nobody runs. The rule used here is the documents' own type-naming form:
 *
 * > inside a code region — an inline span or a fenced block — an **unqualified** `type` followed by
 * > `=` or `:` and an identifier.
 *
 * "Unqualified" is load-bearing. `Location.type = warehouse` ([A3 §2]) and
 * `OccurrenceEvent.type = Delivery.Completed` ([fork-time §3]) are a *source system's* type field
 * and revision 1's abolished class, neither of which is a claim about this vocabulary; requiring
 * the field to stand alone is what keeps them out without an exception list.
 *
 * What it does not attempt: every other way a document can mention a type. That reverse direction —
 * a vocabulary member no document names at all — is checked separately and exactly, because there
 * the token is known and only the search is needed.
 *
 * ## Failure messages
 *
 * Every failure names the **file**, the **line**, the **section heading** and the **token**. A drift
 * test whose output does not locate the drift is half a test: the reader is back to reading five
 * documents, which is the cost this file exists to remove.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ABSENT_AND_OWED,
  AGGREGATE_KINDS,
  ASSERTION_TYPES,
  CANONICAL_SUBJECT_FAMILY,
  META_RECORD_TYPES,
  OUTCOMES,
  PROSE_ALIASES,
  REASON_CODES,
  RECORD_TYPES,
  type AssertionType,
} from '../../src/index'

const ANALYSIS_DIR = fileURLToPath(
  new URL('../../../../docs/domain-reference/analysis/', import.meta.url),
)

interface Document {
  readonly file: string
  readonly text: string
  /** Character offset ranges that are inline spans or fenced blocks. */
  readonly code: readonly (readonly [number, number])[]
}

/**
 * The code regions of one markdown document.
 *
 * Fences are taken first and inline spans are then refused inside them, because a fenced record
 * sketch (`Act  type=Delivery  subject=shipment:S`) contains backticks in neither role and would
 * otherwise be scanned twice.
 */
function codeRegions(text: string): (readonly [number, number])[] {
  const regions: (readonly [number, number])[] = []
  const fence = /^```[^\n]*\n[\s\S]*?^```/gm
  for (let m = fence.exec(text); m !== null; m = fence.exec(text)) {
    regions.push([m.index, m.index + m[0].length] as const)
  }
  const fenced = regions.slice()
  const inline = /`{1,2}[^`\n]+`{1,2}/g
  for (let m = inline.exec(text); m !== null; m = inline.exec(text)) {
    const at = m.index
    if (fenced.some(([start, end]) => at >= start && at < end)) continue
    regions.push([at, at + m[0].length] as const)
  }
  return regions
}

function load(): readonly Document[] {
  return readdirSync(ANALYSIS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const text = readFileSync(`${ANALYSIS_DIR}${file}`, 'utf8')
      return { file, text, code: codeRegions(text) }
    })
}

const DOCUMENTS = load()

/** `file:line § nearest heading` — the three things a reader needs to go and look. */
function locate(doc: Document, offset: number): string {
  const before = doc.text.slice(0, offset).split('\n')
  const line = before.length
  let heading = '(no heading)'
  for (let i = before.length - 1; i >= 0; i--) {
    const candidate = before[i]
    if (candidate !== undefined && /^#{1,6} /.test(candidate)) {
      heading = candidate.replace(/^#+ /, '').trim()
      break
    }
  }
  return `${doc.file}:${line} § ${heading}`
}

function inCode(doc: Document, offset: number): boolean {
  return doc.code.some(([start, end]) => offset >= start && offset < end)
}

/** One backtick-quoted mention, wherever it was found. */
interface Mention {
  readonly token: string
  readonly at: string
}

/**
 * Every `type = X` / `type: X` inside a code region, with `type` unqualified.
 *
 * The negative lookbehind is what refuses `Location.type` and `OccurrenceEvent.type`: a qualified
 * field belongs to whatever object qualifies it, and only a bare `type` is this envelope's
 * ([SD §1.1]) single classification axis.
 */
function typePositionMentions(doc: Document): Mention[] {
  const found: Mention[] = []
  const pattern = /(?<![\w.])type\s*[=:]\s*`?\*{0,2}([A-Za-z][A-Za-z0-9_.]*)/g
  for (let m = pattern.exec(doc.text); m !== null; m = pattern.exec(doc.text)) {
    const token = m[1]
    if (token === undefined || !inCode(doc, m.index)) continue
    found.push({ token, at: locate(doc, m.index) })
  }
  return found
}

const VOCABULARY = new Set<string>(RECORD_TYPES)
const ALIASES = new Set<string>(Object.keys(PROSE_ALIASES))

/**
 * Types the documents name in a type position that are deliberately **not** members, each held out
 * of the vocabulary by a compile-time assertion in `src/vocabulary.ts` rather than by a comment.
 *
 * Neither entry is an exemption. Both are decisions the binding layer states, and both would be
 * defects if the vocabulary ever acquired them — which is why `vocabulary.test.ts` asserts their
 * absence from the other side.
 */
const DECLARED_NON_TYPES: Readonly<Record<string, string>> = {
  /** [SD §4.7.1]: "**A record may never carry `type = actPerformance`**" — it names a family. */
  actPerformance:
    '[SD §4.7.1] — a fact-class family name, not a member (ActPerformanceIsNotARecordType)',
  /** [SD §4.7.3], [SD §4.8]: "There is no such `type` and there will not be one." */
  custody: '[SD §4.7.3], [SD §4.8] — a projection, never a fact class (CustodyIsNotAFactClass)',
}

/** How a mention was accounted for, or that it was not. */
type Accounting =
  | { readonly kind: 'member' }
  /** [A8 §9 item 8] corrects exactly this: "`type = Handover` → **`handover`**". */
  | { readonly kind: 'sketchSpelling'; readonly member: string }
  /** [SD §4.7] note 5: a prose alias, which "must not appear in a record". */
  | { readonly kind: 'proseAlias'; readonly member: string }
  /** [SD §2.5] **A-TYPE**: a name the documents cite in order to forbid it. */
  | { readonly kind: 'aTypeCounterExample' }
  | { readonly kind: 'declaredNonType'; readonly why: string }
  /** [SD §4.7.3]: recorded absent, so a mention is a mention of the gap. */
  | { readonly kind: 'absentAndOwed' }
  | { readonly kind: 'unaccounted' }

function account(token: string): Accounting {
  if (VOCABULARY.has(token)) return { kind: 'member' }
  const sketch = [...VOCABULARY].find((member) => member.toLowerCase() === token.toLowerCase())
  if (sketch !== undefined) return { kind: 'sketchSpelling', member: sketch }
  const alias = (PROSE_ALIASES as Readonly<Record<string, string>>)[token]
  if (alias !== undefined) return { kind: 'proseAlias', member: alias }
  if (OUTCOMES.some((outcome) => token.toLowerCase().includes(outcome.toLowerCase()))) {
    return { kind: 'aTypeCounterExample' }
  }
  const why = DECLARED_NON_TYPES[token]
  if (why !== undefined) return { kind: 'declaredNonType', why }
  if ((ABSENT_AND_OWED as readonly string[]).includes(token)) return { kind: 'absentAndOwed' }
  return { kind: 'unaccounted' }
}

/**
 * **Recorded findings**, not exemptions.
 *
 * Both entries are real divergence between [SD §4.7] note 5's prose-alias table and the documents
 * that use it, found by this guard and recorded on the package's own terms ([SD §0]): a gap is
 * represented as owed and named, never closed by guessing. Neither can be fixed here — note 5's
 * table is [SD §4.7]'s to publish, and "no other document may declare a family".
 *
 * The test below asserts the divergence set is **exactly** this register, in both directions. New
 * drift fails it, and so does *fixing* one of these without striking it from the register — which
 * is what keeps a finding from decaying into a permanent exception.
 *
 * TODO([SD §4.7] note 5): both entries need a decision from the binding layer, not from this
 * package. Until then they are owed, and they are counted.
 */
const RECORDED_DIVERGENCES = [
  {
    token: 'time.delivery',
    direction: 'named-by-a-document-and-not-declared',
    where:
      'fork-time-provenance-corrections.md § 8.1 — `type = time.delivery`, `basis = COMMITTED`',
    finding:
      '[SD §4.7] note 5 declares `time.arrival` and `time.departure` as prose aliases and not `time.delivery`, which [fork-time §8.1] writes in a type position. Either note 5 is missing a row or §8.1 should say `delivery` at `basis = COMMITTED`. Mapping it here would be this package deciding an alias the binding layer has not.',
  },
  {
    token: 'time.departure',
    direction: 'declared-and-named-by-no-document',
    where: 'src/vocabulary.ts PROSE_ALIASES — quoted from [SD §4.7] note 5',
    finding:
      'No analysis document writes `time.departure`. It reads as the symmetric completion of `time.arrival`, which [SD §4.7.1]s `arrival` row does declare. Harmless, and still a row in a quoted table that its source does not support.',
  },
] as const

describe('[SD §4.7.1] the declaration table in the document is the vocabulary in the code', () => {
  const shared = DOCUMENTS.find((doc) => doc.file === '00-shared-decisions.md')

  /** The rows of one `####`-level subsection's markdown table, first cell only. */
  function firstCells(heading: RegExp, until: RegExp): { cell: string; at: string }[] {
    if (shared === undefined) throw new Error('00-shared-decisions.md is missing')
    const lines = shared.text.split('\n')
    const start = lines.findIndex((line) => heading.test(line))
    if (start < 0) throw new Error(`no section matching ${String(heading)}`)
    const end = lines.findIndex((line, index) => index > start && until.test(line))
    const cells: { cell: string; at: string }[] = []
    for (let i = start; i < (end < 0 ? lines.length : end); i++) {
      const line = lines[i]
      if (line === undefined || !line.startsWith('|')) continue
      const cell = line.split('|')[1]
      if (cell === undefined) continue
      cells.push({ cell, at: `00-shared-decisions.md:${i + 1}` })
    }
    return cells
  }

  it('names every member the table declares, and no member it does not', () => {
    const declared = new Map<string, string>()
    for (const { cell, at } of firstCells(/^#### 4\.7\.1\b/, /^#### 4\.7\.2\b/)) {
      for (const m of cell.matchAll(/\*\*`([^`]+)`\*\*/g)) {
        const token = m[1]
        if (token !== undefined) declared.set(token, at)
      }
    }

    // [SD §4.7.3] gives `notification` and `partyRole` their rows in a table of its own, because
    // both are provisional — "no source fixes a subject for either" — so they are absent from
    // §4.7.1's table and present in the vocabulary, which is the next test.
    const provisional = new Set(['notification', 'partyRole'])
    const expected = ASSERTION_TYPES.filter((type) => !provisional.has(type))

    for (const [token, at] of declared) {
      expect(
        VOCABULARY.has(token),
        `${at} § 4.7.1 declares \`${token}\`, which the vocabulary does not contain`,
      ).toBe(true)
    }
    for (const type of expected) {
      expect(
        declared.has(type),
        `the vocabulary contains \`${type}\`, which [SD §4.7.1]'s table does not declare`,
      ).toBe(true)
    }
    expect([...declared.keys()].sort()).toEqual([...expected].sort())
  })

  it('takes the two provisional rows from [SD §4.7.3], with the family that section gives them', () => {
    const rows = new Map<string, string>()
    for (const { cell } of firstCells(/^#### 4\.7\.3\b/, /^#{1,4} (?!4\.7\.3)/)) {
      const token = /^\s*`([^`]+)`\s*$/.exec(cell)?.[1]
      if (token !== undefined) rows.set(token, cell)
    }
    // Both are members of [SD §1.3]'s vocabulary list and were not in §4.7.1's table — the
    // divergence §4.7.3 opens deliberately, and the one place the code must follow the prose
    // rather than the table.
    for (const type of ['notification', 'partyRole'] as const) {
      expect(rows.has(type), `[SD §4.7.3] no longer declares \`${type}\``).toBe(true)
      expect(CANONICAL_SUBJECT_FAMILY[type]).toBe(type === 'notification' ? 'goods' : 'partyRole')
    }
  })
})

describe('every record type the documents name exists in the vocabulary', () => {
  const mentions = DOCUMENTS.flatMap((doc) =>
    typePositionMentions(doc).map((mention) => ({ ...mention, file: doc.file })),
  )

  it('finds type-position mentions to check in the first place', () => {
    // A drift guard that silently extracts nothing passes forever. If the documents are reformatted
    // so the extraction rule stops matching, this is the assertion that says so.
    expect(mentions.length).toBeGreaterThan(15)
    expect(new Set(mentions.map((m) => m.file)).size).toBeGreaterThanOrEqual(4)
  })

  it('accounts for every one of them', () => {
    const unaccounted = mentions
      .filter((mention) => account(mention.token).kind === 'unaccounted')
      .filter((mention) => !RECORDED_DIVERGENCES.some((known) => known.token === mention.token))
      .map((mention) => `\`${mention.token}\` at ${mention.at}`)
    expect(unaccounted, 'record types named by a document and absent from the vocabulary').toEqual(
      [],
    )
  })

  it("keeps the documents' informal spellings visible rather than silently folding them", () => {
    const sketches = new Map<string, string>()
    for (const mention of mentions) {
      const accounting = account(mention.token)
      if (accounting.kind === 'sketchSpelling') sketches.set(mention.token, mention.at)
    }
    // [A8 §9 item 8] corrects exactly this — "`type = Handover` → **`handover`**" — and the worked
    // record sketches in [SD §4.6], [A3 §7] and [fork-order §6] still carry the capitalised form.
    // Folding them by case is legitimate (it is the same member); doing it silently is not, because
    // a genuinely new capitalised name would then also disappear.
    expect([...sketches.keys()].sort()).toEqual(['Delivery', 'Handover', 'Loading', 'Packing'])
  })

  it('records the one type a document names that [SD §4.7] note 5 does not declare', () => {
    const unaccounted = new Map<string, string>()
    for (const mention of mentions) {
      if (account(mention.token).kind !== 'unaccounted') continue
      if (!unaccounted.has(mention.token)) unaccounted.set(mention.token, mention.at)
    }
    const expected = RECORDED_DIVERGENCES.filter(
      (known) => known.direction === 'named-by-a-document-and-not-declared',
    )
    expect(
      [...unaccounted.keys()].sort(),
      'unrecorded divergence — add it to RECORDED_DIVERGENCES with a finding, or close it in [SD §4.7]',
    ).toEqual(expected.map((known) => known.token).sort())
    for (const known of expected) {
      expect(unaccounted.get(known.token), `${known.token}: ${known.finding}`).toContain(
        known.where.split(' § ')[0] ?? known.where,
      )
    }
  })
})

describe('every vocabulary member is named by at least one document', () => {
  /** Every distinct backtick-quoted token in one document, fences included word by word. */
  function quotedTokens(doc: Document): ReadonlySet<string> {
    const tokens = new Set<string>()
    const inline = /`{1,2}([^`\n]+)`{1,2}/g
    for (let m = inline.exec(doc.text); m !== null; m = inline.exec(doc.text)) {
      const span = m[1]
      if (span !== undefined) tokens.add(span.trim())
    }
    const fence = /^```[^\n]*\n([\s\S]*?)^```/gm
    for (let m = fence.exec(doc.text); m !== null; m = fence.exec(doc.text)) {
      for (const word of (m[1] ?? '').split(/[^A-Za-z0-9_.]+/)) if (word !== '') tokens.add(word)
    }
    return tokens
  }

  const quoted = new Map(DOCUMENTS.map((doc) => [doc.file, quotedTokens(doc)] as const))

  function namedBy(token: string): string[] {
    return [...quoted].filter(([, tokens]) => tokens.has(token)).map(([file]) => file)
  }

  it('holds for every published reason code, and the document that names them is [A4]', () => {
    const orphans: string[] = []
    for (const code of REASON_CODES) {
      if (namedBy(code).length === 0) orphans.push(code)
    }
    // A closed vocabulary whose members no document argues for is the [SD §4.7.2e] defect read
    // backwards, and a reason code is the member most easily minted from a support ticket rather
    // than from a source — which is what [SD §2.4] rule 1's own example is about. So every one of
    // them has to be named in prose that cites its evidence.
    expect(orphans).toEqual([])
    // And it is A4 that names them: the vocabulary's home is the area document that decided it.
    for (const code of REASON_CODES) {
      expect(namedBy(code)).toContain('A4-execution-events.md')
    }
  })

  it('holds for all 31 assertion types and both meta-record types', () => {
    const orphans: string[] = []
    for (const type of RECORD_TYPES) {
      if (namedBy(type).length === 0) orphans.push(type)
    }
    // The [SD §4.7.2e] defect read backwards: a member nothing argues for. The vocabulary is closed
    // and minting is [SD §4.7]'s alone, so a member no document names came from somewhere else.
    expect(orphans, 'vocabulary members named by no analysis document').toEqual([])
    expect(RECORD_TYPES.length).toBe(ASSERTION_TYPES.length + META_RECORD_TYPES.length)
  })

  it('names the nine aggregate-lifecycle members in [A3], where their subjects are quoted from', () => {
    // [SD §4.7.2d]: the nine rows' subjects "are quoted from [A3 §3.2]'s table" and are not decided
    // in §4.7.1. If A3 stopped naming one, §4.7.1 would be quoting a table that no longer says it.
    const lifecycle: readonly AssertionType[] = [
      'tripDelay',
      'tripResequence',
      'tripCancellation',
      'membershipOffer',
      'membershipResponse',
      'membershipRelease',
      'assignmentOffer',
      'assignmentResponse',
      'assignmentRelease',
    ]
    for (const type of lifecycle) {
      expect(namedBy(type), `${type} is not named in A3-trip-stop-assignment.md`).toContain(
        'A3-trip-stop-assignment.md',
      )
    }
  })

  it('holds for every aggregate kind, case-insensitively', () => {
    // [SD §1.2]'s enum is "open to addition in a later `specVersion`, never to reinterpretation".
    // The documents spell `ExternallyPerformedLeg` as the aggregate and `externallyPerformedLeg` as
    // the enum member, so the match is on case-folded tokens.
    const folded = new Set(
      [...quoted.values()].flatMap((tokens) => [...tokens].map((t) => t.toLowerCase())),
    )
    const orphans = AGGREGATE_KINDS.filter((kind) => !folded.has(kind.toLowerCase()))
    expect(orphans, 'aggregate kinds named by no analysis document').toEqual([])
  })
})

describe('[SD §4.7.3] what is absent stays absent, and stays disclosed', () => {
  const shared = DOCUMENTS.find((doc) => doc.file === '00-shared-decisions.md')?.text ?? ''

  /**
   * The document names most of these in prose ("cube, survey and estimate facts, ETA, seal
   * integrity, tracer results, claim facts, **the equipment's own tare weight**") and two of them
   * in backticks. The code spells them as identifiers, so the match is on the phrase §4.7.3
   * actually writes — cited per entry rather than de-camel-cased by rule, because
   * `resourceTareWeight` is not a de-camel-casing of "the equipment's own tare weight".
   */
  const AS_WRITTEN: Readonly<Record<string, string>> = {
    cube: 'cube',
    survey: 'survey',
    estimate: 'estimate facts',
    eta: 'ETA',
    sealIntegrity: 'seal integrity',
    tracerResult: 'tracer results',
    claim: 'claim facts',
    resourceTareWeight: "the equipment's own tare weight",
    weighing: '`weighing`',
    unpacking: '`unpacking`',
  }

  it('names each absent class in §4.7.3, so its absence is not read as an oversight', () => {
    const lines = shared.split('\n')
    const start = lines.findIndex((line) => /^#### 4\.7\.3\b/.test(line))
    const end = lines.findIndex((line, index) => index > start && /^#{1,4} (?!4\.7\.3)/.test(line))
    const section = lines.slice(start, end < 0 ? undefined : end).join('\n')
    expect(start, '[SD §4.7.3] has moved or been renamed').toBeGreaterThan(0)

    for (const absent of ABSENT_AND_OWED) {
      const phrase = AS_WRITTEN[absent]
      expect(phrase, `${absent} is in ABSENT_AND_OWED with no §4.7.3 phrase recorded`).toBeDefined()
      expect(
        section.includes(phrase ?? ' '),
        `[SD §4.7.3] no longer names "${phrase}" for ABSENT_AND_OWED member ${absent}`,
      ).toBe(true)
    }
  })
})

describe('[SD §4.7] note 5 the prose aliases and the documents that use them', () => {
  /** Aliases are phrases, not identifiers, so both sides are folded to words before comparing. */
  const fold = (raw: string): string =>
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const corpus = DOCUMENTS.map((doc) => ({ file: doc.file, folded: fold(doc.text) }))

  it('declares an alias for a member of the vocabulary, every time', () => {
    for (const [alias, target] of Object.entries(PROSE_ALIASES)) {
      expect(
        VOCABULARY.has(target),
        `\`${alias}\` aliases \`${target}\`, which is not a member`,
      ).toBe(true)
      expect(ALIASES.has(target), `\`${target}\` is both an alias and an alias target`).toBe(false)
    }
  })

  it('records the one alias the code declares that no document writes', () => {
    const unused = Object.keys(PROSE_ALIASES)
      .filter((alias) => !corpus.some((doc) => doc.folded.includes(fold(alias))))
      .sort()
    const expected = RECORDED_DIVERGENCES.filter(
      (known) => known.direction === 'declared-and-named-by-no-document',
    )
    // Note 5's table is quoted into `PROSE_ALIASES`, so an alias nothing writes is a quotation with
    // no source. Recorded rather than deleted: deleting it would be this package editing a table
    // [SD §4.7] owns.
    expect(
      unused,
      'unrecorded divergence — add it to RECORDED_DIVERGENCES with a finding, or close it in [SD §4.7]',
    ).toEqual(expected.map((known) => known.token).sort())
  })

  it('keeps the recorded divergences a register of findings rather than a list of exemptions', () => {
    for (const known of RECORDED_DIVERGENCES) {
      expect(known.where.length, `${known.token} says nowhere`).toBeGreaterThan(0)
      expect(known.finding.length, `${known.token} states no finding`).toBeGreaterThan(20)
      // A divergence that is also a vocabulary member is not a divergence; it is a stale entry.
      expect(VOCABULARY.has(known.token), `${known.token} is now a member; strike the entry`).toBe(
        false,
      )
    }
    expect(new Set(RECORDED_DIVERGENCES.map((known) => known.token)).size).toBe(
      RECORDED_DIVERGENCES.length,
    )
  })
})
