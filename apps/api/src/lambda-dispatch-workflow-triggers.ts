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
// regardless. A trigger pointing at a non-executable workflow (e.g.
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
// Scheduling lives in the CDK ApiStack (EventBridge rule, every minute).
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { cronMatchesMinute, parseCronExpression } from './lib/cron'
import { createLogger } from './lib/logger'
import { startWorkflowExecution } from './lib/start-workflow-execution'
import { sweepTenantRunners } from './lib/tenant-runner'
import { createWorkflowRepository } from './repositories/workflow.repository'

const logger = createLogger('pegasus-dispatch-workflow-triggers')
const cloudwatch = new CloudWatchClient({})

// Duplicated literally from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as the other emitters. Keep both
// sides in sync.
const METRIC_NAMESPACE = 'Pegasus/Workflows'

/** Bound work per tick. If we hit this we log a backlog line + metric and let
 * the next minute's invocation drain the rest. Never a silent cap. */
const BATCH_SIZE = 100

/** Why a matching trigger did not fire — the `Reason` metric dimension. */
type TriggerSkipReason =
  | 'NOT_EXECUTABLE' // workflow not executable (non-curated, no valid artifact)
  | 'WORKFLOW_NOT_FOUND' // trigger's workflow no longer visible (defensive)
  | 'DUPLICATE' // execution row with this deterministic id already exists
  | 'ALREADY_STARTED' // Temporal REJECT_DUPLICATE fired (pre-check raced)
  | 'START_FAILED' // Temporal start threw; FAILED row records the error
  | 'INVALID_CRON' // SCHEDULE row's expression no longer parses (pre-Unit-4 row)
  | 'CONCURRENCY_LIMIT' // Phase 3 Unit 10: tenant concurrent-execution cap reached
  | 'DAILY_QUOTA_EXCEEDED' // Phase 3 Unit 10: tenant daily execution quota reached
  | 'WORKFLOWS_DISABLED' // Phase 3 Unit 11: operator kill switch
  | 'MUST_FORK' // defensive: trigger on a cross-tenant GLOBAL workflow (config mistake)
  | 'ERROR' // unexpected per-trigger exception

/**
 * v1 trigger-filter match semantics — THE PUBLIC CONTRACT the trigger UI
 * (Phase 3 Unit 5) explains to tenants:
 *
 *   - A trigger with a null (or empty-object) filter matches every event of
 *     its eventType.
 *   - Otherwise the match is SHALLOW TOP-LEVEL EQUALITY: every key in the
 *     filter must be present in the event payload with a strictly equal
 *     (===) value. Extra payload keys are ignored.
 *   - Strict equality means scalar values only (string / number / boolean /
 *     null); an object or array filter value never matches in v1.
 *   - No nesting, no operators, no partial/regex matching in v1.
 */
