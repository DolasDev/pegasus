// ---------------------------------------------------------------------------
// Event-routed signals — the pure rules shared by the trigger API (validation
// at create / update) and the trigger dispatcher (routing at dispatch).
//
// An EVENT trigger in mode START or DELIVER routes each matching event to ONE
// durable Workflow instance per business key: the key is read from the event
// envelope at `correlationPath`, and the instance's Temporal id is
// `wfl/<tenantId>/<workflowName>/<key>` — a prefix no other start path mints
// (manual runs use `wf/…/<executionId>`, NEW-mode triggers `wf/…/trg/…`), so a
// keyed instance can never collide with any other execution.
// ---------------------------------------------------------------------------

import type { WorkflowTriggerMode } from '../repositories/workflow-trigger.repository'
import { declaredSignals } from './signal-workflow-execution'
import { resolveWorkflowRoute } from './workflow-route'

/** The envelope fields a correlation path may start from. */
const ENVELOPE_ROOTS = ['payload', 'domainEventId', 'eventType', 'occurredAt'] as const

/** Dot path of identifier segments, e.g. `payload.orderId` (max 8 segments). */
const CORRELATION_PATH_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}(\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,7}$/

/** A business key: safe inside a Temporal workflow id, and bounded. */
export const CORRELATION_KEY_REGEX = /^[A-Za-z0-9._:-]{1,128}$/

/** The event envelope a trigger delivers (as START input and as the signal argument). */
export type EventEnvelope = {
  domainEventId: string
  eventType: string
  occurredAt: string
  payload: unknown
}

/** Null when `path` is a valid correlation path, else why not. */
export function correlationPathError(path: string): string | null {
  if (!CORRELATION_PATH_REGEX.test(path)) {
    return 'correlationPath must be a dot path of identifiers, e.g. "payload.orderId" (max 8 segments)'
  }
  const root = path.split('.')[0]
  if (!(ENVELOPE_ROOTS as readonly string[]).includes(root ?? '')) {
    return `correlationPath must start at an event-envelope field: ${ENVELOPE_ROOTS.join(', ')}`
  }
  return null
}

export type CorrelationKeyResult =
  | { ok: true; key: string }
  /** MISSING: nothing (or null) at the path. INVALID: not a string / integer, or unsafe. */
  | { ok: false; reason: 'MISSING' | 'INVALID' }

/**
 * Read the business key at `path` from the envelope. A string or an integer,
 * normalized to a string, matching CORRELATION_KEY_REGEX. Never throws.
 */
export function extractCorrelationKey(envelope: EventEnvelope, path: string): CorrelationKeyResult {
  let value: unknown = envelope
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, reason: 'MISSING' }
    }
    if (!Object.prototype.hasOwnProperty.call(value, segment))
      return { ok: false, reason: 'MISSING' }
    value = (value as Record<string, unknown>)[segment]
  }
  if (value === undefined || value === null) return { ok: false, reason: 'MISSING' }
  let key: string
  if (typeof value === 'string') key = value
  else if (typeof value === 'number' && Number.isSafeInteger(value)) key = String(value)
  else return { ok: false, reason: 'INVALID' }
  return CORRELATION_KEY_REGEX.test(key) ? { ok: true, key } : { ok: false, reason: 'INVALID' }
}

/** The Temporal workflow id of the keyed instance. */
export function correlatedTemporalWorkflowId(
  tenantId: string,
  workflowName: string,
  key: string,
): string {
  return `wfl/${tenantId}/${workflowName}/${key}`
}

/**
 * Null when the trigger's (merged) settings are a valid binding for `workflow`,
 * else the 400 message. NEW takes neither field; START / DELIVER need an EVENT
 * trigger on a durable Workflow, a valid correlation path, and a signal the
 * Workflow version declares.
 */
export function signalBindingError(
  trigger: {
    kind: 'EVENT' | 'SCHEDULE'
    mode: WorkflowTriggerMode
    correlationPath?: string | null | undefined
    signalName?: string | null | undefined
  },
  workflow: { name: string; executable: boolean; kind: string; manifest: unknown },
): string | null {
  if (trigger.mode === 'NEW') {
    if (trigger.correlationPath != null || trigger.signalName != null) {
      return 'correlationPath and signalName are only valid with mode START or DELIVER'
    }
    return null
  }
  if (trigger.kind !== 'EVENT') return `mode ${trigger.mode} is only valid for EVENT triggers`
  if (resolveWorkflowRoute(workflow) !== 'TENANT_RUNNER' || workflow.kind !== 'WORKFLOW') {
    return `mode ${trigger.mode} needs a durable Workflow (manifest kind = "workflow"); this is an Automation`
  }
  if (!trigger.correlationPath) return `mode ${trigger.mode} requires a correlationPath`
  const pathError = correlationPathError(trigger.correlationPath)
  if (pathError) return pathError
  if (!trigger.signalName) return `mode ${trigger.mode} requires a signalName`
  const declared = declaredSignals(workflow.manifest)
  if (!declared.includes(trigger.signalName)) {
    return `signalName "${trigger.signalName}" is not declared by this Workflow version (declared: ${declared.length ? declared.join(', ') : 'none'})`
  }
  return null
}
