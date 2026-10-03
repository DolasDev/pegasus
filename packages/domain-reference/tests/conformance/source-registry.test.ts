/**
 * Conformance — the source registry's `areas:` field is a **prompt, not an inventory**, and A9's
 * citations are anchored to scored evidence rather than to it.
 *
 * ## Why this file does I/O
 *
 * The same reason `documents.test.ts` does: `src/` reads no file and imports nothing from the
 * repository, so a guard against drift between the code and the corpus has to read the corpus, and
 * the reading lives here.
 *
 * ## The finding this file exists because of
 *
 * [A9 §1] audited `sources/registry.yaml` against the source analyses and found that a source can
 * score an area non-zero without that area appearing in its `areas:` list — for **every one of the
 * thirteen areas**, not just A9. The sharpest instance is A9's own and is gated below:
 * `src:dtr-part-iv` scores A9 `3/3/n-a/3/n-a/3/3/1`, its analysis calls A9 _"The strongest area"_,
 * and its `areas:` does not name A9.
 *
 * That makes `areas:` the third of the corpus's routing hints to be read as an inventory, beside
 * `rubric.md`'s `v1 detail` column ([SD §0]'s warning) and its `Covers` column ([A6 §3.8],
 * [A7 §3.10], [A9 §3.8]). The registry's own header says what it is: a discovery artefact, written
 * during four research passes on 2026-09-11, before any source was analysed.
 *
 * **What is NOT gated here, and why.** The size of the mismatch is a count over a discovery
 * artefact, and [A1 §9]'s rule is that a count in prose is gated or deleted. A gate over that count
 * would fail the day someone curates the registry — which is the outcome the finding recommends —
 * so [A9 §1] states the property and deletes the number rather than gating it. What is gated is
 * the part that must stay true: **every source A9 cites carries a scored A9 row**, so no row of
 * `data/identity-schemes.json` rests on a source that was never scored for this area.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { loadIdentitySchemes } from '../../src/index'
import {
  SOURCES_DIR,
  analysedSources,
  c6ShareByArea,
  hasScoreTable,
  registryAreas,
  registryIds,
  registryRole,
  registryText,
  scoredAreas,
} from '../../tools/source-registry'

import identitySchemes from '../../data/identity-schemes.json'

const registry = registryText()
const analysed = analysedSources()

const table = loadIdentitySchemes(identitySchemes)
const cited = [
  ...new Set([...table.rows.values()].flatMap((row) => row.witnesses.map((w) => w.source))),
].sort()

/** The two halves of the registry — B1's split, on the presence of a score table and never on `status:`. */
const ids = registryIds(registry)
const generatedHalf = ids.filter((id) => hasScoreTable(id))
const handWrittenHalf = ids.filter((id) => !hasScoreTable(id))

/** The rubric's thirteen areas. A hint may point at any of them and at nothing else. */
const RUBRIC_AREAS = Array.from({ length: 13 }, (_, index) => `A${String(index + 1)}`)

/** A1 < A2 < … < A13, so a failure's diff reads in rubric order rather than lexically. */
const byAreaNumber = (left: string, right: string): number =>
  Number(left.slice(1)) - Number(right.slice(1))

describe("[A9 §1] every source A9's table cites is external and is scored for A9", () => {
  it('cites exactly these sources', () => {
    // Enumerated rather than counted ([A1 §9]). If a row gains or loses a witness, this names it.
    expect(cited).toEqual([
      'atlas-world-group-api',
      'cfr-49-375',
      'dp3-400ng',
      'dp3-tender-of-service',
      'dtr-part-iv',
      'milmove-mymove',
      'nmfta-ebol',
      'project44',
      'sirva-ade',
      'stedi-x12-reference',
      'weichert-supplier-api',
      'x12-212-trailer-manifest',
      'x12-858-implementation-guide',
    ])
  })

  it('none of them is `role: mapping-only`', () => {
    // [SD §0] and the rubric's scope rule: our own systems are not evidence for what the domain IS.
    // [A7 §1] found the previous round's plan had this wrong in the other direction — it called an
    // external partner contract one of ours — so the check runs per source against the registry
    // rather than against any list.
    for (const source of cited) {
      expect(`${source}: ${registryRole(source)}`).not.toContain('mapping-only')
    }
  })

  it('each carries a scored A9 row in its own analysis', () => {
    // The anchor: no row of the witnessed-scheme table may rest on a source that was never scored
    // for this area. Fails by name.
    for (const source of cited) {
      expect(analysed.has(source)).toBe(true)
      expect(`${source} scores: ${[...scoredAreas(source)].sort().join(' ')}`).toContain('A9')
    }
  })
})

