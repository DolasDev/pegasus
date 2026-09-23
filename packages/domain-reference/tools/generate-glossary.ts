/**
 * The glossary generator.
 *
 * The process this package was written under called for a hand-written ubiquitous-language
 * document. It was deliberately replaced, and the reason is the same one [SD §1.1] gives for
 * deleting the generic `correlation` bag: **two homes for one fact can drift.** The names already
 * live in the types, the definitions already live in the JSDoc beside them, and a hand-maintained
 * third copy would be a third place to be wrong.
 *
 * So the glossary is generated **from the code**, and `tests/conformance/glossary-staleness.test.ts`
 * fails when the committed file and the generated one disagree.
 *
 * ## What it reads, and how
 *
 * The TypeScript **compiler API**, not a regular expression over source text. Every term is reached
 * through a real symbol — `checker.getExportsOfModule` over `src/index.ts`, then the declaration's
 * own AST — so a rename cannot silently orphan an entry: the lookup fails and the generator throws.
 * Members of a closed vocabulary (`AGGREGATE_KINDS`, `ROLE_NAMES`, …) are the elements of the
 * declaration's array literal, and each member's definition is the JSDoc comment range attached to
 * that element.
 *
 * It also reads three things that are not code:
 *
 * - `data/canonical-subjects.json` — [SD §4.7.1]'s table, joined onto the 31 record types so each
 *   carries its canonical subject family, its qualifier and its authority (or its owed marker);
 * - the analysis documents' **headings**, to turn a citation like `[SD §4.7.1]` into a link to the
 *   section that decided it;
 * - nothing else. No definition is invented here. Where a term has no usable docstring the fix is a
 *   docstring, and `glossary-coverage.test.ts` is what says so.
 *
 * ## Why it lives in `tools/`
 *
 * `src/` reads no file. This does — the same reason `tests/conformance/documents.test.ts` gives for
 * its own I/O — so it sits outside `src/` and nothing in `src/` depends on it.
 *
 * ## Prettier
 *
 * Prettier rewrites markdown on commit, so the output has to be a **fixed point**: generate it, run
 * `npx prettier --write` over it, and nothing changes. That constraint is why the emitted document
 * is headings, paragraphs, bullets and blockquotes and contains no markdown table — table cells are
 * re-padded by prettier, and a generator that has to reproduce prettier's padding is a generator
 * that will drift from it.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

/* ------------------------------------------------------------------------------------------------
 * Where things are
 * ---------------------------------------------------------------------------------------------- */

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
const SRC_DIR = `${PACKAGE_DIR}src/`
const INDEX_FILE = `${SRC_DIR}index.ts`
const CANONICAL_SUBJECTS_FILE = `${PACKAGE_DIR}data/canonical-subjects.json`
const REASONS_FILE = `${PACKAGE_DIR}data/reasons.json`
const ANALYSIS_DIR = fileURLToPath(
  new URL('../../../docs/domain-reference/analysis/', import.meta.url),
)

/** The committed artefact, and the command that rewrites it. Both appear in the output's header. */
export const GLOSSARY_FILE = fileURLToPath(
  new URL('../../../docs/domain-reference/glossary.md', import.meta.url),
)
export const GLOSSARY_REPO_PATH = 'docs/domain-reference/glossary.md'
export const GLOSSARY_GENERATOR_REPO_PATH = 'packages/domain-reference/tools/generate-glossary.ts'
export const GLOSSARY_COMMAND = 'npm run glossary -w @pegasus/domain-reference'

/* ------------------------------------------------------------------------------------------------
 * Byte-order sorting
 * ---------------------------------------------------------------------------------------------- */

/**
 * Deterministic ordering — **byte order, never locale.**
 *
 * `String.prototype.localeCompare` orders `weight.net` before `weightless` in one ICU build and
 * after it in another, and a generated file that reorders itself on a different machine is a
 * generated file whose staleness test is noise.
 */
export function byteOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => byteOrder(key(left), key(right)))
}

/* ------------------------------------------------------------------------------------------------
 * The program
 * ---------------------------------------------------------------------------------------------- */

function sourceFilesUnder(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}${entry.name}`
    if (entry.isDirectory()) found.push(...sourceFilesUnder(`${path}/`))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found.sort(byteOrder)
}

interface Model {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  readonly files: readonly ts.SourceFile[]
}

function buildModel(): Model {
  const files = sourceFilesUnder(SRC_DIR)
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
  })
  const sources = files
    .map((file) => program.getSourceFile(file))
    .filter((file): file is ts.SourceFile => file !== undefined)
  return { program, checker: program.getTypeChecker(), files: sources }
}

/** The path a reader can open, relative to the repository root. */
function repoPath(file: ts.SourceFile): string {
  const index = file.fileName.indexOf('/packages/')
  return index === -1 ? file.fileName : file.fileName.slice(index + 1)
}

/* ------------------------------------------------------------------------------------------------
 * JSDoc, read off the AST
 * ---------------------------------------------------------------------------------------------- */

/**
 * The JSDoc comment immediately preceding a node, as text.
 *
 * Read from the node's own leading comment ranges rather than from a line offset, so it stays bound
 * to the declaration through a reorder. `undefined` means the node carries no `/** … *\/` comment —
 * which the coverage gate reports and never papers over.
 */
function docCommentOf(node: ts.Node): string | undefined {
  const text = node.getSourceFile().getFullText()
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
  const jsdoc = ranges.filter((range) => text.slice(range.pos, range.pos + 3) === '/**')
  const last = jsdoc[jsdoc.length - 1]
  if (last === undefined) return undefined
  return unwrapJsDoc(text.slice(last.pos, last.end))
}

/** `/** … *\/` with its frame removed, blank lines preserved, `{@link X}` rendered as code. */
function unwrapJsDoc(raw: string): string {
  const body = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').trimEnd())
  // A tag block (`@param`, `@returns`) is API plumbing rather than a definition; the vocabulary
  // uses none today, and cutting at the first one keeps that true if it ever does.
  const end = body.findIndex((line) => /^@\w+/.test(line))
  const kept = end === -1 ? body : body.slice(0, end)
  return kept
    .join('\n')
    .replace(/\{@link\s+([^}|]+?)\s*\}/g, (_match, target: string) => `\`${target.trim()}\``)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The **definition**: a docstring's first paragraph, plus the blockquote it introduces.
 *
 * Most rules in this package are written as "**Rule X** — [cite]:" followed by the rule quoted
 * verbatim, so stopping at the paragraph would print a colon and throw the rule away. Taking the
 * quote too is what makes the generated entry say what the rule actually is.
 */
function definitionOf(doc: string): string {
  const blocks = doc.split(/\n\s*\n/).map((block) => block.trim())
  const first = blocks[0] ?? ''
  const second = blocks[1] ?? ''
  const wantsItsQuote = first.endsWith(':') && second.startsWith('>')
  const quoteFirst = first.startsWith('>')
  if (quoteFirst) return first
  return wantsItsQuote ? `${first}\n\n${second}` : first
}

/* ------------------------------------------------------------------------------------------------
 * Citations and markers — [SD §0]'s disclosure rule, made mechanical
 * ---------------------------------------------------------------------------------------------- */

