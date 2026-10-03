/**
 * The **one** reader of `docs/domain-reference/sources/` — the score rows and the registry.
 *
 * ## Why this exists as a module rather than as helpers inside a test
 *
 * `[A9 §1]` measured that `registry.yaml`'s `areas:` field is not the inventory it reads as, and the
 * cleanup round's B1 makes it one for the half of the corpus that can have it generated. That needs
 * a reader on both sides: the gate that holds `areas:` to the scores, and the earlier A9 checks that
 * anchor citations to scored evidence. **Two parsers of one score-row format would be a gate and a
 * near-copy of a gate**, agreeing until the day the table is reshaped — so the regex and the cell
 * rule live here once and both callers import them.
 *
 * The plan for B1 was explicit about this: _"do not write a second, subtly different parser for the
 * score-row regex; export the one that is already tamper-tested."_ What follows is that one, moved
 * out of `tests/conformance/source-registry.test.ts` unchanged.
 *
 * ## Why it reads files at all
 *
 * The same reason `documents.test.ts` and `generate-glossary.ts` do: `src/` reads no file and
 * imports nothing from the repository, so a guard against drift between the code and the corpus has
 * to read the corpus. Nothing in `src/` depends on this module.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SOURCES_DIR = fileURLToPath(
  new URL('../../../docs/domain-reference/sources/', import.meta.url),
)

/** `registry.yaml`, read once. */
export function registryText(): string {
  return readFileSync(`${SOURCES_DIR}registry.yaml`, 'utf8')
}

/**
 * A scored row: an area label followed by **eight** criterion cells.
 *
 * The eight is load-bearing and is the thing a reshape of the table would break — which is why a
 * single exported constant is worth more than two copies. A caller decides what counts as scored;
 * {@link scoredAreas} applies the rule `[A9 §1]` states.
 */
export const SCORE_ROW =
  /^\|\s*(?:\*\*)?(A\d+)(?:\*\*)?[^|]*\|((?:\s*(?:\*\*)?(?:[0-3]|n\/a|n-a|N\/A)(?:\*\*)?\s*\|){8})/gm

/** The eight criterion cells of a score row, bold markers stripped. */
export function scoreCells(scores: string): readonly string[] {
  return scores
    .split('|')
    .slice(0, -1)
    .map((cell) => cell.trim().replace(/\*\*/g, ''))
}

/** Every source id that has an `analysis.md`. */
export function analysedSources(): ReadonlySet<string> {
  return new Set(
    readdirSync(SOURCES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          readFileSync(`${SOURCES_DIR}${name}/analysis.md`, 'utf8')
          return true
        } catch {
          return false
        }
      }),
  )
}

/**
 * The areas one source's analysis scores **non-zero**.
 *
 * `[A9 §1]`'s rule, and the reason it is not "every area with a row": a row scored `0` / `n-a`
 * throughout is not evidence the source informs the area. `src:uncefact-rec24` forces it — it
 * carries an A9 row scored `0 / n-a / … / 0` and belongs in nobody's list.
 *
 * Returns an empty set for a source with no `analysis.md`, which is also how B1's gate tells the
 * two halves of the registry apart — see {@link hasScoreTable}.
 */
export function scoredAreas(sourceId: string): ReadonlySet<string> {
  let text: string
  try {
    text = readFileSync(`${SOURCES_DIR}${sourceId}/analysis.md`, 'utf8')
  } catch {
    return new Set()
  }
  const areas = new Set<string>()
  for (const match of text.matchAll(SCORE_ROW)) {
    const [, area, scores] = match
    if (area === undefined || scores === undefined) continue
    if (scoreCells(scores).some((cell) => /^[1-3]$/.test(cell))) areas.add(area)
  }
  return areas
}

/**
 * Whether a source has a score table at all — B1's split, and **never** `status:`.
 *
 * The two do not agree and the disagreement is deliberate: `src:pegii-order` has an `analysis.md`
 * **with** a score table and `status: needs-user`, because `status` records whether the *material*
 * was obtained and not whether an analysis was written. A split keyed on `status: analyzed` would
 * exclude a source that has scores, and "fixing" the status to make a gate pass would destroy a true
 * statement. Found while sizing B1, by two counts disagreeing by one.
 */
export function hasScoreTable(sourceId: string): boolean {
  return scoredAreas(sourceId).size > 0
}

/**
 * For each area, the share of scored rows across the whole corpus that give it `C6 = 3`.
 *
 * `C6` is _"Identity & references"_ — A9's own criterion — and `[A9 §2.1]` leans on its
 * distribution. Computed rather than written into the document, per `[A1 §9]`.
 */
export function c6ShareByArea(): ReadonlyMap<string, number> {
  const rows = new Map<string, number>()
  const threes = new Map<string, number>()
  for (const source of analysedSources()) {
    const text = readFileSync(`${SOURCES_DIR}${source}/analysis.md`, 'utf8')
    for (const match of text.matchAll(SCORE_ROW)) {
      const [, area, scores] = match
      if (area === undefined || scores === undefined) continue
      rows.set(area, (rows.get(area) ?? 0) + 1)
      if (scoreCells(scores)[5] === '3') threes.set(area, (threes.get(area) ?? 0) + 1)
    }
  }
  return new Map([...rows].map(([area, n]) => [area, (threes.get(area) ?? 0) / n]))
}

/** One registry entry's body, from its `- id:` line to the next. */
export function registryEntry(sourceId: string, registry = registryText()): string {
  const after = registry.split(`\n- id: ${sourceId}\n`)[1]
  if (after === undefined) throw new Error(`no registry entry for ${sourceId}`)
  return after.split('\n- id: ')[0] ?? after
}

/** The `areas:` list of one registry entry, as the registry states it. */
export function registryAreas(sourceId: string, registry = registryText()): ReadonlySet<string> {
  const line = /\n {2}areas: *([^\n]*)/.exec(registryEntry(sourceId, registry))
  return new Set(line?.[1]?.match(/A\d+/g) ?? [])
}

/** `role:` as the registry states it; an absent role means the default, which is model evidence. */
export function registryRole(sourceId: string, registry = registryText()): string {
  const line = /\n {2}role: *([^\n#]*)/.exec(registryEntry(sourceId, registry))
  return line?.[1]?.trim() ?? 'model-evidence'
}

/** Every source id the registry declares, in the order it declares them. */
export function registryIds(registry = registryText()): readonly string[] {
  return [...registry.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1] ?? '')
}
