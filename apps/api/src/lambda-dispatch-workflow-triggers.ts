// ---------------------------------------------------------------------------
// Scheduled Lambda — dispatches domain events to matching workflow triggers.
//
// The consumer half of the Phase 3 outbox: handlers write DomainEvent rows in
// the same transaction as the state change they describe (lib/domain-events.ts);
// this Lambda runs every minute, drains undispatched rows oldest-first,
// matches each against the tenant's enabled EVENT triggers, and starts
// workflow executions through the SAME run path as POST /workflows/:id/run
// (lib/start-workflow-execution.ts) — with provenance triggerSource=EVENT +
// triggeredByTriggerId and a null triggeredByUserId.
//
// Idempotency (crash-safety) is layered:
//   1. The Temporal workflow id is deterministic per (trigger, event):
//      `wf/<tenantId>/<workflowName>/trg/<triggerId>/<domainEventId>` — with
//      REJECT_DUPLICATE, a redelivered event can never start a second run.
//   2. That id is persisted on the execution row AT CREATE TIME, so a crash
//      anywhere after the insert leaves a row this tick's pre-check finds:
//      an existing row with the deterministic id ⇒ skip (no duplicate row).
//   3. `dispatchedAt` is stamped only AFTER an event's triggers are processed,
//      via conditional updateMany({ where: { id, dispatchedAt: null } }) — a
//      crash before the stamp means redelivery, which layers 1+2 absorb.
//
// Failure isolation: one trigger's failure (non-executable workflow, Temporal
// down for one start) never poisons the event or the batch — per-trigger work
// is wrapped in try/catch and the event is stamped regardless. A trigger
// pointing at a non-executable workflow (e.g. tenant-uploaded, pre-Track-A)
// is a logged skip, not an error.
//
// Cross-tenant by design: it imports the tenant-agnostic root `db` — the same
// precedent as lambda-reconcile-workflow-executions.ts — so a single tick
// dispatches every tenant's events. Creates go through the execution repo
// with an explicit tenantId (the trigger's), which is safe on the root client.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule, every minute).
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { createLogger } from './lib/logger'
import { startWorkflowExecution } from './lib/start-workflow-execution'
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
  | 'NOT_EXECUTABLE' // workflow not in the curated allowlist (pre-Track-A)
  | 'WORKFLOW_NOT_FOUND' // trigger's workflow no longer visible (defensive)
  | 'DUPLICATE' // execution row with this deterministic id already exists
  | 'ALREADY_STARTED' // Temporal REJECT_DUPLICATE fired (pre-check raced)
  | 'START_FAILED' // Temporal start threw; FAILED row records the error
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

/** Deterministic Temporal workflow id for one (trigger, event) pair. */
function deterministicTemporalWorkflowId(
  tenantId: string,
  workflowName: string,
  triggerId: string,
  domainEventId: string,
): string {
  return `wf/${tenantId}/${workflowName}/trg/${triggerId}/${domainEventId}`
}

/** Per-tick metric accumulator — flushed as one PutMetricData call at the end
 * so a 100-event tick doesn't make hundreds of CloudWatch round-trips. */
