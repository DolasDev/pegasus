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

/* ------------------------------------------------------------------------------------------------
 * Retention — can a reader re-check this source's bytes?
 * ---------------------------------------------------------------------------------------------- */

/**
 * The retention states, **worst recourse last**. Order is the render order and the ranking.
 *
 * ## This is NOT `evidence_grade`, and the distinction is the whole point
 *
 * `evidence_grade` (rubric S4, `analysis.md` front matter) grades **our reading** — A full spec
 * read, B partial, C secondhand. `retention` grades **the reader's recourse**. They are independent
 * axes, and the pair that manufactures false confidence is a **high S4 on an unrecoverable
 * retention**: `src:dp3-tender-of-service` is `evidence_grade: A` and `analysis-only`, meaning the
 * model read the entire document and nobody can now open it. Rendering retention under the name
 * "evidence grade" would collapse exactly the distinction this package exists to keep.
 *
 * ## Why these are declared in `registry.yaml` and not computed here
 *
 * The obvious implementation reads the filesystem: `sources/<id>/captured/` exists ⇒
 * `captured-here`. **Measured on 2026-10-11 that is wrong for 3 of the 9 directories that have
 * one**, in three different directions:
 *
 * - `src:stedi-x12-reference` and `src:x12-212-trailer-manifest` — `captured/` holds **our own
 *   notes** plus short quoted excerpts, each file saying of itself "not a mirror". `notes-only`.
 * - `src:atlas-world-group-api` — `captured/` holds a README whose first line is "EMPTY" and one
 *   file that says "NOT a capture … Derived entirely from the committed OpenAPI documents". The
 *   real bytes are 24 OpenAPI documents elsewhere **in this repo**. `refs-in-repo`.
 * - `src:dcsa` — 125 real files, and the cited JIT sub-spec was never among them. `[A8 §10]`.
 *
 * And the converse: `src:nmfta-ebol` and `src:dp3-400ng` carry sha256 digests in `files`/`refs` and
 * look captured from the registry alone, while every path named is **gitignored**. `local-only`.
 *
 * So the state is a claim about **where bytes are in the world**, which no `stat` can answer, and it
 * is authored for the same reason `data/legacy-correspondence.json` is. What a gate *can* do is hold
 * the declaration to what the filesystem proves — see {@link retentionDisagreements}.
 */
export const RETENTION_STATES = [
  'captured-here',
  'refs-in-repo',
  'retained-elsewhere',
  'notes-only',
  'local-only',
  'analysis-only',
  'unrecoverable',
] as const

export type RetentionState = (typeof RETENTION_STATES)[number]

/** Whether a reader who clones only this repo can open the bytes. */
export const RECHECKABLE_FROM_THIS_REPO: readonly RetentionState[] = [
  'captured-here',
  'refs-in-repo',
]

/** One-line reader-facing gloss per state. Rendered, so it lives beside the enum. */
export const RETENTION_GLOSS: Readonly<Record<RetentionState, string>> = {
  'captured-here': "the source's own bytes are in this repo under `sources/<id>/captured/`",
  'refs-in-repo': "the source's own bytes are in this repo, outside `sources/`, named by `refs`",
  'retained-elsewhere':
    'primary bytes are version-controlled in another repo — checkable with access',
  'notes-only': 'only **our** notes and short quoted excerpts; the raw bytes are gitignored',
  'local-only': 'the bytes sit on one machine and are in no git anywhere',
  'analysis-only': '`analysis.md` prose only — nobody can re-check the claim',
  unrecoverable: 'the bytes are gone from the world, not merely uncaptured',
}

function isRetentionState(value: string): value is RetentionState {
  return (RETENTION_STATES as readonly string[]).includes(value)
}

/**
 * The `retention:` one registry entry declares, or `undefined` when it declares none.
 *
 * Follows {@link registryRole}'s shape, with one deliberate difference: `role` has a documented
 * default (`model-evidence`) and **retention has none**. A source that has not been graded must read
 * as ungraded rather than as the mildest state, because the whole failure this field addresses is a
 * missing grade looking like a benign one.
 *
 * @throws if the entry declares a value that is not in {@link RETENTION_STATES} — a typo would
 * otherwise silently become "ungraded", which is the one outcome the gate cannot distinguish from an
 * honest omission.
 */
