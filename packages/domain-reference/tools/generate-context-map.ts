/**
 * The context-map generator.
 *
 * `docs/domain-reference/README.md` has carried the context map as one of three things a `model/`
 * layer would have held and that are genuinely absent. This is it, and it is **generated** for the
 * reason the glossary is: a hand-written context map is a document whose entire content is claims
 * about sets the code already knows, and the owed-closures round found six stale counts and one
 * stale quotation in prose exactly that shape. A hand-written map would be stale on the day it
 * merged.
 *
 * ## What it is
 *
 * The nodes are the **thirteen domain areas** of `docs/domain-reference/rubric.md`. The edges are
 * the three things that cross them and that `src/` can be asked about:
 *
 * 1. **The join surface** — the concepts referenced from more than one place, with every reference
 *    site and the document cited at it. This is the half a reader cannot assemble today: the party
 *    is referenced by `assertedBy`, by `vocabularyScope.authority`, by `issuer`, by a custody
 *    holder and by a correction's declarer, and nothing names the set.
 * 2. **The aggregates and the two projections** — each with the record types that may be asserted
 *    about it. The glossary joins the other way round (record type to subject family); the inverse
 *    is what says which areas meet on one aggregate.
 * 3. **The debt** — the `owed(…)` / `Owed<…>` inventory and the `TODO(…)` ledger, both read from
 *    `src/`, rendered as **directed** edges: who owes what to which area.
 *
 * ## What it refuses, and why no type can hold the refusal
 *
 * It publishes **no DDD integration-pattern label** — no shared kernel, customer–supplier,
 * conformist, anticorruption layer or published language. Those are the vocabulary a context map
 * usually carries, and **no source in the corpus publishes one for this domain**: assigning them
 * would be the `[ORIGINAL]` guess [SD §0] forbids, on the axis a reader would be least likely to
 * check. [A9 §3.2] is the precedent — a vocabulary refused on the evidence rather than minted to
 * make the artefact look finished.
 *
 * The refusal has **no edge the types can see** (§3 item 12's second half, which is the half that
 * gets skipped): there is no vocabulary to leave a hole in, and the absence of a type has no
 * type-level witness — `Extract<keyof typeof module, 'Name'>` enumerates the value namespace and can
 * never fire for a type alias. So it is held at runtime instead, over the bytes this generator
 * emits: `tests/conformance/context-map.test.ts` asserts the refusal is stated and that no pattern
 * name appears anywhere else in the document.
 *
 * ## The two axes, and why neither alone is the rule
 *
 * A concept is on the join surface when it is referenced from at least {@link HUB_MODULE_SPREAD}
 * modules of `src/` **or** when its reference sites cite at least {@link HUB_AREA_REACH} area
 * documents. The union is not belt-and-braces; it was **measured**, and each axis misses what the
 * other catches:
 *
 * - **Citation reach alone misses the party.** Almost every `PartyId` site cites `[SD §…]` and
 *   `[A8 §…]`, and the binding layer is not an area — so the party's reach is **below** the threshold
 *   while its module spread is well above it. The concept [A9 §3.6] calls the structural finding of
 *   its round would not have appeared.
 * - **Module spread alone misses the identity key.** `SchemeName` is the mirror image: reach above
 *   the threshold, spread below it.
 *
 * Neither bullet writes the measurements down. {@link renderJoinSurface} **derives** both witnesses
 * from the hubs it is rendering, so the emitted sentence cannot be a stale count — and
 * `context-map.test.ts` holds the comparison rather than the totals.
 *
 * Both thresholds are counts this generator chose, which §3 item 10 says must be gated or deleted.
 * They are gated by **enumeration**: `context-map.test.ts` lists the resulting concepts by name and
 * asserts equality, so a new reference that promotes or demotes one fails by name and the author
 * decides whether the map changed or the threshold is wrong.
 *
 * ## Prettier
 *
 * Same constraint the glossary generator states, for the same reason: the emitted document is
 * headings, paragraphs, bullets and blockquotes and contains **no markdown table**, because prettier
 * re-pads table cells on commit and a generator that has to reproduce prettier's padding is a
 * generator that will drift from it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import {
  type AnchorIndex,
  type CanonicalTable,
  type Citation,
  type Model,
  DOCUMENTS,
  buildAnchorIndex,
  buildModel,
  byteOrder,
  citationsIn,
  collectOwedInventory,
  declaredExport,
  docCommentOf,
  exportsOfIndex,
  headingSlug,
  linkFor,
  membersOf,
  readCanonicalSubjects,
  repoPath,
  sortedBy,
} from './generate-glossary.ts'

/* ------------------------------------------------------------------------------------------------
 * Where things are
 * ---------------------------------------------------------------------------------------------- */

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
const SRC_DIR = `${PACKAGE_DIR}src/`
const RUBRIC_FILE = fileURLToPath(
  new URL('../../../docs/domain-reference/rubric.md', import.meta.url),
)

/** The committed artefact, and the command that rewrites it. Both appear in the output's header. */
export const CONTEXT_MAP_FILE = fileURLToPath(
  new URL('../../../docs/domain-reference/context-map.md', import.meta.url),
)
export const CONTEXT_MAP_REPO_PATH = 'docs/domain-reference/context-map.md'
export const CONTEXT_MAP_GENERATOR_REPO_PATH =
  'packages/domain-reference/tools/generate-context-map.ts'
export const CONTEXT_MAP_COMMAND = 'npm run context-map -w @pegasus/domain-reference'