/** The binding layer, then A8, then the three decision documents, then the review rounds. */
const DOCUMENTS: Readonly<Record<string, string>> = {
  SD: '00-shared-decisions.md',
  A8: 'A8-authority-skeleton.md',
  A4: 'A4-execution-events.md',
  A3: 'A3-trip-stop-assignment.md',
  'fork-order': 'fork-order-shipment-cardinality.md',
  'fork-time': 'fork-time-provenance-corrections.md',
  F1: 'F1-handover-qualifier-decision.md',
  // Derives from SD and A8 rather than outranking them ([catalog §0]); listed after them for that
  // reason, and before the review rounds.
  catalog: 'published-event-catalog.md',
  'round-1-crosscheck': 'round-1-crosscheck.md',
  'round-2-critique': 'round-2-critique.md',
  'findings-from-alloy': 'findings-from-alloy.md',
}

const DOCUMENT_TOKENS = Object.keys(DOCUMENTS).sort((left, right) => right.length - left.length)

/**
 * `[SD §4.7.1]`, and `[SD]` for the document as a whole.
 *
 * The section group requires **whitespace** before it rather than allowing the closing bracket.
 * With `(?:\s|\])` the `\]` branch consumed a citation's own closing bracket and then ran
 * `[^\]]*` on to the *next* one, so a bare `[findings-from-alloy]` followed later in the same
 * docstring by `[A8 §2]` was swallowed as a single citation and rendered as a broken nested link.
 * Bare citations still match: the group is optional.
 */
const CITATION = new RegExp(`\\[(${DOCUMENT_TOKENS.join('|')})(\\s[^\\]]*)?\\]`, 'g')
const CORPUS_CITATION = /`src:[a-z0-9-]+`/g
const REGULATION_CITATION = /§\s?\d/
const MARKER = /\[(ORIGINAL|SYNTHESIS)\]/g

interface Citation {
  readonly document: string
  /** `4.7.1` where the citation named a section, `null` where it named the document as a whole. */
  readonly section: string | null
  /** The citation exactly as the docstring spells it. */
  readonly text: string
}

function citationsIn(doc: string): Citation[] {
  const seen = new Map<string, Citation>()
  for (const match of doc.matchAll(CITATION)) {
    const document = match[1] ?? ''
    const tail = match[2] ?? ''
    const section = /§\s*([\d]+(?:\.[\d]+)*[a-z]?)/.exec(tail)?.[1] ?? null
    const text = match[0]
    if (!seen.has(text)) seen.set(text, { document, section, text })
  }
  return sortedBy([...seen.values()], (citation) => citation.text)
}

function markersIn(doc: string): string[] {
  const found = new Set<string>()
  for (const match of doc.matchAll(MARKER)) found.add(`[${match[1] ?? ''}]`)
  return [...found].sort(byteOrder)
}

function hasCitation(doc: string): boolean {
  CITATION.lastIndex = 0
  CORPUS_CITATION.lastIndex = 0
  return CITATION.test(doc) || CORPUS_CITATION.test(doc) || REGULATION_CITATION.test(doc)
}

/* ------------------------------------------------------------------------------------------------
 * Links into the deciding document
 * ---------------------------------------------------------------------------------------------- */

/**
 * GitHub's heading slug: lowercased, punctuation dropped, **each remaining space** hyphenated.
 *
 * "Each" is the part that is easy to get wrong and is load-bearing: dropping the em dash out of
 * `Owed — what the model declares undecided` leaves two adjacent spaces, and GitHub turns them into
 * two hyphens. Collapsing whitespace first produces one, and every link into a heading with a dash
 * in it then points at nothing.
 */
export function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/ /g, '-')
}

/** The one section heading the Contents has to link to by hand; spelled once so it cannot drift. */
const OWED_HEADING = 'Owed — what the model declares undecided, and who owes it'

type AnchorIndex = ReadonlyMap<string, ReadonlyMap<string, string>>

/**
 * Section number → heading anchor, per document.
 *
 * Built by reading the documents' own headings, so `[SD §4.7.1]` links to the section that decided
 * it rather than to the top of a three-hundred-kilobyte file. A citation whose section has no
 * heading of its own — `[SD §4.7.2f]`, which is a bold run inside §4.7.2 — falls back to the
 * longest heading that is a prefix of it.
 */
function buildAnchorIndex(): AnchorIndex {
  const index = new Map<string, Map<string, string>>()
  for (const [token, file] of Object.entries(DOCUMENTS)) {
    const anchors = new Map<string, string>()
    let text: string
    try {
      text = readFileSync(`${ANALYSIS_DIR}${file}`, 'utf8')
    } catch {
      index.set(token, anchors)
      continue
    }
    for (const line of text.split('\n')) {
      const heading = /^#{1,6}\s+(.*)$/.exec(line)
      if (heading === null) continue
      const title = (heading[1] ?? '').trim()
      const numbered = /^(\d+(?:\.\d+)*[a-z]?)\s/.exec(title)
      if (numbered === null) continue
      const number = numbered[1] ?? ''
      if (!anchors.has(number)) anchors.set(number, headingSlug(title))
    }
    index.set(token, anchors)
  }
  return index
}

function linkFor(citation: Citation, anchors: AnchorIndex): string {
  const file = DOCUMENTS[citation.document]
  if (file === undefined) return citation.text
  const perDocument = anchors.get(citation.document)
  let anchor: string | undefined
  let section = citation.section
  while (section !== null && anchor === undefined) {
    anchor = perDocument?.get(section)
    if (anchor !== undefined) break
    // A lettered subsection (`4.7.2f`) is a bold run inside its numbered parent, never a heading
    // of its own, so drop the letter before dropping a level — otherwise `4.7.2f` would skip
    // §4.7.2 entirely and land on §4.7.
    if (/[a-z]$/.test(section)) {
      section = section.slice(0, -1)
      continue
    }
    const cut = section.lastIndexOf('.')
    section = cut === -1 ? null : section.slice(0, cut)
  }
  const target = anchor === undefined ? `analysis/${file}` : `analysis/${file}#${anchor}`
  return `[${citation.text}](${target})`
}

/* ------------------------------------------------------------------------------------------------
 * Reaching a declaration
 * ---------------------------------------------------------------------------------------------- */

/** A declaration reached through the module's real exports, with the file it was found in. */
interface Declared {
  readonly name: string
  readonly node: ts.Node
  readonly file: ts.SourceFile
  readonly doc: string | undefined
}

/**
 * The exports of `src/index.ts`, by name.
 *
 * Through the checker rather than by scanning files: `index.ts` is nothing but `export *`, so a
 * term that stops being exported disappears from this map and every lookup for it throws.
 */
function exportsOfIndex(model: Model): ReadonlyMap<string, ts.Symbol> {
  const index = model.program.getSourceFile(INDEX_FILE)
  if (index === undefined) throw new Error(`the generator cannot find ${INDEX_FILE}`)
  const moduleSymbol = model.checker.getSymbolAtLocation(index)
  if (moduleSymbol === undefined) throw new Error(`${INDEX_FILE} is not a module`)
  const exported = new Map<string, ts.Symbol>()
  for (const symbol of model.checker.getExportsOfModule(moduleSymbol)) {
    exported.set(symbol.getName(), symbol)
  }
  return exported
}

/** The node a JSDoc comment would sit above — a `const` carries it on the statement. */
function documentedNode(declaration: ts.Declaration): ts.Node {
  if (ts.isVariableDeclaration(declaration)) {
    const list = declaration.parent
    if (ts.isVariableDeclarationList(list) && ts.isVariableStatement(list.parent))
      return list.parent
  }
  return declaration
}