export function registryRetention(
  sourceId: string,
  registry = registryText(),
): RetentionState | undefined {
  const line = /\n {2}retention: *([^\n#]*)/.exec(registryEntry(sourceId, registry))
  const value = line?.[1]?.trim()
  if (value === undefined || value === '') return undefined
  if (!isRetentionState(value)) {
    throw new Error(
      `src:${sourceId} declares retention: ${value}, which is not one of ${RETENTION_STATES.join(' | ')}`,
    )
  }
  return value
}

/**
 * Where a declared retention state contradicts something the filesystem can actually prove.
 *
 * **Deliberately narrow.** It checks only the implications that are decidable from this repo, and
 * says nothing about the states whose truth lies outside it — `retained-elsewhere`, `local-only` and
 * `unrecoverable` are claims about other machines and other repos, and a gate that pretended to
 * verify them would be theatre. What is decidable:
 *
 * - `captured-here` ⇒ `sources/<id>/captured/` exists and is non-empty.
 * - `refs-in-repo` / `notes-only` ⇒ the source directory exists (both are claims about files here).
 * - `analysis-only` ⇒ there is **no** non-empty `captured/`, because that is the one pairing a
 *   reader would be actively misled by: prose graded unverifiable while bytes sit next to it.
 *
 * Returns one human-readable line per disagreement, empty when the declaration holds.
 */
export function retentionDisagreements(registry = registryText()): readonly string[] {
  const problems: string[] = []
  for (const id of registryIds(registry)) {
    const state = registryRetention(id, registry)
    if (state === undefined) continue
    const captured = capturedEntryCount(id)
    if (state === 'captured-here' && captured === 0) {
      problems.push(
        `src:${id} declares captured-here but sources/${id}/captured/ is missing or empty`,
      )
    }
    if (state === 'analysis-only' && captured > 0) {
      problems.push(
        `src:${id} declares analysis-only but sources/${id}/captured/ holds ${captured} entr${captured === 1 ? 'y' : 'ies'} — ` +
          'if those are our own notes the state is notes-only, not analysis-only',
      )
    }
    if ((state === 'refs-in-repo' || state === 'notes-only') && !sourceDirExists(id)) {
      problems.push(`src:${id} declares ${state} but sources/${id}/ does not exist`)
    }
  }
  return problems
}

/** Entries directly under `sources/<id>/captured/`, or 0 when there is no such directory. */
export function capturedEntryCount(sourceId: string): number {
  try {
    return readdirSync(`${SOURCES_DIR}${sourceId}/captured`).length
  } catch {
    return 0
  }
}

function sourceDirExists(sourceId: string): boolean {
  try {
    readdirSync(`${SOURCES_DIR}${sourceId}`)
    return true
  } catch {
    return false
  }
}

/**
 * `evidence_grade` from one source's `analysis.md` front matter — rubric **S4**, the grade of **our
 * reading**: `A` full spec/source read · `B` partial docs, samples, implementation guides · `C`
 * marketing, secondhand or inferred.
 *
 * Kept deliberately adjacent to {@link registryRetention} and deliberately **not merged with it**.
 * The two answer different questions — "how well did we read it" versus "can anyone re-check it" —
 * and `rubric.md` already owns the phrase "evidence grade" for this one. The combination worth
 * surfacing is a **high S4 on a poor retention**, which reads as authoritative and is uncheckable:
 * `src:dp3-tender-of-service` is `A` / `analysis-only`.
 *
 * Returns `undefined` when the source has no `analysis.md` or none is declared.
 */
export function analysisEvidenceGrade(sourceId: string): string | undefined {
  let text: string
  try {
    text = readFileSync(`${SOURCES_DIR}${sourceId}/analysis.md`, 'utf8')
  } catch {
    return undefined
  }
  return /^evidence_grade: *([ABC])\b/m.exec(text)?.[1]
}

/**
 * Every `src:<id>` cited in a block of prose, deduplicated, in first-appearance order.
 *
 * Pure on purpose: the citations this model needs graded live in
 * `data/authority-table.json`'s `evidence` strings, and `data/` is not this module's to read — it is
 * the reader of `docs/domain-reference/sources/`. Callers pass the text; this owns the one regex, so
 * a future second citation site does not bring a second, subtly different parser with it. Same
 * reasoning that moved {@link SCORE_ROW} here.
 *
 * The trailing-character class excludes `.` and `,` so a citation ending a sentence
 * (`… src:dcsa.`) does not acquire the punctuation.
 */
export function citedSourceIds(text: string): readonly string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(/\bsrc:([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
    const id = match[1]
    if (id !== undefined) seen.add(id)
  }
  return [...seen]
}
