// ---------------------------------------------------------------------------
// The publishable `fetch` block — the PULL counterpart to `inbound` (Gap B).
//
// `inbound` describes push: which event to emit on receipt, how to dedup, how
// to shape the ack. Nothing described PULL, so partner-specific transport
// knowledge — which path, which params select a period, where in the envelope
// the records live — lived in workflow Python. That meant a new source needed a
// new workflow even when its mapping and rules were pure config, silently
// breaking the "new partner = config alone" property the floor/overlay split
// otherwise buys.
//
// A `fetch` block holds NAMED OPERATIONS whose names must be capabilities the
// floor declares, so every settlement source answers to `settlements`:
//
//   "fetch": {
//     "settlements": {
//       "method": "GET",
//       "path": "/settlement/v1/settlement",
//       "query": { "settlementDate": "{{settlementDate}}" },
//       "decode": "jsonString",
//       "page": { "style": "none" }
//     }
//   }
//
// (That example omits `recordsPath` on purpose. Where the per-record array sits
// in Atlas's settlement envelope is an OPEN question: the top-level `Settlement`
// and `AgentSettlement` levels are a remittance envelope — one payment run across
// many orders — while the per-order record is the `Document` nested inside. An
// example naming `agentSettlements` would teach extracting the envelope as the
// record, which is a many-to-one source published against a 1:1 floor.)
//
// ── THE DSL IS DELIBERATELY BOUNDED, AND THIS IS WHERE THAT USUALLY DIES ────
// Permitted: `{{param}}` and `{{config:KEY}}` substitution, a closed `page.style`
// enum, a closed `decode` enum, one dot-path `recordsPath`. NOT permitted: any
// arithmetic, conditional, or loop. A source that needs real logic falls back to
// a bespoke workflow — the same escape hatch the mapping DSL documents. If a
// `{{#if}}` shows up in review, the answer is a bespoke workflow.
//
// `{{secret:…}}` is deliberately NOT offered: a credential must never be
// templatable into a URL or query string, where it would land in partner access
// logs. Header credentials go through `secretHeaders` (#563), which resolves
// server-side. `checkFetchBlock` refuses `{{secret:…}}` explicitly rather than
// just failing to substitute it, so the attempt is a publish error and not a
// literal `{{secret:X}}` on the wire.
//
// SPLIT OF DUTY. `FetchBlockSchema` validates SHAPE (enums, types, required
// fields) and is what `fetchBlockJsonSchema()` publishes for authoring agents.
// `checkFetchBlock` validates CONTENT the shape cannot express — that operation
// names are declared capabilities of the floor, that no header is a reserved
// one, and that every `{{…}}` is a permitted substitution. The gate runs both;
// neither does I/O, so the gate stays pure and synchronous.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { RESERVED_HEADERS } from './outbound-headers'

/**
 * The ONE permitted substitution form, shared by the publish gate and (second
 * increment) the runtime substituter so the two can never diverge: `{{param}}`
 * or `{{config:KEY}}`, nothing else.
 *
 * Anchored and deliberately narrow — an identifier, not an expression. This is
 * the regex that makes `{{secret:X}}`, `{{a.b}}`, `{{#if x}}` and `{{ x }}`
 * publish errors rather than runtime surprises.
 */
export const FETCH_TEMPLATE_RE = /^\{\{(config:)?[A-Za-z_][A-Za-z0-9_]*\}\}$/

/** Finds every `{{…}}` occurrence in a string, permitted or not. */
const TEMPLATE_SCAN_RE = /\{\{[^}]*\}\}/g

/** Paging styles. Closed by design — a new style is a code change, not config. */
export const FETCH_PAGE_STYLES = ['none', 'pageNumber', 'cursor'] as const

