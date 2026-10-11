/**
 * Conformance — **retention**: can a reader re-check what the model says?
 *
 * `[plan §8.3(2)]`. The reference's confident readings and its unverifiable ones looked identical to
 * anyone reading the generated documents: the state was recorded in `sources/registry.yaml`, which a
 * migrator never opens. These gates hold the surface that fixes it.
 *
 * ## The four axes, and why no gate here merges them
 *
 * | axis             | question                            | authored in                     |
 * | ---------------- | ----------------------------------- | ------------------------------- |
 * | `retention`      | can anyone re-check the bytes       | `registry.yaml`                 |
 * | `evidence_grade` | how thoroughly **we** read them     | each `analysis.md` front matter |
 * | `authored`       | the source's reading or **ours**    | `data/authority-table.json`     |
 * | `confidence`     | the row's own stated confidence     | `data/authority-table.json`     |
 *
 * `rubric.md:152` already owns the phrase "evidence grade" for the second. A gate that checked a
 * single combined score would make the first unnameable, and the pairing that actually misleads —
 * `evidence_grade: A` on an `analysis-only` source, a document read in full that nobody can open —
 * is invisible in any fold of the two.
 *
 * ## Why retention is authored rather than measured from the filesystem
 *
 * Because measuring it is wrong. `sources/<id>/captured/` exists for 9 sources and **3 of those 9
 * are not captured**: two hold our own notes (`notes-only`), one holds a README whose first line is
 * "EMPTY" plus a derived file while the real bytes sit elsewhere in this repo (`refs-in-repo`). And
 * two sources with no `captured/` at all carry sha256 digests in the registry and are not
 * analysis-only either — their bytes are on one disk (`local-only`). So the gates below check the
 * declaration against what the filesystem can actually prove, and no further.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { rowStrings, SYMPTOM_INDEX_FILE } from '../../tools/generate-symptom-index.ts'
import {
  analysisEvidenceGrade,
  citedSourceIds,
  RECHECKABLE_FROM_THIS_REPO,
  registryIds,
  registryRetention,
  registryText,
  RETENTION_GLOSS,
  RETENTION_STATES,
  retentionDisagreements,
  type RetentionState,
} from '../../tools/source-registry.ts'

import authorityTable from '../../data/authority-table.json'

// `rowStrings` is IMPORTED from the generator rather than re-implemented here. An earlier cut had a
// local `allStrings` with an identical body, which is precisely what `source-registry.ts`'s opening
// paragraph forbids: "two parsers of one format would be a gate and a near-copy of a gate, agreeing
// until the day the table is reshaped". The gate must walk the same tree the generator walks, or it
// stops gating the generator.
const citedByAuthorityTable = [...citedSourceIds(rowStrings(authorityTable).join('\n'))].sort()

/**
 * Re-declare one entry's `retention:`, addressing the entry rather than the first match.
 *
 * Written after a first attempt tampered with `registryText().replace('\n  retention:
 * captured-here', …)` and silently hit **`src:milmove-mymove`**, which happens to be declared
 * earlier in the file than the entry the test named. The test then passed its own tamper and
 * asserted about a source it had not touched — a tamper that changes something other than the thing
 * under test is worse than no tamper, because it reads as coverage.
 */