function declaredExport(
  model: Model,
  exported: ReadonlyMap<string, ts.Symbol>,
  name: string,
): Declared {
  const symbol = exported.get(name)
  if (symbol === undefined) {
    throw new Error(
      `the glossary covers \`${name}\`, and \`src/index.ts\` no longer exports it — ` +
        'rename the glossary entry or restore the export',
    )
  }
  const aliased =
    symbol.flags & ts.SymbolFlags.Alias ? model.checker.getAliasedSymbol(symbol) : symbol
  const declaration = (aliased.getDeclarations() ?? [])[0]
  if (declaration === undefined) throw new Error(`\`${name}\` has no declaration`)
  const node = documentedNode(declaration)
  return { name, node, file: node.getSourceFile(), doc: docCommentOf(node) }
}

/**
 * A declaration named inside one file, exported or not — `checkM1`, `PortionCommon.shipment`.
 *
 * M1-M7 are private predicates by design ({@link CaptureVerdict} is the public surface), and
 * **P-IDENTITY** is stated on a property of an interface the module does not export. The rules are
 * part of the ubiquitous language either way, so they are addressed by declaration path rather than
 * promoted to exports for the glossary's convenience.
 */
function declaredInFile(model: Model, file: string, path: string): Declared {
  const source = model.files.find((candidate) => candidate.fileName.endsWith(`/src/${file}`))
  if (source === undefined) throw new Error(`the generator cannot find src/${file}`)
  const [head, member] = path.split('.')
  let found: ts.Node | undefined
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === head) found = statement
    else if (ts.isInterfaceDeclaration(statement) && statement.name.text === head) found = statement
    else if (ts.isTypeAliasDeclaration(statement) && statement.name.text === head) found = statement
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === head) found = statement
      }
    }
  }
  if (found === undefined) throw new Error(`src/${file} declares no \`${head}\``)
  if (member !== undefined) {
    if (!ts.isInterfaceDeclaration(found)) throw new Error(`\`${head}\` is not an interface`)
    const property = found.members.find(
      (candidate) => ts.isPropertySignature(candidate) && candidate.name.getText() === member,
    )
    if (property === undefined) throw new Error(`\`${head}\` has no member \`${member}\``)
    found = property
  }
  return { name: path, node: found, file: source, doc: docCommentOf(found) }
}

/* ------------------------------------------------------------------------------------------------
 * Closed vocabularies — the members of an `as const` array
 * ---------------------------------------------------------------------------------------------- */

interface Member {
  readonly value: string
  readonly doc: string | undefined
  readonly declaredBy: string
  readonly file: string
}

/** `[...] as const satisfies T` is three nodes deep; the literal is what any of them is about. */
function unwrapAssertions(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function arrayLiteralOf(node: ts.Node): ts.ArrayLiteralExpression {
  let initializer: ts.Expression | undefined
  if (ts.isVariableStatement(node)) {
    initializer = node.declarationList.declarations[0]?.initializer
  }
  if (initializer === undefined) throw new Error('not a `const x = [...]` declaration')
  const unwrapped = unwrapAssertions(initializer)
  if (!ts.isArrayLiteralExpression(unwrapped)) throw new Error('not an array literal')
  return unwrapped
}

/**
 * The declaration an element **names**, where the element is a reference rather than a literal.
 *
 * `CUSTODY_BASES` is `[HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY, HANDED_OVER]` and not `[41, 349]`
 * for a reason the module states: prettier fills an array of numbers onto one line and drags each
 * member's JSDoc with it, so a definition written inside that array cannot survive a commit. The
 * definition therefore lives on the named constant, and this is what follows the reference to it —
 * through the checker, so a rename is a resolution failure rather than a silently empty entry.
 */
function resolvedMember(
  model: Model,
  element: ts.Expression,
): { readonly value: string; readonly doc: string | undefined } | undefined {
  if (!ts.isIdentifier(element)) return undefined
  const symbol = model.checker.getSymbolAtLocation(element)
  if (symbol === undefined) throw new Error(`\`${element.text}\` does not resolve to a declaration`)
  const aliased =
    symbol.flags & ts.SymbolFlags.Alias ? model.checker.getAliasedSymbol(symbol) : symbol
  const declaration = (aliased.getDeclarations() ?? [])[0]
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) {
    throw new Error(`\`${element.text}\` is not a \`const\` declaration`)
  }
  const initializer = declaration.initializer
  if (initializer === undefined) throw new Error(`\`${element.text}\` has no initializer`)
  const literal = unwrapAssertions(initializer)
  const value = ts.isStringLiteralLike(literal) ? literal.text : literal.getText()
  return { value, doc: docCommentOf(documentedNode(declaration)) }
}

/** One entry per element of the declaration's array literal, in declaration order. */
function membersOf(model: Model, declared: Declared): Member[] {
  const literal = arrayLiteralOf(declared.node)
  return literal.elements.map((element) => {
    const referenced = resolvedMember(model, element)
    const value =
      referenced?.value ??
      (ts.isStringLiteralLike(element)
        ? element.text
        : ts.isNumericLiteral(element)
          ? element.text
          : element.getText())
    return {
      value,
      doc: referenced?.doc ?? docCommentOf(element),
      declaredBy: declared.name,
      file: repoPath(declared.file),
    }
  })
}

/* ------------------------------------------------------------------------------------------------
 * The owed ledger — every `owed(…)` and every `Owed<…>` in `src/`
 * ---------------------------------------------------------------------------------------------- */

interface OwedEntry {
  readonly what: string
  readonly owedTo: string
  readonly where: string
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal)) return node.literal.text
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/**
 * What the model itself declares undecided.
 *
 * Two spellings, both read from the AST: the `owed(name, owedTo)` constructor and the
 * `Owed<Name, Owner>` type. [SD §0] forbids guessing a value to make the types tidy, so the count
 * is the honest state of the model — and a reference model that cannot say **how much** is
 * undecided invites a reader to assume the answer is "not much" (`data.ts`, `owedAuthorityRows`).
 */
function owedFromCode(model: Model): OwedEntry[] {
  const entries: OwedEntry[] = []
  for (const file of model.files) {
    const where = repoPath(file)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'owed'
      ) {
        const what = literalText(node.arguments[0] ?? node)
        const owedTo = literalText(node.arguments[1] ?? node)
        if (what !== undefined && owedTo !== undefined) entries.push({ what, owedTo, where })
      }
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === 'Owed'
      ) {
        const what = literalText(node.typeArguments?.[0] ?? node)
        const owedTo = literalText(node.typeArguments?.[1] ?? node)
        if (what !== undefined && owedTo !== undefined) entries.push({ what, owedTo, where })
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return entries
}

/**
 * The **vocabularies** the model declares owed, as distinct from the values.
 *
 * `OwedCode<'reasonCode'>` is not an `Owed<…>` and never was, so until A4 landed the owed inventory
 * counted 21 declared values and **no owed vocabularies at all** — while four closed enums were
 * missing their members. That is precisely the "invites a reader to assume the answer is 'not much'"
 * failure {@link owedFromCode} was written against, one construct over, and it went unnoticed because
 * the ledger only knew one spelling. Found while landing A4, which was supposed to make the inventory
 * shrink and did not ([A4 §7]).
 *
 * Read from the AST like the others: every `OwedCode<'x'>` type reference in `src/`, deduplicated by
 * vocabulary name.
 */
