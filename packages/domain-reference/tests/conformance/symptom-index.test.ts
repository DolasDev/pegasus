/**
 * Conformance — the **symptom index**, and the one hand-written table behind it.
 *
 * The index is the path into this model from a *symptom* — a legacy MoveManager module folder —
 * rather than from the vocabulary, which is how `glossary.md` is organised and why it cannot be
 * entered from legacy code. It is generated; `data/legacy-correspondence.json` is the only authored
 * input.
 *
 * **What is worth gating here, and why.** The generator already refuses to run when the authored
 * half names a concept the published catalog does not carry — so the interesting failures are the
 * ones a throw cannot express: the committed artefact going stale, the correspondence quietly losing
 * its disclosure (a row with no `basis` is an unsourced claim, which `[SD §0]` forbids), and the
 * gap-pointing rows silently emptying. **A migrator meeting `_SurveyResults/` must be told the
 * reference has nothing**, and an index that stops saying so has lost the thing that made it worth
 * generating.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { SYMPTOM_INDEX_FILE, generateSymptomIndex } from '../../tools/generate-symptom-index.ts'

import correspondence from '../../data/legacy-correspondence.json'
import catalogIndex from '../../../../docs/domain-reference/catalog/index.json'

const modules = correspondence.modules as readonly {
  module: string
  concepts: string[]
  absentConcepts?: string[]
  aggregates: string[]
  confidence: string
  basis: string
  note: string
}[]

describe('the generated symptom index', () => {
  it('is committed in the state the generator produces', async () => {
    // The same contract the glossary, catalog and context map hold: the artefact in the repo is the
    // generator's output, so a reader is never looking at something that drifted from the model.
    expect(readFileSync(SYMPTOM_INDEX_FILE, 'utf8')).toBe(await generateSymptomIndex())
  })

  it('names every MoveManager module folder measured, and no others', () => {
    // Enumerated rather than counted ([A1 §9]). A folder appearing in movemanager without a row
    // here is the failure this catches on the next re-measure.
    expect(modules.map((m) => m.module).sort()).toEqual([
      '_Account',
      '_Billing',
      '_Configuration',
      '_Crew',
      '_Database',
      '_Driver',
      '_Employee',
      '_Flash',
      '_FlatRateAuto',
      '_Lead',
      '_LocalDispatch',
      '_Masters',
      '_MenuSpecifications',
      '_Ops',
      '_Person',
      '_Portal',
      '_PremiumServiceDetail',
      '_Sale',
      '_Shared',
      '_StoredProcedures',
      '_SurveyResults',
      '_Task',
      '_TestForms',
      '_TextMessaging',
      '_Vehicle',
      '_WarehouseCommercial',
      '_WarehouseHouseholdGoods',
      '_zUnsorted',
    ])
  })
})

describe('the authored half keeps its disclosure', () => {
  it('states a `basis` and a `note` on every row', () => {
    // [SD §0]: every claim cites what it is taken from or is marked authored. The correspondence is
    // authored by construction, so `basis` — what in the legacy code was read — is the whole of its
    // disclosure. An empty one is an unsourced mapping wearing a sourced one's clothes.
    for (const m of modules) {
      expect(m.basis.trim().length, `${m.module} has no basis`).toBeGreaterThan(0)
      expect(m.note.trim().length, `${m.module} has no note`).toBeGreaterThan(0)
    }
  })

  it('marks confidence with a declared value, so "unknown" stays sayable', () => {
    const legend = Object.keys(correspondence.confidenceLegend)
    for (const m of modules) {
      expect(legend, `${m.module}: ${m.confidence} is not in the legend`).toContain(m.confidence)
    }
    // `unknown` must remain in the legend even when unused: a round that cannot name a module's
    // concept has to be able to say so rather than reach for the nearest plausible mapping.
    expect(legend).toContain('unknown')
  })

  it('does not put an aggregate-only kind in the concepts column', () => {
    // The generator caught this on its first run: `order`, `trip` and `stop` are SUBJECTS, not fact
    // classes, and listing them as concepts would tell a migrator the model carries an `order`
    // assertion. `charge` and `partyRole` are legitimately BOTH — measured against the wire, they
    // are the only two — so they are admitted here rather than lumped in.
    const types = new Set(
      (catalogIndex.members as { type: string; kind?: string }[])
        .filter((m) => m.kind !== 'meta')
        .map((m) => m.type),
    )
    for (const m of modules) {
      for (const concept of m.concepts) {
        expect(types.has(concept), `${m.module}: "${concept}" is not a published fact class`).toBe(
          true,
        )
      }
    }
  })
})

describe('the index still points at the gaps — the reason it exists', () => {
  const absent = new Set(catalogIndex.owed.absentFactClasses as string[])

  it('tells a migrator in `_SurveyResults/` that the reference has NOTHING', () => {
    // The single most useful row in the table: three absent fact classes and no concept at all.
    // Silence is what the glossary gives today, and silence reads as "no match found" rather than
    // "this is a known gap".
    const survey = modules.find((m) => m.module === '_SurveyResults')
    expect(survey).toBeDefined()
    expect(survey?.concepts).toEqual([])
    expect(survey?.absentConcepts ?? []).toEqual(
      expect.arrayContaining(['survey', 'estimate', 'cube']),
    )
  })

  it('keeps every `absentConcepts` claim true of the published catalog', () => {
    // The direction that rots: a round WRITES `survey`, the catalog stops listing it as absent, and
    // this table goes on telling migrators there is nothing there. Then the index is worse than
    // absent, because it is confidently wrong.
    for (const m of modules) {
      for (const a of m.absentConcepts ?? []) {
        expect(absent.has(a), `${m.module}: "${a}" is no longer an absent fact class`).toBe(true)
      }
    }
  })

  it('renders the absent-class join, not just the list', async () => {
    const out = await generateSymptomIndex()
    // Whitespace-tolerant on purpose: the generator formats through Prettier, which PADS table
    // columns to align them, so a literal single-spaced header never matches. Asserting the padded
    // spelling instead would make this gate break on a Prettier version bump.
    expect(out).toMatch(/\|\s*absent fact class\s*\|\s*modules that need it\s*\|/)
    // `claim` is reached by `_Flash/` and nothing else; if the join silently emptied, this is the
    // assertion that notices.
    expect(out).toMatch(/\|\s*`claim`\s*\|.*_Flash/)
  })

  it("warns that the model's own evidence is not uniform", async () => {
    // A migrator weighting every reading equally is the failure mode the retention work exists for.
    const out = await generateSymptomIndex()
    expect(out).toContain('retained-elsewhere')
    expect(out).toContain('analysis-only')
  })
})
