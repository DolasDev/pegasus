// ---------------------------------------------------------------------------
// Scheduled Lambda — dispatches workflow triggers. Three phases per tick
// (events, schedules, then the Unit-9 tenant-runner sweep — see the sweep
// block at the bottom of the handler):
//
// PHASE 1 — domain events (Phase 3 Unit 3). The consumer half of the outbox:
// handlers write DomainEvent rows in the same transaction as the state change
// they describe (lib/domain-events.ts); each tick drains undispatched rows
// oldest-first, matches each against the tenant's enabled EVENT triggers, and
// starts workflow executions through the SAME run path as
// POST /workflows/:id/run (lib/start-workflow-execution.ts) — with provenance
// triggerSource=EVENT + triggeredByTriggerId and a null triggeredByUserId.
//
// PHASE 0 — namespace drains (Phase 3b.2), before phase 1: moves DRAINING
// tenants to ACTIVE and REVERTING ones to READY once their open executions in
// the namespace they're leaving have finished (lib/temporal-namespace-
// cutover.ts). A migrating tenant's events are excluded from phase 1's query
// until then; a trigger that hits TENANT_MIGRATING mid-tick (the tenant began
// migrating after the query) leaves its event undispatched for redelivery.
//
// PHASE 2 — schedules (Phase 3 Unit 4). The same tick evaluates every enabled
// SCHEDULE trigger's cron expression (lib/cron.ts — dependency-free 5-field
// matcher, UTC) against the tick's fire-minute and fires the matches through
// the identical run path with triggerSource=SCHEDULE. Deliberately NOT
// Temporal Schedules: Schedule actions start workflows directly, bypassing
// the execution-row + broker contract every run depends on (the runtime-token
// endpoint requires a QUEUED/RUNNING execution row).
//
// NO CATCH-UP (documented v1 contract): if a tick is missed entirely (Lambda
// downtime, EventBridge hiccup), that fire-minute's scheduled runs are simply
// skipped — the next tick evaluates ITS OWN minute only. Domain events, by
// contrast, are durable outbox rows and are never lost to a missed tick.
//
// KICKS (latency): EventBridge runs the full tick every minute, the safety
// net. Between ticks, callers that just made trigger work possible invoke this
// Lambda asynchronously with `{ source: 'kick' }` (lib/trigger-dispatch-kick.ts):
// RingCentral capture after committing a new `sms.received`, and the broker
// PATCH when a TENANT_RUNNER run finishes while its tenant has events waiting.
// A kicked invocation runs PHASE 1 only — no namespace drains, no SCHEDULE
// sweep (a kick never evaluates a fire-minute), no runner sweep — so an event
// fires seconds after capture instead of up to a minute later.
//
// ONE DISPATCHER AT A TIME: CDK gives this function reserved concurrency 1.
// The concurrency cap is counted before a start, not reserved, so two
// overlapping dispatchers could each see the same free slots and together
// exceed the cap. With one at a time, a kick that lands mid-tick is throttled
// and Lambda's async retry redelivers it moments later. Don't lift the
// reservation without making the cap check atomic (GOTCHAS).
//
// BACK-PRESSURE (concurrency cap): an EVENT trigger that hits the tenant's
// TENANT_RUNNER concurrency cap leaves its event undispatched, so it fires once
// a run finishes — the cap delays a burst, it doesn't drop it (until 2026-10-29
// the event was stamped and the run lost). Three guards keep a parked tenant
// from becoming an outage:
//   - its young events are excluded AT THE QUERY while it is at the cap (like
//     a migrating tenant's), so they can't fill the oldest-first batch — the
//     WHOLE event waits, so its curated (STDLIB) triggers wait with it;
//   - a full pass that newly parks a tenant re-queries without it (at most
//     MAX_EVENT_PASSES per tick), for a tenant that dipped one run under the cap;
//   - an event still capped CONCURRENCY_DEFER_MAX_AGE_MS after it occurred is
//     stamped as dropped (CONCURRENCY_DROPPED), so the park always exhausts.
// A SCHEDULE trigger at the cap stays a skipped minute; the daily quota still
// drops. One gap: the run path checks the cap BEFORE the quota, so an event
// that arrives while its tenant is at both parks rather than drops, and may
// fire after the quota resets at midnight UTC. Another: a DRY-RUN trigger's
// start counts dry runs too, so one capped by dry runs alone still marks the
// tenant capped for the rest of the tick, so its live triggers drain about one
// event per tick while dry runs fill the cap.
//
// Idempotency (crash-safety) is layered identically for both phases:
//   1. The Temporal workflow id is deterministic per (trigger, occurrence):
//      `wf/<tenantId>/<workflowName>/trg/<triggerId>/<dedupeKey>` where the
//      dedupe key is the DomainEvent id (EVENT) or the compact UTC fire-minute
//      stamp like `20260610T1604Z` (SCHEDULE) — with REJECT_DUPLICATE, a
//      redelivered event or a double-run within the same minute can never
//      start a second run.
//   2. That id is persisted on the execution row AT CREATE TIME, so a crash
//      anywhere after the insert leaves a row this tick's pre-check finds:
//      an existing row with the deterministic id ⇒ skip (no duplicate row).
//   3. (EVENT only) `dispatchedAt` is stamped only AFTER an event's triggers
//      are processed, via conditional updateMany({ where: { id,
//      dispatchedAt: null } }) — a crash before the stamp means redelivery,
//      which layers 1+2 absorb. SCHEDULE has no outbox row; layers 1+2 are
//      the whole story.
//
// Failure isolation: one trigger's failure (non-executable workflow, Temporal
// down for one start) never poisons the event, the schedule sweep, or the
// batch — per-trigger work is wrapped in try/catch and events are stamped
// regardless of a failed trigger (only a migrating or capped tenant parks one,
// see above). A trigger pointing at a non-executable workflow (e.g.
// tenant-uploaded, pre-Track-A) is a logged skip, not an error. A SCHEDULE
// row whose cron expression predates the Unit-4 parser-backed validation and
// no longer parses is an INVALID_CRON skip, never a crash.
//
// Cross-tenant by design: it imports the tenant-agnostic root `db` — the same
// precedent as lambda-reconcile-workflow-executions.ts — so a single tick
// dispatches every tenant's events and schedules. Creates go through the
// execution repo with an explicit tenantId (the trigger's), which is safe on
// the root client.
//
// EVENT-ROUTED SIGNALS: an EVENT trigger in mode START / DELIVER does not start
// an execution per event. It reads the event's business key at
// `correlationPath`, finds the OPEN execution of the keyed durable Workflow
// instance (`wfl/<tenant>/<name>/<key>`) and delivers the envelope to it as
// `signalName` (lib/signal-workflow-execution.ts). With no open instance,
// START creates one via signal-with-start (through the same run path, so it is
// charged and gated like any start — the kill switch included); DELIVER fails
// the delivery (NO_OPEN_INSTANCE). A plain signal is not a run: no quota, no
// cap, and the kill switch does not block it. Outcomes are metrics + logs
// (SignalDelivered, SignalDeliveryFailed{Reason}); a failed delivery is final
// (the event is stamped) except a START parked on WORKFLOW_VERSION_STARTING or
// deferred by a migrating / provisioning namespace. Delivery is at-least-once:
// a redelivered event signals again, so Workflow handlers dedupe on
// `domainEventId`.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule, every minute).
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { cronMatchesMinute, parseCronExpression } from './lib/cron'
import { DOMAIN_EVENT_TYPES, emitTenantEvent } from './lib/domain-events'
// Trigger-filter matching lives in lib/event-filter.ts so the dispatcher and
// the trigger create/update validation share ONE contract — the v1
// shallow-equality dialect AND the v2 structured dialect (dot-paths, operators,
// all/any). matchesFilter never throws; see that module's header. Re-exported
// under its historical name for callers/tests that import it from here.
import { matchesFilter as matchesTriggerFilter } from './lib/event-filter'
import { createLogger } from './lib/logger'
import {
  findTenantsAtRunnerConcurrencyCap,
  startWorkflowExecution,
} from './lib/start-workflow-execution'
import { declaredSignals, signalDurableExecution } from './lib/signal-workflow-execution'
import {
  correlatedTemporalWorkflowId,
  extractCorrelationKey,
  signalBindingError,
  type EventEnvelope,
} from './lib/workflow-signal-routing'
import { sweepTenantRunners } from './lib/tenant-runner'
import { advanceNamespaceMigrations } from './lib/temporal-namespace-cutover'
import { tenantNamespacesConfigured } from './lib/tenant-namespace-request'
import { resolveWorkflowRoute } from './lib/workflow-route'
import {
  createTenantTemporalNamespaceRepository,
  MIGRATING_STATUSES,
} from './repositories/tenant-temporal-namespace.repository'
import { createWorkflowRepository } from './repositories/workflow.repository'
import { createWorkflowExecutionRepository } from './repositories/workflow-execution.repository'
import type { WorkflowTriggerMode } from './repositories/workflow-trigger.repository'

