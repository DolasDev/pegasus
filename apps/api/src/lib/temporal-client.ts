// ---------------------------------------------------------------------------
// Temporal client (Cloud + local-dev) for the API Lambda.
//
// The API Lambda is the producer that starts workflows on Temporal Cloud via
// `client.workflow.start(...)`. The Fargate worker (apps/temporal-worker) is
// the consumer — it polls task queues and runs the actual workflows.
//
// Connection model
// ────────────────
// * Production (staging / prod): API-key auth against Temporal Cloud. The key
//   lives in Secrets Manager at `pegasus/{env}/temporal-cloud` as JSON
//   `{ "apiKey": "<jwt>" }`. CDK extracts the `apiKey` field via Secrets
//   Manager dynamic reference and injects it as the env var
//   TEMPORAL_CLOUD_API_KEY — the same pattern DATABASE_URL uses. No AWS
//   SDK call required at runtime. `Connection.connect({ tls: true, apiKey,
//   metadata: { 'temporal-namespace': namespace } })` is the Cloud shape
//   (see hello-world-mtls samples; mTLS uses certs but API-key auth replaces
//   the cert pair with the apiKey field).
// * Local dev: when `TEMPORAL_ADDRESS` is unset (or set to localhost),
//   connects without TLS or auth — matches `docker-compose.temporal.yml`'s
//   bare dev server on `localhost:7233`.
//
// Caching
// ───────
// The Connection is cached at module scope for the Lambda container's
// lifetime. Cold start pays one gRPC handshake; warm invocations reuse.
// This is the standard pattern in this codebase — see apps/api/src/db.ts
// (Prisma) and runtime-token-crypto.ts (KMS client).
//
// Tests: import _setTemporalClientForTesting to inject a mock Client so tests
// don't open a real connection.
// ---------------------------------------------------------------------------

import { Client, Connection } from '@temporalio/client'

// ---------------------------------------------------------------------------
// Workflow history summary (developer execution inspection)
//
// `handle.fetchHistory()` returns a Temporal protobuf History whose events are
// a verbose union of `<kind>EventAttributes` fields. We flatten it to a compact
// timeline the tenant UI and the SDK CLI can render — WorkflowExecutionStarted,
// per-activity scheduled/started/completed/failed, and the terminal workflow
// event — without leaking the raw proto shape into handlers.
//
// Kept here, pure and proto-agnostic, so it is unit-testable from a plain
// object fixture (no live Temporal connection).
// ---------------------------------------------------------------------------

/** One flattened history event for the execution-inspection timeline. */
export type WorkflowHistoryEvent = {
  /** Temporal eventId, stringified (it is a 64-bit value). */
  id: string
  /** Human-readable event kind, e.g. `ActivityTaskFailed`. */
  type: string
  /** ISO-8601 event time, or null when the proto carried no timestamp. */
  timestamp: string | null
  /** Activity name, on activity events (correlated by scheduledEventId). */
  activityType?: string
  /** Attempt number, on activity-started events. */
  attempt?: number
  /** Failure message, on failed workflow/activity events. */
  failure?: string
}