/**
 * Response decode steps. Closed by design.
 *
 * `jsonString` exists because a real partner needs it: Atlas's `settlement-v1`
 * returns a JSON **string** whose content is JSON, not an object, so
 * `recordsPath` has nothing to walk until the body is decoded twice. Keeping it
 * an enum rather than a transform expression is the whole point — the escape
 * hatch for anything richer is a bespoke workflow.
 */
export const FETCH_DECODES = ['none', 'jsonString'] as const

const PageSchema = z
  .object({
    style: z
      .enum(FETCH_PAGE_STYLES)
      .describe(
        'How the partner pages. "none" = single request (the correct answer when ' +
          'the endpoint exposes no paging parameters at all — honest, not lazy). ' +
          '"pageNumber" = an incrementing page index; "cursor" = an opaque token ' +
          'echoed from the previous response.',
      ),
    /** pageNumber/cursor: query param carrying the page index or cursor. */
    param: z.string().min(1).max(128).optional(),
    /** cursor: dot-path in the response holding the NEXT cursor; absent ⇒ stop. */
    cursorPath: z.string().min(1).max(512).optional(),
    /** pageNumber: first index to request (partners differ on 0 vs 1). */
    startAt: z.number().int().min(0).max(1).optional(),
    /** Hard ceiling on requests per operation — a runaway guard, not a tuning knob. */
    maxPages: z.number().int().min(1).max(100).optional(),
  })
  .strict()

export const FetchOperationSchema = z
  .object({
    method: z
      .enum(['GET', 'POST'])
      .describe(
        'A fetch is a READ. GET is the norm; POST is permitted only because some ' +
          'partners expose reads as POST with a criteria body. A fetch must never ' +
          'mutate — use call_external for that.',
      ),
    path: z
      .string()
      .min(1)
      .max(2048)
      .describe("Path appended to the integration's BASE_URL. May contain {{param}}."),
    query: z
      .record(z.string().min(1).max(128), z.string().max(2048))
      .optional()
      .describe('Query parameters. Values may be literals or a single {{param}}.'),
    body: z
      .unknown()
      .optional()
      .describe('Request body for method POST. Strings inside may contain {{param}}.'),
    headers: z
      .record(z.string().min(1).max(128), z.string().max(2048))
      .optional()
      .describe(
        'Extra request headers with LITERAL (non-secret) values. Reserved names are ' +
          'refused at publish. A CREDENTIAL never goes here — declare it in ' +
          'secretHeaders, which resolves server-side.',
      ),
    secretHeaders: z
      .record(z.string().min(1).max(128), z.string().min(1).max(128))
      .optional()
      .describe(
        'Headers whose values are SECRET KEY NAMES resolved server-side from the ' +
          'tenant store (e.g. {"Ocp-Apim-Subscription-Key": "ATLAS_SUB_KEY"}). This ' +
          'is the only way a credential reaches the wire.',
      ),
    decode: z
      .enum(FETCH_DECODES)
      .optional()
      .describe(
        'Pre-extraction decode of the response body, applied BEFORE recordsPath. ' +
          'Default "none". Use "jsonString" when the partner returns a JSON string ' +
          'containing JSON (double-encoded) — without it recordsPath has nothing to walk.',
      ),
    recordsPath: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe(
        'Dot-path to the array of records in the (decoded) response, e.g. ' +
          '"Settlements". Absent ⇒ the whole body is the single record. One path, no ' +
          'wildcards: a record set that needs regrouping is a bespoke workflow.',
      ),
    page: PageSchema.optional().describe('Paging descriptor. Absent ⇒ {"style":"none"}.'),
  })
  .strict()

/** The publishable `fetch` block: capability name → operation descriptor. */
export const FetchBlockSchema = z.record(
  z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'operation names are capability ids: lower_snake_case, starting with a letter',
    ),
  FetchOperationSchema,
)

export type FetchOperation = z.infer<typeof FetchOperationSchema>
export type FetchBlock = z.infer<typeof FetchBlockSchema>

