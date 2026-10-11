/**
 * Generates `docs/domain-reference/symptom-index.md` — **the path in from a symptom.**
 *
 * **Why this file exists.** `glossary.md` is indexed by **vocabulary** ("Aggregates (15)", "Record
 * types (32)", "Bases (5)"). A session refactoring legacy WinForms logic never arrives holding a
 * fact class; it arrives holding a **module folder** or a **form name** — `_SurveyResults/`,
 * `AcctMemosMaintenanceForm.vb` — and there has been no way in from either. 37k lines of analysis
 * with no symptom index is a reference a reader cannot enter.
 *
 * **The generated / authored split, which is this package's standing discipline applied once more.**
 * Exactly one input is hand-written: `data/legacy-correspondence.json`, which maps a legacy module
 * to reference concepts. It has to be authored, because the reference model is built from external
 * sources only ([SD §0]) and **knows nothing about MoveManager** — so every correspondence there is
 * `[ORIGINAL]`, and each row carries the `basis` it was read from. Everything else below is
 * **derived**: whether a named concept exists, whether its authority row is owed and to whom,
 * whether it is an **absent** fact class, and the corpus's retention profile. None of it can rot
 * without this generator's own gates failing.
 *
 * **It validates as it generates, and refuses rather than emitting a lie.** A concept named in the
 * correspondence that is not in `ASSERTION_TYPES`, an aggregate not in `AGGREGATE_KINDS`, an
 * `absentConcepts` entry the catalog does not actually list as absent — each throws. That is the
 * point: the authored half cannot drift away from the model without the build stopping.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as prettier from 'prettier'

import {
  analysisEvidenceGrade,
  citedSourceIds,
  RECHECKABLE_FROM_THIS_REPO,
  registryRetention,
  registryText,
  RETENTION_GLOSS,
  RETENTION_STATES,
  type RetentionState,
} from './source-registry.ts'

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))

/**
 * **The vocabularies are read from the PUBLISHED CATALOG, not from `src/`, and that is deliberate.**
 *
 * `src/` modules import each other **without** file extensions, because nothing ever runs them —
 * they are type-checked and read by the other generators through the TypeScript compiler API. A
 * runtime `import` from here fails on the first hop (`vocabulary.ts` → `../src/ids`), which is the
 * same constraint `tsconfig.json` records about `allowImportingTsExtensions`.
 *
 * Reading the catalog instead is the better answer rather than merely the available one: this file
 * documents **what is published**, so deriving it from the published artifact means the index cannot
 * describe a concept the wire does not carry. `catalog/*` is regenerated and gated upstream, so
 * there is no second extraction path to drift.
 */
const CATALOG_DIR = fileURLToPath(
  new URL('../../../docs/domain-reference/catalog/', import.meta.url),
)

export const SYMPTOM_INDEX_FILE = fileURLToPath(
  new URL('../../../docs/domain-reference/symptom-index.md', import.meta.url),
)
export const SYMPTOM_INDEX_REPO_PATH = 'docs/domain-reference/symptom-index.md'
export const SYMPTOM_INDEX_GENERATOR_REPO_PATH =
  'packages/domain-reference/tools/generate-symptom-index.ts'
export const SYMPTOM_INDEX_COMMAND = 'npm run symptom-index -w @pegasus/domain-reference'

/* ------------------------------------------------------------------------------------------------
 * Inputs
 * ---------------------------------------------------------------------------------------------- */

interface CorrespondenceModule {
  readonly module: string
  readonly legacyVocabulary: readonly string[]
  readonly concepts: readonly string[]
  readonly absentConcepts?: readonly string[]
  readonly aggregates: readonly string[]
  readonly areas: readonly string[]
  readonly confidence: 'read' | 'fromNames' | 'unknown'
  readonly basis: string
  readonly note: string
}