type MetricCounts = {
  dispatched: number
  fired: number
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
  if (counts.fired > 0) {
    metricData.push({
      MetricName: 'WorkflowTriggerFired',
      Value: counts.fired,
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

export async function handler(): Promise<{
  scanned: number
  dispatched: number
  fired: number
}> {
  const events = await db.domainEvent.findMany({
    where: { dispatchedAt: null },
    orderBy: { occurredAt: 'asc' },
    take: BATCH_SIZE,
  })

  logger.info('Scanned for undispatched domain events', { scanned: events.length })

  if (events.length === 0) {
    return { scanned: 0, dispatched: 0, fired: 0 }
  }

  const counts: MetricCounts = {
    dispatched: 0,
    fired: 0,
    skipped: new Map(),
    backlog: events.length === BATCH_SIZE,
  }
  const skip = (reason: TriggerSkipReason) => {
    counts.skipped.set(reason, (counts.skipped.get(reason) ?? 0) + 1)
  }

  if (counts.backlog) {
    logger.warn('Domain-event dispatch backlog — hit batch cap; next tick will continue', {
      batchSize: BATCH_SIZE,
    })
  }

  const workflowRepo = createWorkflowRepository(db)

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

          // Same visibility rule as the manual run path: the workflow must be
          // the trigger-tenant's own row or GLOBAL. CASCADE deletes triggers
          // with their workflow, so null here is a defensive race window.
          const workflow = await workflowRepo.findByIdForTenant(
            trigger.workflowId,
            trigger.tenantId,
          )
          if (!workflow) {
            skip('WORKFLOW_NOT_FOUND')
            logger.warn('Trigger workflow not found — skipping', {
              triggerId: trigger.id,
              workflowId: trigger.workflowId,
              tenantId: trigger.tenantId,
              domainEventId: event.id,
            })
            continue
          }

          const temporalWorkflowId = deterministicTemporalWorkflowId(
            trigger.tenantId,
            workflow.name,
            trigger.id,
            event.id,
          )

          // Redelivery guard: a previous (crashed-before-stamping) tick may
          // already have created this execution — the deterministic id is
          // persisted at create time precisely so this pre-check finds it.
          const existing = await db.workflowExecution.findFirst({
            where: { tenantId: trigger.tenantId, temporalWorkflowId },
            select: { id: true },
          })
          if (existing) {
            skip('DUPLICATE')
            logger.info('Execution already exists for this (trigger, event) — skipping', {
              triggerId: trigger.id,
              domainEventId: event.id,
              tenantId: trigger.tenantId,
              executionId: existing.id,
            })
            continue
          }

          const result = await startWorkflowExecution(db, {
            workflow,
            tenantId: trigger.tenantId,
            // The execution input is the event envelope. The payload is a
            // pointer (entity ids + minimal context) — workflows refetch
            // authoritative state via the API.
            input: {
              domainEventId: event.id,
              eventType: event.eventType,
              occurredAt: event.occurredAt.toISOString(),
              payload: event.payload,
            },
            provenance: {
              triggerSource: 'EVENT',
              triggeredByTriggerId: trigger.id,
              runtimeAccountCreatedById: trigger.createdByUserId,
            },
            temporalWorkflowId,
          })

          switch (result.outcome) {
            case 'STARTED':
              counts.fired += 1
              logger.info('Trigger fired workflow execution', {
                triggerId: trigger.id,
                domainEventId: event.id,
                tenantId: trigger.tenantId,
                workflowId: workflow.id,
                executionId: result.execution.id,
                temporalWorkflowId,
              })
              break
            case 'NOT_EXECUTABLE':
              // Expected for tenant-uploaded workflows until Track A lands —
              // a logged skip, never an error, never blocks the stamp.
              skip('NOT_EXECUTABLE')
              logger.info('Trigger workflow is not executable — skipping', {
                triggerId: trigger.id,
                domainEventId: event.id,
                tenantId: trigger.tenantId,
                workflowId: workflow.id,
                workflowName: workflow.name,
              })
              break
            case 'ALREADY_STARTED':
              // The pre-check raced a concurrent start; Temporal's
              // REJECT_DUPLICATE guarantees the run exists exactly once.
              // Success-already-handled: no FAILED row, log + continue.
              skip('ALREADY_STARTED')
              logger.warn('Temporal already started this (trigger, event) — skipping', {
                triggerId: trigger.id,
                domainEventId: event.id,
                tenantId: trigger.tenantId,
                temporalWorkflowId,
              })
              break
            case 'START_FAILED':
              // The FAILED execution row records the error for the tenant;
              // the event is still stamped (no redelivery — retrying a start
              // that failed cleanly is the operator's call, not the poller's).
              skip('START_FAILED')
              logger.error('Trigger failed to start workflow execution', {
                triggerId: trigger.id,
                domainEventId: event.id,
                tenantId: trigger.tenantId,
                workflowId: workflow.id,
                error: result.message,
              })
              break
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

  await flushMetrics(counts)

  logger.info('Dispatch tick finished', {
    scanned: events.length,
    dispatched: counts.dispatched,
    fired: counts.fired,
  })
  return { scanned: events.length, dispatched: counts.dispatched, fired: counts.fired }
}