function owedVocabulariesFromCode(model: Model): { name: string; where: string }[] {
  const seen = new Map<string, { name: string; where: string }>()
  for (const file of model.files) {
    const where = repoPath(file)
    const visit = (node: ts.Node): void => {
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === 'OwedCode'
      ) {
        const name = literalText(node.typeArguments?.[0] ?? node)
        if (name !== undefined && !seen.has(name)) seen.set(name, { name, where })
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return sortedBy([...seen.values()], (entry) => entry.name)
}

/**
 * The `FACT_CLASS_FAMILY` rows the [SYNTHESIS] could not make, read off the object literal.
 *
 * Two of the thirty-one types are marked `'owed'` rather than assigned a family — neither `charge`
 * nor `notification` appears in [SD §4.1]'s list — and reporting them is the same discipline the
 * table itself applies: a join that cannot be made is a finding, not a blank.
 */
function owedFactClassFamilies(model: Model): (readonly [string, string])[] {
  const source = model.files.find((file) => file.fileName.endsWith('/src/vocabulary.ts'))
  if (source === undefined) throw new Error('the generator cannot find src/vocabulary.ts')
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations[0]
    if (declaration === undefined) continue
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'FACT_CLASS_FAMILY')
      continue
    const initializer = declaration.initializer
    const literal = initializer === undefined ? undefined : unwrapAssertions(initializer)
    if (literal === undefined || !ts.isObjectLiteralExpression(literal)) break
    const owedRows: (readonly [string, string])[] = []
    for (const property of literal.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const family = literalText(property.initializer)
      if (family !== 'owed') continue
      const name = ts.isStringLiteralLike(property.name)
        ? property.name.text
        : property.name.getText()
      owedRows.push([name, family])
    }
    return sortedBy(owedRows, ([name]) => name)
  }
  throw new Error('src/vocabulary.ts no longer declares `FACT_CLASS_FAMILY` as an object literal')
}

/* ------------------------------------------------------------------------------------------------
 * [SD §4.7.1]'s table, as shipped in `data/`
 * ---------------------------------------------------------------------------------------------- */

interface CanonicalRow {
  readonly type: string
  readonly family: string
  readonly proseAliases: readonly string[]
  readonly qualifier: { readonly fields: readonly string[]; readonly citation: string } | null
  readonly authority: {
    readonly status: string
    readonly boundBy: string
    readonly summary?: string
    readonly owedTo?: string
    readonly assignedWhen?: string
    readonly owedWhen?: string
    readonly scoring?: string
    readonly a8Row?: { readonly row: number; readonly sameType: boolean } | null
    readonly provisional?: { readonly marker: string; readonly reading: string } | null
    readonly citations?: readonly string[]
  }
}

interface CanonicalTable {
  readonly rows: readonly CanonicalRow[]
  readonly families: Readonly<Record<string, { readonly members: readonly string[] }>>
}

function readCanonicalSubjects(): CanonicalTable {
  const raw = JSON.parse(readFileSync(CANONICAL_SUBJECTS_FILE, 'utf8')) as {
    rows: CanonicalRow[]
    families: { members: Record<string, { members: string[] }> }
  }
  return { rows: raw.rows, families: raw.families.members }
}

/**
 * `data/reasons.json`'s per-code table — [A4 §3].
 *
 * Joined onto the `reason code` entries for the same reason the canonical-subject table is joined
 * onto the record types: the docstring carries the evidence and the table carries the discipline, and
 * a reader who has to open two files to learn whether a code requires a remedy has been given half
 * an answer. The loader already holds the two to one set ([SD §2.4]).
 */
function readReasonCodeTable(): Map<string, ReasonRow> {
  const raw = JSON.parse(readFileSync(REASONS_FILE, 'utf8')) as {
    vocabulary: { codes: ReasonRow[] }
  }
  return new Map(raw.vocabulary.codes.map((row) => [row.code, row]))
}

interface ReasonRow {
  readonly code: string
  readonly scope: string
  readonly partyRequired: boolean
  readonly remedyRequired: boolean
  readonly remedyShape: string | null
  readonly marker: string | null
  readonly citation: string
}

function factsForReasonCode(row: ReasonRow | undefined): (readonly [string, string])[] {
  if (row === undefined) return []
  return [
    ['Default scope', `\`${row.scope}\``],
    [
      'Attribution',
      row.partyRequired
        ? '`attribution.party` **required** — a party-side reason that cannot name the party is the ' +
          '`DIV` overload [SD §2.3] invariant 2 removes'
        : '`attribution.party` optional; `roleClass` is not ([SD §2.4] rule 6)',
    ],
    [
      'Remedy',
      row.remedyRequired
        ? `**required** — \`${row.remedyShape ?? ''}\` ([SD §2.4] rule 5)`
        : 'not required ([SD §2.4] rule 5, "for some codes")',
    ],
  ]
}

/* ------------------------------------------------------------------------------------------------
 * The entries
 * ---------------------------------------------------------------------------------------------- */

interface Entry {
  readonly term: string
  readonly category: string
  readonly definition: string
  readonly doc: string | undefined
  readonly declaredBy: string
  readonly file: string
  /** Rendered `- **Label:** value` lines, in the order they are written. */
  readonly facts: readonly (readonly [string, string])[]
}

interface Category {
  readonly name: string
  readonly heading: string
  readonly blurb: string
  readonly entries: readonly Entry[]
}