function withRetention(sourceId: string, state: string, registry = registryText()): string {
  const marker = `\n- id: ${sourceId}\n`
  const [head, ...rest] = registry.split(marker)
  if (rest.length !== 1) throw new Error(`expected exactly one entry for ${sourceId}`)
  const body = rest[0] as string
  const [entry, ...after] = body.split('\n- id: ')
  const replaced = (entry as string).replace(/\n {2}retention: *[^\n#]*/, `\n  retention: ${state}`)
  if (replaced === entry) throw new Error(`no retention: line in ${sourceId} to replace`)
  return (head as string) + marker + [replaced, ...after].join('\n- id: ')
}

describe('retention — the declaration', () => {
  it('is a closed set, spelled exactly once', () => {
    // A literal anchor beside the enum, not a re-read of it (gotcha 7: an assertion that compares
    // the system to itself gates co-drift, not drift). Adding a state is a deliberate act that
    // should break this line and make someone write the gloss and the registry schema entry.
    expect([...RETENTION_STATES]).toEqual([
      'captured-here',
      'refs-in-repo',
      'retained-elsewhere',
      'notes-only',
      'local-only',
      'analysis-only',
      'unrecoverable',
    ])
  })

  it('glosses every state, so nothing renders as a bare word', () => {
    expect(Object.keys(RETENTION_GLOSS).sort()).toEqual([...RETENTION_STATES].sort())
  })

  it('treats only in-repo bytes as re-checkable from a clone', () => {
    // `retained-elsewhere` is deliberately NOT here, and deliberately not lumped with
    // `analysis-only` either. src:sirva-ade is 228 citations of primary bytes that are
    // version-controlled in a private repo: checkable by a reader with access, which is a third
    // thing. Conflating it with "unverifiable" is the exact error [plan §8.3(2)] corrected, and an
    // earlier cut of the generator committed it again.
    expect([...RECHECKABLE_FROM_THIS_REPO]).toEqual(['captured-here', 'refs-in-repo'])
  })

  it('tampers the entry it names, and only that entry', () => {
    // The three gates below perform their own tamper through `withRetention`, so if the helper were
    // broken they would pass VACUOUSLY — green because nothing changed, which is the shape of
    // failure this round already hit once (a `sed` tamper that matched nothing and read as a
    // working gate). This asserts the helper actually edits, and edits the right entry: the first
    // attempt used a plain `.replace()` and silently hit `src:milmove-mymove`, which is declared
    // earlier in the file than the entry the test named.
    const tampered = withRetention('cfr-49-375', 'analysis-only')
    expect(tampered).not.toBe(registryText())
    expect(registryRetention('cfr-49-375', tampered)).toBe('analysis-only')
    expect(registryRetention('milmove-mymove', tampered)).toBe('captured-here')
    expect(registryRetention('milmove-mymove')).toBe('captured-here')
  })

  it('rejects a value outside the enum rather than reading it as ungraded', () => {
    const tampered = withRetention('cfr-49-375', 'captured-ish')
    expect(() => registryRetention('cfr-49-375', tampered)).toThrow(/not one of/)
  })

  it('reports no state at all for an undeclared source, never a default', () => {
    // `registryRole` defaults to `model-evidence`; retention must NOT default, because the failure
    // being prevented is a missing grade reading as a benign one.
    const undeclared = registryIds().filter((id) => registryRetention(id) === undefined)
    expect(undeclared.length).toBeGreaterThan(0)
    expect(registryRetention(undeclared[0] as string)).toBeUndefined()
  })
})

describe('retention — every source the model leans on carries one', () => {
  it('declares a retention state for every source the authority table cites', () => {
    // The gate that makes the surface honest: an undeclared cited source renders as a blank cell,
    // and a reader reads a blank as "fine". The generator throws on this too; this names which.
    const ungraded = citedByAuthorityTable.filter((id) => registryRetention(id) === undefined)
    expect(ungraded).toEqual([])
  })

  it('cites exactly the sources measured on 2026-10-11', () => {
    // Enumerated, not counted ([A1 §9]). A new citation must come with a retention declaration, and
    // this line is where that becomes a decision rather than a silent widening.
    expect(citedByAuthorityTable).toEqual([
      'atlas-world-group-api',
      'cfr-49-375',
      'dcsa',
      'dp3-400ng',
      'dp3-tender-of-service',
      'dtr-part-iv',
      'macropoint',
      'milmove-mymove',
      'nmfta-ebol',
      'sirva-ade',
      'stedi-x12-reference',
      'uncefact-rec24',
    ])
  })

  it('finds citations outside `evidence`, because they are there', () => {
    // `sitEntryDate`'s evidence reads "SOURCED twice, from opposite directions — see settlement",
    // and its sources are one field away. Reading `evidence` alone rendered the row as uncited:
    // a false negative in the one surface built to prevent false confidence.
    const row = authorityTable.rows.find((r) => r.type === 'sitEntryDate')
    expect(row).toBeDefined()
    expect(citedSourceIds(row?.evidence ?? '')).toEqual([])
    expect([...citedSourceIds(rowStrings(row).join('\n'))].sort()).toEqual([
      'dp3-400ng',
      'dtr-part-iv',
    ])
  })
})

describe('retention — the declaration agrees with the filesystem', () => {
  it('has no source claiming more or less than the files show', () => {
    expect(retentionDisagreements()).toEqual([])
  })

  it('catches a captured-here claim with nothing captured', () => {
    // src:dp3-tender-of-service has no captured/ at all, so re-declaring it captured-here is the
    // cheapest possible version of the lie this gate exists to refuse.
    const tampered = withRetention('dp3-tender-of-service', 'captured-here')
    expect(retentionDisagreements(tampered)).toEqual([
      expect.stringContaining('dp3-tender-of-service declares captured-here'),
    ])
  })

  it('catches analysis-only declared over bytes that are sitting right there', () => {
    // The inverse, and the more insidious direction: prose graded unverifiable while the source's
    // own files are in the repo next to it. src:cfr-49-375 has captured/cfr-49-375.xml.
    const tampered = withRetention('cfr-49-375', 'analysis-only')
    expect(retentionDisagreements(tampered)).toEqual([
      expect.stringContaining('cfr-49-375 declares analysis-only'),
    ])
  })
})

describe('retention — it reaches the surface a migrator actually reads', () => {
  const index = readFileSync(SYMPTOM_INDEX_FILE, 'utf8')

  // Every assertion below is a REGEX, never a literal table row. The pre-commit hook runs Prettier
  // over markdown and Prettier pads table columns to align them, so a literal would fail on
  // whitespace alone the first time a neighbouring cell changed width (gotcha 1 — it has already
  // caught one assertion in this package).

  it('carries the recourse column in the index table', () => {
    expect(index).toMatch(/\|\s*can you re-check it\?\s*\|/)
  })

  it('tells a reader what each recourse mark means', () => {
    expect(index).toMatch(/●\s*open\s*—\s*clone and grep/)
    expect(index).toMatch(/◍\s*with access\s*—\s*another repo/)
    expect(index).toMatch(/○\s*closed\s*—\s*unverifiable/)
  })

  it('keeps retention and evidence_grade visibly separate, as two columns', () => {
    // The one thing this round must not do is render retention under the name "evidence grade".
    expect(index).toMatch(/\|\s*retention\s*\|.*\|\s*our reading \(S4\)\s*\|/)
  })

  it('names the sources that are fully read and unverifiable', () => {
    // The headline finding, in the document rather than in a commit message.
    expect(index).toMatch(/cannot be re-checked from a clone/)
    expect(index).toMatch(/`src:dp3-tender-of-service`/)
  })

  it('does not call src:dp3-400ng analysis-only', () => {
    // #832's hand-written paragraph did exactly that. Its bytes are real and on one disk, and
    // grading it analysis-only is the src:sirva-ade error in reverse — under-grading a source by
    // conflating "not in git" with "never existed".
    expect(index).toMatch(/`src:dp3-400ng`\s*\|\s*\*\*local-only\*\*/)
    expect(index).not.toMatch(/`src:dp3-400ng`[^|\n]*\|[^|\n]*analysis-only/)
  })

  it('still discloses that a per-source state is a floor, not a guarantee', () => {
    // src:dcsa has 125 captured files and lost a cited sub-spec. If this disclosure disappears the
    // table starts reading as a verification, which it is not.
    expect(index).toMatch(/floor, not a guarantee/)
    expect(index).toMatch(/per-citation\*\*? grain is owed/)
  })
})

describe('retention — the pairing that manufactures false confidence', () => {
  it('still has sources read in full that no second reader can open', () => {
    // NOT a target to drive to zero — it is a standing property of this corpus and the reason the
    // surface exists. The assertion is that the model keeps SAYING so: if this list empties because
    // someone relaxed a grade rather than captured a source, the gate above about filesystem
    // agreement is what catches it.
    const unverifiableButFullyRead = citedByAuthorityTable.filter((id) => {
      const state = registryRetention(id)
      return (
        state !== undefined &&
        !RECHECKABLE_FROM_THIS_REPO.includes(state) &&
        analysisEvidenceGrade(id) === 'A'
      )
    })
    expect(unverifiableButFullyRead.sort()).toEqual([
      'dp3-tender-of-service',
      'nmfta-ebol',
      'sirva-ade',
      'uncefact-rec24',
    ])
  })

  it('keeps the two axes independent — neither predicts the other', () => {
    // If retention and evidence_grade ever became a function of one another, one of them would be
    // redundant and the four-column render would be dishonest. Measured: `A` appears on both
    // captured-here and analysis-only; `B` appears on both refs-in-repo and analysis-only.
    const pairs = citedByAuthorityTable.map(
      (id) => `${registryRetention(id) as RetentionState}/${analysisEvidenceGrade(id) ?? 'none'}`,
    )
    expect(pairs).toContain('captured-here/A')
    expect(pairs).toContain('analysis-only/A')
    expect(pairs).toContain('refs-in-repo/B')
    expect(pairs).toContain('analysis-only/B')
  })
})