interface Correspondence {
  readonly note: string
  readonly purpose: string
  readonly legacySource: {
    readonly repo: string
    readonly visibility: string
    readonly commit: string
    readonly branch: string
    readonly commitDate: string
    readonly measuredAt: string
    readonly root: string
    readonly note: string
    readonly totals: {
      readonly moduleFolders: number
      readonly forms: number
      readonly vbLines: number
    }
    readonly elsewhere: Record<string, number | string>
  }
  readonly confidenceLegend: Record<string, string>
  readonly modules: readonly CorrespondenceModule[]
}

interface OwedAuthorityRow {
  readonly type: string
  readonly status: string
  readonly owedTo: string
}

interface CatalogMember {
  readonly type: string
  readonly kind?: string
}

interface CatalogIndex {
  readonly catalog: { readonly specVersion: string }
  readonly members: readonly CatalogMember[]
  readonly owed: {
    readonly vocabularies: readonly string[]
    readonly authorityRows: readonly OwedAuthorityRow[]
    readonly factClassFamilies: readonly string[]
    readonly absentFactClasses: readonly string[]
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/* ------------------------------------------------------------------------------------------------
 * Evidence recourse — can a reader re-check what the model says?
 * ---------------------------------------------------------------------------------------------- */

/**
 * One row of `data/authority-table.json`, reduced to the four provenance facts it carries.
 *
 * All four are already in the data and none was surfaced anywhere a migrator reads. They are
 * **four separate axes** and are rendered as four columns rather than folded into a score:
 *
 * | field            | question                            | where it is authored          |
 * | ---------------- | ----------------------------------- | ----------------------------- |
 * | `evidence`       | which sources, hence what recourse  | this table, cited as `src:<id>` |
 * | `authored`       | ours or the source's                | this table, `[ORIGINAL]`/`[SYNTHESIS]` |
 * | `confidence`     | the row's own stated confidence     | this table                    |
 * | `evidence_grade` | how thoroughly *we* read the source | each `analysis.md` front matter |
 *
 * Folding them would be the error the whole package guards against: a single number cannot say
 * "read in full, authored by us, and unverifiable by anyone", which is a real and common row.
 */
interface AuthorityRow {
  readonly type: string
  readonly evidence?: string
  readonly authored?: string
  readonly confidence?: string
}

interface AuthorityTable {
  readonly rows: readonly AuthorityRow[]
}

/**
 * Every string anywhere in one row, so a citation is found wherever the row happens to put it.
 *
 * **Measured, because reading `evidence` alone was wrong.** Citations in
 * `data/authority-table.json` are spread across **11 distinct field paths** — `evidence` (17),
 * `standings.{corroborating,authoritative,competing,advisory}.note`, `settlement.note`,
 * `settlement.citation`, `standings.*.unresolved[].owedTo`, `confidenceNote`, and
 * `standings.authoritativeByValue.RATED.note`. The row that forced this is `sitEntryDate`, whose
 * `evidence` reads _"SOURCED twice, from opposite directions — **see settlement**"_: parsing
 * `evidence` only rendered it as **uncited** while its sources sat one field away, which is exactly
 * the false negative this whole surface exists to prevent.
 *
 * A reader asking "can I check this row" means the row, not one of its fields, so recourse is
 * computed over all of it.
 */
function rowStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const v of value) rowStrings(v, into)
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) rowStrings(v, into)
  }
  return into
}

/**
 * How much recourse a reader has across a set of cited sources. **Worst case wins.**
 *
 * **Three tiers, not two, and the middle one is the point.** An earlier cut had only
 * open-versus-closed and rendered `unloading` — whose single source is `src:sirva-ade` — as "no
 * recourse". That is the `src:sirva-ade` error the plan corrected, committed again by a generator:
 * conflating "not in this repo" with "not retained". Its 13 ADE PDFs are version-controlled and a
 * reader with access can check them page by page, which is a different thing from prose nobody can
 * open, and the distinction is the entire reason this round exists.
 */
type Recourse = 'open' | 'withAccess' | 'mixed' | 'closed' | 'uncited'