/** The categories the glossary must cover, in the order the brief names them. */
const VOCABULARIES: readonly {
  readonly name: string
  readonly heading: string
  readonly blurb: string
  readonly symbols: readonly string[]
}[] = [
  {
    name: 'aggregate',
    heading: 'Aggregates',
    blurb:
      'The fourteen members of [SD §1.2]\'s versioned closed enum — "open to _addition_ in a later ' +
      '`specVersion`, never to reinterpretation". One record names exactly one of these as its ' +
      '`subject`, never a path and never two. `custody` is deliberately absent: it is a projection ' +
      '([SD §4.8]), not an aggregate.',
    symbols: ['AGGREGATE_KINDS'],
  },
  {
    name: 'record type',
    heading: 'Record types',
    blurb:
      'The one published record vocabulary — every `type` an Assertion may carry. [SD §1.3] makes ' +
      'this the **single classification axis**: on an Assertion the `type` **is** the fact class, ' +
      'and [SD §4.7.1] is its complete declaration. Each entry carries the canonical subject family ' +
      'it may be asserted about (**E-CANON**), the `qualifier` it declares if any, and the ' +
      'authority row [A8 §5] gives it — or the explicit note that the row is **owed**. The last ' +
      'three columns are joined from `packages/domain-reference/data/canonical-subjects.json`.',
    symbols: ['ACT_TYPES', 'NON_ACT_TYPES'],
  },
  {
    name: 'fact-class family',
    heading: 'Fact-class families',
    blurb:
      'Families **over** the one axis, not a second axis ([SD §1.1] forbids one). [SD §4.1] uses ' +
      'them to argue that "weights, piece counts, conditions and statuses DO have a ' +
      'competing-assertion story, and it is the same one times have". One of the eight, `state`, ' +
      'has no publishable member — see the owed section.',
    symbols: ['FACT_CLASS_FAMILIES'],
  },
  {
    name: 'basis',
    heading: 'Bases',
    blurb:
      "[SD §4.2]'s tense enum. **Tense lives on the value, never on the envelope** — the one " +
      'cross-cutting decision of the three documents that survives unchanged ([SD §1.1]), and the ' +
      'reason the envelope forbids a `tense` qualifier.',
    symbols: ['BASES'],
  },
  {
    name: 'capture method',
    heading: 'Capture methods',
    blurb:
      "[SD §5.1]'s seven members, and the axis [SD §5] cuts the machine-assertion rule on: " +
      '"The rule binds on `capturedBy`, not on \'a device\'." Nothing in `rules/capture.ts` tests ' +
      'for a device; every rule tests a member of this enum.',
    symbols: ['CAPTURE_METHODS'],
  },
  {
    name: 'outcome',
    heading: 'Outcomes',
    blurb:
      'Five members ([SD §2.2]), carried by every act record at `basis = ACTUAL`. **The event ' +
      '`type` names the act and never the outcome** (**A-TYPE**, [SD §2.5]), and `reasons[]` has at ' +
      'least one member unless the outcome is `COMPLETED`, where it is forbidden ([SD §2.3] ' +
      'invariant 2).',
    symbols: ['OUTCOMES'],
  },
  {
    name: 'reason scope',
    heading: 'Reason scopes',
    blurb:
      '`Reason.scope` — **[ORIGINAL]** in [SD §2.4]. "It exists so a consumer can separate ' +
      "'something is wrong with the goods' from 'something is wrong with the site' without reading " +
      "a code list, and because HHG's authoring gap is concentrated in `SITE` and " +
      '`ADMINISTRATIVE`." Every code below declares a default scope, and [A4 §4.4] is where that ' +
      "gap turned out to be narrower than [SD §2.4]'s examples suggested: `src:dp3-400ng` Item " +
      '125.1 enumerates the shuttle causes and Item 33 the impractical operations.',
    symbols: ['REASON_SCOPES'],
  },
  {
    name: 'reason code',
    heading: 'Reason codes',
    blurb:
      'The published reason vocabulary — the half of `(outcome, reason)` [SD §2.4] fixed the shape ' +
      'of and left to A4: "the list itself is A4\'s job". Twenty-three members, which is rule 2\'s ' +
      'magnitude ("~20 reasons × 5 outcomes, not ~100 types") and not a quota. Every member is ' +
      "**orthogonal to the outcome** — `GOODS_DAMAGED` is `src:shippeo`'s `LIV/RCA` _and_ its " +
      '`REN/AVA`, one code under two outcomes — and **grain-independent**: a code does not change ' +
      'when the subject changes grain. `OTHER` is not a member: it is declared by the shape itself ' +
      '(rule 3) and carries a mandatory narrative the others do not. The per-code scope, attribution ' +
      'discipline and remedy obligation are joined from ' +
      '`packages/domain-reference/data/reasons.json`, which the loader holds to this list as a set.',
    symbols: ['REASON_CODES'],
  },
  {
    name: 'role name',
    heading: 'Role names',
    blurb:
      "[A8 §2]'s cast: `src:sirva-ade`'s `Resource.Type` roles plus the four A8 adds because each " +
      'asserts facts. Two naming rules bind it — **A8-NAME-1** ("the bare word `agent` is not a ' +
      'role in this model") and **A8-NAME-2** (the bare word `shipper` splits into `accountParty` ' +
      'and the goods owner). **Provisional**: [A8 §9 item 2] leaves the role enum undefined, and ' +
      '[A8 §2] takes the cast as a name list without defining any role individually.',
    symbols: ['ROLE_NAMES'],
  },
  {
    name: 'membership form',
    heading: 'Membership forms',
    blurb:
      "How a Portion's membership is stated ([SD §3.1], [SD §3.2]). The corpus publishes **both** " +
      'forms for the same phenomenon, which is why neither can be the sole grain — and why ' +
      '**P-MEMBER** lets one become the other without changing the `portionId`.',
    symbols: ['MEMBERSHIP_FORMS'],
  },
  {
    name: 'custody basis',
    heading: 'Custody bases',
    blurb:
      "`src:uncefact-rec24`'s two codes — the one real distinction the source draws, and the hinge " +
      '[A8 §7.1] hangs **A8-MOVE** on. Kept as the numeric code and not renamed: [A3 §5.2] records ' +
      'that Rec 24 supplies them "as two status codes, **not as an entity**", and the code is the ' +
      'part that is sourced.',
    symbols: ['CUSTODY_BASES'],
  },
  {
    name: 'catalog face',
    heading: 'Catalog faces',
    blurb:
      "The two published faces of every record ([catalog §4.1]), forced by [SD §1.1]'s obligation " +
      'on `recordedAt`: "server-authored; **FORBIDDEN on capture, MANDATORY on query**". Two ' +
      'types, not one optional field — so two schema documents, and both are external contracts.',
    symbols: ['CATALOG_FACES'],
  },
  {
    name: 'filter axis',
    heading: 'Filter axes',
    blurb:
      'What a consumer may filter a subscription or a query on ([catalog §3.2]). Every member is ' +
      'an envelope field, a payload field the vocabulary declares, or a key **derived** from ' +
      'those — there is no fourth kind, and the derived members are what answer the ' +
      '"publish something coarser" argument without adding the second classification axis ' +
      '[SD §1.1] forbids.',
    symbols: ['FILTER_AXES'],
  },
  {
    name: 'refused filter axis',
    heading: 'Refused filter axes',
    blurb:
      'What a consumer may **not** filter on, each carrying the decision that refuses it ' +
      '([catalog §3.2]). Published as a list rather than left as an absence, for the reason ' +
      '[SD §4.7.3] gives for its own: "so their absence is not read as an oversight".',
    symbols: ['REFUSED_FILTER_AXES'],
  },
  {
    name: 'change class',
    heading: 'Compatibility change classes',
    blurb:
      'What may change within a major `specVersion` and what may not ([catalog §2.3]). ' +
      '**[SYNTHESIS]**: the classification is ours and each member is a consequence of a sourced ' +
      'rule that it names. `src:dcsa` publishes the _practice_ — per-release changelogs down to a ' +
      'renamed filter — but no source in the corpus publishes the rule.',
    symbols: ['ADDITIVE_CHANGES', 'BREAKING_CHANGES'],
  },
]

/**
 * The rules and folds the brief names, each addressed at the declaration that states it.
 *
 * Addressing rather than restating is the point: the JSDoc on `custodyAt` **is** [SD §4.8.3]'s
 * fold, and a glossary that paraphrased it would be the hand-maintained third copy this generator
 * exists to avoid.
 */