/** Map each `<kind>EventAttributes` field name to a clean event label. */
const HISTORY_EVENT_ATTR_TYPES: Readonly<Record<string, string>> = {
  workflowExecutionStartedEventAttributes: 'WorkflowExecutionStarted',
  workflowExecutionCompletedEventAttributes: 'WorkflowExecutionCompleted',
  workflowExecutionFailedEventAttributes: 'WorkflowExecutionFailed',
  workflowExecutionTimedOutEventAttributes: 'WorkflowExecutionTimedOut',
  workflowExecutionCanceledEventAttributes: 'WorkflowExecutionCanceled',
  workflowExecutionTerminatedEventAttributes: 'WorkflowExecutionTerminated',
  workflowExecutionContinuedAsNewEventAttributes: 'WorkflowExecutionContinuedAsNew',
  activityTaskScheduledEventAttributes: 'ActivityTaskScheduled',
  activityTaskStartedEventAttributes: 'ActivityTaskStarted',
  activityTaskCompletedEventAttributes: 'ActivityTaskCompleted',
  activityTaskFailedEventAttributes: 'ActivityTaskFailed',
  activityTaskTimedOutEventAttributes: 'ActivityTaskTimedOut',
  timerStartedEventAttributes: 'TimerStarted',
  timerFiredEventAttributes: 'TimerFired',
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Coerce a proto numeric (number | string | Long-like) to a JS number. */
function protoNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  const obj = asObject(value)
  if (obj && typeof obj['toString'] === 'function') {
    const n = Number(String(value))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Convert a proto `{ seconds, nanos }` timestamp to an ISO string. */
function protoTimestampToIso(value: unknown): string | null {
  const t = asObject(value)
  if (!t) return null
  const seconds = protoNumber(t['seconds'])
  if (seconds === null) return null
  const nanos = protoNumber(t['nanos']) ?? 0
  return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString()
}

/**
 * Flatten a Temporal History proto into a compact, ordered timeline. Activity
 * names are correlated from the scheduled event onto the later
 * started/completed/failed/timed-out events (which only carry a
 * scheduledEventId), so each activity event in the timeline shows its name.
 */
export function summarizeWorkflowHistory(history: unknown): WorkflowHistoryEvent[] {
  const root = asObject(history)
  const rawEvents = root ? root['events'] : null
  if (!Array.isArray(rawEvents)) return []

  // First pass: scheduledEventId → activity name.
  const activityNameByScheduledId = new Map<string, string>()
  for (const raw of rawEvents) {
    const event = asObject(raw)
    if (!event) continue
    const attrs = asObject(event['activityTaskScheduledEventAttributes'])
    if (!attrs) continue
    const eventId = event['eventId']
    const activityType = asObject(attrs['activityType'])
    const name = activityType ? activityType['name'] : null
    if (eventId != null && typeof name === 'string') {
      activityNameByScheduledId.set(String(eventId), name)
    }
  }

  const out: WorkflowHistoryEvent[] = []
  for (const raw of rawEvents) {
    const event = asObject(raw)
    if (!event) continue

    // Find the populated `<kind>EventAttributes` field.
    let attrKey: string | null = null
    for (const key of Object.keys(HISTORY_EVENT_ATTR_TYPES)) {
      if (asObject(event[key])) {
        attrKey = key
        break
      }
    }
    const type = (attrKey ? HISTORY_EVENT_ATTR_TYPES[attrKey] : undefined) ?? 'Unknown'
    const attrs = attrKey ? asObject(event[attrKey]) : null

    const summary: WorkflowHistoryEvent = {
      id: event['eventId'] != null ? String(event['eventId']) : '',
      type,
      timestamp: protoTimestampToIso(event['eventTime']),
    }

    if (attrs) {
      // Activity name: directly on the scheduled event, else correlated.
      const directType = asObject(attrs['activityType'])
      if (directType && typeof directType['name'] === 'string') {
        summary.activityType = directType['name']
      } else {
        const scheduledId = attrs['scheduledEventId']
        if (scheduledId != null) {
          const name = activityNameByScheduledId.get(String(scheduledId))
          if (name) summary.activityType = name
        }
      }
      const attempt = protoNumber(attrs['attempt'])
      if (attempt !== null && attempt > 0) summary.attempt = attempt
      const failure = asObject(attrs['failure'])
      if (failure && typeof failure['message'] === 'string') {
        summary.failure = failure['message']
      }
    }

    out.push(summary)
  }
  return out
}

// ---------------------------------------------------------------------------
// Env / config helpers
// ---------------------------------------------------------------------------

/**
 * Temporal Cloud address — e.g. `pegasus-staging.chgel.tmprl.cloud:7233`.
 * Unset in dev (we fall through to localhost).
 */
function temporalAddress(): string | undefined {
  return process.env['TEMPORAL_ADDRESS'] || undefined
}

/**
 * Full Temporal Cloud namespace id — `<short>.<account>`. CDK derives this
 * from TEMPORAL_ADDRESS in `bin/app.ts` and injects it explicitly so the
 * runtime doesn't have to re-parse the address (and so a future address-only
 * change can't silently drift from the namespace).
 */
function temporalNamespace(): string {
  return process.env['TEMPORAL_NAMESPACE'] || 'default'
}

/** Task queue name — e.g. `pegasus-stdlib-staging`. */
export function temporalTaskQueue(): string {
  return process.env['TEMPORAL_TASK_QUEUE'] || 'pegasus-stdlib-dev'
}

function temporalCloudApiKey(): string | undefined {
  return process.env['TEMPORAL_CLOUD_API_KEY'] || undefined
}

/** True when we should connect via Temporal Cloud (API key + TLS). */
function usesTemporalCloud(): boolean {
  const addr = temporalAddress()
  if (!addr) return false
  // Defensive: if someone sets TEMPORAL_ADDRESS=localhost:7233 in dev, treat
  // it as local even though the var is set.
  if (addr.startsWith('localhost') || addr.startsWith('127.0.0.1')) return false
  return true
}

// ---------------------------------------------------------------------------
// Client (cached for container lifetime)
// ---------------------------------------------------------------------------

let _client: Promise<Client> | null = null

/**
 * Test injection hook. Tests call this with a fake Client so the handler
 * never reaches the real Temporal SDK. The handler tests use this to stub
 * `client.workflow.start` and assert on its arguments.
 *
 * Passing `null` clears the cache, mirroring the pattern in db.ts.
 */
export function _setTemporalClientForTesting(client: Client | null): void {
  _client = client ? Promise.resolve(client) : null
}

/**
 * Returns the cached Temporal client, constructing it on the first call.
 * Subsequent callers share the same instance for the Lambda container's
 * lifetime — the gRPC connection is long-lived and safe to reuse.
 */
export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client
  _client = (async () => {
    if (usesTemporalCloud()) {
      const apiKey = temporalCloudApiKey()
      if (!apiKey) {
        throw new Error('TEMPORAL_CLOUD_API_KEY is not set — cannot connect to Temporal Cloud')
      }
      const address = temporalAddress()
      if (!address) {
        throw new Error('TEMPORAL_ADDRESS unset despite Cloud mode being on')
      }
      const namespace = temporalNamespace()
      const connection = await Connection.connect({
        address,
        tls: true,
        apiKey,
        // Temporal Cloud uses the metadata header to disambiguate the
        // namespace — required when the API key is account-scoped.
        metadata: { 'temporal-namespace': namespace },
      })
      return new Client({ connection, namespace })
    }
    // Local dev — bare localhost:7233 connection, no TLS, no auth.
    const address = temporalAddress() ?? 'localhost:7233'
    const connection = await Connection.connect({ address })
    return new Client({ connection, namespace: temporalNamespace() })
  })()
  _client.catch(() => {
    _client = null
  })
  return _client
}
