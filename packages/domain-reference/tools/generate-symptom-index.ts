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
    '| legacy module | legacy vocabulary | reference concepts | what the model can say | read? |',
  )
  l.push('| --- | --- | --- | --- | --- |')
  for (const m of [...c.modules].sort((a, b) => a.module.localeCompare(b.module))) {
    const concepts = m.concepts.length === 0 ? '—' : m.concepts.map((x) => `\`${x}\``).join(' · ')
    const aggs =
      m.aggregates.length === 0
        ? ''
        : `<br>_aggregates:_ ${m.aggregates.map((x) => `\`${x}\``).join(', ')}`
    const areas = m.areas.length === 0 ? '' : `<br>_areas:_ ${m.areas.join(', ')}`
    l.push(
      `| **\`${m.module}/\`** | ${m.legacyVocabulary.join(', ')} | ${concepts}${aggs}${areas} | ` +
        `${statusCell(m, owedRows, families)} | ${CONFIDENCE_MARK[m.confidence] ?? m.confidence} |`,
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
  l.push(
    "**And one warning about confidence.** The reference's own evidence is not uniform. Its most " +
      'cited source is `src:sirva-ade` (**retained-elsewhere** — real bytes, in a private repo), ' +
      'while `src:dp3-400ng`, `src:dtr-part-iv` and `src:dp3-tender-of-service` total **542** ' +
      'citations of **analysis-only** prose that nobody can re-check, and one claim has already ' +
      'been found **unrecoverable** ([A8 §10]). `sources/registry.yaml` carries the per-source ' +
      'state. Weight a reading by it.',
  )
  l.push('')

  return l.join('\n')
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