describe('[A9 §1] `areas:` is a prompt, not an inventory', () => {
  it('src:dtr-part-iv scores A9 and the registry NOW routes A9 to it — B1', () => {
    // **This assertion is inverted from the one A9 shipped**, and the inversion is the deliverable.
    // A9 gated the sharp instance of its finding: the source whose own analysis calls A9 "The
    // strongest area" was not discoverable as an A9 source through `areas:`. Its comment said that
    // if a later curation pass fixed the registry this should fail and send the reader to [A9 §1]
    // to amend the claim. B1 is that pass, the test failed exactly as predicted, and [A9 §1] is
    // amended rather than left standing.
    //
    // Kept rather than deleted, because the same source is still the sharpest case — now of the
    // gate working.
    expect(scoredAreas('dtr-part-iv').has('A9')).toBe(true)
    expect(registryAreas('dtr-part-iv').has('A9')).toBe(true)
    expect(readFileSync(`${SOURCES_DIR}dtr-part-iv/analysis.md`, 'utf8')).toContain(
      'The strongest area',
    )
  })

  it("A9's share of `C6 = 3` is the highest of the thirteen areas, by a wide margin", () => {
    // [A9 §2.1]'s claim, gated rather than written as a number — and gated as a COMPARISON so that
    // it survives a source being added or re-scored, which a bare count would not. "Wide margin"
    // is held as a real threshold: A9 must beat the runner-up by more than half again.
    const shares = c6ShareByArea()
    const a9 = shares.get('A9')
    expect(a9).toBeDefined()
    const others = [...shares].filter(([area]) => area !== 'A9').map(([, share]) => share)
    const runnerUp = Math.max(...others)
    expect(
      a9 ?? 0,
      `A9 scores C6=3 on ${((a9 ?? 0) * 100).toFixed(0)}% of its rows; the next area scores ${(
        runnerUp * 100
      ).toFixed(0)}%`,
    ).toBeGreaterThan(runnerUp * 1.5)
  })

  it('the registry header says which half of `areas:` is which — B1', () => {
    // A9's comment said `areas` is a discovery hint, full stop. After B1 that is true of the
    // hand-written half and false of the generated half, and a comment that does not say so is the
    // same defect one turn later — the plan's words. The comment must name the rule rather than a
    // count, so what is gated is the rule's text.
    expect(registry).toContain('GENERATED for any source whose sources/<id>/analysis.md has a')
    expect(registry).toContain('a DISCOVERY hint for every other entry')
  })
})

describe('[B1] `areas:` is generated for the scored half and hand-written for the rest', () => {
  /**
   * The hybrid, and why it is a hybrid.
   *
   * Only the sources with a score table can have `areas:` generated. For the rest it is the **only**
   * signal there is — a hand-written discovery hint from the 2026-09-11 research passes — and
   * regenerating it would delete real information rather than correct it. So the gate holds the two
   * halves to different rules, and the registry's schema comment says which is which.
   *
   * Every mismatch is **named**, never counted ([A1 §9], [A9]'s C6-density gate): one `it` per
   * source, so a failure names the entry in its own title rather than in a total.
   */
  it('splits the registry into a generated half and a hand-written half', () => {
    // Not a count of either half — a statement that both exist and are disjoint, which is what the
    // two rules below depend on. A count here would fail the day a source is analysed, which is the
    // outcome the whole field exists to encourage.
    expect(generatedHalf.length, 'no source has a score table').toBeGreaterThan(0)
    expect(handWrittenHalf.length, 'every source has a score table').toBeGreaterThan(0)
    expect(generatedHalf.length + handWrittenHalf.length).toBe(ids.length)
    expect(generatedHalf.filter((id) => handWrittenHalf.includes(id))).toEqual([])
  })

  describe('the generated half — `areas:` is exactly the areas scored non-zero', () => {
    it.each(generatedHalf)('%s', (sourceId) => {
      const scored = [...scoredAreas(sourceId)].sort(byAreaNumber)
      const declared = [...registryAreas(sourceId, registry)].sort(byAreaNumber)
      expect(
        declared,
        `src:${sourceId} has a score table, so its \`areas:\` is generated: exactly the areas it ` +
          'scores non-zero, nothing else. Regenerate it by hand from the score rows — an area with ' +
          'no row, or a row scored 0/n-a throughout, is not evidence the source informs it.',
      ).toEqual(scored)
    })
  })

  describe('the hand-written half — a discovery hint, so it must still BE one', () => {
    /**
     * **What this does not assert, and why the obvious assertion would be worthless.**
     *
     * The first draft of this block asserted that each hand-written entry has no scored rows. That
     * is a **tautology**: `handWrittenHalf` is filtered on exactly that predicate, so the assertion
     * restates its own filter and can never fail. It was written to catch "the day the split moves"
     * and it cannot — found by tampering, which is the only way a tautology ever is ([A2 §9]'s
     * finding, that an assertion can be live and still unfailable).
     *
     * **The split moving is already caught**, one block up: a source that acquires a score table
     * joins the generated half immediately, and its hand-written `areas:` then fails that rule by
     * name until somebody regenerates it. Verified by giving an unscored source a score table — the
     * failure named it and pointed at the score rows.
     *
     * So what is left to check here is what the field must be for an entry with no analysis behind
     * it: a hint that exists and points somewhere real. Both are properties of the data rather than
     * of the filter.
     */
    it.each(handWrittenHalf)('%s', (sourceId) => {
      const declared = [...registryAreas(sourceId, registry)]
      // An EMPTY hint is legitimate and is not asserted against: `src:fidi-mmsa` and
      // `src:generic-low-relevance` are `status: skipped` and `src:inbox-notes` is raw user leads,
      // and for those "routes nowhere" is true information rather than a gap. The first draft of
      // this assertion required a non-empty list and named exactly those three — a gate that fires
      // on correct data is a gate people delete.
      expect(
        declared.filter((area) => !RUBRIC_AREAS.includes(area)),
        `src:${sourceId} routes to an area id the rubric does not have. A hint pointing nowhere is ` +
          'worse than none, because it reads as routing.',
      ).toEqual([])
    })
  })
})