const logger = createLogger('pegasus-dispatch-workflow-triggers')
const cloudwatch = new CloudWatchClient({})

// Duplicated literally from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as the other emitters. Keep both
// sides in sync.
const METRIC_NAMESPACE = 'Pegasus/Workflows'

/** Bound work per tick. If we hit this we log a backlog line + metric and let
 * the next minute's invocation drain the rest. Never a silent cap. */
const BATCH_SIZE = 100

/** How long an EVENT trigger's event may wait behind the concurrency cap
 * before it is stamped as dropped. Must stay well under the RingCentral 72h
 * body retention: a parked event keeps its own payload body (the purge skips
 * undispatched events), but `messages.body`, which a reply workflow may re-read
 * through the API, is purged at 72h regardless. */
const CONCURRENCY_DEFER_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Event-query passes per tick. A pass repeats only when the batch was full
 * AND it newly excluded a tenant (see the pass loop in the handler). */
const MAX_EVENT_PASSES = 3

/** Why a matching trigger did not fire — the `Reason` metric dimension. */
type TriggerSkipReason =
  | 'NOT_EXECUTABLE' // workflow not executable (non-curated, no valid artifact)
  | 'WORKFLOW_NOT_FOUND' // trigger's workflow no longer visible (defensive)
  | 'DUPLICATE' // execution row with this deterministic id already exists
  | 'ALREADY_STARTED' // Temporal REJECT_DUPLICATE fired (pre-check raced)
  | 'START_FAILED' // Temporal start threw; FAILED row records the error
  | 'INVALID_CRON' // SCHEDULE row's expression no longer parses (pre-Unit-4 row)
  | 'OVERLAP' // SCHEDULE overlap policy: a previous run of this trigger is still in-flight
  | 'CONCURRENCY_LIMIT' // tenant concurrency cap: SCHEDULE fire-minute skipped
  | 'CONCURRENCY_DEFERRED' // tenant concurrency cap: EVENT left undispatched to fire once a run finishes
  | 'CONCURRENCY_DROPPED' // tenant concurrency cap: EVENT still capped past the max park age, stamped
  | 'DAILY_QUOTA_EXCEEDED' // Phase 3 Unit 10: tenant daily execution quota reached
  | 'WORKFLOWS_DISABLED' // Phase 3 Unit 11: operator kill switch
  | 'MUST_FORK' // defensive: trigger on a cross-tenant GLOBAL workflow (config mistake)
  | 'TENANT_MIGRATING' // Phase 3b.2: tenant's Temporal namespace mid-cutover/rollback
  | 'TENANT_NAMESPACE_PROVISIONING' // tenant's own namespace being created: deferred like TENANT_MIGRATING
  | 'TENANT_NAMESPACE_UNAVAILABLE' // tenant's namespace FAILED / DEPROVISIONING: the run is lost (alarmed)
  | 'DRY_RUN_UNSUPPORTED' // dry-run trigger on a STDLIB workflow (API refuses; legacy/race)
  | 'OPEN_WORKFLOW_LIMIT' // Phase 3c: tenant at its open durable-Workflow cap
  | 'WORKFLOW_VERSION_STARTING' // Phase 3c: SCHEDULE tick for a durable version not yet polled (skipped)
  | 'WORKFLOW_VERSION_DEFERRED' // Phase 3c: EVENT parked until the durable version's worker has polled
  | 'WORKFLOW_VERSION_DROPPED' // Phase 3c: EVENT still parked on an unregistered version past the max park age
  | 'ERROR' // unexpected per-trigger exception

/** Why an event-routed signal was not delivered — the `Reason` dimension of
 * SignalDeliveryFailed. A START that could not create the instance reports its
 * start outcome (WORKFLOWS_DISABLED, OPEN_WORKFLOW_LIMIT, …). */
type SignalFailureReason =
  | 'WORKFLOW_NOT_FOUND' // trigger's workflow no longer visible (defensive)
  | 'BINDING_INVALID' // not a durable Workflow / signal no longer declared / bad path
  | 'MISSING_KEY' // nothing at correlationPath in this event
  | 'INVALID_KEY' // key not a string / integer, or unsafe in a workflow id
  | 'NO_OPEN_INSTANCE' // DELIVER: no open instance for the key
  | 'INSTANCE_CLOSED' // START: the key's instance already closed (REJECT_DUPLICATE)
  | 'NOT_RUNNING' // an open row, but Temporal has no running instance
  | 'SIGNAL_FAILED' // Temporal refused / errored on the signal
  | 'ERROR' // unexpected exception
  | string // a START's start outcome