/** JSON Schema for the publishable `fetch` block (for the discovery endpoint). */
export function fetchBlockJsonSchema(): unknown {
  return z.toJSONSchema(FetchBlockSchema)
}

/** A content problem in a `fetch` block: where it is, and what is wrong. */
export interface FetchProblem {
  where: string
  problem: string
}

/**
 * Content checks the Zod shape cannot express. Pure and synchronous.
 *
 * Takes the ALREADY SHAPE-VALIDATED block plus the floor's declared capability
 * list. `capabilities` undefined means the floor declares none — then no
 * operation name can be valid, which is a clearer failure than silently
 * accepting any name.
 */
export function checkFetchBlock(
  block: FetchBlock,
  capabilities: readonly string[] | undefined,
): FetchProblem[] {
  const problems: FetchProblem[] = []
  const declared = new Set(capabilities ?? [])

  for (const [name, op] of Object.entries(block)) {
    // 1. Operation names come from the floor's capability list, so naming is a
    // floor change rather than a schema migration — and a typo'd capability can
    // never be routed to.
    if (!declared.has(name)) {
      problems.push({
        where: name,
        problem: declared.size
          ? `operation '${name}' is not a capability this floor declares (declared: ${[...declared].sort().join(', ')})`
          : `operation '${name}' cannot be published: this floor declares no capabilities`,
      })
    }

    // 2. Reserved headers are set by the platform; the same refusal
    // call-external applies, so one partner cannot be configured two ways.
    for (const headerName of [
      ...Object.keys(op.headers ?? {}),
      ...Object.keys(op.secretHeaders ?? {}),
    ]) {
      if (RESERVED_HEADERS.has(headerName.toLowerCase())) {
        problems.push({
          where: `${name}.headers.${headerName}`,
          problem: `header '${headerName}' is reserved and set by the platform; it cannot be overridden`,
        })
      }
    }

    // 3. A credential must never be templatable into a URL, a query string or a
    // literal header — it would land in the partner's access logs. Refuse the
    // attempt loudly instead of emitting `{{secret:X}}` on the wire.
    for (const [where, text] of templatedStrings(name, op)) {
      for (const found of text.match(TEMPLATE_SCAN_RE) ?? []) {
        if (FETCH_TEMPLATE_RE.test(found)) continue
        problems.push({
          where,
          problem: found.startsWith('{{secret:')
            ? `'${found}' is not permitted: a secret must never be templated into a path, query or literal header — use secretHeaders, which resolves server-side`
            : `'${found}' is not a permitted substitution; only {{param}} and {{config:KEY}} are allowed (the fetch block is not an expression language)`,
        })
      }
    }

    // 4. Paging fields must match the declared style, so an unreachable
    // descriptor is a publish error rather than a silent single-page fetch.
    problems.push(...checkPaging(name, op))

    // 5. A body on a GET is unreachable — almost always a mis-set `method`.
    if (op.body !== undefined && op.method === 'GET') {
      problems.push({
        where: `${name}.body`,
        problem: 'a GET fetch cannot carry a body; set method to POST or drop the body',
      })
    }
  }

  return problems
}

/** Every templatable string in an operation, paired with its problem path. */
function templatedStrings(name: string, op: FetchOperation): Array<[string, string]> {
  const out: Array<[string, string]> = [[`${name}.path`, op.path]]
  for (const [k, v] of Object.entries(op.query ?? {})) out.push([`${name}.query.${k}`, v])
  for (const [k, v] of Object.entries(op.headers ?? {})) out.push([`${name}.headers.${k}`, v])
  // secretHeaders values are KEY NAMES resolved server-side, never templates —
  // scanning them would reject a key legitimately named e.g. `ATLAS_KEY`. Their
  // reserved-name check happens above.
  collectStrings(op.body, `${name}.body`, out)
  return out
}

