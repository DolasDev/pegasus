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
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadIdentitySchemes } from '../../src/index'

import identitySchemes from '../../data/identity-schemes.json'

const sourcesDir = fileURLToPath(
  new URL('../../../../docs/domain-reference/sources/', import.meta.url),
)
const registry = readFileSync(`${sourcesDir}registry.yaml`, 'utf8')

const table = loadIdentitySchemes(identitySchemes)
const cited = [
  ...new Set([...table.rows.values()].flatMap((row) => row.witnesses.map((w) => w.source))),
].sort()

/** Every source id that has an `analysis.md`. */
const analysed = new Set(
  readdirSync(sourcesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        readFileSync(`${sourcesDir}${name}/analysis.md`, 'utf8')
        return true
      } catch {
        return false
      }
    }),
)

/** A scored row: an area label followed by eight criterion cells, at least one non-zero. */
const SCORE_ROW =
  /^\|\s*(?:\*\*)?(A\d+)(?:\*\*)?[^|]*\|((?:\s*(?:\*\*)?(?:[0-3]|n\/a|n-a|N\/A)(?:\*\*)?\s*\|){8})/gm

function scoredAreas(sourceId: string): ReadonlySet<string> {
  const text = readFileSync(`${sourcesDir}${sourceId}/analysis.md`, 'utf8')
  const areas = new Set<string>()
  for (const match of text.matchAll(SCORE_ROW)) {
    const [, area, scores] = match
    if (area === undefined || scores === undefined) continue
    const cells = scores
      .split('|')
      .slice(0, -1)
      .map((cell) => cell.trim().replace(/\*\*/g, ''))
    if (cells.some((cell) => /^[1-3]$/.test(cell))) areas.add(area)
  }
  return areas
}

/**
 * For each area, the share of scored rows across the whole corpus that give it `C6 = 3`.
 *
 * `C6` is _"Identity & references"_ — A9's own criterion — and [A9 §2.1] leans on its distribution:
 * the area is over-covered on **mechanism** and thin on **terms**, which is the whole argument for
 * [A9 §4]'s weighting and half the argument for [A9 §3.2]. The number is computed rather than
 * written into the document, per [A1 §9].
 */
function c6ShareByArea(): ReadonlyMap<string, number> {
  const rows = new Map<string, number>()
  const threes = new Map<string, number>()
  for (const source of analysed) {
    const text = readFileSync(`${sourcesDir}${source}/analysis.md`, 'utf8')
    for (const match of text.matchAll(SCORE_ROW)) {
      const [, area, scores] = match
      if (area === undefined || scores === undefined) continue
      const cells = scores
        .split('|')
        .slice(0, -1)
        .map((cell) => cell.trim().replace(/\*\*/g, ''))
      rows.set(area, (rows.get(area) ?? 0) + 1)
      if (cells[5] === '3') threes.set(area, (threes.get(area) ?? 0) + 1)
    }
  }
  return new Map([...rows].map(([area, n]) => [area, (threes.get(area) ?? 0) / n]))
}

/** One registry entry's body, from its `- id:` line to the next. */
function registryEntry(sourceId: string): string {
  const after = registry.split(`\n- id: ${sourceId}\n`)[1]
  if (after === undefined) throw new Error(`no registry entry for ${sourceId}`)
  return after.split('\n- id: ')[0] ?? after
}

/** The `areas:` list of one registry entry, as the registry states it. */
function registryAreas(sourceId: string): ReadonlySet<string> {
  const line = /\n {2}areas: *([^\n]*)/.exec(registryEntry(sourceId))
  return new Set(line?.[1]?.match(/A\d+/g) ?? [])
}

/** `role:` as the registry states it; an absent role means the default, which is model evidence. */
function registryRole(sourceId: string): string {
  const line = /\n {2}role: *([^\n#]*)/.exec(registryEntry(sourceId))
  return line?.[1]?.trim() ?? 'model-evidence'
}

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
  it('src:dtr-part-iv scores A9 and the registry does not route A9 to it', () => {
    // The sharp instance, gated because the prose leans on it: the source whose own analysis calls
    // A9 "The strongest area" is not discoverable as an A9 source through `areas:`. If a later
    // curation pass fixes the registry, this fails and sends the reader to [A9 §1] to delete the
    // claim rather than leaving it standing unsupported.
    expect(scoredAreas('dtr-part-iv').has('A9')).toBe(true)
    expect(registryAreas('dtr-part-iv').has('A9')).toBe(false)
    expect(readFileSync(`${sourcesDir}dtr-part-iv/analysis.md`, 'utf8')).toContain(
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

  it('the registry header says `areas:` is a discovery artefact', () => {
    // The documentation half of the finding, and the only edit A9 makes to the registry: the
    // schema comment now says what the field is, so the next reader does not have to measure it.
    expect(registry).toContain('`areas` is a DISCOVERY hint, not an')
  })
})