export { matchesTriggerFilter }

/** Built-in event names — the only valid domain-condition derivation sources. */
const DOMAIN_EVENT_TYPES_SET: ReadonlySet<string> = new Set(DOMAIN_EVENT_TYPES)

/**
 * Domain-condition derivation (Unit 8). After a BUILT-IN domain event is
 * processed + stamped, emit a derived CUSTOM event for every enabled
 * TenantEventType whose domainCondition matches it. The derived event is a NEW
 * outbox row — picked up on the NEXT tick by the unchanged EVENT path — rather
 * than fired inline, which keeps derivation a simple append.
 *
 * Loop-safety: domainCondition.sourceEventType is validated at registry-create
 * to be a built-in name, and this only runs for built-in source events, so a
 * custom event can never feed another derivation — cycles are impossible.
 *
 * The (hasDomainCondition, enabled) index backs the pre-filter, so a tenant with
 * no conditions costs one empty indexed query. Per-condition try/catch keeps one
 * bad derivation from blocking the others or the event stamp. At-least-once: if
 * the tick crashes after deriving but before the source stamp, redelivery
 * re-derives — each derived row has its own id, so the downstream trigger's
 * deterministic Temporal id still guarantees at-most-one execution per row.
 */
async function deriveTenantEvents(
  event: { id: string; tenantId: string; eventType: string; payload: Prisma.JsonValue },
  counts: MetricCounts,
): Promise<void> {
  const candidates = await db.tenantEventType.findMany({
    where: { tenantId: event.tenantId, enabled: true, hasDomainCondition: true },
  })
  const basePayload =
    typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {}

  for (const et of candidates) {
    const cond = et.domainCondition as {
      sourceEventType?: string
      filter?: Prisma.JsonValue
    } | null
    if (!cond || cond.sourceEventType !== event.eventType) continue
    if (cond.filter !== undefined && !matchesTriggerFilter(cond.filter ?? null, event.payload)) {
      continue
    }
    try {
      await db.$transaction(async (tx) => {
        await emitTenantEvent(tx, {
          tenantId: event.tenantId,
          eventType: et.name,
          payload: { ...basePayload, _derivedFrom: event.id },
        })
      })
      counts.derived += 1
      logger.info('Derived tenant event from domain condition', {
        tenantEventTypeId: et.id,
        derivedEventType: et.name,
        sourceEventId: event.id,
        sourceEventType: event.eventType,
        tenantId: event.tenantId,
      })
    } catch (err) {
      logger.error('Failed to derive tenant event from domain condition', {
        tenantEventTypeId: et.id,
        sourceEventId: event.id,
        tenantId: event.tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Deterministic Temporal workflow id for one trigger occurrence. The dedupe
 * key is the DomainEvent id (EVENT) or the compact fire-minute stamp
 * (SCHEDULE) — see the module header.
 */
function deterministicTemporalWorkflowId(
  tenantId: string,
  workflowName: string,
  triggerId: string,
  dedupeKey: string,
): string {
  return `wf/${tenantId}/${workflowName}/trg/${triggerId}/${dedupeKey}`
}

/**
 * Compact UTC minute stamp — ISO-8601 basic format truncated to the minute,
 * e.g. `2026-06-10T16:04:23.456Z` → `20260610T1604Z`. Used as the SCHEDULE
 * dedupe key so the deterministic id stays separator-safe and readable.
 */
function compactUtcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace(/[-:]/g, '')}Z`
}

/** Per-tick metric accumulator — flushed as one PutMetricData call at the end
 * so a 100-event tick doesn't make hundreds of CloudWatch round-trips. */
type MetricCounts = {
  dispatched: number
  fired: number // EVENT-trigger fires
  scheduleFired: number // SCHEDULE-trigger fires
  derived: number // custom events derived from a domain condition (Unit 8)
  skipped: Map<TriggerSkipReason, number>
  /** Event-routed signals delivered (a START that created its instance included). */
  signalsDelivered: number
  signalFailures: Map<SignalFailureReason, number>
  backlog: boolean
  /** TenantTemporalNamespacesUnhealthy: set by phase 0 where namespaces are
   * provisioned (0 included, so the alarm has a continuous series). */
  namespacesUnhealthy?: number
}

async function flushMetrics(counts: MetricCounts): Promise<void> {
  const timestamp = new Date()
  const metricData = []
  if (counts.dispatched > 0) {
    metricData.push({
      MetricName: 'DomainEventsDispatched',
      Value: counts.dispatched,
      Unit: 'Count' as const,
      Timestamp: timestamp,
    })
  }
  // WorkflowTriggerFired counts BOTH kinds, undimensioned: adding a `Kind`
  // dimension would change the metric identity (CloudWatch keys series by
  // dimension set) and orphan the existing Unit-3 alarms/graphs. Kind-level
  // detail lives in the structured logs and the handler's return value.
  const totalFired = counts.fired + counts.scheduleFired
  if (totalFired > 0) {
    metricData.push({
      MetricName: 'WorkflowTriggerFired',
      Value: totalFired,
      Unit: 'Count' as const,
      Timestamp: timestamp,
    })
  }
  if (counts.derived > 0) {
    metricData.push({
      MetricName: 'TenantEventsDerived',
      Value: counts.derived,
      Unit: 'Count' as const,
      Timestamp: timestamp,
    })
  }
  for (const [reason, value] of counts.skipped) {
    metricData.push({
      MetricName: 'WorkflowTriggerSkipped',
      Value: value,
      Unit: 'Count' as const,
      Timestamp: timestamp,
      Dimensions: [{ Name: 'Reason', Value: reason }],
    })
  }
  if (counts.signalsDelivered > 0) {
    metricData.push({
      MetricName: 'SignalDelivered',
      Value: counts.signalsDelivered,
      Unit: 'Count' as const,
      Timestamp: timestamp,
    })
  }
  for (const [reason, value] of counts.signalFailures) {
    metricData.push({
      MetricName: 'SignalDeliveryFailed',
      Value: value,
      Unit: 'Count' as const,
      Timestamp: timestamp,
      Dimensions: [{ Name: 'Reason', Value: reason }],
    })
  }
  if (counts.namespacesUnhealthy !== undefined) {
    metricData.push({
      MetricName: 'TenantTemporalNamespacesUnhealthy',
      Value: counts.namespacesUnhealthy,
      Unit: 'Count' as const,
      Timestamp: timestamp,
    })
  }
  if (counts.backlog) {
    metricData.push({
      MetricName: 'DomainEventDispatchBacklog',
      Value: 1,
      Unit: 'Count' as const,
      Timestamp: timestamp,
    })
  }
  if (metricData.length === 0) return
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({ Namespace: METRIC_NAMESPACE, MetricData: metricData }),
    )
  } catch (err) {
    // Metrics are observability, not correctness — never fail the tick on a
    // CloudWatch hiccup.
    logger.error('Failed to publish dispatch metrics', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** The trigger columns both fire paths need. */
type FirableTrigger = {
  id: string
  tenantId: string
  workflowId: string
  createdByUserId: string
  /** Start every execution in dry-run mode (mutations captured, not performed). */
  dryRun: boolean
}

/**
 * Shared fire path for one trigger occurrence — everything AFTER the
 * kind-specific match decision (filter match for EVENT, cron match for
 * SCHEDULE): visibility lookup, deterministic-id pre-check, start, outcome
 * accounting. Throws are left to the caller's per-trigger isolation catch.
 *
 * Returns 'DEFERRED' when the occurrence must be retried later rather than
 * consumed: the tenant's Temporal namespace started migrating after this tick
 * loaded its events (Phase 3b.2). The EVENT caller then leaves the event
 * undispatched, so it fires once the migration settles; SCHEDULE has no
 * outbox row, so for it a deferral is a skipped minute (no catch-up).
 *
 * Returns 'CAPPED' (EVENT only) when the tenant is at its TENANT_RUNNER
 * concurrency cap — either the run path said so, or `tenantAtCap` already
 * knows it and the workflow routes to the runner, so the start (and its count
 * query, rejection metric and warn log) is skipped. The caller decides
 * defer-vs-drop by the event's age. Curated (STDLIB) workflows are never
 * capped, so `tenantAtCap` never stops their start — though a capped sibling
 * trigger still parks the whole event, and the query exclusion holds it too.
 */
async function fireTrigger(opts: {
  workflowRepo: ReturnType<typeof createWorkflowRepository>
  trigger: FirableTrigger
  triggerSource: 'EVENT' | 'SCHEDULE'
  /** DomainEvent id (EVENT) or compact fire-minute stamp (SCHEDULE). */
  dedupeKey: string
  input: Record<string, unknown>
  counts: MetricCounts
  skip: (reason: TriggerSkipReason) => void
  /** Occurrence identifiers ({ domainEventId } / { fireMinute }) for logs. */
  logContext: Record<string, unknown>
  /** EVENT only: the tenant is known to be at the concurrency cap this tick. */
  tenantAtCap?: boolean
}): Promise<'DEFERRED' | 'CAPPED' | 'VERSION_STARTING' | void> {
  const { workflowRepo, trigger, triggerSource, dedupeKey, input, counts, skip, logContext } = opts

  // Same visibility rule as the manual run path: the workflow must be the
  // trigger-tenant's own row or GLOBAL. CASCADE deletes triggers with their
  // workflow, so null here is a defensive race window.
  const workflow = await workflowRepo.findByIdForTenant(trigger.workflowId, trigger.tenantId)
  if (!workflow) {
    skip('WORKFLOW_NOT_FOUND')
    logger.warn('Trigger workflow not found — skipping', {
      triggerId: trigger.id,
      workflowId: trigger.workflowId,
      tenantId: trigger.tenantId,
      ...logContext,
    })
    return
  }

  const temporalWorkflowId = deterministicTemporalWorkflowId(
    trigger.tenantId,
    workflow.name,
    trigger.id,
    dedupeKey,
  )

  // Re-run guard: a previous occurrence of this exact (trigger, dedupe key)
  // — a redelivered event, or a second evaluation of the same fire-minute —
  // may already have created this execution; the deterministic id is
  // persisted at create time precisely so this pre-check finds it.
  const existing = await db.workflowExecution.findFirst({
    where: { tenantId: trigger.tenantId, temporalWorkflowId },
    select: { id: true },
  })
  if (existing) {
    skip('DUPLICATE')
    logger.info('Execution already exists for this trigger occurrence — skipping', {
      triggerId: trigger.id,
      tenantId: trigger.tenantId,
      executionId: existing.id,
      ...logContext,
    })
    return
  }

  // The concurrency cap bounds Automations only: a durable Workflow (Phase 3c)
  // has its own open-Workflow cap, checked by the start.
  if (
    opts.tenantAtCap &&
    resolveWorkflowRoute(workflow) === 'TENANT_RUNNER' &&
    workflow.kind !== 'WORKFLOW'
  ) {
    return 'CAPPED'
  }

  const result = await startWorkflowExecution(db, {
    workflow,
    tenantId: trigger.tenantId,
    input,
    provenance: {
      triggerSource,
      triggeredByTriggerId: trigger.id,
      runtimeAccountCreatedById: trigger.createdByUserId,
    },
    temporalWorkflowId,
    dryRun: trigger.dryRun,
  })

  switch (result.outcome) {
    case 'STARTED':
      if (triggerSource === 'EVENT') {
        counts.fired += 1
      } else {
        counts.scheduleFired += 1
      }
      logger.info('Trigger fired workflow execution', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        triggerSource,
        workflowId: workflow.id,
        executionId: result.execution.id,
        temporalWorkflowId,
        dryRun: trigger.dryRun,
        ...logContext,
      })
      break
    case 'DRY_RUN_UNSUPPORTED':
      // A dry-run trigger on a curated STDLIB workflow, which has no
      // interception seam. The API refuses to attach one; reaching here means
      // the workflow became curated after the fact. Never fall back to live.
      skip('DRY_RUN_UNSUPPORTED')
      logger.warn('Dry-run trigger skipped — workflow cannot run dry', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        ...logContext,
      })
      break
    case 'NOT_EXECUTABLE':
      // Non-curated + non-executable (no valid artifact yet). Logged skip;
      // never blocks the event stamp.
      skip('NOT_EXECUTABLE')
      logger.info('Trigger workflow is not executable — skipping', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        ...logContext,
      })
      break
    case 'CONCURRENCY_LIMIT':
      // Tenant hit the TENANT_RUNNER concurrent-execution cap. EVENT: back-
      // pressure — the caller parks the event (see the module header).
      // SCHEDULE: no outbox row, so a skipped minute, like a migrating tenant.
      if (triggerSource === 'EVENT') return 'CAPPED'
      skip('CONCURRENCY_LIMIT')
      logger.warn('Trigger skipped — TENANT_RUNNER concurrency cap reached', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        ...logContext,
      })
      break
    case 'OPEN_WORKFLOW_LIMIT':
      // Phase 3c: the tenant already has the maximum number of open durable
      // Workflows. An abuse ceiling like the daily quota, so the occurrence is
      // skipped rather than parked (open Workflows can stay open for months).
      skip('OPEN_WORKFLOW_LIMIT')
      logger.warn('Trigger skipped — open durable Workflow cap reached', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        ...logContext,
      })
      break
    case 'WORKFLOW_VERSION_STARTING':
      // Phase 3c: the durable version's worker hasn't polled yet (a minute or
      // two after publish), so Temporal refused the pinned start; nothing was
      // written. EVENT: parked like the concurrency cap (bounded by the same
      // max park age, so a version that never registers can't park forever).
      // SCHEDULE: a skipped minute, like a migrating tenant.
      if (triggerSource === 'EVENT') return 'VERSION_STARTING'
      skip('WORKFLOW_VERSION_STARTING')
      logger.info('Trigger skipped — durable workflow version not registered yet', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        ...logContext,
      })
      break
    case 'DAILY_QUOTA_EXCEEDED':
      // Phase 3 Unit 10: tenant hit the per-day execution quota.
      skip('DAILY_QUOTA_EXCEEDED')
      logger.warn('Trigger skipped — TENANT_RUNNER daily quota exceeded', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        ...logContext,
      })
      break
    case 'WORKFLOWS_DISABLED':
      // Phase 3 Unit 11: operator kill switch.
      skip('WORKFLOWS_DISABLED')
      logger.info('Trigger skipped — workflows disabled for tenant', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        ...logContext,
      })
      break
    case 'MUST_FORK':
      // Defensive: a trigger is attached to a cross-tenant GLOBAL workflow it
      // does not own. Triggers should only be attached to a tenant's own or
      // forked rows, so this indicates a configuration mistake — log a warning
      // and skip. The supported path is to fork first, then attach triggers to
      // the fork.
      skip('MUST_FORK')
      logger.warn('Trigger skipped — cross-tenant GLOBAL workflow requires fork first', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        ...logContext,
      })
      break
    case 'TENANT_MIGRATING':
      // Phase 3b.2: the tenant flipped to DRAINING / REVERTING after this tick
      // loaded its events (the event query already excludes migrating
      // tenants). Nothing was written; the caller keeps the event undispatched.
      skip('TENANT_MIGRATING')
      logger.info('Trigger deferred — tenant Temporal namespace migrating', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        triggerSource,
        ...logContext,
      })
      return 'DEFERRED'
    case 'TENANT_NAMESPACE_PROVISIONING':
      // The tenant had no namespace when this tick loaded its events (the
      // start just requested one), or it began provisioning mid-tick. Same
      // contract as TENANT_MIGRATING: nothing written, the event waits, and
      // the next ticks exclude the tenant at the query until it is ACTIVE.
      skip('TENANT_NAMESPACE_PROVISIONING')
      logger.info('Trigger deferred — tenant Temporal namespace provisioning', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        triggerSource,
        ...logContext,
      })
      return 'DEFERRED'
    case 'TENANT_NAMESPACE_UNAVAILABLE':
      // FAILED (or DEPROVISIONING) is not excluded at the query: it has no
      // bound, and holding the tenant's events would also hold its curated
      // triggers. So this tenant-runner occurrence is lost, loudly; phase 0
      // retries the provision and TenantTemporalNamespacesUnhealthy alarms.
      skip('TENANT_NAMESPACE_UNAVAILABLE')
      logger.error('Trigger skipped — tenant Temporal namespace unavailable', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        triggerSource,
        ...logContext,
      })
      break
    case 'ALREADY_STARTED':
      // The pre-check raced a concurrent start; Temporal's REJECT_DUPLICATE
      // guarantees the run exists exactly once. Success-already-handled: no
      // FAILED row, log + continue.
      skip('ALREADY_STARTED')
      logger.warn('Temporal already started this trigger occurrence — skipping', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        temporalWorkflowId,
        ...logContext,
      })
      break
    case 'START_FAILED':
      // The FAILED execution row records the error for the tenant; for EVENT
      // the event is still stamped (no redelivery — retrying a start that
      // failed cleanly is the operator's call, not the poller's).
      skip('START_FAILED')
      logger.error('Trigger failed to start workflow execution', {
        triggerId: trigger.id,
        tenantId: trigger.tenantId,
        workflowId: workflow.id,
        error: result.message,
        ...logContext,
      })
      break
  }
}

/** An EVENT trigger in mode START / DELIVER (its binding columns, as stored). */
type SignalRoutedTrigger = FirableTrigger & {
  mode: WorkflowTriggerMode
  correlationPath: string | null
  signalName: string | null
}

/**
 * Event-routed signal delivery for one START / DELIVER trigger and one event
 * (see the module header). Returns 'DEFERRED' / 'VERSION_STARTING' when the
 * event must be redelivered later (same contract as fireTrigger); otherwise
 * the delivery is final — counted, logged, and the event is stamped.
 */
async function routeSignalTrigger(opts: {
  workflowRepo: ReturnType<typeof createWorkflowRepository>
  trigger: SignalRoutedTrigger
  envelope: EventEnvelope
  counts: MetricCounts
  skip: (reason: TriggerSkipReason) => void
}): Promise<'DEFERRED' | 'VERSION_STARTING' | void> {
  const { workflowRepo, trigger, envelope, counts, skip } = opts
  const logContext = {
    triggerId: trigger.id,
    tenantId: trigger.tenantId,
    mode: trigger.mode,
    signalName: trigger.signalName,
    domainEventId: envelope.domainEventId,
  }
  const fail = (reason: SignalFailureReason, extra: Record<string, unknown> = {}) => {
    counts.signalFailures.set(reason, (counts.signalFailures.get(reason) ?? 0) + 1)
    logger.warn('Event-routed signal not delivered', { reason, ...logContext, ...extra })
  }

  const workflow = await workflowRepo.findByIdForTenant(trigger.workflowId, trigger.tenantId)
  if (!workflow) return fail('WORKFLOW_NOT_FOUND')
  // Re-checked here, not only at trigger create: the stored binding can go
  // stale (e.g. the trigger's version was replaced by one without the signal).
  const bindingError = signalBindingError({ kind: 'EVENT', ...trigger }, workflow)
  if (bindingError || !trigger.correlationPath || !trigger.signalName) {
    return fail('BINDING_INVALID', { error: bindingError })
  }
  const signalName = trigger.signalName

  const keyResult = extractCorrelationKey(envelope, trigger.correlationPath)
  if (!keyResult.ok) {
    return fail(keyResult.reason === 'MISSING' ? 'MISSING_KEY' : 'INVALID_KEY', {
      correlationPath: trigger.correlationPath,
    })
  }
  const temporalWorkflowId = correlatedTemporalWorkflowId(
    trigger.tenantId,
    workflow.name,
    keyResult.key,
  )

  // The dispatcher is serialized (reserved concurrency 1) and no other path
  // mints `wfl/` ids, so the open row, if any, is THE instance for this key.
  const open = await createWorkflowExecutionRepository(db).findOpenByTemporalWorkflowId(
    trigger.tenantId,
    temporalWorkflowId,
  )
  if (open) {
    // The instance runs the version it STARTED on, which may predate the
    // trigger's: that version must declare the signal too.
    const instanceWorkflow =
      open.workflowId === workflow.id
        ? workflow
        : await workflowRepo.findByIdForTenant(open.workflowId, trigger.tenantId, {
            includeRetired: true,
          })
    if (!instanceWorkflow || !declaredSignals(instanceWorkflow.manifest).includes(signalName)) {
      return fail('BINDING_INVALID', {
        executionId: open.id,
        error: 'the open instance runs a version that does not declare this signal',
      })
    }
    const result = await signalDurableExecution(db, {
      workflow: instanceWorkflow,
      execution: open,
      signalName,
      args: [envelope],
    })
    if (result.outcome !== 'SIGNALLED') {
      return fail(result.outcome === 'NOT_RUNNING' ? 'NOT_RUNNING' : 'SIGNAL_FAILED', {
        executionId: open.id,
        outcome: result.outcome,
      })
    }
    counts.signalsDelivered += 1
    logger.info('Event-routed signal delivered', { ...logContext, executionId: open.id })
    return
  }

  if (trigger.mode === 'DELIVER') return fail('NO_OPEN_INSTANCE', { temporalWorkflowId })

  // START: create the instance with this event as its first signal. Through
  // the run path, so it is gated and charged like any start (kill switch,
  // open-Workflow cap, daily quota). The event is also the start input.
  const result = await startWorkflowExecution(db, {
    workflow,
    tenantId: trigger.tenantId,
    input: envelope,
    provenance: {
      triggerSource: 'EVENT',
      triggeredByTriggerId: trigger.id,
      runtimeAccountCreatedById: trigger.createdByUserId,
    },
    temporalWorkflowId,
    startSignal: { name: signalName, args: [envelope] },
  })
  switch (result.outcome) {
    case 'STARTED':
      counts.fired += 1
      counts.signalsDelivered += 1
      logger.info('Event-routed signal started its Workflow instance', {
        ...logContext,
        executionId: result.execution.id,
        temporalWorkflowId,
      })
      return
    case 'SIGNALLED_EXISTING':
      counts.signalsDelivered += 1
      logger.info('Event-routed signal delivered to an instance the DB had not tracked open', {
        ...logContext,
        existingExecutionId: result.existingExecutionId,
        temporalWorkflowId,
      })
      return
    case 'ALREADY_STARTED':
      return fail('INSTANCE_CLOSED', { temporalWorkflowId })
    case 'WORKFLOW_VERSION_STARTING':
      return 'VERSION_STARTING'
    case 'TENANT_MIGRATING':
    case 'TENANT_NAMESPACE_PROVISIONING':
      skip(result.outcome)
      logger.info('Event-routed START deferred — tenant namespace not ready', {
        ...logContext,
        outcome: result.outcome,
      })
      return 'DEFERRED'
    case 'START_FAILED':
      return fail('START_FAILED', { error: result.message })
    default:
      return fail(result.outcome)
  }
}

/** A kick (lib/trigger-dispatch-kick.ts) vs anything else — EventBridge's
 * scheduled event, or no payload — which runs the full tick. */
function isKick(event: unknown): boolean {
  return (
    typeof event === 'object' && event !== null && (event as { source?: unknown }).source === 'kick'
  )
}

export async function handler(event?: unknown): Promise<{
  scanned: number
  dispatched: number
  fired: number
  derived: number
  schedulesEvaluated: number
  scheduleFired: number
  runnersLaunched: number
}> {
  const counts: MetricCounts = {
    dispatched: 0,
    fired: 0,
    scheduleFired: 0,
    derived: 0,
    skipped: new Map(),
    signalsDelivered: 0,
    signalFailures: new Map(),
    backlog: false,
  }
  const skip = (reason: TriggerSkipReason) => {
    counts.skipped.set(reason, (counts.skipped.get(reason) ?? 0) + 1)
  }
  const workflowRepo = createWorkflowRepository(db)
  // KICKED: capture or a finished run asked for an immediate drain. Only the
  // domain-event phase runs — the namespace drains, the SCHEDULE sweep (a kick
  // must never evaluate a fire-minute) and the runner sweep stay on the minute
  // tick, which still runs every phase as the safety net.
  const kicked = isKick(event)

  // ONE fire-minute for the whole tick, fixed BEFORE the event phase: the
  // invocation time truncated to the UTC minute. Computing it up front keeps
  // a slow event drain from pushing the schedule evaluation into the next
  // minute (double-evaluation of a minute is absorbed by the deterministic-id
  // layers; a skipped minute would not be).
  const fireMinute = new Date(Math.floor(Date.now() / 60_000) * 60_000)

  // ── Phase 1: domain-event dispatch (EVENT triggers) ──────────────────────

  // ── Phase 0 (3b.2): finish namespace drains ───────────────────────────────
  // (and, where namespaces are provisioned, advance READY rows and retry stuck
  // or failed provisions: lib/temporal-namespace-cutover.ts)
  const namespacesConfigured = tenantNamespacesConfigured()
  //
  // Before the event query, so a tenant that settles now gets its waiting
  // events dispatched this tick. Failure-isolated: a broken pass leaves every
  // migrating tenant migrating (its events wait), never breaks the tick.
  if (!kicked) {
    try {
      const migration = await advanceNamespaceMigrations(db)
      if (namespacesConfigured) counts.namespacesUnhealthy = migration.unhealthy
      if (
        migration.advanced.length > 0 ||
        migration.waiting.length > 0 ||
        migration.retried.length > 0 ||
        migration.unhealthy > 0
      ) {
        logger.info('Temporal namespace migrations checked', { ...migration })
      }
    } catch (err) {
      logger.error('Temporal namespace migration pass failed — next tick retries', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Phase 3b.2: a tenant mid-cutover or mid-rollback takes no new runner work,
  // so its events wait, undispatched, until the drain settles. Excluded AT THE
  // QUERY — never loaded and skipped — so they can't sit at the head of this
  // oldest-first batch and starve every other tenant (GOTCHAS: "A global
  // oldest-first outbox drain + an infinite park").
  //
  // Legacy-runner retirement: where namespaces are provisioned, a tenant
  // whose namespace is PROVISIONING or READY waits the same way (bounded: a
  // provision finishes within the provisioner's 15-minute timeout, and READY
  // advances on the next phase 0). FAILED is deliberately NOT held: it has no
  // bound, and holding it would hold the tenant's curated triggers too.
  const migratingTenantIds = (
    await createTenantTemporalNamespaceRepository(db).findInStatuses(
      namespacesConfigured
        ? [...MIGRATING_STATUSES, 'PROVISIONING', 'READY']
        : [...MIGRATING_STATUSES],
    )
  ).map((r) => r.tenantId)

  // Back-pressure: a tenant at the concurrency cap would only park its events
  // again, so its events younger than the max park age are excluded AT THE
  // QUERY, for the same starvation reason as above. Older ones still load, so
  // the loop below can stamp them as dropped — the park always exhausts.
  // Failure-isolated: without the list, capped events still park correctly via
  // the run path; only the batch fairness is lost for this tick.
  let cappedTenantIds: string[] = []
  try {
    cappedTenantIds = await findTenantsAtRunnerConcurrencyCap(db)
  } catch (err) {
    logger.error('Failed to load tenants at the concurrency cap — no query exclusion this tick', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  const parkCutoff = new Date(Date.now() - CONCURRENCY_DEFER_MAX_AGE_MS)
  // Tenants known to be at the cap this tick — seeded from the query, then
  // grown by the first CAPPED start, so a burst costs one rejected start, not
  // one per event.
  const cappedTenants = new Set(cappedTenantIds)
  // Excluded at the query at every age: migrating at the start of the tick,
  // plus any tenant that began migrating mid-tick.
  const migratingTenants = new Set(migratingTenantIds)
  let scanned = 0

  // Fairness WITHIN the tick: a tenant one run under the cap isn't excluded,
  // so a deep park can fill the whole batch while only one of its events
  // fires and the rest park again. When a FULL pass parked a tenant the query
  // didn't already exclude, re-query without it so other tenants' events still
  // drain this tick. Bounded; whatever is left waits for the next tick.
  for (let pass = 0; pass < MAX_EVENT_PASSES; pass++) {
    const excludedCapped = [...cappedTenants]
    const excludedMigrating = [...migratingTenants]
    const events = await db.domainEvent.findMany({
      where: {
        dispatchedAt: null,
        ...(excludedMigrating.length > 0 ? { tenantId: { notIn: excludedMigrating } } : {}),
        ...(excludedCapped.length > 0
          ? { NOT: { tenantId: { in: excludedCapped }, occurredAt: { gt: parkCutoff } } }
          : {}),
      },
      orderBy: { occurredAt: 'asc' },
      take: BATCH_SIZE,
    })
    scanned += events.length

    logger.info('Scanned for undispatched domain events', { scanned: events.length, pass })

    await dispatchEvents(events)

    counts.backlog = events.length === BATCH_SIZE
    const newlyExcluded =
      cappedTenants.size > excludedCapped.length || migratingTenants.size > excludedMigrating.length
    if (!counts.backlog || !newlyExcluded) break
  }

  if (counts.backlog) {
    logger.warn('Domain-event dispatch backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

  async function dispatchEvents(events: Awaited<ReturnType<typeof db.domainEvent.findMany>>) {
    for (const event of events) {
      try {
        // The Unit-2 (kind, enabled, eventType) index covers this; tenantId
        // keeps one tenant's events from ever firing another tenant's triggers.
        const triggers = await db.workflowTrigger.findMany({
          where: {
            kind: 'EVENT',
            enabled: true,
            eventType: event.eventType,
            tenantId: event.tenantId,
          },
          orderBy: { createdAt: 'asc' },
        })

        let deferred = false
        // Parked behind the concurrency cap: true leaves the event undispatched
        // unless it has waited past the max age, when it is stamped as dropped.
        let capped = false
        // Parked on a durable Workflow version that hasn't registered yet
        // (Phase 3c): same park/drop contract as `capped`, but it says nothing
        // about the tenant's other triggers, so the tenant isn't marked capped.
        let versionStarting = false
        const parkExpired = event.occurredAt <= parkCutoff
        for (const trigger of triggers) {
          // Failure isolation: one trigger's failure must not poison the event
          // (its other triggers, the dispatchedAt stamp) or the batch.
          try {
            if (!matchesTriggerFilter(trigger.filter, event.payload)) {
              continue
            }
            // The execution input (NEW) / signal argument (START, DELIVER) is
            // the event envelope. The payload is a pointer (entity ids +
            // minimal context) — workflows refetch authoritative state via the API.
            const envelope: EventEnvelope = {
              domainEventId: event.id,
              eventType: event.eventType,
              occurredAt: event.occurredAt.toISOString(),
              payload: event.payload,
            }
            const fired =
              trigger.mode === 'NEW'
                ? await fireTrigger({
                    workflowRepo,
                    trigger,
                    triggerSource: 'EVENT',
                    dedupeKey: event.id,
                    input: envelope,
                    counts,
                    skip,
                    logContext: { domainEventId: event.id },
                    tenantAtCap: cappedTenants.has(event.tenantId),
                  })
                : await routeSignalTrigger({ workflowRepo, trigger, envelope, counts, skip })
            if (fired === 'DEFERRED') {
              deferred = true
              migratingTenants.add(event.tenantId)
            }
            if (fired === 'VERSION_STARTING') {
              versionStarting = true
              skip(parkExpired ? 'WORKFLOW_VERSION_DROPPED' : 'WORKFLOW_VERSION_DEFERRED')
              if (parkExpired) {
                logger.error('Trigger dropped — durable workflow version never registered', {
                  triggerId: trigger.id,
                  tenantId: trigger.tenantId,
                  domainEventId: event.id,
                  occurredAt: event.occurredAt.toISOString(),
                  maxAgeHours: CONCURRENCY_DEFER_MAX_AGE_MS / 3_600_000,
                })
              }
            }
            if (fired === 'CAPPED') {
              capped = true
              if (parkExpired) {
                skip('CONCURRENCY_DROPPED')
                logger.error('Trigger dropped — event parked behind the concurrency cap too long', {
                  triggerId: trigger.id,
                  tenantId: trigger.tenantId,
                  domainEventId: event.id,
                  occurredAt: event.occurredAt.toISOString(),
                  maxAgeHours: CONCURRENCY_DEFER_MAX_AGE_MS / 3_600_000,
                })
              } else {
                skip('CONCURRENCY_DEFERRED')
                // Once per tenant per tick — a deep park would otherwise log a
                // line per parked event (the metric still counts each one).
                if (!cappedTenants.has(event.tenantId)) {
                  logger.info('Trigger deferred — TENANT_RUNNER concurrency cap reached', {
                    triggerId: trigger.id,
                    tenantId: trigger.tenantId,
                    domainEventId: event.id,
                  })
                }
              }
              cappedTenants.add(event.tenantId)
            }
          } catch (err) {
            skip('ERROR')
            logger.error('Trigger dispatch failed', {
              triggerId: trigger.id,
              domainEventId: event.id,
              tenantId: trigger.tenantId,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // A deferred trigger means the tenant began migrating mid-tick: leave
        // the WHOLE event undispatched. The next ticks exclude the tenant at the
        // query; once it settles the event is redelivered, and the triggers that
        // did fire now are absorbed by the deterministic-id pre-check.
        if (deferred) continue

        // A capped trigger parks the WHOLE event the same way: the next ticks
        // exclude the tenant at the query while it stays at the cap, then the
        // event is redelivered — triggers that fired now hit the DUPLICATE
        // pre-check. Past the max age it falls through and is stamped (dropped).
        if ((capped || versionStarting) && !parkExpired) continue

        // Stamp AFTER the event's triggers are processed. Conditional on
        // dispatchedAt still being null so a concurrent tick can't double-count
        // — and a crash before this line means redelivery, which the
        // deterministic-id layers absorb.
        const { count } = await db.domainEvent.updateMany({
          where: { id: event.id, dispatchedAt: null },
          data: { dispatchedAt: new Date() },
        })
        if (count > 0) {
          counts.dispatched += 1
        }

        // Domain-condition derivation (Unit 8): only BUILT-IN events can be a
        // derivation source (cycle-safety). Isolated from the stamp above — a
        // derivation failure never un-stamps the event or aborts the batch.
        if (DOMAIN_EVENT_TYPES_SET.has(event.eventType)) {
          try {
            await deriveTenantEvents(event, counts)
          } catch (err) {
            logger.error('Domain-condition derivation query failed', {
              domainEventId: event.id,
              tenantId: event.tenantId,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      } catch (err) {
        // Trigger lookup / stamping failed — leave the event undispatched for
        // the next tick rather than abort the batch.
        logger.error('Failed to dispatch domain event — will retry next tick', {
          domainEventId: event.id,
          tenantId: event.tenantId,
          eventType: event.eventType,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // ── Phase 2: scheduled triggers (Phase 3 Unit 4) ──────────────────────────
  //
  // Evaluates every enabled SCHEDULE trigger against the tick's fire-minute
  // (fixed at handler start). NO CATCH-UP — a missed tick skips its
  // fire-minute entirely (documented v1 contract; see module header).
  const fireMinuteIso = fireMinute.toISOString()
  let schedulesEvaluated = 0

  if (!kicked) {
    try {
      // Cross-tenant, like the event phase: every tenant's enabled SCHEDULE
      // triggers in one sweep. Disabled rows are filtered at the query.
      const scheduleTriggers = await db.workflowTrigger.findMany({
        where: { kind: 'SCHEDULE', enabled: true },
        orderBy: { createdAt: 'asc' },
      })
      schedulesEvaluated = scheduleTriggers.length

      for (const trigger of scheduleTriggers) {
        // Same per-trigger failure isolation as the event phase.
        try {
          const schedule = trigger.cronExpression
            ? parseCronExpression(trigger.cronExpression)
            : null
          if (!schedule) {
            // Rows predating the Unit-4 parser-backed create/update validation
            // may hold expressions the old charset regex allowed — they must
            // never crash the tick.
            skip('INVALID_CRON')
            logger.warn('Trigger cron expression is unparseable — skipping', {
              triggerId: trigger.id,
              tenantId: trigger.tenantId,
              cronExpression: trigger.cronExpression,
            })
            continue
          }

          // Not due this minute — the overwhelmingly common case; no metric.
          if (!cronMatchesMinute(schedule, fireMinute)) {
            continue
          }

          // Overlap policy: skip this tick if a prior run of THIS trigger is still
          // in-flight (QUEUED/RUNNING), rather than piling up concurrent duplicates
          // when a run exceeds the interval. The deterministic-id dedup below only
          // guards the SAME fire-minute; this guards across minutes. The [status]
          // index keeps it selective (non-terminal executions are few).
          const inFlight = await db.workflowExecution.findFirst({
            where: { triggeredByTriggerId: trigger.id, status: { in: ['QUEUED', 'RUNNING'] } },
            select: { id: true },
          })
          if (inFlight) {
            skip('OVERLAP')
            logger.info('Scheduled trigger skipped — previous run still in-flight', {
              triggerId: trigger.id,
              tenantId: trigger.tenantId,
              inFlightExecutionId: inFlight.id,
              fireMinute: fireMinuteIso,
            })
            continue
          }

          await fireTrigger({
            workflowRepo,
            trigger,
            triggerSource: 'SCHEDULE',
            dedupeKey: compactUtcMinute(fireMinute),
            // The scheduled-tick input envelope (sdk-feedback/0023): a documented
            // shape distinct from EVENT (has `payload`) and manual (has user input)
            // — a workflow's resolver keys on `scheduledAt`. `schedule` echoes the
            // cron so the run self-describes its cadence. Lands at `arg["input"]`.
            input: {
              scheduledAt: fireMinuteIso,
              schedule: trigger.cronExpression,
              triggerId: trigger.id,
            },
            counts,
            skip,
            logContext: { fireMinute: fireMinuteIso },
          })
        } catch (err) {
          skip('ERROR')
          logger.error('Scheduled trigger dispatch failed', {
            triggerId: trigger.id,
            tenantId: trigger.tenantId,
            fireMinute: fireMinuteIso,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } catch (err) {
      // SCHEDULE sweep failed to even load — log and let the next tick retry
      // (its own minute; this fire-minute is forfeit per the no-catch-up
      // contract). The event phase's results are unaffected.
      logger.error('Failed to load SCHEDULE triggers — skipping schedule phase this tick', {
        fireMinute: fireMinuteIso,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Phase 3: tenant-runner sweep (Phase 3 Unit 9) ─────────────────────────
  //
  // Scale-to-zero backstop: ensure a runner task is up for every tenant with
  // outstanding QUEUED/RUNNING runner-bound work (crash/idle-exit recovery),
  // and publish the runner pool gauges (TenantRunnersRunning + cold-start
  // latency). No-op when TENANT_RUNNER_* env is absent (dev) and — until
  // Unit 10 lifts the curated gate — finds no runner-bound work by
  // construction. Failure-isolated like the phases above: a broken sweep
  // never poisons event dispatch or schedule evaluation.
  let runnersLaunched = 0
  if (!kicked) {
    try {
      const sweep = await sweepTenantRunners(db)
      runnersLaunched = sweep.launched
      if (sweep.tenantsNeedingRunner > 0) {
        logger.info('Tenant-runner sweep finished', { ...sweep })
      }
    } catch (err) {
      logger.error('Tenant-runner sweep failed — next tick retries', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await flushMetrics(counts)

  logger.info('Dispatch tick finished', {
    source: kicked ? 'kick' : 'schedule',
    scanned,
    dispatched: counts.dispatched,
    fired: counts.fired,
    derived: counts.derived,
    schedulesEvaluated,
    scheduleFired: counts.scheduleFired,
    runnersLaunched,
  })
  return {
    scanned,
    dispatched: counts.dispatched,
    fired: counts.fired,
    derived: counts.derived,
    schedulesEvaluated,
    scheduleFired: counts.scheduleFired,
    runnersLaunched,
  }
}