export function matchesTriggerFilter(
  filter: Prisma.JsonValue | null,
  payload: Prisma.JsonValue,
): boolean {
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
    // Null / non-object filters mean "no filter". (The API only persists
    // plain objects; anything else is treated as match-all defensively.)
    return true
  }
  const keys = Object.keys(filter)
  if (keys.length === 0) return true
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    // A non-empty filter can never match a non-object payload.
    return false
  }
  const payloadRecord = payload as Record<string, unknown>
  const filterRecord = filter as Record<string, unknown>
  return keys.every((key) => filterRecord[key] === payloadRecord[key])
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
  skipped: Map<TriggerSkipReason, number>
  backlog: boolean
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
  for (const [reason, value] of counts.skipped) {
    metricData.push({
      MetricName: 'WorkflowTriggerSkipped',
      Value: value,
      Unit: 'Count' as const,
      Timestamp: timestamp,
      Dimensions: [{ Name: 'Reason', Value: reason }],
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
}

/**
 * Shared fire path for one trigger occurrence — everything AFTER the
 * kind-specific match decision (filter match for EVENT, cron match for
 * SCHEDULE): visibility lookup, deterministic-id pre-check, start, outcome
 * accounting. Throws are left to the caller's per-trigger isolation catch.
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
}): Promise<void> {
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
      // Phase 3 Unit 10: tenant hit the TENANT_RUNNER concurrent-execution cap.
      // Treat the same as START_FAILED for the dispatcher: logged skip, event
      // is still stamped (no retry — the tenant is over-capacity, not failing).
      skip('CONCURRENCY_LIMIT')
      logger.warn('Trigger skipped — TENANT_RUNNER concurrency cap reached', {
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

export async function handler(): Promise<{
  scanned: number
  dispatched: number
  fired: number
  schedulesEvaluated: number
  scheduleFired: number
  runnersLaunched: number
}> {
  const counts: MetricCounts = {
    dispatched: 0,
    fired: 0,
    scheduleFired: 0,
    skipped: new Map(),
    backlog: false,
  }
  const skip = (reason: TriggerSkipReason) => {
    counts.skipped.set(reason, (counts.skipped.get(reason) ?? 0) + 1)
  }
  const workflowRepo = createWorkflowRepository(db)

  // ONE fire-minute for the whole tick, fixed BEFORE the event phase: the
  // invocation time truncated to the UTC minute. Computing it up front keeps
  // a slow event drain from pushing the schedule evaluation into the next
  // minute (double-evaluation of a minute is absorbed by the deterministic-id
  // layers; a skipped minute would not be).
  const fireMinute = new Date(Math.floor(Date.now() / 60_000) * 60_000)

  // ── Phase 1: domain-event dispatch (EVENT triggers) ──────────────────────

  const events = await db.domainEvent.findMany({
    where: { dispatchedAt: null },
    orderBy: { occurredAt: 'asc' },
    take: BATCH_SIZE,
  })

  logger.info('Scanned for undispatched domain events', { scanned: events.length })

  counts.backlog = events.length === BATCH_SIZE
  if (counts.backlog) {
    logger.warn('Domain-event dispatch backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

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

      for (const trigger of triggers) {
        // Failure isolation: one trigger's failure must not poison the event
        // (its other triggers, the dispatchedAt stamp) or the batch.
        try {
          if (!matchesTriggerFilter(trigger.filter, event.payload)) {
            continue
          }
          await fireTrigger({
            workflowRepo,
            trigger,
            triggerSource: 'EVENT',
            dedupeKey: event.id,
            // The execution input is the event envelope. The payload is a
            // pointer (entity ids + minimal context) — workflows refetch
            // authoritative state via the API.
            input: {
              domainEventId: event.id,
              eventType: event.eventType,
              occurredAt: event.occurredAt.toISOString(),
              payload: event.payload,
            },
            counts,
            skip,
            logContext: { domainEventId: event.id },
          })
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

  // ── Phase 2: scheduled triggers (Phase 3 Unit 4) ──────────────────────────
  //
  // Evaluates every enabled SCHEDULE trigger against the tick's fire-minute
  // (fixed at handler start). NO CATCH-UP — a missed tick skips its
  // fire-minute entirely (documented v1 contract; see module header).
  const fireMinuteIso = fireMinute.toISOString()
  let schedulesEvaluated = 0

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
        const schedule = trigger.cronExpression ? parseCronExpression(trigger.cronExpression) : null
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

        await fireTrigger({
          workflowRepo,
          trigger,
          triggerSource: 'SCHEDULE',
          dedupeKey: compactUtcMinute(fireMinute),
          input: { scheduledFor: fireMinuteIso, triggerId: trigger.id },
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

  await flushMetrics(counts)

  logger.info('Dispatch tick finished', {
    scanned: events.length,
    dispatched: counts.dispatched,
    fired: counts.fired,
    schedulesEvaluated,
    scheduleFired: counts.scheduleFired,
    runnersLaunched,
  })
  return {
    scanned: events.length,
    dispatched: counts.dispatched,
    fired: counts.fired,
    schedulesEvaluated,
    scheduleFired: counts.scheduleFired,
    runnersLaunched,
  }
}