const RECOURSE_MARK: Readonly<Record<Recourse, string>> = {
  open: '● open — clone and grep',
  withAccess: '◍ with access — another repo',
  mixed: '◐ mixed',
  closed: '○ closed — unverifiable',
  uncited: '—',
}

function recourseOf(states: readonly (RetentionState | undefined)[]): Recourse {
  if (states.length === 0) return 'uncited'
  const open = states.filter((s) => s !== undefined && RECHECKABLE_FROM_THIS_REPO.includes(s))
  const withAccess = states.filter((s) => s === 'retained-elsewhere')
  if (open.length === states.length) return 'open'
  if (open.length + withAccess.length === states.length) {
    return open.length === 0 ? 'withAccess' : 'mixed'
  }
  return open.length + withAccess.length === 0 ? 'closed' : 'mixed'
}

/** The `[ORIGINAL]` / `[SYNTHESIS]` mark a row carries, or `unmarked`. */
function authoredMark(row: AuthorityRow): string {
  const m = /\[(ORIGINAL|SYNTHESIS)\]/.exec(row.authored ?? '')
  return m?.[0] ?? '_unmarked_'
}

interface RowProvenance {
  readonly type: string
  readonly sources: readonly string[]
  readonly states: readonly (RetentionState | undefined)[]
  readonly recourse: Recourse
  readonly authored: string
  readonly confidence: string
}

/**
 * Every source the authority table cites, with its declared retention — and **a refusal when one
 * is undeclared.**
 *
 * This is the gate that makes the whole surface honest rather than decorative. If a cited source
 * carries no `retention:`, the generator stops instead of rendering a blank cell: a blank reads as
 * "nothing to worry about", which is the precise failure the field exists to end. The same applies
 * to a typo'd value, which {@link registryRetention} throws on.
 *
 * It also means the declaration set widens on its own. The next round that cites a new source in
 * `evidence` cannot emit until that source is graded, so the registry cannot fall behind the table.
 */
function citedSourceStates(
  table: AuthorityTable,
  registry: string,
): ReadonlyMap<string, RetentionState> {
  const cited = new Set<string>()
  for (const row of table.rows) {
    for (const id of citedSourceIds(rowStrings(row).join('\n'))) cited.add(id)
  }

  const out = new Map<string, RetentionState>()
  const ungraded: string[] = []
  for (const id of [...cited].sort()) {
    const state = registryRetention(id, registry)
    if (state === undefined) ungraded.push(id)
    else out.set(id, state)
  }
  if (ungraded.length > 0) {
    throw new Error(
      `data/authority-table.json cites ${ungraded.length} source(s) with no retention: in ` +
        `sources/registry.yaml — ${ungraded.map((id) => `src:${id}`).join(', ')}. ` +
        'Declare one (see the schema block at the head of registry.yaml); an undeclared source ' +
        'would render as a blank cell, which a reader reads as "fine".',
    )
  }
  return out
}

/** The worst recourse across the authority rows a module's concepts actually have. */
function recourseCell(
  m: CorrespondenceModule,
  provenance: ReadonlyMap<string, RowProvenance>,
): string {
  const rows = m.concepts.map((concept) => provenance.get(concept)).filter((p) => p !== undefined)
  if (rows.length === 0) return RECOURSE_MARK.uncited
  const states = rows.flatMap((p) => [...p.states])
  const mark = RECOURSE_MARK[recourseOf(states)]
  const worst = [...new Set(states)]
    .filter((s): s is RetentionState => s !== undefined)
    .sort((a, b) => RETENTION_STATES.indexOf(a) - RETENTION_STATES.indexOf(b))
  return worst.length === 0 ? mark : `${mark}<br>_${worst.join(' · ')}_`
}

function provenanceByType(table: AuthorityTable, registry: string): Map<string, RowProvenance> {
  const out = new Map<string, RowProvenance>()
  for (const row of table.rows) {
    const sources = [...citedSourceIds(rowStrings(row).join('\n'))].sort()
    const states = sources.map((id) => registryRetention(id, registry))
    out.set(row.type, {
      type: row.type,
      sources,
      states,
      recourse: recourseOf(states),
      authored: authoredMark(row),
      confidence: row.confidence ?? 'unstated',
    })
  }
  return out
}

