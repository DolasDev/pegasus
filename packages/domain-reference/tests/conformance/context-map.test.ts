/**
 * Conformance — **the context map is generated, and this is what stops it drifting.**
 *
 * The README carried the context map as genuinely absent, and the shape it has landed in is a
 * generated one for the reason the glossary is generated: a context map's entire content is claims
 * about sets the code already knows, and the owed-closures round found six stale counts and a stale
 * quotation in prose exactly that shape. So this file does four jobs, and only the first is the
 * staleness check every generated artefact here has:
 *
 * 1. **Staleness and reproducibility** — the committed bytes are the ones the generator produces,
 *    and two runs produce the same bytes.
 * 2. **The membership of the join surface, enumerated by name.** The two thresholds the generator
 *    uses are counts it chose, and §3 item 10 says a count must be gated or deleted — and that a
 *    gate which _enumerates_ beats one that counts. A new reference that promotes or demotes a
 *    concept fails here by name, and the author decides whether the map changed or the threshold is
 *    wrong.
 * 3. **The comparison that justifies the union of the two axes**, which is the part a later round
 *    would otherwise simplify away. Neither axis alone finds what the other does, and the two
 *    witnesses are asserted as comparisons rather than as totals: `PartyId` is on the map on spread
 *    **and is below the reach threshold**, `SchemeName` the other way round. Delete either axis and
 *    this fails naming the concept that disappears.
 * 4. **The refusal.** The map publishes no DDD integration-pattern label, and that refusal has no
 *    edge the types can see — there is no vocabulary for it to leave a hole in, and the absence of a
 *    type has no type-level witness ([A5 §9]'s `Exact` trap one construct over: a check over a
 *    module's value namespace can never fire for a type alias). So it is held at runtime, over the
 *    emitted bytes, which is the only surface that can hold it.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CONTEXT_MAP_COMMAND,
  CONTEXT_MAP_FILE,
  CONTEXT_MAP_GENERATOR_REPO_PATH,
  CONTEXT_MAP_REPO_PATH,
  HUB_AREA_REACH,
  HUB_MODULE_SPREAD,
  REFUSAL_SENTENCE,
  REFUSED_PATTERN_NAMES,
  collectContextMap,
  generateContextMap,
} from '../../tools/generate-context-map'

/**
 * These suites drive the TypeScript compiler API, which takes seconds, not milliseconds — and a CI
 * runner is slower than a workstation. The same budget `glossary-staleness.test.ts` records the
 * reason for (PR #712): it exists to stop a hang, not to police how fast tsc is.
 */
const COMPILER_TIMEOUT_MS = 120_000

/** The first line that differs, with the command that fixes it — `glossary-staleness.test.ts`'s. */
function firstDifference(generated: string, committed: string): string {
  const left = generated.split('\n')
  const right = committed.split('\n')
  const limit = Math.max(left.length, right.length)
  for (let line = 0; line < limit; line += 1) {
    if (left[line] === right[line]) continue
    return [
      `first difference at ${CONTEXT_MAP_REPO_PATH}:${line + 1}`,
      `  committed: ${JSON.stringify(right[line] ?? '<end of file>')}`,
      `  generated: ${JSON.stringify(left[line] ?? '<end of file>')}`,
      '',
      `The context map is generated. Do not edit it by hand — run \`${CONTEXT_MAP_COMMAND}\`.`,
    ].join('\n')
  }
  return 'the files differ only in trailing content'
}