const RULES: readonly {
  readonly term: string
  readonly what: string
  readonly export?: string
  readonly file?: string
  readonly path?: string
  readonly member?: readonly [string, string]
}[] = [
  { term: 'custodyAt', what: 'the custody fold', export: 'custodyAt' },
  { term: 'E-CANON-STRICT', what: 'the subject-admission boundary', export: 'admitAtBoundary' },
  {
    term: 'E-CANON-RESOLVE',
    what: 'subject resolution, before the boundary',
    export: 'resolveSubject',
  },
  {
    term: 'E-CANON-OBLIGATION',
    what: 'what a refusal leaves behind',
    export: 'RetainedSubmission',
  },
  { term: 'M1', what: 'the machine-assertion rule', file: 'rules/capture.ts', path: 'checkM1' },
  { term: 'M2', what: 'the machine-assertion rule', file: 'rules/capture.ts', path: 'checkM2' },
  { term: 'M3', what: 'the machine-assertion rule', file: 'rules/capture.ts', path: 'checkM3' },
  { term: 'M4', what: 'the machine-assertion rule', file: 'rules/capture.ts', path: 'checkM4' },
  { term: 'M5', what: 'the machine-assertion rule', file: 'rules/capture.ts', path: 'checkM5' },
  {
    term: 'M6(a)',
    what: 'a named defect, declined',
    file: 'rules/capture.ts',
    path: 'M6A_GEOFENCE_DERIVED_CONFORMITY',
  },
  {
    term: 'M6(b)',
    what: 'a named defect, declined',
    file: 'rules/capture.ts',
    path: 'M6B_PUBLISHER_KINDS',
  },
  { term: 'M7', what: 'the machine-assertion rule', export: 'checkEligibility' },
  { term: 'A8-INSTANT', what: 'which clock authority is keyed on', export: 'FactInstant' },
  {
    term: 'A8-MOVE',
    what: 'how authority moves at a handover',
    export: 'authorityMovesAtHandover',
  },
  { term: 'A8-AFTER', what: 'a former holder after a handoff', export: 'standingAfterBoundary' },
  {
    term: 'C5',
    what: 'the custody timeline',
    export: 'CUSTODY_UNKNOWN_REASONS',
    member: ['CUSTODY_UNKNOWN_REASONS', 'IN_TRANSFER_GAP'],
  },
  {
    term: 'C6',
    what: 'the custody tie',
    export: 'CUSTODY_UNKNOWN_REASONS',
    member: ['CUSTODY_UNKNOWN_REASONS', 'AMBIGUOUS_ORDER_AT_INSTANT'],
  },
  { term: 'I-KEY', what: 'the identity fact key', export: 'IdentityFactKey' },
  { term: 'P-MEMBER', what: 'a Portion may learn more', export: 'isLegalMembershipTransition' },
  { term: 'P-CLAIM', what: 'a claim addresses items', export: 'canSupportClaim' },
  { term: 'P-OVERLAP', what: 'Portions may overlap and nest', export: 'enumeratedSubsetOf' },
  {
    term: 'P-IDENTITY',
    what: 'a Portion never moves the shipment boundary',
    file: 'portion.ts',
    path: 'PortionCommon.shipment',
  },
  { term: 'R-WEIGHT-LOWER', what: 'the one published value rule', export: 'R_WEIGHT_LOWER' },
]

/* ------------------------------------------------------------------------------------------------
 * Building the entries
 * ---------------------------------------------------------------------------------------------- */

function factsForRecordType(
  row: CanonicalRow | undefined,
  table: CanonicalTable,
): (readonly [string, string])[] {
  if (row === undefined) return []
  const facts: (readonly [string, string])[] = []
  const members = table.families[row.family]?.members ?? []
  facts.push([
    'Canonical subject family',
    `\`${row.family}\` = {${members.map((member) => `\`${member}\``).join(', ')}}`,
  ])
  facts.push([
    'Qualifier',
    row.qualifier === null
      ? 'none — the fact key is `(subject, type)`'
      : `\`{${row.qualifier.fields.join(', ')}}\` — ${row.qualifier.citation}`,
  ])
  if (row.proseAliases.length > 0) {
    facts.push([
      'Prose aliases (never in a record)',
      row.proseAliases.map((alias) => `\`${alias}\``).join(', '),
    ])
  }
  const authority = row.authority
  const a8 = authority.a8Row
  const rowLink =
    a8 === null || a8 === undefined
      ? ''
      : ` [A8 §5] row ${a8.row}${a8.sameType ? '' : ' (borrowed — a row for a different type)'}.`
  if (authority.status === 'assigned') {
    facts.push([
      'Authority',
      `**assigned**, \`boundBy = ${authority.boundBy}\`.${rowLink} ${authority.summary ?? ''}`.trim(),
    ])
  } else if (authority.status === 'conditional') {
    facts.push([
      'Authority',
      `**conditional**, \`boundBy = ${authority.boundBy}\`.${rowLink} Assigned ${authority.assignedWhen ?? ''}; ` +
        `**owed** ${authority.owedWhen ?? ''} — owed to ${authority.owedTo ?? ''}.`,
    ])
  } else {
    facts.push([
      'Authority',
      `**owed** — ${authority.owedTo ?? ''}. \`boundBy = ${authority.boundBy}\`.` +
        (authority.provisional == null
          ? ''
          : ` Provisional reading ${authority.provisional.marker}, **do not score**: ${authority.provisional.reading}`),
    ])
  }
  facts.push(['Scoring', `\`${authority.scoring ?? 'do-not-score'}\` ([SD §4.7] note 3)`])
  return facts
}

function entryFor(
  term: string,
  category: string,
  doc: string | undefined,
  declaredBy: string,
  file: string,
  extraFacts: readonly (readonly [string, string])[],
  anchors: AnchorIndex,
): Entry {
  const text = doc ?? ''
  const facts: (readonly [string, string])[] = [...extraFacts]
  const markers = markersIn(text)
  if (markers.length > 0) facts.push(['Marker', markers.join(' ')])
  const citations = citationsIn(text)
  facts.push([
    'Cited',
    citations.length === 0
      ? '_no document citation in the docstring_'
      : citations.map((citation) => linkFor(citation, anchors)).join(' · '),
  ])
  // The corpus half of [SD §0]'s three citation forms, rendered rather than only counted. It was
  // counted from the start — `hasCitation` has always accepted a `src:` reference — but not shown,
  // so an entry whose whole evidence is external read as "no document citation in the docstring".
  // That is exactly backwards for a vocabulary built from external sources, and A4's reason codes
  // are where it became visible: eleven of twenty-three cite nothing but the corpus.
  const corpus = [...new Set([...text.matchAll(CORPUS_CITATION)].map((match) => match[0]))].sort()
  if (corpus.length > 0) facts.push(['Corpus', corpus.join(' · ')])
  facts.push(['Declared by', `\`${declaredBy}\` in \`${file}\``])
  return {
    term,
    category,
    definition: doc === undefined ? '_No docstring._' : definitionOf(doc),
    doc,
    declaredBy,
    file,
    facts,
  }
}

function buildCategories(model: Model, anchors: AnchorIndex): Category[] {
  const exported = exportsOfIndex(model)
  const table = readCanonicalSubjects()
  const rowsByType = new Map(table.rows.map((row) => [row.type, row]))
  const reasonRows = readReasonCodeTable()
  const categories: Category[] = []

  for (const vocabulary of VOCABULARIES) {
    const members: Member[] = []
    for (const symbol of vocabulary.symbols) {
      members.push(...membersOf(model, declaredExport(model, exported, symbol)))
    }
    const entries = sortedBy(members, (member) => member.value).map((member) =>
      entryFor(
        member.value,
        vocabulary.name,
        member.doc,
        member.declaredBy,
        member.file,
        vocabulary.name === 'record type'
          ? factsForRecordType(rowsByType.get(member.value), table)
          : vocabulary.name === 'reason code'
            ? factsForReasonCode(reasonRows.get(member.value))
            : [],
        anchors,
      ),
    )
    categories.push({
      name: vocabulary.name,
      heading: vocabulary.heading,
      blurb: vocabulary.blurb,
      entries,
    })
  }

  const ruleEntries = RULES.map((rule) => {
    const declared =
      rule.export !== undefined
        ? declaredExport(model, exported, rule.export)
        : declaredInFile(model, rule.file ?? '', rule.path ?? '')
    if (rule.member !== undefined) {
      const [, value] = rule.member
      const member = membersOf(model, declared).find((candidate) => candidate.value === value)
      if (member === undefined) {
        throw new Error(`\`${declared.name}\` has no member \`${value}\` for rule ${rule.term}`)
      }
      return entryFor(
        rule.term,
        'rule',
        member.doc,
        `${declared.name}.${value}`,
        repoPath(declared.file),
        [['Kind', rule.what]],
        anchors,
      )
    }
    return entryFor(
      rule.term,
      'rule',
      declared.doc,
      declared.name,
      repoPath(declared.file),
      [['Kind', rule.what]],
      anchors,
    )
  })

  categories.push({
    name: 'rule',
    heading: 'Key functions and rules',
    blurb:
      'The named, versioned rules the model computes with. Each entry is the docstring on the ' +
      'declaration that **states** the rule, not a paraphrase of it — M1-M7 are private predicates ' +
      'in `rules/capture.ts`, C5 and C6 are members of `CUSTODY_UNKNOWN_REASONS`, and P-IDENTITY is ' +
      "stated on a Portion's `shipment` field, because that is where each one actually lives.",
    entries: sortedBy(ruleEntries, (entry) => entry.term),
  })

  return categories
}