/** The 32 published fact classes — `index.json`'s members, less the two `meta` records. */
function publishedAssertionTypes(catalog: CatalogIndex): Set<string> {
  return new Set(catalog.members.filter((m) => m.kind !== 'meta').map((m) => m.type))
}

/**
 * The 15 published aggregate kinds, from `$defs/AggregateId.<kind>` on the captured face.
 *
 * Derived from the **brand** defs rather than from a list, because that is where the wire actually
 * commits to a kind: `AggregateId.party` appearing is what `[A8 §9 item 1]` emitted when it minted
 * the party aggregate.
 */
function publishedAggregateKinds(): Set<string> {
  const schema = readJson<{ readonly $defs: Record<string, unknown> }>(
    `${CATALOG_DIR}captured.schema.json`,
  )
  const prefix = 'AggregateId.'
  return new Set(
    Object.keys(schema.$defs)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length)),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Validation — the authored half may not drift from the model
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every claim the correspondence makes about the model is checked here, and a failure throws.
 *
 * **Enumerated failures rather than a count**, because a count says a gate ran and not what it
 * found. The messages name the module AND the offending token, so a reader fixes the data file
 * rather than going looking.
 */
function validate(c: Correspondence, catalog: CatalogIndex): void {
  const types = publishedAssertionTypes(catalog)
  const aggregates = publishedAggregateKinds()
  const absent = new Set(catalog.owed.absentFactClasses)
  const problems: string[] = []

  for (const m of c.modules) {
    for (const concept of m.concepts) {
      if (!types.has(concept)) {
        problems.push(`${m.module}: concept "${concept}" is not in ASSERTION_TYPES`)
      }
      if (absent.has(concept)) {
        problems.push(
          `${m.module}: "${concept}" is listed under \`concepts\` but the catalog says it is ABSENT — ` +
            `move it to \`absentConcepts\``,
        )
      }
    }
    for (const concept of m.absentConcepts ?? []) {
      if (!absent.has(concept)) {
        problems.push(
          `${m.module}: "${concept}" is listed under \`absentConcepts\` but the catalog does not ` +
            `list it as absent — it may have been written since`,
        )
      }
    }
    for (const aggregate of m.aggregates) {
      if (!aggregates.has(aggregate)) {
        problems.push(`${m.module}: aggregate "${aggregate}" is not in AGGREGATE_KINDS`)
      }
    }
    if (m.basis.trim() === '')
      problems.push(`${m.module}: empty \`basis\` — every row states what it was read from`)
    if (m.note.trim() === '') problems.push(`${m.module}: empty \`note\``)
  }

  const seen = new Set<string>()
  for (const m of c.modules) {
    if (seen.has(m.module)) problems.push(`${m.module}: duplicate module row`)
    seen.add(m.module)
  }

  if (problems.length > 0) {
    throw new Error(
      `legacy-correspondence.json disagrees with the model:\n  - ${problems.join('\n  - ')}`,
    )
  }
}

/* ------------------------------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------------------------------- */

const CONFIDENCE_MARK: Record<string, string> = {
  read: '●● read',
  fromNames: '●○ from names',
  unknown: '○○ unknown',
}

function owedAuthorityFor(catalog: CatalogIndex): Map<string, string> {
  const m = new Map<string, string>()
  for (const row of catalog.owed.authorityRows) {
    if (row.status === 'owed') m.set(row.type, row.owedTo)
  }
  return m
}