/** Walk a JSON body collecting every string leaf with its path. */
function collectStrings(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') {
    out.push([path, value])
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}.${k}`, out)
  }
}

/** Paging coherence: the fields a style needs, and none it cannot use. */
function checkPaging(name: string, op: FetchOperation): FetchProblem[] {
  const page = op.page
  if (!page) return []
  const problems: FetchProblem[] = []
  const at = (field: string) => `${name}.page.${field}`

  if (page.style === 'none') {
    for (const field of ['param', 'cursorPath', 'startAt', 'maxPages'] as const) {
      if (page[field] !== undefined) {
        problems.push({
          where: at(field),
          problem: `'${field}' has no meaning with style "none"`,
        })
      }
    }
    return problems
  }

  if (!page.param) {
    problems.push({
      where: at('param'),
      problem: `style "${page.style}" requires 'param' — the query parameter carrying the page index or cursor`,
    })
  }
  if (page.style === 'cursor' && !page.cursorPath) {
    problems.push({
      where: at('cursorPath'),
      problem:
        'style "cursor" requires \'cursorPath\' — without it the next cursor cannot be read and paging would stop after one page',
    })
  }
  if (page.style === 'pageNumber' && page.cursorPath !== undefined) {
    problems.push({
      where: at('cursorPath'),
      problem: '\'cursorPath\' has no meaning with style "pageNumber"',
    })
  }
  if (page.style === 'cursor' && page.startAt !== undefined) {
    problems.push({
      where: at('startAt'),
      problem: '\'startAt\' has no meaning with style "cursor"',
    })
  }
  return problems
}

// ---------------------------------------------------------------------------
// RUNTIME half — resolving a published block to one operation, and filling its
// templates. Both pure, so they are fully testable without an outbound call.
//
// WHERE THE BLOCK COMES FROM. Off the tenant's scoped IntegrationConfig row
// (`integrationConfigRepository.findActiveForScope`), exactly as the ingress
// endpoint reads `inbound` off the row — NOT off the resolved
// IntegrationDefinition, which has no `fetch` field and does not need one.
// `findActiveForScope` already implements tenant-overlay-wins-over-GLOBAL, which
// is the behavior a routing block has to have.
//
// The definition supplies only `capabilities`, for the runtime name check below.
// ---------------------------------------------------------------------------

/** Why a `fetch` operation could not be resolved. Typed so the handler maps each to a status. */
export type FetchResolveFailure =
  | { kind: 'noFetchBlock' }
  | { kind: 'unknownOperation'; declared: string[] }
  | { kind: 'notACapability'; capabilities: string[] }
  | { kind: 'malformedBlock'; problems: FetchProblem[] }

export type FetchResolveResult =
  { ok: true; operation: FetchOperation } | { ok: false; failure: FetchResolveFailure }

/**
 * Resolve one named operation out of a stored `fetch` block.
 *
 * Re-checks the capability name even though the publish gate already did. That
 * is deliberate defence in depth, not redundancy: a row can predate a floor
 * that dropped a capability, and a stored block is data we did not validate on
 * this request. The gate is the authoring guard; this is the runtime guard.
 */
export function resolveFetchOperation(
  rawBlock: unknown,
  capabilities: readonly string[] | undefined,
  operation: string,
): FetchResolveResult {
  if (rawBlock == null) return { ok: false, failure: { kind: 'noFetchBlock' } }

  const parsed = FetchBlockSchema.safeParse(rawBlock)
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        kind: 'malformedBlock',
        problems: parsed.error.issues.map((i) => ({
          where: i.path.join('.') || '(root)',
          problem: i.message,
        })),
      },
    }
  }

  const block = parsed.data
  const op = block[operation]
  if (!op) {
    return {
      ok: false,
      failure: { kind: 'unknownOperation', declared: Object.keys(block).sort() },
    }
  }

  // A stored op whose name is no longer a declared capability must not run.
  if (!(capabilities ?? []).includes(operation)) {
    return {
      ok: false,
      failure: { kind: 'notACapability', capabilities: [...(capabilities ?? [])].sort() },
    }
  }

  return { ok: true, operation: op }
}

/** A template that could not be filled, or a value that may not be substituted. */
export interface FetchSubstituteProblem {
  where: string
  template: string
  problem: string
}

export type FetchSubstituteResult =
  { ok: true; operation: FetchOperation } | { ok: false; problems: FetchSubstituteProblem[] }

/**
 * Characters a PATH substitution may not introduce. A descriptor exists to
 * constrain WHICH endpoint is called; letting a caller-supplied param inject a
 * path segment, a query string or a fragment turns it back into an
 * arbitrary-URL builder, which is the whole thing `fetch` is meant to prevent.
 * Query and body values are exempt — they are encoded downstream by
 * URLSearchParams / JSON, so they cannot change the request's shape.
 */
const PATH_FORBIDDEN_RE = /[/?#]/

/**
 * Fill `{{param}}` and `{{config:KEY}}` in an operation's path, query, headers
 * and body.
 *
 * A template that cannot be filled is an ERROR, never a pass-through. This is
 * the load-bearing rule: a leftover `{{settlementDate}}` on the wire comes back
 * as an opaque partner 400, so the real cause (a caller that forgot a param)
 * would be invisible. Substitution is single-pass — a substituted VALUE that
 * happens to look like a template is left alone, so no caller input can expand
 * into another template.
 */
export function substituteFetchTemplates(
  operation: FetchOperation,
  params: Readonly<Record<string, string | number | boolean>>,
  configs: Readonly<Record<string, string>> = {},
): FetchSubstituteResult {
  const problems: FetchSubstituteProblem[] = []

  const fill = (text: string, where: string, isPath: boolean): string =>
    text.replace(TEMPLATE_SCAN_RE, (match) => {
      if (!FETCH_TEMPLATE_RE.test(match)) {
        // The gate refuses these at publish; a stored block can still predate it.
        problems.push({
          where,
          template: match,
          problem: 'not a permitted substitution; only {{param}} and {{config:KEY}} are allowed',
        })
        return match
      }
      const inner = match.slice(2, -2)
      const isConfig = inner.startsWith('config:')
      const key = isConfig ? inner.slice('config:'.length) : inner
      const raw = isConfig ? configs[key] : params[key]
      if (raw === undefined) {
        problems.push({
          where,
          template: match,
          problem: isConfig
            ? `config '${key}' is not set for this integration`
            : `required parameter '${key}' was not supplied`,
        })
        return match
      }
      const value = String(raw)
      if (isPath && PATH_FORBIDDEN_RE.test(value)) {
        problems.push({
          where,
          template: match,
          problem: `value for '${key}' may not contain '/', '?' or '#' in a path — it would change which endpoint is called`,
        })
        return match
      }
      return value
    })

  const out: FetchOperation = { ...operation, path: fill(operation.path, 'path', true) }

  if (operation.query) {
    const query: Record<string, string> = {}
    for (const [k, v] of Object.entries(operation.query)) query[k] = fill(v, `query.${k}`, false)
    out.query = query
  }
  if (operation.headers) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(operation.headers)) {
      headers[k] = fill(v, `headers.${k}`, false)
    }
    out.headers = headers
  }
  if (operation.body !== undefined) {
    out.body = fillBody(operation.body, 'body', fill)
  }

  return problems.length ? { ok: false, problems } : { ok: true, operation: out }
}

/** Fill templates in every string leaf of a JSON body, preserving its shape. */
function fillBody(
  value: unknown,
  path: string,
  fill: (text: string, where: string, isPath: boolean) => string,
): unknown {
  if (typeof value === 'string') return fill(value, path, false)
  if (Array.isArray(value)) return value.map((v, i) => fillBody(v, `${path}[${i}]`, fill))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillBody(v, `${path}.${k}`, fill)]),
    )
  }
  return value
}