/* ------------------------------------------------------------------------------------------------
 * The disclosure gate
 * ---------------------------------------------------------------------------------------------- */

export interface DisclosureFailure {
  readonly term: string
  readonly category: string
  readonly declaredBy: string
  readonly file: string
  readonly problem: 'NO_DOCSTRING' | 'NO_CITATION_AND_NO_MARKER'
}

/**
 * [SD §0]'s disclosure rule, mechanised — and the same sentence this package's own README states:
 * "A rule with no citation and no `[ORIGINAL]` marker is a defect."
 *
 * Reported, never repaired: a generator that invented a citation to silence its own gate would be
 * doing the one thing [SD §0] forbids.
 */
export function collectDisclosureFailures(): DisclosureFailure[] {
  const model = buildModel()
  const anchors = buildAnchorIndex()
  const failures: DisclosureFailure[] = []
  for (const category of buildCategories(model, anchors)) {
    for (const entry of category.entries) {
      if (entry.doc === undefined || entry.doc.length === 0) {
        failures.push({
          term: entry.term,
          category: category.name,
          declaredBy: entry.declaredBy,
          file: entry.file,
          problem: 'NO_DOCSTRING',
        })
      } else if (!hasCitation(entry.doc) && markersIn(entry.doc).length === 0) {
        failures.push({
          term: entry.term,
          category: category.name,
          declaredBy: entry.declaredBy,
          file: entry.file,
          problem: 'NO_CITATION_AND_NO_MARKER',
        })
      }
    }
  }
  return sortedBy(failures, (failure) => `${failure.category}\u0000${failure.term}`)
}

/* ------------------------------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------
 * The owed ledger, as data
 * ---------------------------------------------------------------------------------------------- */

/** One line of the owed ledger. The same shape the glossary's `Owed` section renders. */
export interface OwedInventory {
  /** Every `owed(name, owedTo)` call and `Owed<Name, Owner>` type in `src/`, deduplicated. */
  readonly declared: readonly OwedEntry[]
  /** Closed vocabularies whose members are owed — every `OwedCode<'x'>` in `src/`. [A4 §7] */
  readonly vocabularies: readonly { readonly name: string; readonly where: string }[]
  /** Record types whose [A8 §5] authority row is owed in whole or in part. */
  readonly authorityRows: readonly {
    readonly type: string
    readonly status: string
    readonly owedTo: string | null
    readonly boundBy: string
  }[]
  /** Record types [SD §4.1]'s family table cannot place. */
  readonly factClassFamilies: readonly string[]
  /** Fact classes [SD §4.7.3] names as absent from the vocabulary and owed a row. */
  readonly absentFactClasses: readonly string[]
  /** How many record types the canonical-subject table declares — the denominator. */
  readonly declaredRecordTypes: number
}

/**
 * The owed ledger, computed once and rendered twice.
 *
 * The glossary's `Owed` section and the catalog's `index.json` both publish it, and two readings of
 * one ledger can drift exactly the way [SD §1.1] deletes the generic `correlation` bag for. So the
 * collection lives here, beside the machinery that already has the compiler model, and
 * `generate-catalog.ts` imports it rather than re-deriving it.
 */
export function collectOwedInventory(): OwedInventory {
  const model = buildModel()
  const table = readCanonicalSubjects()
  const exported = exportsOfIndex(model)

  const deduped = new Map<string, OwedEntry>()
  for (const entry of owedFromCode(model)) {
    const key = `${entry.what} ${entry.owedTo}`
    if (!deduped.has(key)) deduped.set(key, entry)
  }

  return {
    declared: sortedBy([...deduped.values()], (item) => `${item.what} ${item.owedTo}`),
    vocabularies: owedVocabulariesFromCode(model),
    authorityRows: sortedBy(
      table.rows.filter((row) => row.authority.status !== 'assigned'),
      (row) => row.type,
    ).map((row) => ({
      type: row.type,
      status: row.authority.status === 'conditional' ? 'conditional' : 'owed',
      owedTo: row.authority.owedTo ?? null,
      boundBy: row.authority.boundBy,
    })),
    factClassFamilies: owedFactClassFamilies(model).map(([type]) => type),
    absentFactClasses: sortedBy(
      membersOf(model, declaredExport(model, exported, 'ABSENT_AND_OWED')),
      (member) => member.value,
    ).map((member) => member.value),
    declaredRecordTypes: table.rows.length,
  }
}

function anchorFor(entry: Entry): string {
  return headingSlug(`${entry.term} (${entry.category})`)
}

function renderEntry(entry: Entry, lines: string[]): void {
  lines.push(`### \`${entry.term}\` (${entry.category})`)
  lines.push('')
  lines.push(entry.definition)
  lines.push('')
  for (const [label, value] of entry.facts) {
    lines.push(`- **${label}:** ${value}`)
  }
  lines.push('')
}