/** What the model can and cannot say about one module — derived, never authored. */
function statusCell(
  m: CorrespondenceModule,
  owedRows: Map<string, string>,
  families: ReadonlySet<string>,
): string {
  const parts: string[] = []
  const owed = m.concepts.filter((c) => owedRows.has(c))
  const rowed = m.concepts.filter((c) => !owedRows.has(c))

  if (rowed.length > 0) parts.push(`**authority row:** ${rowed.map((c) => `\`${c}\``).join(', ')}`)
  if (owed.length > 0) {
    parts.push(`**authority OWED:** ${owed.map((c) => `\`${c}\` → ${owedRows.get(c)}`).join('; ')}`)
  }
  const absent = m.absentConcepts ?? []
  if (absent.length > 0) {
    parts.push(`**ABSENT fact class:** ${absent.map((c) => `\`${c}\``).join(', ')}`)
  }
  const fam = m.concepts.filter((c) => families.has(c))
  if (fam.length > 0) {
    parts.push(`**fact-class family owed:** ${fam.map((c) => `\`${c}\``).join(', ')}`)
  }
  if (parts.length === 0) parts.push('_no reference concept — see the note_')
  return parts.join('<br>')
}

/**
 * **The generator formats its own output, and that is deliberate rather than tidy.**
 *
 * The committed artefact must equal what this function returns — that is the contract all four
 * generated files hold. But the repo's pre-commit hook runs Prettier over markdown, and Prettier
 * **pads table columns to align them**, so an unformatted table would be rewritten the moment it
 * was committed and the reproduce gate would fail on whitespace alone. Running Prettier here, with
 * the repo's own resolved config, makes the generator's output already canonical: the hook becomes
 * a no-op on this file and the gate compares content rather than spacing.
 */
export async function generateSymptomIndex(): Promise<string> {
  const raw = renderSymptomIndex()
  const config = await prettier.resolveConfig(SYMPTOM_INDEX_FILE)
  return prettier.format(raw, { ...config, filepath: SYMPTOM_INDEX_FILE })
}

function renderSymptomIndex(): string {
  const c = readJson<Correspondence>(`${PACKAGE_DIR}data/legacy-correspondence.json`)
  const catalog = readJson<CatalogIndex>(`${CATALOG_DIR}index.json`)
  validate(c, catalog)

  const owedRows = owedAuthorityFor(catalog)
  const families = new Set(catalog.owed.factClassFamilies)
  const registry = registryText()
  const authority = readJson<AuthorityTable>(`${PACKAGE_DIR}data/authority-table.json`)
  const provenance = provenanceByType(authority, registry)
  const citedStates = citedSourceStates(authority, registry)
  const l: string[] = []

  l.push('# Symptom index — from legacy MoveManager code into the domain reference')
  l.push('')
  l.push(
    `**GENERATED — do not edit.** Rewrite with \`${SYMPTOM_INDEX_COMMAND}\`. Generator: ` +
      `\`${SYMPTOM_INDEX_GENERATOR_REPO_PATH}\`. Catalog \`${catalog.catalog.specVersion}\`.`,
  )
  l.push('')
  l.push(`> ${c.purpose}`)
  l.push('')
  l.push(
    '**How to use it.** Find your module folder. The **what the model can say** column is derived ' +
      'from the published catalog, so it is current: it tells you whether the concept has an ' +
      'authority row, whether that row is **owed** and to whom, and whether the concept is an ' +
      '**absent fact class** — which means the reference has nothing for you yet, and silence ' +
      'would have been the alternative. Then read the note, then the area documents.',
  )
  l.push('')
  l.push(
    '**Then check what the reading is worth.** The **can you re-check it?** column says whether ' +
      "the sources behind that module's authority rows are bytes you can open or prose nobody can " +
      'verify — `● re-checkable`, `◐ mixed`, `○ no recourse`. It is derived per row from ' +
      '`data/authority-table.json` and `sources/registry.yaml`, and the two recourse sections ' +
      'below give the detail. **Where the model and your legacy code disagree, this is what tells ' +
      'you which of the two can be checked.**',
  )
  l.push('')
  l.push(
    '**What is authored and what is derived.** The legacy→concept correspondence is ' +
      '**`[ORIGINAL]`** — the reference model is built from external sources only ([SD §0]) and ' +
      'knows nothing about MoveManager, so the mapping is judgement and each row states the ' +
      '`basis` it was read from. Everything in the status column is **derived** from ' +
      '`catalog/index.json` and the vocabulary, and the generator **refuses to build** if the two ' +
      'disagree.',
  )
  l.push('')

  /* -- provenance ------------------------------------------------------------------------------ */
  const s = c.legacySource
  l.push('## The legacy side, and when it was measured')
  l.push('')
  l.push(
    `Measured **${s.measuredAt}** against \`${s.repo}\` (${s.visibility}) at commit ` +
      `**\`${s.commit}\`** on \`${s.branch}\`, committed ${s.commitDate}; root \`${s.root}\`.`,
  )
  l.push('')
  l.push(
    `**${s.totals.moduleFolders}** module folders · **${s.totals.forms}** forms · ` +
      `**${s.totals.vbLines.toLocaleString('en-US')}** lines of VB. Elsewhere in that repo: ` +
      Object.entries(s.elsewhere)
        .filter(([k]) => k !== 'note')
        .map(([k, v]) => `**${String(v)}** ${k}`)
        .join(' · ') +
      '.',
  )
  l.push('')
  l.push(`> ${s.note}`)
  l.push('')

  /* -- the index ------------------------------------------------------------------------------- */
  l.push('## The index')
  l.push('')
  l.push(
    '| legacy module | legacy vocabulary | reference concepts | what the model can say | can you re-check it? | read? |',
  )
  l.push('| --- | --- | --- | --- | --- | --- |')
  for (const m of [...c.modules].sort((a, b) => a.module.localeCompare(b.module))) {
    const concepts = m.concepts.length === 0 ? '—' : m.concepts.map((x) => `\`${x}\``).join(' · ')
    const aggs =
      m.aggregates.length === 0
        ? ''
        : `<br>_aggregates:_ ${m.aggregates.map((x) => `\`${x}\``).join(', ')}`
    const areas = m.areas.length === 0 ? '' : `<br>_areas:_ ${m.areas.join(', ')}`
    l.push(
      `| **\`${m.module}/\`** | ${m.legacyVocabulary.join(', ')} | ${concepts}${aggs}${areas} | ` +
        `${statusCell(m, owedRows, families)} | ${recourseCell(m, provenance)} | ` +
        `${CONFIDENCE_MARK[m.confidence] ?? m.confidence} |`,
    )
  }
  l.push('')
  l.push(
    '**Confidence legend.** ' +
      Object.entries(c.confidenceLegend)
        .map(([k, v]) => `**${CONFIDENCE_MARK[k] ?? k}** — ${v}`)
        .join(' '),
  )
  l.push('')

  /* -- the notes ------------------------------------------------------------------------------- */
  l.push('## Module notes — read the one for your module before mapping anything')
  l.push('')
  for (const m of [...c.modules].sort((a, b) => a.module.localeCompare(b.module))) {
    l.push(`### \`${m.module}/\``)
    l.push('')
    l.push(`- **Read from:** ${m.basis}`)
    l.push(`- **Confidence:** ${CONFIDENCE_MARK[m.confidence] ?? m.confidence}`)
    l.push('')
    l.push(m.note)
    l.push('')
  }

  /* -- the gaps, enumerated -------------------------------------------------------------------- */
  l.push('## What the reference does NOT have, enumerated')
  l.push('')
  l.push(
    'Derived from the published catalog, so this list cannot go stale while the catalog is ' +
      'regenerated. **A migrator meeting one of these should expect no domain reading at all** — ' +
      'which is a finding, not a dead end.',
  )
  l.push('')
  l.push(
    `**Absent fact classes (${catalog.owed.absentFactClasses.length}).** ` +
      catalog.owed.absentFactClasses.map((x) => `\`${x}\``).join(' · '),
  )
  l.push('')
  const hit = new Map<string, string[]>()
  for (const m of c.modules) {
    for (const a of m.absentConcepts ?? []) {
      hit.set(a, [...(hit.get(a) ?? []), m.module])
    }
  }
  if (hit.size > 0) {
    l.push(
      '**Of those, the ones a MoveManager module actually lands on** — i.e. the gaps that cost:',
    )
    l.push('')
    l.push('| absent fact class | modules that need it |')
    l.push('| --- | --- |')
    for (const [a, mods] of [...hit.entries()].sort()) {
      l.push(`| \`${a}\` | ${mods.map((x) => `\`${x}/\``).join(', ')} |`)
    }
    l.push('')
  }
  l.push(
    `**Owed vocabularies (${catalog.owed.vocabularies.length}).** ` +
      catalog.owed.vocabularies.map((x) => `\`${x}\``).join(' · ') +
      ' — a value in one of these is carried as an owed code, never as a guessed member.',
  )
  l.push('')
  l.push(
    `**Fact-class families owed (${catalog.owed.factClassFamilies.length}).** ` +
      catalog.owed.factClassFamilies.map((x) => `\`${x}\``).join(' · '),
  )
  l.push('')
  l.push(
    `**Fact classes whose authority row is owed (${owedRows.size}).** ` +
      [...owedRows.keys()]
        .sort()
        .map((x) => `\`${x}\``)
        .join(' · ') +
      ' — the class exists and is assertable, but **who is authoritative over it is undecided**, ' +
      'so do not let legacy code imply an answer.',
  )
  l.push('')

  /* -- recourse -------------------------------------------------------------------------------- */
  pushRecourseSections(l, provenance, citedStates)

  /* -- where to go next ------------------------------------------------------------------------ */
  l.push('## Where to go after this file')
  l.push('')
  l.push(
    '- [`glossary.md`](glossary.md) — the vocabulary itself, once you know which term you want.',
  )
  l.push('- [`context-map.md`](context-map.md) — which concepts cross area boundaries.')
  l.push(
    '- [`catalog/`](catalog/) — the published wire contract, and the `owed` block this file joins.',
  )
  l.push('- `analysis/` — the areas. The index names which one applies per module.')
  l.push('')

  return l.join('\n')
}

