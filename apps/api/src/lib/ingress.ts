// ---------------------------------------------------------------------------
// Ingress helpers (sdk-feedback 0021) — the definition-driven behaviour of the
// inbound endpoint: which domain event to emit, how to derive the dedup id, and
// how to shape the synchronous partner ack. All read from the `inbound` block a
// tenant publishes on its IntegrationConfig; a missing block falls back to a
// generic accepted/rejected ack.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'

/** The `inbound` block published on an IntegrationConfig. All fields optional. */
export interface InboundConfig {
  /** Domain event emitted on receipt (e.g. "sirva_ade.shipment.event"). */
  eventType?: string
  /** Dot-path to the dedup id in the payload (e.g. "Id", "Events.0.Id"). */
  dedupKeyPath?: string
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
  if (o['ackTemplate'] && typeof o['ackTemplate'] === 'object') {
    cfg.ackTemplate = o['ackTemplate'] as { success?: unknown; failure?: unknown }
  }
  return cfg
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
 * Render an ack template: recursively replace any string that is EXACTLY
 * `{{key}}` with `context[key]` (preserving the substituted value's type, so a
 * number stays a number). Non-matching strings and other JSON pass through.
 */
export function renderAck(template: unknown, context: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const m = template.match(/^\{\{(\w+)\}\}$/)
    if (m) return context[m[1] as string] ?? null
    return template
  }
  if (Array.isArray(template)) return template.map((t) => renderAck(t, context))
  if (template !== null && typeof template === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(template)) out[k] = renderAck(v, context)
    return out
  }
  return template
}

/** Build the success ack (published template, else generic). */
export function successAck(cfg: InboundConfig): unknown {
  if (cfg.ackTemplate?.success !== undefined) {
    return renderAck(cfg.ackTemplate.success, { status: 'Success', errorCount: 0, messages: [] })
  }
  return GENERIC_SUCCESS_ACK
}

/** Build the failure ack (published template, else generic) for the given messages. */
export function failureAck(cfg: InboundConfig, messages: string[]): unknown {
  if (cfg.ackTemplate?.failure !== undefined) {
    return renderAck(cfg.ackTemplate.failure, {
      status: 'Failed',
      errorCount: messages.length,
      messages,
    })
  }
  return genericFailureAck(messages)
}
