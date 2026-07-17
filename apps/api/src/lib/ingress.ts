// ---------------------------------------------------------------------------
// Ingress helpers (sdk-feedback 0021) — the definition-driven behaviour of the
// inbound endpoint: which domain event to emit, how to derive the dedup id, and
// how to shape the synchronous partner ack. All read from the `inbound` block a
// tenant publishes on its IntegrationConfig; a missing block falls back to a
// generic accepted/rejected ack.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'

/** A structured ingest issue: a partner-shaped code + a human-readable message. */
export interface AckIssue {
  code: string
  message: string
}

/** Declarative body validation for the inbound endpoint (all fields optional). */
export interface InboundValidation {
  /** Dot-paths that must resolve to a non-empty scalar (e.g. "SvcProvDataRecipient"). */
  requiredPaths?: string[]
  /** Dot-paths that must resolve to a non-empty array (e.g. "Events"). */
  nonEmptyArrayPaths?: string[]
}

/** The `inbound` block published on an IntegrationConfig. All fields optional. */
export interface InboundConfig {
  /** Domain event emitted on receipt (e.g. "sirva_ade.shipment.event"). */
  eventType?: string
  /** Dot-path to the dedup id in the payload (e.g. "Id", "Events.0.Id"). */
  dedupKeyPath?: string
  /** Declarative body validation; a failure returns the partner's failure ack. */
  validation?: InboundValidation
  /** Ack rendered synchronously: `{success, failure}` JSON templates. */
  ackTemplate?: { success?: unknown; failure?: unknown }
}

/** Fallback event type when the definition names none. */
export function defaultEventType(integrationId: string): string {
  return `${integrationId}.inbound.received`
}

/** Generic success/failure acks when no ackTemplate is published. */
export const GENERIC_SUCCESS_ACK = { status: 'accepted' }
export function genericFailureAck(messages: string[]): unknown {
  return { status: 'rejected', errors: messages }
}

/** Read + normalize the `inbound` block off a raw IntegrationConfig `inbound` value. */
export function parseInboundConfig(raw: unknown): InboundConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const cfg: InboundConfig = {}
  if (typeof o['eventType'] === 'string') cfg.eventType = o['eventType']
  if (typeof o['dedupKeyPath'] === 'string') cfg.dedupKeyPath = o['dedupKeyPath']
  const validation = parseInboundValidation(o['validation'])
  if (validation) cfg.validation = validation
  if (o['ackTemplate'] && typeof o['ackTemplate'] === 'object') {
    cfg.ackTemplate = o['ackTemplate'] as { success?: unknown; failure?: unknown }
  }
  return cfg
}

/** Read the optional `validation` block; string arrays only, everything else dropped. */
function parseInboundValidation(raw: unknown): InboundValidation | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined
  const validation: InboundValidation = {}
  const req = strings(o['requiredPaths'])
  if (req) validation.requiredPaths = req
  const arr = strings(o['nonEmptyArrayPaths'])
  if (arr) validation.nonEmptyArrayPaths = arr
  return validation.requiredPaths || validation.nonEmptyArrayPaths ? validation : undefined
}

/**
 * Validate a payload against the published `validation` block. Returns structured
 * issues ([] when it passes or when no validation is published — back-compatible).
 * Declarative and partner-agnostic: presence of required scalars + non-empty
 * arrays, nothing partner-specific. The partner shapes these issues into its ack
 * envelope via the `failure` ackTemplate.
 */
export function validateInboundBody(
  payload: unknown,
  validation: InboundValidation | undefined,
): AckIssue[] {
  const issues: AckIssue[] = []
  if (!validation) return issues
  for (const path of validation.requiredPaths ?? []) {
    const v = resolvePath(payload, path)
    if (v === undefined || v === null || v === '') {
      issues.push({ code: 'MISSING_FIELD', message: `Required field "${path}" is missing.` })
    }
  }
  for (const path of validation.nonEmptyArrayPaths ?? []) {
    const v = resolvePath(payload, path)
    if (!Array.isArray(v) || v.length === 0) {
      issues.push({ code: 'EMPTY_LIST', message: `"${path}" must be a non-empty array.` })
    }
  }
  return issues
}

/** Resolve a dot-path (e.g. "Events.0.Id") against a payload; undefined if absent. */
function resolvePath(payload: unknown, path: string): unknown {
  let cur: unknown = payload
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * Derive the dedup id for a payload. Uses the configured `dedupKeyPath` when it
 * resolves to a scalar; otherwise falls back to a stable hash of the whole body
 * so every distinct payload still dedups (a redelivered identical body is a hit).
 */
export function deriveDedupId(payload: unknown, dedupKeyPath: string | undefined): string {
  if (dedupKeyPath) {
    const v = resolvePath(payload, dedupKeyPath)
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return String(v)
    }
  }
  return `sha256:${crypto
    .createHash('sha256')
    .update(JSON.stringify(payload) ?? '')
    .digest('hex')}`
}

/**
 * Render an ack template. Two directives, everything else passes through:
 *   - a string that is EXACTLY `{{key}}` → `context[key]` (type preserved, so a
 *     number stays a number, an array stays an array);
 *   - an object `{ "$map": "<contextArrayKey>", "as": <sub-template> }` → one
 *     element per item in `context[key]`, each rendered from the sub-template
 *     against THAT item's fields. Lets a partner shape a per-message array like
 *     ADE's `ResultsMessage: [{ResultsMessageCode, ResultsMessageDescription}]`
 *     from the structured `issues` — a whole-value substitution can't build one.
 * Non-matching strings and other JSON pass through unchanged.
 */
export function renderAck(template: unknown, context: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const m = template.match(/^\{\{(\w+)\}\}$/)
    if (m) return context[m[1] as string] ?? null
    return template
  }
  if (Array.isArray(template)) return template.map((t) => renderAck(t, context))
  if (template !== null && typeof template === 'object') {
    const obj = template as Record<string, unknown>
    if (typeof obj['$map'] === 'string' && 'as' in obj) {
      const items = context[obj['$map']]
      if (!Array.isArray(items)) return []
      return items.map((item) => renderAck(obj['as'], (item ?? {}) as Record<string, unknown>))
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = renderAck(v, context)
    return out
  }
  return template
}

/** Build the success ack (published template, else generic). */
export function successAck(cfg: InboundConfig): unknown {
  if (cfg.ackTemplate?.success !== undefined) {
    return renderAck(cfg.ackTemplate.success, {
      status: 'Success',
      errorCount: 0,
      messages: [],
      issues: [],
    })
  }
  return GENERIC_SUCCESS_ACK
}

/** Build the failure ack (published template, else generic) for the given issues. */
export function failureAck(cfg: InboundConfig, issues: AckIssue[]): unknown {
  const messages = issues.map((i) => i.message)
  if (cfg.ackTemplate?.failure !== undefined) {
    return renderAck(cfg.ackTemplate.failure, {
      status: 'Failed',
      errorCount: issues.length,
      // `messages` (strings) keeps simple templates working; `issues` (structured
      // {code,message}) feeds a `$map` that builds a per-message object array.
      messages,
      issues,
    })
  }
  return genericFailureAck(messages)
}