/* ------------------------------------------------------------------------------------------------
 * Evidence recourse — rendered twice, by row and by source
 * ---------------------------------------------------------------------------------------------- */

/**
 * Renders the two recourse sections and appends them to `l`.
 *
 * Split out because the index's own sections are already long, and because these two are the only
 * part of the file derived from `data/authority-table.json` rather than from the catalog.
 */
function pushRecourseSections(
  l: string[],
  provenance: ReadonlyMap<string, RowProvenance>,
  citedStates: ReadonlyMap<string, RetentionState>,
): void {
  /* -- per authority row ----------------------------------------------------------------------- */
  l.push('## Can you re-check it? — recourse per authority row')
  l.push('')
  l.push(
    '**Why this is here and not folded into one score.** Four independent things decide how far to ' +
      'trust a row, and no single number can state them: **which sources** it rests on and ' +
      "therefore **what recourse you have**, whether the reading is the source's or **ours**, the " +
      "row's **own stated confidence**, and how thoroughly we read each source " +
      '(`evidence_grade`, rubric S4 — the next table). The combination that misleads is a row read ' +
      'in full, authored by us, and verifiable by nobody; it looks identical to a row quoting a ' +
      'statute you can open.',
  )
  l.push('')
  l.push('| fact class | recourse | cited sources, with retention | reading | row confidence |')
  l.push('| --- | --- | --- | --- | --- |')
  for (const p of [...provenance.values()].sort((a, b) => a.type.localeCompare(b.type))) {
    const cites =
      p.sources.length === 0
        ? '_none cited_'
        : p.sources.map((id, i) => `\`src:${id}\` (${p.states[i] ?? '**UNGRADED**'})`).join('<br>')
    l.push(
      `| \`${p.type}\` | ${RECOURSE_MARK[p.recourse]} | ${cites} | ${p.authored} | ${p.confidence} |`,
    )
  }
  l.push('')

  const closedRows = [...provenance.values()].filter((p) => p.recourse === 'closed')
  const uncitedRows = [...provenance.values()].filter((p) => p.recourse === 'uncited')
  l.push(
    `**${closedRows.length} of ${provenance.size} authority rows rest entirely on sources nobody ` +
      'can open** — ' +
      closedRows
        .map((p) => `\`${p.type}\``)
        .sort()
        .join(', ') +
      '. That is not an accusation of error; every one is sourced and the sourcing is recorded. It ' +
      'means a disagreement between the model and your legacy code **cannot be settled by reading ' +
      'the source** — so treat the model as the weaker party in that argument and write down what ' +
      'the code says.',
  )
  l.push('')
  if (uncitedRows.length > 0) {
    l.push(
      `**${uncitedRows.length} row(s) cite no source at all** — ` +
        uncitedRows
          .map((p) => `\`${p.type}\``)
          .sort()
          .join(', ') +
        '. Read the row in `data/authority-table.json` before relying on it; a row can be sourced ' +
        'through a rule it defers to rather than through a citation of its own.',
    )
    l.push('')
  }

  /* -- per source ------------------------------------------------------------------------------ */
  l.push('## Where the evidence is — the cited corpus')
  l.push('')
  l.push(
    'Every source the authority table cites, with the two axes a reader needs kept apart: ' +
      '**retention** (can anyone re-check the bytes) and **`evidence_grade`** (how thoroughly ' +
      '*we* read them, rubric S4). They are independent, and `A` / `analysis-only` — a full read ' +
      'of a document nobody can now open — is the pairing that manufactures false confidence.',
  )
  l.push('')
  l.push('| source | retention | what that means | our reading (S4) | rows citing it |')
  l.push('| --- | --- | --- | --- | --- |')
  const byState = [...citedStates.entries()].sort(
    (a, b) =>
      RETENTION_STATES.indexOf(a[1]) - RETENTION_STATES.indexOf(b[1]) || a[0].localeCompare(b[0]),
  )
  for (const [id, state] of byState) {
    const citing = [...provenance.values()].filter((p) => p.sources.includes(id)).length
    const s4 = analysisEvidenceGrade(id)
    l.push(
      `| \`src:${id}\` | **${state}** | ${RETENTION_GLOSS[state]} | ` +
        `${s4 === undefined ? '_none_' : `\`${s4}\``} | ${citing} |`,
    )
  }
  l.push('')

  const openStates = new Set<string>(RECHECKABLE_FROM_THIS_REPO)
  const closed = byState.filter(([, state]) => !openStates.has(state))
  const falseConfidence = byState.filter(
    ([id, state]) => !openStates.has(state) && analysisEvidenceGrade(id) === 'A',
  )
  l.push(
    `**${closed.length} of the ${byState.length} cited sources cannot be re-checked from a clone ` +
      `of this repo**, and **${falseConfidence.length}** of those carry \`evidence_grade: A\` — ` +
      falseConfidence.map(([id]) => `\`src:${id}\``).join(', ') +
      ' — meaning the model read them in full and no second reader can. `registry.yaml` carries ' +
      "each state and a `retention_note` explaining it where the state isn't obvious.",
  )
  l.push('')
  l.push(
    '> **A per-source state is a floor, not a guarantee, and `src:dcsa` is why.** Its 125 captured ' +
      'files are real and the cited JIT sub-spec was never among them — five citations rested on ' +
      'bytes that exist nowhere ([A8 §10]). Measured 2026-10-11, **neither** `src:dcsa` citation ' +
      'in the authority table reaches JIT, so nothing in the table above is overstated. The ' +
      '**per-citation** grain is owed and is not done.',
  )
  l.push('')
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  writeFileSync(SYMPTOM_INDEX_FILE, await generateSymptomIndex(), 'utf8')
  process.stdout.write(`wrote ${SYMPTOM_INDEX_REPO_PATH}\n`)
}