describe('the generated context map', () => {
  it(
    'is committed in the state the generator produces',
    () => {
      const generated = generateContextMap()
      const committed = readFileSync(CONTEXT_MAP_FILE, 'utf8')
      if (generated !== committed) {
        throw new Error(
          `\`${CONTEXT_MAP_REPO_PATH}\` is stale.\n\n${firstDifference(generated, committed)}`,
        )
      }
      expect(generated).toBe(committed)
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'regenerates identically — the output is a function of the code and nothing else',
    () => {
      expect(generateContextMap()).toBe(generateContextMap())
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'carries the do-not-edit header, naming the generator and the command',
    () => {
      // Generated, not committed, for the reason the refusal gates below record.
      const generated = generateContextMap()
      expect(generated).toContain('GENERATED FILE — DO NOT EDIT BY HAND')
      expect(generated).toContain(CONTEXT_MAP_GENERATOR_REPO_PATH)
      expect(generated).toContain(CONTEXT_MAP_COMMAND)
    },
    COMPILER_TIMEOUT_MS,
  )
})

describe('the nodes are rubric.md’s areas, and nothing else', () => {
  it(
    'is the thirteen the rubric declares, in the rubric’s order',
    () => {
      expect(collectContextMap().areas.map((area) => area.id)).toEqual([
        'A1',
        'A2',
        'A3',
        'A4',
        'A5',
        'A6',
        'A7',
        'A8',
        'A9',
        'A10',
        'A11',
        'A12',
        'A13',
      ])
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'names A10-A13 as context-map-only and gives them no decision document',
    () => {
      // `rubric.md` says twice that these are **not gaps**. The map records what reaches them and
      // discharges nothing, so a round that gave one of them a document would change this row
      // rather than quietly turn four nodes into four thin area documents ([A6 §3.8]'s caution).
      const contextMapOnly = collectContextMap().areas.filter(
        (area) => area.v1Detail === 'context map',
      )
      expect(contextMapOnly.map((area) => area.id)).toEqual(['A10', 'A11', 'A12', 'A13'])
      expect(contextMapOnly.map((area) => area.document)).toEqual([null, null, null, null])
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'reaches the context-map-only areas from the published vocabulary',
    () => {
      // The edge a reader would assume is absent. `rubric.md`'s own note says the `v1 detail`
      // column invites exactly that assumption, and the map exists partly to contradict it: the
      // record-type vocabulary's own docstrings name A10 and A11, and a `TODO` names A12 and A13.
      const map = collectContextMap()
      const reached = new Set<string>()
      for (const hub of map.hubs) for (const area of hub.areas) reached.add(area)
      for (const marker of map.debt) for (const area of marker.areas) reached.add(area)
      for (const entry of map.owed.declared) {
        for (const area of ['A10', 'A11', 'A12', 'A13']) {
          if (new RegExp(`(?<![A-Za-z0-9])${area}(?![0-9])`).test(entry.owedTo)) reached.add(area)
        }
      }
      expect(
        [...reached].filter((area) => ['A10', 'A11', 'A12', 'A13'].includes(area)).sort(),
      ).toEqual(['A10', 'A11', 'A12', 'A13'])
    },
    COMPILER_TIMEOUT_MS,
  )
})

describe('the join surface, enumerated rather than counted', () => {
  it(
    'is exactly these concepts',
    () => {
      // Enumerated, not counted — §3 item 10. A reference added or removed in `src/` can move a
      // concept across either threshold, and when it does this list is the thing to change
      // deliberately. Do not "fix" a failure by widening the thresholds: decide first whether the
      // concept really does cross, then say so here.
      expect(collectContextMap().hubs.map((hub) => hub.name)).toEqual([
        'AggregateKind',
        'AssertionType',
        'BoundBy',
        'CaptureMethod',
        'EventId',
        'EvidenceRef',
        'IdentitySchemeTable',
        'Instant',
        'Outcome',
        'PartyId',
        'QualifierByType',
        'RecordType',
        'RoleName',
        'RuleRef',
        'SchemeAccountability',
        'SchemeAccountabilityVerdict',
        'SchemeName',
        'ShipmentContinuityUndeterminedReason',
        'ShipmentContinuityVerdict',
        'StayLocation',
      ])
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'needs BOTH axes: the party is found by spread alone and the identity key by reach alone',
    () => {
      // The measured finding the generator's header records, held as a **comparison** rather than
      // as two totals (§3 item 10). `PartyId` is [A9 §3.6]'s structural finding — an identifier the
      // model can carry and cannot make a `subject` of — and almost every site that references it
      // cites the binding layer and [A8], which is not an area, so its reach falls below the
      // threshold while its module spread sits well above it. `SchemeName` is the mirror image.
      // Drop either axis and the concept on that side disappears from the map, and this test says
      // which one.
      //
      // No count is written here. The emitted document derives its own two witnesses and names the
      // **widest** of each, which today makes its reach-only witness `BoundBy` rather than
      // `SchemeName`; both are genuine witnesses. This gate names `SchemeName` because that is the
      // pair the round measured, and a named pair is steadier than whichever concept ranks first.
      const map = collectContextMap()
      const party = map.hubs.find((hub) => hub.name === 'PartyId')
      const scheme = map.hubs.find((hub) => hub.name === 'SchemeName')
      expect(party).toBeDefined()
      expect(scheme).toBeDefined()

      expect(party?.modules.length).toBeGreaterThanOrEqual(HUB_MODULE_SPREAD)
      expect(party?.areas.length).toBeLessThan(HUB_AREA_REACH)

      expect(scheme?.areas.length).toBeGreaterThanOrEqual(HUB_AREA_REACH)
      expect(scheme?.modules.length).toBeLessThan(HUB_MODULE_SPREAD)
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'carries no declaration that takes type parameters',
    () => {
      // The one exclusion, and it is mechanical rather than a blocklist: a declaration carrying type
      // parameters is machinery. `Exact`, `Brand` and `NonEmptyArray` outrank every concept in the
      // model on reference spread, so without this the top of the join surface would be
      // `primitives.ts`'s generics. Held by name because the names are what a reader would recognise.
      const names = collectContextMap().hubs.map((hub) => hub.name)
      for (const machinery of ['Exact', 'Brand', 'NonEmptyArray', 'Owed', 'OwedCode']) {
        expect(names).not.toContain(machinery)
      }
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'attributes every reference site to a declaration a reader can open',
    () => {
      // A row reading `?.party` is half a row: the reference is inside an inline union member or an
      // anonymous type literal, and the label has to resolve out to the alias that declares it.
      for (const hub of collectContextMap().hubs) {
        for (const site of hub.sites) {
          expect(site.where, `${hub.name} has an unresolved site label`).not.toContain('?')
          expect(site.where).toMatch(/^[\w/.-]+\.ts:[\w().$]+/)
        }
      }
    },
    COMPILER_TIMEOUT_MS,
  )
})

describe('the TODO ledger — the register no other artefact reads', () => {
  it(
    'is exactly these markers',
    () => {
      // Keyed on module and blocker rather than on a line number, so an unrelated edit in `src/`
      // does not fail this gate — and so that **adding** a `TODO` does. The owed inventory the
      // glossary and `catalog/index.json` publish reads `owed(…)`, `Owed<…>` and `OwedCode<…>`;
      // none of them sees these, which is why they were invisible until this map.
      const seen = collectContextMap().debt.map(
        (marker) =>
          `${marker.where.replace('packages/domain-reference/src/', '')} → ${marker.blocker}`,
      )
      expect(seen).toEqual([
        'assertions.ts → corrections area',
        'custody.ts → [SD §1.2] / A3',
        'custody.ts → [A8 §9 items 1-3]',
        'custody.ts → [SD §3] / A5',
        'envelope.ts → capture rules',
        'identity.ts → A9',
        'ids.ts → A8 §9 item 1',
        'portion.ts → measures',
        'portion.ts → [SD §4.7.1]',
        'rules/authority.ts → [A8 §10] §4.2 row',
        'rules/authority.ts → reconcile with `data/authority-table.json`',
        'rules/authority.ts → [A8 §9 item 2]',
        'rules/authority.ts → [A8 §9 item 7]',
        'rules/authority.ts → [SD §4.2]',
        'rules/authority.ts → [A1 §3.5]',
        'rules/authority.ts → [A8 §9 items 1-3, 5]',
        'rules/capture.ts → [SD §4.7.3]',
        'rules/corrections.ts → [SD §4.7.3] / A4',
        'rules/corrections.ts → [SD §4.7.2b] / A7 / A12',
        'rules/corrections.ts → [A8 §9 item 6]',
        'rules/resolution.ts → [SD §4.4] / A4',
        'vocabulary.ts → authority module',
        'vocabulary.ts → [SD §4.7.3] / A1',
        'vocabulary.ts → ingest',
        'vocabulary.ts → projections',
      ])
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'names an area on the markers that have an owner, and says so on the ones that do not',
    () => {
      // Both halves side by side — §3 item 12. A marker whose blocker is a module (`ingest`,
      // `projections`, `measures`) genuinely names no area, and the map says that rather than
      // guessing one; a marker citing a document names it, and the map links it.
      const map = collectContextMap()
      const named = map.debt.filter((marker) => marker.areas.length > 0)
      const unowned = map.debt.filter((marker) => marker.areas.length === 0)
      expect(named.length).toBeGreaterThan(0)
      expect(unowned.length).toBeGreaterThan(0)
      expect(
        unowned.map((marker) => marker.blocker).filter((blocker) => /\[A\d/.test(blocker)),
      ).toEqual([])
    },
    COMPILER_TIMEOUT_MS,
  )
})

/**
 * And the one thing these two gates deliberately do **not** hold: the **wording**.
 *
 * {@link REFUSAL_SENTENCE} is the declaring surface, so a round that rewords it reworders the gate
 * with it and only the staleness check fires — which is the right split, because no gate in this
 * package reads prose for sense. What is held is the substance: a pattern name may appear in the
 * paragraph that refuses it and nowhere else, whatever that paragraph has come to say.
 */
describe('the refusal — no DDD integration-pattern label', () => {
  it(
    'states the refusal in the document, in the generator’s own words',
    () => {
      // The **generated** bytes, not the committed ones. Tampering the generator and running the
      // suite without regenerating made this gate pass on a stale file while only the staleness
      // check fired — the half-tamper pass A6 found, A7 reproduced and the cleanup round fixed, in
      // a third shape. A gate whose subject is what the generator emits has to read what it emits.
      expect(generateContextMap()).toContain(REFUSAL_SENTENCE)
    },
    COMPILER_TIMEOUT_MS,
  )

  it(
    'names a pattern only inside the paragraph that refuses it',
    () => {
      // The whole of the refusal's enforcement, because there is nothing else it could live in: no
      // vocabulary to leave a hole in, and no type-level witness for an absent type. Scoped to the
      // refusing **paragraph** and to nothing wider — the scoping lesson §3 item 19 generalises,
      // which is also why the paragraph that names the five patterns is the one allowed to.
      const paragraphs = generateContextMap().split(/\n\s*\n/)
      const refusal = paragraphs.find((paragraph) => paragraph.includes(REFUSAL_SENTENCE))
      expect(refusal).toBeDefined()
      const elsewhere = paragraphs.filter((paragraph) => paragraph !== refusal).join('\n\n')
      for (const pattern of REFUSED_PATTERN_NAMES) {
        expect(
          elsewhere.toLowerCase(),
          `\`${pattern}\` appears outside the paragraph that refuses it — the map does not publish ` +
            'an integration-pattern vocabulary, and a label that leaks into a row would be the ' +
            '[ORIGINAL] guess [SD §0] forbids',
        ).not.toContain(pattern)
      }
    },
    COMPILER_TIMEOUT_MS,
  )
})