/**
 * The integration-pattern vocabulary this map **does not** publish.
 *
 * Spelled once, here, so the refusal and the gate that holds it read the same list — and spelled in
 * lower case because the gate matches case-insensitively over the emitted document.
 */
/**
 * The sentence the refusal is stated in, spelled once.
 *
 * The gate reads **this**, not a paraphrase of it: a check that looked for its own wording would
 * pass while the document said something else, and the lesson §3 item 19 generalises is that a gate
 * must read the thing that declares.
 */
export const REFUSAL_SENTENCE = 'This map publishes no integration-pattern label.'

export const REFUSED_PATTERN_NAMES: readonly string[] = [
  'shared kernel',
  'customer-supplier',
  'customer–supplier',
  'conformist',
  'anticorruption layer',
  'published language',
  'separate ways',
  'big ball of mud',
]

/* ------------------------------------------------------------------------------------------------
 * The nodes — read from `rubric.md`, never restated here
 * ---------------------------------------------------------------------------------------------- */

/** One row of `rubric.md`'s domain-area table. */
export interface Area {
  readonly id: string
  readonly title: string
  /** `yes` or `context map` — the column [A9 §1] calls a routing hint read as a record. */
  readonly v1Detail: string
  /** The `Covers` column, verbatim. A prompt, not an inventory ([A6 §3.8], [A7 §3.10]). */
  readonly covers: string
  /** The analysis document that decides it, or `null` where there is none by design. */
  readonly document: string | null
}

/**
 * `rubric.md`'s thirteen areas.
 *
 * Read from the file rather than declared here, because the rubric **is** the declaration and a
 * second copy is a second place to be wrong — [SD §1.1]'s reason for deleting the `correlation`
 * bag, one artefact over. Scoped to the table under `## Domain areas` and to nothing wider: §3 item
 * 19's lesson is that a reader scoped to a region containing prose about its own subject closes on
 * that prose, and this file carries blockquote after blockquote of prose about these very rows.
 */