function renderOwed(model: Model, table: CanonicalTable, lines: string[]): void {
  lines.push(`## ${OWED_HEADING}`)
  lines.push('')
  lines.push(
    'This is the honest state of the model on one page. [SD §0] forbids guessing a value to make ' +
      'the types tidy, so a gap is carried as a gap and names who owes it. Every line below is ' +
      'read out of the code or the tables — the `owed(name, owedTo)` constructor, the ' +
      "`Owed<Name, Owner>` type, the `OwedCode<'x'>` brand, and the authority column of " +
      '`packages/domain-reference/data/canonical-subjects.json`.',
  )
  lines.push('')

  lines.push('### Declared owed in `src/`')
  lines.push('')
  const code = owedFromCode(model)
  const deduped = new Map<string, OwedEntry>()
  for (const entry of code) {
    const key = `${entry.what}\u0000${entry.owedTo}`
    if (!deduped.has(key)) deduped.set(key, entry)
  }
  for (const entry of sortedBy(
    [...deduped.values()],
    (item) => `${item.what}\u0000${item.owedTo}`,
  )) {
    lines.push(`- \`${entry.what}\` — owed to ${entry.owedTo} _(\`${entry.where}\`)_`)
  }
  lines.push('')

  lines.push('### Closed vocabularies whose members are owed')
  lines.push('')
  lines.push(
    'A vocabulary whose **shape** is published and whose **members** are not, carried as ' +
      "`OwedCode<'x'>` so that the gap is in the type rather than in a comment. The reason " +
      'vocabulary was one of these until [A4 §3] published it; these are what is left. Each ' +
      'publishes on the wire as a string with an `x-owed-vocabulary` annotation, and publishing one ' +
      'is `publishedOwedVocabulary` under [catalog §2.3].',
  )
  lines.push('')
  for (const entry of owedVocabulariesFromCode(model)) {
    lines.push(`- \`${entry.name}\` _(\`${entry.where}\`)_`)
  }
  lines.push('')

  lines.push('### Record types whose authority row is owed')
  lines.push('')
  const owedRows = table.rows.filter((row) => row.authority.status !== 'assigned')
  lines.push(
    `${owedRows.length} of ${table.rows.length} declared types carry an authority that is owed in ` +
      'whole or in part. [A8 §9 item 8] is the ledger: "cube, piece count, packing performance, ' +
      'survey/estimate facts, ETA, seal integrity, tracer results, claim facts, and every A10/A11 ' +
      'class. **Each needs a row before its area can score a dependent decision high.**"',
  )
  lines.push('')
  for (const row of sortedBy(owedRows, (candidate) => candidate.type)) {
    const status = row.authority.status === 'conditional' ? 'conditional' : 'owed'
    lines.push(
      `- \`${row.type}\` — **${status}**, owed to ${row.authority.owedTo ?? '_unnamed_'} ` +
        `(\`boundBy = ${row.authority.boundBy}\`)`,
    )
  }
  lines.push('')

  lines.push('### Record types whose fact-class family is owed')
  lines.push('')
  lines.push(
    "`FACT_CLASS_FAMILY` is a **[SYNTHESIS]** of [SD §4.1]'s family table and [SD §4.7.1]'s type " +
      'declaration, and the rows the join cannot make are marked `owed` rather than guessed. The ' +
      'mirror finding is that **[SD §4.1] declares a `state` family with no publishable member**: ' +
      'the lifecycle types are acts, and [SD §4.7.2d] is explicit that `in-transit` "is **not a ' +
      'record at all**: it is a projection".',
  )
  lines.push('')
  for (const [type, family] of owedFactClassFamilies(model)) {
    lines.push(`- \`${type}\` — no family in [SD §4.1]'s table (declared \`${family}\`)`)
  }
  lines.push('')

  lines.push('### Fact classes named in the corpus and absent from the vocabulary')
  lines.push('')
  lines.push(
    '[SD §4.7.3] lists these "so their absence is not read as an oversight". Each needs a row in ' +
      '[SD §4.7.1] **and** an [A8 §5] row before its area can score a dependent decision high.',
  )
  lines.push('')
  const exported = exportsOfIndex(model)
  for (const member of sortedBy(
    membersOf(model, declaredExport(model, exported, 'ABSENT_AND_OWED')),
    (item) => item.value,
  )) {
    const gloss =
      member.doc === undefined ? '' : ` — ${definitionOf(member.doc).replace(/\n+/g, ' ')}`
    lines.push(`- \`${member.value}\`${gloss}`)
  }
  lines.push('')
}

function renderIndex(categories: readonly Category[], lines: string[]): void {
  lines.push('## Alphabetical index')
  lines.push('')
  const all = categories.flatMap((category) => category.entries)
  for (const entry of sortedBy(
    all,
    (candidate) => `${candidate.term}\u0000${candidate.category}`,
  )) {
    lines.push(`- [\`${entry.term}\`](#${anchorFor(entry)}) — ${entry.category}`)
  }
  lines.push('')
}

/** The whole document, as a string. The only thing `main` does is write it to disk. */
export function generateGlossary(): string {
  const model = buildModel()
  const anchors = buildAnchorIndex()
  const categories = buildCategories(model, anchors)
  const table = readCanonicalSubjects()
  const lines: string[] = []

  lines.push('# Glossary — the household-goods moving & storage reference domain')
  lines.push('')
  lines.push(
    `<!-- GENERATED FILE — DO NOT EDIT BY HAND. Generated by ${GLOSSARY_GENERATOR_REPO_PATH}; ` +
      `run \`${GLOSSARY_COMMAND}\`. -->`,
  )
  lines.push('')
  lines.push('> **Generated file — do not edit by hand.**')
  lines.push('>')
  lines.push(
    `> Every definition below is the JSDoc on the declaration that mints the term. The generator is ` +
      `\`${GLOSSARY_GENERATOR_REPO_PATH}\`; regenerate with \`${GLOSSARY_COMMAND}\`. ` +
      '`tests/conformance/glossary-staleness.test.ts` fails when this file and the code disagree, ' +
      'and `tests/conformance/glossary-coverage.test.ts` fails when a term covered here has no ' +
      'docstring, or a docstring carrying neither a citation nor an explicit `[ORIGINAL]` / ' +
      '`[SYNTHESIS]` marker.',
  )
  lines.push('>')
  lines.push(
    '> **To change a definition, change the docstring** in ' +
      '`packages/domain-reference/src/` and regenerate. Editing this file is the one thing that ' +
      'cannot work: the next run overwrites it, and the staleness gate fails before then.',
  )
  lines.push('')
  lines.push(
    'This is an **executable specification**, not an implementation and not a description of any ' +
      'system we run. Authority, in precedence order, is ' +
      '[`analysis/00-shared-decisions.md`](analysis/00-shared-decisions.md) (the binding layer, ' +
      'cited as **[SD §x]**), then ' +
      '[`analysis/A8-authority-skeleton.md`](analysis/A8-authority-skeleton.md) (**[A8 §x]**), then ' +
      'the three decision documents (**[A3]**, **[fork-order]**, **[fork-time]**). Open findings ' +
      'are in [`analysis/findings-from-alloy.md`](analysis/findings-from-alloy.md).',
  )
  lines.push('')
  lines.push(
    'Entries are sorted in **byte order** within each section, so a regeneration on another ' +
      'machine produces the same bytes and a diff shows only what changed.',
  )
  lines.push('')

  lines.push('## Contents')
  lines.push('')
  for (const category of categories) {
    lines.push(
      `- [${category.heading}](#${headingSlug(`${category.heading} ${category.entries.length}`)}) — ` +
        `${category.entries.length}`,
    )
  }
  lines.push(`- [${OWED_HEADING}](#${headingSlug(OWED_HEADING)})`)
  lines.push('- [Alphabetical index](#alphabetical-index)')
  lines.push('')

  for (const category of categories) {
    lines.push(`## ${category.heading} (${category.entries.length})`)
    lines.push('')
    lines.push(category.blurb)
    lines.push('')
    for (const entry of category.entries) renderEntry(entry, lines)
  }

  renderOwed(model, table, lines)
  renderIndex(categories, lines)

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (invokedDirectly) {
  writeFileSync(GLOSSARY_FILE, generateGlossary(), 'utf8')
  const failures = collectDisclosureFailures()
  process.stdout.write(`wrote ${GLOSSARY_REPO_PATH}\n`)
  if (failures.length > 0) {
    process.stdout.write(
      `${failures.length} term(s) fail the disclosure gate — see glossary-coverage.test.ts:\n`,
    )
    for (const failure of failures) {
      process.stdout.write(`  ${failure.category} \`${failure.term}\`: ${failure.problem}\n`)
    }
  }
}