export function readAreas(): Area[] {
  const text = readFileSync(RUBRIC_FILE, 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^##\s+Domain areas\s*$/.test(line))
  if (start === -1) throw new Error(`${RUBRIC_FILE} has no "## Domain areas" heading`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^##\s/.test(line))
  const region = end === -1 ? rest : rest.slice(0, end)

  const areas: Area[] = []
  for (const line of region) {
    const row = /^\|\s*(A\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(line)
    if (row === null) continue
    const id = row[1] ?? ''
    areas.push({
      id,
      title: row[2] ?? '',
      v1Detail: row[3] ?? '',
      covers: row[4] ?? '',
      document: DOCUMENTS[id] ?? null,
    })
  }
  if (areas.length === 0) throw new Error(`${RUBRIC_FILE}'s domain-area table parsed to no rows`)
  return areas
}

/* ------------------------------------------------------------------------------------------------
 * Area references, in two spellings
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every area reference in a piece of text, in **both** spellings the corpus uses.
 *
 * A1–A9 have documents and are cited bracketed (`[A6 §3.2]`); A10–A13 have none by design and are
 * named bare (`A4 / A10 — no document fixes the condition vocabulary`). The `TODO(…)` ledger mixes
 * the two in one comment, so a reader that accepted only the bracketed form would see the published
 * vocabulary's edges to the context-map-only areas as absent — which is the assumption the rubric's
 * own note says the `v1 detail` column invites.
 */
function areaReferencesIn(text: string, areas: readonly Area[]): Set<string> {
  const found = new Set<string>()
  for (const area of areas) {
    const bare = new RegExp(`(?<![A-Za-z0-9])${area.id}(?![0-9])`)
    if (bare.test(text)) found.add(area.id)
  }
  return found
}

/* ------------------------------------------------------------------------------------------------
 * The join surface
 * ---------------------------------------------------------------------------------------------- */

/**
 * A concept referenced from at least this many modules of `src/` is on the map.
 *
 * See the module header: the threshold is a count, and it is gated by the enumeration in
 * `context-map.test.ts` rather than by its own value.
 */
export const HUB_MODULE_SPREAD = 4

/** A concept whose reference sites cite at least this many areas is on the map, spread aside. */
export const HUB_AREA_REACH = 3

/** One place a concept is referenced from. */
export interface HubSite {
  /** `envelope.ts:AssertedBy.party` — the declaration path, resolved past anonymous literals. */
  readonly where: string
  readonly module: string
  /** Every document cited at the nearest enclosing docstring that cites anything. */
  readonly citations: readonly Citation[]
  readonly areas: readonly string[]
}

/** A concept on the join surface. */
export interface Hub {
  readonly name: string
  readonly declaredIn: string
  /** The `AGGREGATE_KINDS` member this concept's identity belongs to, or `null`. */
  readonly aggregate: string | null
  readonly modules: readonly string[]
  readonly areas: readonly string[]
  readonly sites: readonly HubSite[]
}

/**
 * A type **constructor** rather than a concept — `Exact<>`, `Brand<>`, `NonEmptyArray<>`, and a type
 * parameter itself.
 *
 * The distinction is mechanical and it is the one that makes this readable: ranked on reference
 * spread alone, the generic plumbing of `primitives.ts` sits above every domain concept in the
 * model. Nothing is blocklisted by name — a declaration carrying type parameters is machinery, and
 * one carrying none is a concept.
 */
function isTypeConstructor(declaration: ts.Declaration): boolean {
  if (ts.isTypeParameterDeclaration(declaration)) return true
  const withParameters = declaration as unknown as {
    typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>
  }
  return (withParameters.typeParameters?.length ?? 0) > 0
}

/**
 * The declaration path a reference sits inside — `custody.ts:CustodyHolder.party`.
 *
 * Walks out through property signatures to the nearest **named** declaration, so a reference inside
 * an inline union member or an anonymous type literal is reported against the alias that declares
 * it rather than as `?.party`. A row a reader cannot open is half a row.
 */
function siteLabel(node: ts.Node, module: string): string {
  const path: string[] = []
  let host: ts.Node = node
  while (!ts.isSourceFile(host)) {
    if (ts.isPropertySignature(host) || ts.isPropertyDeclaration(host)) {
      path.unshift(host.name.getText())
    } else if (ts.isParameter(host) && ts.isIdentifier(host.name)) {
      path.unshift(`(${host.name.text})`)
    } else if (
      ts.isInterfaceDeclaration(host) ||
      ts.isTypeAliasDeclaration(host) ||
      ts.isFunctionDeclaration(host)
    ) {
      path.unshift(host.name?.getText() ?? '?')
      break
    } else if (ts.isVariableDeclaration(host) && ts.isIdentifier(host.name)) {
      path.unshift(host.name.text)
      break
    }
    host = host.parent
  }
  return `${module}:${path.join('.')}`
}

/**
 * The citations in force at a reference site: the nearest enclosing docstring that cites anything.
 *
 * An empty result means **this site cites nothing**, and it is rendered that way. Inheriting the
 * module header instead would attribute the module's decision to a field the module header never
 * mentions, which is the silent-drop failure §3 item 12 says is worse than a refusal.
 */
function citationsAtSite(
  node: ts.Node,
  areas: readonly Area[],
): { citations: Citation[]; areas: string[] } {
  let host: ts.Node | undefined = node
  while (host !== undefined && !ts.isSourceFile(host)) {
    const doc = docCommentOf(host)
    if (doc !== undefined) {
      const citations = citationsIn(doc)
      const named = areaReferencesIn(doc, areas)
      if (citations.length > 0 || named.size > 0) {
        return { citations, areas: [...named].sort(byAreaOrder(areas)) }
      }
    }
    host = host.parent
  }
  return { citations: [], areas: [] }
}

/** Rubric order — `A10` after `A9`, which no string comparison gives. */
function byAreaOrder(areas: readonly Area[]): (left: string, right: string) => number {
  const order = new Map(areas.map((area, index) => [area.id, index]))
  return (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0)
}

/** The aggregate kind a branded id belongs to — `PortionId` to `portion`, `PartyId` to nothing. */
function aggregateBehind(name: string, aggregates: readonly string[]): string | null {
  const stem = /^(.*)Id$/.exec(name)?.[1]
  if (stem === undefined) return null
  const lower = `${stem.charAt(0).toLowerCase()}${stem.slice(1)}`
  return aggregates.includes(lower) ? lower : null
}

/**
 * Every concept on the join surface, with every site that reaches it.
 *
 * Reached through the **checker**, not a regular expression: a type reference resolves to a symbol,
 * the symbol to its declaration, and a declaration outside `src/` is not a concept of this model.
 */
export function collectHubs(
  model: Model,
  areas: readonly Area[],
  aggregates: readonly string[],
): Hub[] {
  const sites = new Map<string, HubSite[]>()
  const declaredIn = new Map<string, string>()

  for (const file of model.files) {
    if (!file.fileName.startsWith(SRC_DIR)) continue
    const module = file.fileName.slice(SRC_DIR.length)
    const walk = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node)) {
        const symbol = model.checker.getSymbolAtLocation(node.typeName)
        const resolved =
          symbol === undefined
            ? undefined
            : symbol.flags & ts.SymbolFlags.Alias
              ? model.checker.getAliasedSymbol(symbol)
              : symbol
        const declaration = (resolved?.getDeclarations() ?? [])[0]
        if (
          resolved !== undefined &&
          declaration !== undefined &&
          declaration.getSourceFile().fileName.startsWith(SRC_DIR) &&
          !isTypeConstructor(declaration)
        ) {
          const name = resolved.getName()
          declaredIn.set(name, repoPath(declaration.getSourceFile()))
          const list = sites.get(name) ?? []
          const inForce = citationsAtSite(node, areas)
          list.push({
            where: siteLabel(node, module),
            module,
            citations: inForce.citations,
            areas: inForce.areas,
          })
          sites.set(name, list)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
  }

  const hubs: Hub[] = []
  for (const [name, found] of sites) {
    // One row per DECLARATION, not per token: a declaration that names the same concept twice —
    // `SubjectRef`'s own two halves, an overload's parameter and return — is one place a reader
    // opens. The citations are those of the first occurrence, which share its ancestor chain.
    const unique = new Map<string, HubSite>()
    for (const site of found) if (!unique.has(site.where)) unique.set(site.where, site)
    const deduped = sortedBy([...unique.values()], (site) => site.where)
    const modules = [...new Set(deduped.map((site) => site.module))].sort(byteOrder)
    const reached = new Set<string>()
    for (const site of deduped) for (const area of site.areas) reached.add(area)
    if (modules.length < HUB_MODULE_SPREAD && reached.size < HUB_AREA_REACH) continue
    hubs.push({
      name,
      declaredIn: declaredIn.get(name) ?? '',
      aggregate: aggregateBehind(name, aggregates),
      modules,
      areas: [...reached].sort(byAreaOrder(areas)),
      sites: deduped,
    })
  }
  return sortedBy(hubs, (hub) => hub.name)
}

/* ------------------------------------------------------------------------------------------------
 * The debt — `TODO(…)` in `src/`, which no other artefact reads
 * ---------------------------------------------------------------------------------------------- */

/** One `TODO(blocker)` marker in `src/`. */
export interface DebtMarker {
  readonly where: string
  readonly line: number
  /** The text inside the parentheses — a citation, or a free label like `projections`. */
  readonly blocker: string
  /** The sentence that follows it, trimmed to one line. */
  readonly note: string
  readonly areas: readonly string[]
}

/**
 * Every `TODO(…)` in `src/`, as a directed edge.
 *
 * **This register reaches nothing else.** `collectOwedInventory` reads the `owed(…)` constructor,
 * the `Owed<…>` type and `OwedCode<…>`, and those three reach the glossary and `catalog/index.json`.
 * The `TODO(…)` markers are a second ledger of the same kind — each one names the document that has
 * to act — and no generated artefact has ever published them. One of them says in as many words
 * that revenue allocation is A13's; that edge to a context-map-only area existed in the code and
 * appeared on no map.
 *
 * Read from the raw text rather than from JSDoc, because several of them are `//` comments inside a
 * function body and are not attached to any declaration.
 */
export function collectDebtMarkers(model: Model, areas: readonly Area[]): DebtMarker[] {
  const markers: DebtMarker[] = []
  const pattern = /TODO\(([^)]*)\)\s*:?\s*([^\n]*)/g
  for (const file of model.files) {
    if (!file.fileName.startsWith(SRC_DIR)) continue
    const text = file.getFullText()
    for (const match of text.matchAll(pattern)) {
      const blocker = (match[1] ?? '').trim()
      const note = asPlainText(match[2] ?? '')
      markers.push({
        where: repoPath(file),
        line: text.slice(0, match.index).split('\n').length,
        blocker,
        note,
        areas: [...areaReferencesIn(`${blocker} ${note}`, areas)].sort(byAreaOrder(areas)),
      })
    }
  }
  return sortedBy(markers, (marker) => `${marker.where} ${String(marker.line).padStart(6, '0')}`)
}

/* ------------------------------------------------------------------------------------------------
 * The aggregates, and what is asserted about them
 * ---------------------------------------------------------------------------------------------- */

/** One aggregate kind, with the record types that may name it as `subject`. */
export interface AggregateNode {
  readonly kind: string
  /** The subject families of [SD §4.7.1] that admit this kind. */
  readonly families: readonly string[]
  readonly recordTypes: readonly string[]
  readonly areas: readonly string[]
}

/**
 * The inverse of the glossary's join.
 *
 * The glossary renders each record type with its canonical subject family. **Nothing renders the
 * other direction**, and the other direction is the one a context map needs: two areas meet on an
 * aggregate when each has a record type that can be asserted about it.
 */
export function collectAggregateNodes(
  table: CanonicalTable,
  aggregates: readonly string[],
  areas: readonly Area[],
): AggregateNode[] {
  const order = byAreaOrder(areas)
  return aggregates.map((kind) => {
    const families = Object.entries(table.families)
      .filter(([, family]) => family.members.includes(kind))
      .map(([name]) => name)
      .sort(byteOrder)
    const rows = table.rows.filter((row) => families.includes(row.family))
    const reached = new Set<string>()
    for (const row of rows) {
      const text = [...(row.citations ?? []), ...(row.authority.citations ?? [])].join(' ')
      for (const area of areaReferencesIn(text, areas)) reached.add(area)
    }
    return {
      kind,
      families,
      recordTypes: sortedBy(rows, (row) => row.type).map((row) => row.type),
      areas: [...reached].sort(order),
    }
  })
}

/* ------------------------------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------------------------------- */

/**
 * A citation whose own text fits on one line.
 *
 * A docstring may wrap a citation across a line break — `[A1\n * §Cross-area]` — and
 * `citationsIn` keeps the spelling verbatim, so the link label arrived carrying a newline and split
 * its own bullet in two. Prettier then re-indented the orphan as a continuation, and the emitted
 * bytes stopped being a fixed point. Collapsed here rather than in the shared reader, because the
 * glossary wants the spelling it has.
 */
function oneLine(citation: Citation): Citation {
  return { ...citation, text: citation.text.replace(/\s+/g, ' ') }
}

/**
 * A comment fragment, rendered as plain text.
 *
 * Three things have to come off, and the third is the one that bit:
 *
 * - **`*` and `` ` ``** — the notes are the first line of a wrapped comment, so a `**bold**` run can
 *   arrive with one of its markers on the next line. Emitting that is how a generated file stops
 *   being a prettier fixed point: prettier balances the stray `*` and rewrites the file the
 *   generator just wrote. `_` is **kept**, because stripping it turned `NOT_COMPLETED` into
 *   `NOTCOMPLETED` — an intra-word underscore is not emphasis in markdown and never needed removing.
 * - **String-literal plumbing** — several markers sit inside a quoted string in an authority row, so
 *   the line ends `is owed.",` or `on ISSU, so the corpus ' +`.
 * - **The truncation itself**, which is marked rather than hidden: a fragment that does not end a
 *   sentence gets an ellipsis, so a reader knows the file has more to say than the row does.
 */
function asPlainText(text: string): string {
  const stripped = text
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*['"]?\s*\+\s*$/, '')
    .replace(/\s*['"][,;]?\s*$/, '')
    .trim()
  if (stripped.length === 0) return ''
  return /[.!?…]$/.test(stripped) ? stripped : `${stripped}…`
}

/**
 * What is cited at a reference site, rendered honestly in all three states.
 *
 * The third is the one worth seeing: a docstring that **names** an area without citing a section —
 * `A8-INSTANT`, a rule A8 declares, named in prose with no `[A8 §x]` beside it. Rendering that as
 * `uncited` would hide a real edge, and rendering it as a citation would claim a section nobody
 * wrote. It is its own state.
 */
function renderSite(site: HubSite, anchors: AnchorIndex, areas: readonly Area[]): string {
  if (site.citations.length > 0) {
    return site.citations.map((citation) => linkFor(oneLine(citation), anchors)).join(' ')
  }
  if (site.areas.length > 0) {
    return `${site.areas.map((id) => areaLink(id, areas)).join(' · ')} — _named, with no section cited_`
  }
  return '_uncited at this site_'
}

function areaLink(id: string, areas: readonly Area[]): string {
  const area = areas.find((candidate) => candidate.id === id)
  if (area === undefined) return `**${id}**`
  if (area.document === null) return `**${id}**`
  return `[**${id}**](analysis/${area.document})`
}

/** Everything the map is made of, collected once. The gates read this; the renderer renders it. */
export interface ContextMap {
  readonly areas: readonly Area[]
  readonly hubs: readonly Hub[]
  readonly debt: readonly DebtMarker[]
  readonly aggregateNodes: readonly AggregateNode[]
  readonly owed: ReturnType<typeof collectOwedInventory>
  readonly anchors: AnchorIndex
}

/**
 * The map, as data.
 *
 * Separate from the renderer so `context-map.test.ts` enumerates the **sets** rather than grepping
 * the emitted markdown for them. A gate that reads the rendered bytes to decide what the model
 * contains is a gate on the renderer.
 */
export function collectContextMap(): ContextMap {
  const model = buildModel()
  const areas = readAreas()
  const table = readCanonicalSubjects()
  const exported = exportsOfIndex(model)
  const aggregates = membersOf(model, declaredExport(model, exported, 'AGGREGATE_KINDS')).map(
    (member) => member.value,
  )
  return {
    areas,
    hubs: collectHubs(model, areas, aggregates),
    debt: collectDebtMarkers(model, areas),
    aggregateNodes: collectAggregateNodes(table, aggregates, areas),
    owed: collectOwedInventory(),
    anchors: buildAnchorIndex(),
  }
}

/** `1 module` / `8 modules` — a generated sentence that says `area(s)` reads as a template. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The whole document, as a string. The only thing `main` does is write it to disk. */
export function generateContextMap(): string {
  const { areas, hubs, debt, aggregateNodes, owed, anchors } = collectContextMap()
  const order = byAreaOrder(areas)

  const lines: string[] = []

  lines.push('# Context map — what crosses the thirteen areas')
  lines.push('')
  lines.push(
    `<!-- GENERATED FILE — DO NOT EDIT BY HAND. Generated by ${CONTEXT_MAP_GENERATOR_REPO_PATH}; ` +
      `run \`${CONTEXT_MAP_COMMAND}\`. -->`,
  )
  lines.push('')
  lines.push('> **Generated file — do not edit by hand.**')
  lines.push('>')
  lines.push(
    '> Every row below is read from `packages/domain-reference/src/` through the TypeScript ' +
      "compiler API, from `data/canonical-subjects.json`, or from `rubric.md`'s own domain-area " +
      `table. The generator is \`${CONTEXT_MAP_GENERATOR_REPO_PATH}\`; regenerate with ` +
      `\`${CONTEXT_MAP_COMMAND}\`. \`tests/conformance/context-map.test.ts\` fails when this file ` +
      'and the code disagree, and when the join surface changes membership without the change being ' +
      'declared.',
  )
  lines.push('>')
  lines.push(
    '> **To change what this says, change the code.** A hand-written context map is a document ' +
      'whose entire content is claims about sets the code already knows — which is the shape of ' +
      'prose that has gone stale here before.',
  )
  lines.push('')

  lines.push('## Contents')
  lines.push('')
  lines.push(`- [${WHAT_HEADING}](#${headingSlug(WHAT_HEADING)})`)
  lines.push(`- [${JOIN_HEADING}](#${headingSlug(JOIN_HEADING)})`)
  lines.push(`- [${AGGREGATE_HEADING}](#${headingSlug(AGGREGATE_HEADING)})`)
  lines.push(`- [${DEBT_HEADING}](#${headingSlug(DEBT_HEADING)})`)
  lines.push(`- [${AREA_HEADING}](#${headingSlug(AREA_HEADING)})`)
  lines.push('')

  renderWhatThisIs(areas, lines)
  renderJoinSurface(hubs, areas, anchors, lines)
  renderAggregates(aggregateNodes, areas, lines)
  renderDebt(debt, owed, areas, order, lines)
  renderAreas(areas, hubs, debt, owed, aggregateNodes, lines)

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

const WHAT_HEADING = 'What this map is, and what it refuses'
const JOIN_HEADING = 'The join surface — the concepts that cross'
const AGGREGATE_HEADING = 'The aggregates, and the record types asserted about each'
const DEBT_HEADING = 'The debt, as directed edges'
const AREA_HEADING = 'The thirteen areas'

function renderWhatThisIs(areas: readonly Area[], lines: string[]): void {
  lines.push(`## ${WHAT_HEADING}`)
  lines.push('')
  lines.push(
    'The nodes are the domain areas of [`rubric.md`](rubric.md), read from that table rather than ' +
      'restated here. The edges are the three things that cross them and that the executable ' +
      'specification can be asked about: the concepts referenced from more than one place, the ' +
      'aggregates two areas both assert about, and the debt one area owes another.',
  )
  lines.push('')
  lines.push(
    'A **context-map-only** area — the ones whose `v1 detail` column says so — appears here as a ' +
      'node with whatever reaches it and nothing more. That is the whole of what it is owed: ' +
      '`rubric.md` says twice that those areas are **not gaps**, and a map that discharged their ' +
      'debt would be four thin area documents wearing a different name.',
  )
  lines.push('')
  lines.push(
    `**${REFUSAL_SENTENCE}** A context map in the usual sense carries ` +
      'a vocabulary for the relationships — shared kernel, customer–supplier, conformist, ' +
      'anticorruption layer, published language — and **no source in this corpus publishes one for ' +
      'this domain**. Assigning them would be the `[ORIGINAL]` guess ' +
      '[`[SD §0]`](analysis/00-shared-decisions.md) forbids, on the axis a reader would be least ' +
      'likely to check; [`[A9 §3.2]`](analysis/A9-identity-cross-references.md) is the precedent in ' +
      'shape, a vocabulary refused on the evidence rather than minted to make the artefact look ' +
      'finished. The refusal has no edge the types can see — there is no vocabulary for it to leave ' +
      'a hole in — so it is held at runtime, over these bytes, by ' +
      '`tests/conformance/context-map.test.ts`.',
  )
  lines.push('')
  lines.push(
    'What is published instead is the join: every concept that crosses, **every place it is ' +
      'referenced from**, and the document cited at that place. A relationship stated as a pattern ' +
      'name is a claim; a relationship stated as a list of reference sites is a fact about the code.',
  )
  lines.push('')
  lines.push(
    `The areas are [${areas.map((area) => area.id).join('], [')}] — ` +
      "in `rubric.md`'s order, which is not byte order.",
  )
  lines.push('')
}

function renderJoinSurface(
  hubs: readonly Hub[],
  areas: readonly Area[],
  anchors: AnchorIndex,
  lines: string[],
): void {
  lines.push(`## ${JOIN_HEADING}`)
  lines.push('')
  // The two witnesses are DERIVED, not written down. A sentence naming `PartyId` and a count of its
  // modules would be an ungated claim about a set this function is holding — the defect the owed-
  // closures round found six of. Picked as the widest-spread concept whose reach is below the
  // threshold and the widest-reach concept whose spread is below it, so if the model changes which
  // concept plays each part, the sentence changes with it.
  const bySpread = [...hubs].sort((left, right) => right.modules.length - left.modules.length)
  const byReach = [...hubs].sort((left, right) => right.areas.length - left.areas.length)
  const spreadOnly = bySpread.find((hub) => hub.areas.length < HUB_AREA_REACH)
  const reachOnly = byReach.find((hub) => hub.modules.length < HUB_MODULE_SPREAD)
  const witnesses =
    spreadOnly === undefined || reachOnly === undefined
      ? 'Both halves currently find the same concepts, which is a change worth reading as evidence: ' +
        'when it last held, each half found something the other did not.'
      : `each half catches what the other misses. Reach alone would miss \`${spreadOnly.name}\`, ` +
        `referenced from ${plural(spreadOnly.modules.length, 'module')} with an area reach of ` +
        `${spreadOnly.areas.length === 0 ? 'none' : plural(spreadOnly.areas.length, 'area')} — the rest ` +
        'of its sites cite the binding layer, which is not an area. Spread alone would miss ' +
        `\`${reachOnly.name}\`, with a reach of ${plural(reachOnly.areas.length, 'area')} and a ` +
        `spread of ${plural(reachOnly.modules.length, 'module')}.`
  lines.push(
    `A concept is here when it is referenced from at least ${HUB_MODULE_SPREAD} modules of \`src/\`, ` +
      `**or** when its reference sites cite at least ${HUB_AREA_REACH} areas. The union was measured ` +
      `rather than assumed, and ${witnesses} Both thresholds are counts, so the membership below is ` +
      'enumerated by name in `tests/conformance/context-map.test.ts` — a new reference that ' +
      'promotes or demotes a concept fails that gate and the author decides which of the two ' +
      'changed.',
  )
  lines.push('')
  lines.push(
    'A declaration carrying **type parameters** is machinery rather than a concept and is not ' +
      "here: ranked on reference spread, `primitives.ts`'s generic helpers sit above every concept " +
      'in the model. Nothing is excluded by name.',
  )
  lines.push('')
  lines.push(
    '**`aggregate`** says whether the concept has one of [`[SD §1.2]`]' +
      "(analysis/00-shared-decisions.md)'s aggregate kinds behind it. `none` on a branded " +
      'identifier is the structural finding ' +
      '[`[A9 §3.6]`](analysis/A9-identity-cross-references.md) records: an identifier the model can ' +
      'carry and cannot make a `subject` of.',
  )
  lines.push('')
  for (const hub of hubs) {
    lines.push(`### \`${hub.name}\``)
    lines.push('')
    lines.push(`- **Declared in:** \`${hub.declaredIn}\``)
    lines.push(
      `- **Aggregate behind it:** ${hub.aggregate === null ? '_none_' : `\`${hub.aggregate}\``}`,
    )
    lines.push(
      `- **Areas that cite a reference site:** ${
        hub.areas.length === 0
          ? '_none — every site cites the binding layer or nothing_'
          : hub.areas.map((id) => areaLink(id, areas)).join(' · ')
      }`,
    )
    lines.push(`- **Modules that reference it:** ${hub.modules.map((m) => `\`${m}\``).join(' · ')}`)
    const crossing = hub.sites.filter((site) => site.areas.length > 0)
    const kernel = hub.sites.filter((site) => site.areas.length === 0)
    if (crossing.length > 0) {
      lines.push('- **Sites whose docstring names an area** — the edges this map is about:')
      for (const site of crossing) {
        lines.push(`  - \`${site.where}\` — ${renderSite(site, anchors, areas)}`)
      }
    } else {
      lines.push(
        '- **Sites whose docstring names an area:** _none_ — every reference is decided by the ' +
          'binding layer or cites nothing, which is why this concept is here on reference spread.',
      )
    }
    if (kernel.length > 0) {
      lines.push(
        '- **Also referenced from**, where the docstring in force names no area — shared-kernel use, ' +
          'listed because a reference a map does not name is a reference a reader cannot find: ' +
          kernel.map((site) => `\`${site.where}\``).join(' · '),
      )
    }
    lines.push('')
  }
}

function renderAggregates(
  nodes: readonly AggregateNode[],
  areas: readonly Area[],
  lines: string[],
): void {
  lines.push(`## ${AGGREGATE_HEADING}`)
  lines.push('')
  lines.push(
    'The glossary joins each record type to its canonical subject family. This is the **inverse** ' +
      'join, and it is the one a map needs: two areas meet on an aggregate when each has a record ' +
      'type that may be asserted about it. The families are ' +
      "[`[SD §4.7.1]`](analysis/00-shared-decisions.md)'s, from " +
      '`packages/domain-reference/data/canonical-subjects.json`; the areas are the ones that table ' +
      "cites on the rows, which is a different question from the areas the concepts' docstrings " +
      'cite above.',
  )
  lines.push('')
  lines.push(
    '`custody` is **not** here and its absence is a decision, not an omission — it is a projection ' +
      'folded from `handover` assertions ([`[SD §4.8]`](analysis/00-shared-decisions.md)), and so ' +
      "is an order's stage ([`[A1 §3.3]`](analysis/A1-order-service-lifecycle.md)). A projection " +
      'has no `subject` of its own, so nothing is asserted about it and it joins no areas here.',
  )
  lines.push('')
  for (const node of nodes) {
    lines.push(`### \`${node.kind}\` (aggregate)`)
    lines.push('')
    lines.push(
      `- **Subject families that admit it:** ${
        node.families.length === 0 ? '_none_' : node.families.map((f) => `\`${f}\``).join(' · ')
      }`,
    )
    lines.push(
      `- **Record types that may name it:** ${
        node.recordTypes.length === 0
          ? '_none_'
          : node.recordTypes.map((t) => `\`${t}\``).join(' · ')
      }`,
    )
    lines.push(
      `- **Areas cited on those rows:** ${
        node.areas.length === 0 ? '_none_' : node.areas.map((id) => areaLink(id, areas)).join(' · ')
      }`,
    )
    lines.push('')
  }
}

function renderDebt(
  debt: readonly DebtMarker[],
  owed: ReturnType<typeof collectOwedInventory>,
  areas: readonly Area[],
  order: (left: string, right: string) => number,
  lines: string[],
): void {
  lines.push(`## ${DEBT_HEADING}`)
  lines.push('')
  lines.push(
    "The glossary's **Owed** section groups the inventory by what is undecided. This groups the " +
      'same debt by **who has to act**, which is the edge a map carries — and it adds a register ' +
      'nothing else reads.',
  )
  lines.push('')
  lines.push(`### The \`TODO(…)\` ledger`)
  lines.push('')
  lines.push(
    'A second ledger of the same kind as the owed inventory, and the one no generated artefact has ' +
      'published. `collectOwedInventory` reads the `owed(…)` constructor, the `Owed<…>` type and ' +
      '`OwedCode<…>`, and those three reach the glossary and `catalog/index.json`; the `TODO(…)` ' +
      'markers reach neither. Each names the document or the module that has to act. Read from the ' +
      'raw source text, because several are `//` comments inside a function body and attach to no ' +
      'declaration.',
  )
  lines.push('')
  for (const marker of debt) {
    const named =
      marker.areas.length === 0
        ? '_names no area_'
        : marker.areas.map((id) => areaLink(id, areas)).join(' · ')
    const note = marker.note.length === 0 ? '' : ` — ${marker.note}`
    lines.push(`- \`${marker.where}:${marker.line}\` → **${marker.blocker}** (${named})${note}`)
  }
  lines.push('')
  lines.push('### The declared owed values, by owner')
  lines.push('')
  lines.push(
    'Every `owed(name, owedTo)` and `Owed<Name, Owner>` in `src/`, keyed on the owner rather than ' +
      'on the value. The owner is part of the value and is auditable ' +
      '([`[catalog §5]`](analysis/published-event-catalog.md)); repointing one is a real ' +
      'deliverable, and reading them grouped this way is how a round finds that two unrelated ' +
      'values are waiting on the same decision.',
  )
  lines.push('')
  const byOwner = new Map<string, string[]>()
  for (const entry of owed.declared) {
    const list = byOwner.get(entry.owedTo) ?? []
    list.push(entry.what)
    byOwner.set(entry.owedTo, list)
  }
  for (const owner of [...byOwner.keys()].sort(byteOrder)) {
    const values = sortedBy(byOwner.get(owner) ?? [], (value) => value)
    const named = [...areaReferencesIn(owner, areas)].sort(order)
    lines.push(
      `- **${owner}** — ${values.map((value) => `\`${value}\``).join(' · ')}` +
        `${named.length === 0 ? '' : ` (${named.map((id) => areaLink(id, areas)).join(' · ')})`}`,
    )
  }
  lines.push('')
  lines.push('### The authority rows that are not assigned')
  lines.push('')
  lines.push(
    "[`[A8 §5]`](analysis/A8-authority-skeleton.md)'s table, filtered to the rows whose status is " +
      'not `assigned`, with the owner each is owed to. The glossary publishes the same rows under ' +
      '**Owed**; here they are edges, and the owner is the node they point at.',
  )
  lines.push('')
  for (const row of owed.authorityRows) {
    const owner = row.owedTo ?? '_no owner recorded_'
    const named = [...areaReferencesIn(row.owedTo ?? '', areas)].sort(order)
    lines.push(
      `- \`${row.type}\` — **${row.status}**, \`boundBy\` \`${row.boundBy}\` — ${owner}` +
        `${named.length === 0 ? '' : ` (${named.map((id) => areaLink(id, areas)).join(' · ')})`}`,
    )
  }
  lines.push('')
}

function renderAreas(
  areas: readonly Area[],
  hubs: readonly Hub[],
  debt: readonly DebtMarker[],
  owed: ReturnType<typeof collectOwedInventory>,
  aggregateNodes: readonly AggregateNode[],
  lines: string[],
): void {
  lines.push(`## ${AREA_HEADING}`)
  lines.push('')
  lines.push(
    'One entry per node, with what reaches it. **Shares with** is the undirected edge — another ' +
      'area that cites a reference site of the same concept — and it is a projection of the join ' +
      'surface above rather than a second computation, so the two cannot disagree. **Owed to it** ' +
      'is the directed edge.',
  )
  lines.push('')
  for (const area of areas) {
    const heading = `${area.id} — ${area.title}`
    lines.push(`### ${heading}`)
    lines.push('')
    lines.push(
      `- **\`v1 detail\`:** ${area.v1Detail}` +
        (area.document === null
          ? ' — context-map-only by design, and **not a gap**; it has no decision document.'
          : ` — [\`analysis/${area.document}\`](analysis/${area.document})`),
    )
    lines.push(`- **\`Covers\`:** ${area.covers}`)
    const mine = hubs.filter((hub) => hub.areas.includes(area.id))
    lines.push(
      `- **Concepts on the join surface that cite it:** ${
        mine.length === 0 ? '_none_' : mine.map((hub) => `\`${hub.name}\``).join(' · ')
      }`,
    )
    const neighbours = new Map<string, string[]>()
    for (const hub of mine) {
      for (const other of hub.areas) {
        if (other === area.id) continue
        const via = neighbours.get(other) ?? []
        via.push(hub.name)
        neighbours.set(other, via)
      }
    }
    if (neighbours.size === 0) {
      lines.push('- **Shares with:** _no other area cites a concept this one cites_')
    } else {
      lines.push('- **Shares with:**')
      for (const other of [...neighbours.keys()].sort(byAreaOrder(areas))) {
        const via = sortedBy(neighbours.get(other) ?? [], (name) => name)
        lines.push(
          `  - ${areaLink(other, areas)} via ${via.map((name) => `\`${name}\``).join(' · ')}`,
        )
      }
    }
    const aggregated = aggregateNodes.filter((node) => node.areas.includes(area.id))
    lines.push(
      `- **Aggregates whose record rows cite it:** ${
        aggregated.length === 0
          ? '_none_'
          : aggregated.map((node) => `\`${node.kind}\``).join(' · ')
      }`,
    )
    const todo = debt.filter((marker) => marker.areas.includes(area.id))
    const values = owed.declared.filter((entry) =>
      areaReferencesIn(entry.owedTo, areas).has(area.id),
    )
    const rows = owed.authorityRows.filter((row) =>
      areaReferencesIn(row.owedTo ?? '', areas).has(area.id),
    )
    if (todo.length === 0 && values.length === 0 && rows.length === 0) {
      lines.push('- **Owed to it:** _nothing in `src/` names it as a blocker_')
    } else {
      lines.push('- **Owed to it:**')
      for (const marker of todo) {
        lines.push(`  - \`${marker.where}:${marker.line}\` → **${marker.blocker}**`)
      }
      for (const entry of values) {
        lines.push(`  - \`${entry.what}\` — ${entry.owedTo}`)
      }
      for (const row of rows) {
        lines.push(`  - \`${row.type}\`'s authority row — ${row.owedTo ?? ''}`)
      }
    }
    lines.push('')
  }
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  writeFileSync(CONTEXT_MAP_FILE, generateContextMap(), 'utf8')
  process.stdout.write(`wrote ${CONTEXT_MAP_REPO_PATH}\n`)
}
