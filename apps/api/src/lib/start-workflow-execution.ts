// ---------------------------------------------------------------------------
// Shared workflow-run path — starts a server-side workflow execution.
//
// Extracted from `POST /workflows/:id/run` (Phase 3 Unit 3) so the trigger
// dispatcher Lambda fires executions through the exact same sequence the
// manual endpoint uses.
//
// Unit 10 (routing + limits) replaces the old curated-only gate with the
// full routing decision and enforces all four v1-blocking abuse limits on the
// TENANT_RUNNER lane:
//
//   1. resolveWorkflowRoute(workflow)          — routing decision (one place)
//   2. TENANT_RUNNER only: concurrency cap     — count before insert, 429 if over
//   3. TENANT_RUNNER only: daily quota         — count before insert, 429 if over
//      (and, before both, Phase 3b.2's namespace check: a DRAINING/REVERTING
//      tenant is refused 409 TENANT_MIGRATING; an ACTIVE one starts in its
//      own namespace, recorded on the row at insert; where namespaces are
//      provisioned, any other tenant is refused 409
//      TENANT_NAMESPACE_PROVISIONING / 503 TENANT_NAMESPACE_UNAVAILABLE, and
//      one with no namespace yet gets it requested)
//   4. ensureTenantRunner (per-tenant runner)  — kick off before Temporal start
//   5. lazy runtime-service-account mint       — same transaction as insert
//   6. insert the QUEUED WorkflowExecution row with provenance
//   7. Temporal `workflow.start` with REJECT_DUPLICATE
//      - STDLIB: stdlib task queue (unchanged Phase-2 behavior)
//      - TENANT_RUNNER: per-tenant queue + workflowExecutionTimeout
//      - TENANT_RUNNER, kind WORKFLOW (Phase 3c): the workflow's own queue,
//        maxLifetimeDays, and a version pin to this exact row (see below)
//   8. eager QUEUED → RUNNING on success / FAILED on Temporal start error
//
// Callers own everything around this sequence: authz, validation, and HTTP
// response shapes (the manual handler); event/trigger matching and dispatch
// stamping (the dispatcher Lambda). Results are returned as a discriminated
// union — this module never throws for the outcomes it models.
//
// ## Limit scope — TENANT_RUNNER only
//
// Resolved decision #3 scopes all four limits to the TENANT_RUNNER lane
// exclusively. The curated stdlib lane (STDLIB route) keeps running exactly
// as before Unit 10: no concurrency cap, no daily quota, no per-execution
// Temporal timeout set here. This is the literal "the curated stdlib keeps
// running exactly as today" commitment in the plan.
//
// ## Concurrency cap race posture (documented contract)
//
// The cap check (count QUEUED+RUNNING) is done OUTSIDE the insert transaction,
// so two concurrent starts for the same tenant can both pass the check and
// both insert — briefly overshooting the cap by 1. This is accepted for v1:
// the cap is a soft abuse guardrail, not a hard resource lock. Adding a
// serialization (SELECT FOR UPDATE / advisory lock) would hurt the common case
// for a rare edge. Document this in the result type.
//
// ## Daily quota race posture
//
// Same as concurrency: two concurrent starts can both pass the quota check
// and both increment the day counter, briefly overshooting by 1. Accepted.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { PrismaClient, Prisma } from '@prisma/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { createApiClientRepository } from '../repositories/api-client.repository'
import { createWorkflowRepository } from '../repositories/workflow.repository'
import type { WorkflowRow } from '../repositories/workflow.repository'
import { createWorkflowExecutionRepository } from '../repositories/workflow-execution.repository'
import type { WorkflowExecutionRow } from '../repositories/workflow-execution.repository'
import { encryptRuntimeToken } from './runtime-token-crypto'
import {
  createTenantTemporalNamespaceRepository,
  MIGRATING_STATUSES,
} from '../repositories/tenant-temporal-namespace.repository'
import { temporalTaskQueue, withTemporalClient } from './temporal-client'
import {
  DEFAULT_MAX_LIFETIME_DAYS,
  resolveWorkflowRoute,
  tenantTaskQueue,
  workflowTaskQueue,
} from './workflow-route'
import { ensureTenantRunner } from './tenant-runner'
import { requestTenantNamespace, tenantNamespacesConfigured } from './tenant-namespace-request'
import { CURATED_WORKFLOW_NAMES } from './curated-workflows'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Constants / env
// ---------------------------------------------------------------------------

/** Platform default per-execution Temporal workflow timeout (seconds). */
const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 900

/**
 * Per-tenant concurrent-execution cap for the TENANT_RUNNER lane.
 * Curated (STDLIB) executions are never counted toward or capped by this.
 */
const TENANT_RUNNER_CONCURRENCY_CAP = 5

/**
 * Per-tenant executions-per-UTC-day quota for the TENANT_RUNNER lane.
 * Defaults to TENANT_WORKFLOW_DAILY_QUOTA env (0/unset → use default).
 * All statuses count — a failed run still consumed resources.
 */
const DEFAULT_DAILY_QUOTA = 200

/**
 * Per-tenant cap on OPEN durable Workflows (Phase 3c), instead of the
 * concurrency cap of 5 that bounds Automations: a Workflow is open for days,
 * mostly waiting, so it doesn't compete for the runner the way a 15-minute
 * Automation does. TENANT_OPEN_WORKFLOW_CAP overrides it (0/unset → default).
 */
const DEFAULT_OPEN_WORKFLOW_CAP = 500

function openWorkflowCap(env: Record<string, string | undefined> = process.env): number {
  const raw = (env['TENANT_OPEN_WORKFLOW_CAP'] ?? '').trim()
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OPEN_WORKFLOW_CAP
}

/**
 * Temporal's refusal of a start pinned to a version no worker has polled yet
 * (FailedPrecondition: "Pinned version '<deployment>:<build>' is not present
 * in task queue ..."). Matched on the message because it is the one stable
 * discriminator the TS client surfaces for it.
 */
const PINNED_VERSION_NOT_REGISTERED = /is not present in task queue/

function isPinnedVersionNotRegistered(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (PINNED_VERSION_NOT_REGISTERED.test(e.message)) return true
  }
  return false
}

function dailyQuotaLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = (env['TENANT_WORKFLOW_DAILY_QUOTA'] ?? '').trim()
  if (!raw) return DEFAULT_DAILY_QUOTA
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_QUOTA
  return n
}

// ---------------------------------------------------------------------------
// CloudWatch metrics (limits)
// ---------------------------------------------------------------------------

// Namespace is duplicated from packages/infra/lib/metrics.ts for the same
// apps/api-can't-import-@pegasus/infra reason as every other emitter.
const METRIC_NAMESPACE = 'Pegasus/Workflows'

const cloudwatch = new CloudWatchClient({})

type RejectionReason =
  | 'CONCURRENCY_LIMIT'
  | 'DAILY_QUOTA_EXCEEDED'
  | 'TENANT_MIGRATING'
  | 'TENANT_NAMESPACE_PROVISIONING'
  | 'TENANT_NAMESPACE_UNAVAILABLE'
  | 'OPEN_WORKFLOW_LIMIT'
  | 'WORKFLOW_VERSION_STARTING'

function isMigratingStatus(status: string): boolean {
  return (MIGRATING_STATUSES as readonly string[]).includes(status)
}

/**
 * Why a TENANT_RUNNER start can't run yet, for a tenant whose namespace row is
 * not ACTIVE (and not migrating). A tenant with no row gets one requested.
 */
async function namespaceNotReadyOutcome(
  db: PrismaClient,
  tenantId: string,
  row: { status: string } | null,
): Promise<'TENANT_NAMESPACE_PROVISIONING' | 'TENANT_NAMESPACE_UNAVAILABLE'> {
  if (!row) {
    const requested = await requestTenantNamespace(db, tenantId, { cause: 'start' })
    return requested.outcome === 'INVOKE_FAILED'
      ? 'TENANT_NAMESPACE_UNAVAILABLE'
      : 'TENANT_NAMESPACE_PROVISIONING'
  }
  return row.status === 'PROVISIONING' || row.status === 'READY'
    ? 'TENANT_NAMESPACE_PROVISIONING'
    : 'TENANT_NAMESPACE_UNAVAILABLE'
}

/**
 * Emits WorkflowExecutionRejected{Reason=<reason>} to CloudWatch.
 * Observability, not correctness — a CloudWatch hiccup never fails the run.
 */
async function emitRejectionMetric(reason: RejectionReason): Promise<void> {
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: [
          {
            MetricName: 'WorkflowExecutionRejected',
            Value: 1,
            Unit: 'Count',
            Timestamp: new Date(),
            Dimensions: [{ Name: 'Reason', Value: reason }],
          },
        ],
      }),
    )
  } catch (err) {
    logger.error('Failed to publish execution-rejected metric', {
      reason,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Who/what started this execution. USER = the manual `POST /:id/run` path;
 * EVENT = the trigger dispatcher's domain-event phase (Phase 3 Unit 3);
 * SCHEDULE = the same dispatcher's cron phase (Unit 4). Both trigger kinds
 * share one shape — only the recorded `triggerSource` differs.
 */
export type StartWorkflowExecutionProvenance =
  | { triggerSource: 'USER'; triggeredByUserId: string }
  | {
      triggerSource: 'EVENT' | 'SCHEDULE'
      triggeredByTriggerId: string
      /**
       * TenantUser.id recorded as creator if a runtime service account must
       * be lazily minted. No user fired this run, so the trigger's creator
       * is the closest accountable principal.
       */
      runtimeAccountCreatedById: string
    }

export type StartWorkflowExecutionOptions = {
  /** The workflow to run — already loaded + visibility-checked by the caller. */
  workflow: WorkflowRow
  /** Tenant the execution belongs to (the caller's tenant, NOT necessarily
   * the workflow's own tenant — GLOBAL workflows run under the caller). */
  tenantId: string
  /** Workflow-defined arbitrary JSON input. Not validated here. */
  input: Record<string, unknown>
  provenance: StartWorkflowExecutionProvenance
  /**
   * Optional caller-supplied Temporal workflow id. When set it is ALSO
   * persisted on the execution row at create time (before the Temporal
   * start) — that pre-start persistence is what makes dispatcher redelivery
   * idempotent: a crash after `workflow.start` but before dispatch stamping
   * leaves a row the dispatcher's pre-check can find. When unset, the
   * manual-run scheme `wf/<tenantId>/<name>/<executionId>` is used and the
   * id is only persisted by markStarted — unchanged Phase 2 behavior.
   */
  temporalWorkflowId?: string
  /**
   * When true, run in DRY-RUN mode: the tenant runner injects a dry-run
   * PegasusClient so reads run live but mutations are captured (never
   * performed), and the execution is tagged `dryRun` end-to-end (Temporal memo
   * + envelope). Only supported on the TENANT_RUNNER lane — the STDLIB lane runs
   * real activities with no interception seam, so a dry-run there is rejected
   * (DRY_RUN_UNSUPPORTED) rather than silently performing side effects. Defaults
   * false. The dispatcher passes a trigger's `dryRun` flag; retry always runs
   * live.
   */
  dryRun?: boolean
  /**
   * Event-routed signals (START triggers): start with Temporal's
   * signal-with-start instead of a plain start — same pin, timeout, memo and
   * reuse policy, plus this signal delivered as the first event. If an
   * instance with `temporalWorkflowId` is already RUNNING, Temporal signals it
   * instead of starting one: the row this call inserted is deleted and the
   * outcome is SIGNALLED_EXISTING (no double row, no quota charge). A CLOSED
   * instance under REJECT_DUPLICATE is not restarted: ALREADY_STARTED, and the
   * inserted row is deleted too. Durable Workflows only (the dispatcher's
   * binding guarantees it).
   */
  startSignal?: { name: string; args: unknown[] }
}

export type StartWorkflowExecutionResult =
  /** Temporal accepted the start; the row is RUNNING. */
  | { outcome: 'STARTED'; execution: WorkflowExecutionRow }
  /** Route was NOT_EXECUTABLE — non-curated + non-executable. Nothing written. */
  | { outcome: 'NOT_EXECUTABLE' }
  /**
   * A dry-run was requested for a workflow that does not run on the tenant
   * runner (STDLIB lane). Dry-run interception lives in the tenant-runner
   * subprocess driver; the curated stdlib worker runs real activities, so a
   * dry-run there could not be made benign. Nothing written or started. The
   * caller maps this to 422 with code DRY_RUN_UNSUPPORTED.
   */
  | { outcome: 'DRY_RUN_UNSUPPORTED' }
  /**
   * Operator kill switch: workflowsDisabled=true on the tenant row. Nothing
   * written or started. Existing RUNNING executions are unaffected (allowed to
   * finish). The caller maps this to 423 Locked with code WORKFLOWS_DISABLED.
   */
  | { outcome: 'WORKFLOWS_DISABLED' }
  /**
   * TENANT_RUNNER: tenant has ≥ TENANT_RUNNER_CONCURRENCY_CAP QUEUED/RUNNING
   * executions. Nothing written or started. See race posture note above.
   */
  | { outcome: 'CONCURRENCY_LIMIT' }
  /**
   * TENANT_RUNNER: tenant has reached the per-UTC-day execution quota. Nothing
   * written or started. See race posture note above.
   */
  | { outcome: 'DAILY_QUOTA_EXCEEDED' }
  /**
   * TENANT_RUNNER: the tenant's Temporal namespace is mid-cutover (DRAINING)
   * or mid-rollback (REVERTING) — Phase 3b.2. Nothing written, no runner
   * launched. Transient (a drain is bounded by the 15-min execution cap); the
   * handler maps this to 409 TENANT_MIGRATING with a retry hint.
   */
  | { outcome: 'TENANT_MIGRATING' }
  /**
   * TENANT_RUNNER: the tenant has no ACTIVE namespace yet and one is being
   * provisioned (requested by this start if it had none). Only where tenant
   * namespaces are provisioned (staging, prod): there is no shared runner to
   * fall back to. Nothing written, no runner launched. Transient (minutes);
   * the handler maps this to 409 TENANT_NAMESPACE_PROVISIONING with a retry
   * hint, and the dispatcher defers the occurrence like TENANT_MIGRATING.
   */
  | { outcome: 'TENANT_NAMESPACE_PROVISIONING' }
  /**
   * TENANT_RUNNER: the tenant's namespace failed to provision (FAILED) or is
   * being deleted (DEPROVISIONING). Not transient on a client's timescale: the
   * dispatcher retries a FAILED row every 15 minutes and an alarm fires. The
   * handler maps this to 503 TENANT_NAMESPACE_UNAVAILABLE; the dispatcher
   * skips the occurrence.
   */
  | { outcome: 'TENANT_NAMESPACE_UNAVAILABLE' }
  /**
   * TENANT_RUNNER, kind WORKFLOW (Phase 3c): the tenant already has the
   * maximum number of OPEN durable Workflows (TENANT_OPEN_WORKFLOW_CAP, 500).
   * Nothing written or started. The handler maps this to 429.
   */
  | { outcome: 'OPEN_WORKFLOW_LIMIT' }
  /**
   * TENANT_RUNNER, kind WORKFLOW (Phase 3c): this published version's worker
   * has not polled yet, so Temporal refuses a start pinned to it (it does,
   * for good, once the worker has polled once). Typical for a minute or two
   * after publish. Nothing started; the inserted QUEUED row is deleted (no
   * execution ever existed). Transient: the handler maps this to 409 with a
   * retry hint; the dispatcher defers an EVENT and skips a SCHEDULE tick.
   */
  | { outcome: 'WORKFLOW_VERSION_STARTING' }
  /**
   * TENANT_RUNNER: the caller tried to directly run a non-curated GLOBAL
   * workflow it does not own (workflow.tenantId !== caller's tenantId). Nothing
   * written or started. The caller must fork the workflow into their own tenant
   * first (`POST /:id/fork`), then run the fork. The handler maps this to 403
   * with code WORKFLOW_MUST_FORK.
   *
   * Curated (STDLIB-routed) GLOBAL workflows are unaffected — they never reach
   * this guard. The platform tenant running its own GLOBAL row is also
   * unaffected (tenantId matches).
   */
  | { outcome: 'MUST_FORK' }
  /**
   * Temporal rejected the start with WorkflowExecutionAlreadyStartedError —
   * a deterministic-id redelivery raced us; the workflow IS running under
   * another execution row. The (orphaned QUEUED) row inserted by this call
   * is returned for logging; it is deliberately NOT marked FAILED.
   * Unreachable on the manual path (fresh-UUID workflow ids).
   */
  | { outcome: 'ALREADY_STARTED'; execution: WorkflowExecutionRow }
  /**
   * `startSignal` only: Temporal already had a RUNNING instance with this id,
   * so signal-with-start signalled it instead of starting one (the DB lagged
   * Temporal: the open row was missing or closed). The row this call inserted
   * was deleted. `existingExecutionId` is the execution row that started the
   * instance (read back from its memo), or null if unknown.
   */
  | { outcome: 'SIGNALLED_EXISTING'; existingExecutionId: string | null }
  /** Temporal start threw; the row was rolled forward to FAILED. */
  | { outcome: 'START_FAILED'; message: string; execution: WorkflowExecutionRow | null }

// ---------------------------------------------------------------------------
// Runtime service-account provisioning
// ---------------------------------------------------------------------------

/**
 * Provisions the per-workflow runtime service account inside an open
 * transaction and persists the KMS-encrypted credential onto the workflow row.
 *
 * Mirrors the api-clients POST / pattern: create a cognito-less service-account
 * TenantUser (it cannot sign in via Cognito), then mint a scoped `vnd_` API key
 * bound to it. The plaintext key is KMS-encrypted via `encryptRuntimeToken` and
 * only the ciphertext + ApiClient.id are stored — the plaintext is discarded
 * here and never logged or returned.
 *
 * Runs in the SAME transaction as the workflow-row insert, so a failure
 * anywhere rolls back the workflow, the service account, and the key together.
 *
 * Returns the workflow row with the runtime columns populated.
 */
export async function provisionRuntimeServiceAccount(
  tx: Prisma.TransactionClient,
  opts: { tenantId: string; workflowId: string; createdById: string },
): Promise<WorkflowRow> {
  const { tenantId, workflowId, createdById } = opts
  // Pre-generate the service-account user id so it can seed the synthetic
  // email (per-tenant unique) without an extra round-trip after insert.
  const serviceAccountId = randomUUID()

  await tx.tenantUser.create({
    data: {
      id: serviceAccountId,
      tenantId,
      email: `svc-${serviceAccountId}@svc.invalid`,
      cognitoSub: null,
      isServiceAccount: true,
      status: 'ACTIVE',
      activatedAt: new Date(),
      roleNames: ['workflow_runtime'],
    },
  })

  const apiClientRepo = createApiClientRepository(tx as PrismaClient)
  // Tenant-scoped clients leave `scopes` empty — the bound service-account
  // user's roleNames drive Cedar authorization.
  const { row, plainKey } = await apiClientRepo.create(
    tenantId,
    `wf-runtime-${workflowId}`,
    [],
    createdById,
    serviceAccountId,
  )

  const ciphertext = await encryptRuntimeToken(plainKey)

  const workflowRepo = createWorkflowRepository(tx as PrismaClient)
  const updated = await workflowRepo.attachRuntimeToken(
    workflowId,
    { runtimeTokenCiphertext: ciphertext, runtimeApiClientId: row.id },
    tx,
  )

  logger.info('Workflow runtime service account provisioned', {
    workflowId,
    tenantId,
    runtimeApiClientId: row.id,
    keyPrefix: row.keyPrefix,
    serviceAccountId,
  })
  return updated
}

// ---------------------------------------------------------------------------
// Limit helpers (TENANT_RUNNER lane only)
// ---------------------------------------------------------------------------

/**
 * The executions that count against the concurrency cap: QUEUED and RUNNING
 * TENANT_RUNNER-lane runs.
 *
 * "TENANT_RUNNER-lane" means the workflow was non-curated + executable.
 * Both conditions are checked explicitly:
 *   - workflow.executable=true   — excludes pre-upload / non-eligible rows
 *   - workflow.name NOT IN (CURATED_WORKFLOW_NAMES) — excludes STDLIB-lane
 *     executions; curated GLOBAL workflows have executable=true after their
 *     own finalize, so omitting this filter would count STDLIB runs against
 *     the TENANT_RUNNER cap (false throttle).
 */
function tenantRunnerActiveWhere(includeDryRuns = false): Prisma.WorkflowExecutionWhereInput {
  return {
    status: { in: ['QUEUED', 'RUNNING'] },
    // A manual dry run never counts against a LIVE start's cap. A
    // trigger-fired dry start counts every run (see the call site).
    ...(includeDryRuns ? {} : { dryRun: false }),
    workflow: {
      executable: true,
      name: { notIn: [...CURATED_WORKFLOW_NAMES] },
      // Durable Workflows (Phase 3c) are open for days and have their own cap
      // (OPEN_WORKFLOW_LIMIT); counting them here would lock a tenant with five
      // open Workflows out of every Automation, and park its events.
      kind: 'AUTOMATION',
    },
  }
}

/** Open durable Workflows for the tenant (Phase 3c), against openWorkflowCap. */
async function countOpenDurableWorkflows(db: PrismaClient, tenantId: string): Promise<number> {
  return db.workflowExecution.count({
    where: {
      tenantId,
      status: { in: ['QUEUED', 'RUNNING'] },
      workflow: { kind: 'WORKFLOW' },
    },
  })
}

/** Count of this tenant's executions counting against the concurrency cap. */
async function countTenantRunnerActiveExecutions(
  db: PrismaClient,
  tenantId: string,
  includeDryRuns = false,
): Promise<number> {
  return db.workflowExecution.count({
    where: { tenantId, ...tenantRunnerActiveWhere(includeDryRuns) },
  })
}

/**
 * Every tenant currently at (or over) the TENANT_RUNNER concurrency cap — one
 * groupBy, same filter as the per-start check. The trigger dispatcher excludes
 * these tenants' young events at its query, so events parked behind the cap
 * never fill its global oldest-first batch (GOTCHAS: "A global oldest-first
 * outbox drain + an infinite park"). Counts LIVE runs only: a tenant at the
 * live cap rejects every runner start, live or dry (a dry trigger's start
 * counts live runs too).
 */
export async function findTenantsAtRunnerConcurrencyCap(db: PrismaClient): Promise<string[]> {
  const rows = await db.workflowExecution.groupBy({
    by: ['tenantId'],
    where: tenantRunnerActiveWhere(),
    _count: { _all: true },
  })
  return rows.filter((r) => r._count._all >= TENANT_RUNNER_CONCURRENCY_CAP).map((r) => r.tenantId)
}

/**
 * UTC-day start for the given date (midnight UTC).
 */
function utcDayStart(now: Date): Date {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Count of this tenant's TENANT_RUNNER-lane executions created today (UTC).
 * All terminal statuses count — a failed run still consumed resources.
 *
 * Same lane filter as countTenantRunnerActiveExecutions: executable=true AND
 * name NOT IN curated names, so STDLIB-lane runs do not consume TENANT_RUNNER
 * daily quota.
 */
async function countTenantRunnerDailyExecutions(
  db: PrismaClient,
  tenantId: string,
  now: Date,
  includeDryRuns = false,
): Promise<number> {
  return db.workflowExecution.count({
    where: {
      tenantId,
      createdAt: { gte: utcDayStart(now) },
      // A manual dry run never consumes a LIVE start's quota. A trigger-fired
      // dry start counts every run (see the call site).
      ...(includeDryRuns ? {} : { dryRun: false }),
      workflow: {
        executable: true,
        name: { notIn: [...CURATED_WORKFLOW_NAMES] },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Starts a server-side execution of `workflow`. See the module header for the
 * full sequence. Key contracts:
 *
 *   - resolveWorkflowRoute determines the lane. NOT_EXECUTABLE → immediate
 *     return, nothing written.
 *   - TENANT_RUNNER lane only: concurrency cap and daily quota are checked
 *     before any write. Both use counts that race — see the module header's
 *     race posture note.
 *   - The runtime token is NOT placed in Temporal workflow args (Temporal
 *     history is durable; a credential there outlives the run). The worker
 *     fetches the token from the broker by `executionId` at activity start.
 *   - REJECT_DUPLICATE makes re-submission of the same Temporal workflow id
 *     an error rather than a second run; for the dispatcher's deterministic
 *     ids that error is mapped to ALREADY_STARTED (success-already-handled).
 *   - workflowExecutionTimeout is set only for TENANT_RUNNER lane: defaults
 *     to DEFAULT_EXECUTION_TIMEOUT_SECONDS; the manifest's timeoutSeconds (if
 *     present and ≤ default) overrides it. Values > 900 are rejected at
 *     finalize (ManifestSchema validation), never silently clamped here.
 */
/** Delete a QUEUED row whose Temporal start never happened; best effort. */
async function deleteNeverStartedRow(db: PrismaClient, executionId: string): Promise<void> {
  await db.workflowExecution
    .deleteMany({ where: { id: executionId, status: 'QUEUED' } })
    .catch((err: unknown) => {
      logger.error('Failed to delete a never-started execution row', {
        executionId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
}

export async function startWorkflowExecution(
  db: PrismaClient,
  opts: StartWorkflowExecutionOptions,
): Promise<StartWorkflowExecutionResult> {
  const { workflow, tenantId, input, provenance } = opts

  const route = resolveWorkflowRoute(workflow)

  if (route === 'NOT_EXECUTABLE') {
    return { outcome: 'NOT_EXECUTABLE' }
  }

  const durable = route === 'TENANT_RUNNER' && workflow.kind === 'WORKFLOW'

  // Dry-run is a TENANT_RUNNER-only capability: interception lives in the
  // subprocess driver. Reject (never silently perform side effects) a dry-run
  // of a curated STDLIB workflow, which runs real activities with no seam —
  // and of a durable Workflow (Phase 3c), which runs on a real Temporal worker,
  // not the one-shot driver the interception lives in.
  if (opts.dryRun && (route !== 'TENANT_RUNNER' || durable)) {
    logger.warn('Dry-run start rejected — workflow does not run on the tenant runner', {
      tenantId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      route,
    })
    return { outcome: 'DRY_RUN_UNSUPPORTED' }
  }

  // ── Kill-switch check — applies to BOTH routes ───────────────────────────
  //
  // Read workflowsDisabled from the Tenant row. This is a cheap indexed
  // primary-key lookup (tenantId is the PK). We do it here — after the route
  // check so pure NOT_EXECUTABLE calls don't hit the DB — and before ANY write
  // or ECS/Temporal interaction, so a disabled tenant never consumes a runner
  // or Temporal start.
  //
  // The check runs for BOTH STDLIB and TENANT_RUNNER routes: the kill switch is
  // an operator-level override that stops ALL new starts for a tenant regardless
  // of workflow type. It does NOT stop already-RUNNING executions.
  {
    const tenantRow = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { workflowsDisabled: true },
    })
    if (tenantRow?.workflowsDisabled === true) {
      logger.warn('Workflow start blocked — tenant workflows disabled', {
        tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
      })
      return { outcome: 'WORKFLOWS_DISABLED' }
    }
  }

  // ── TENANT_RUNNER-only pre-flight checks ──────────────────────────────────
  //
  // All checks happen BEFORE the insert and BEFORE ensureTenantRunner —
  // cheap reads that reject invalid or abusively-frequent callers without
  // touching ECS, Temporal, or the broker.

  /** The tenant namespace this run starts in; null = the shared namespace. */
  let temporalNamespace: string | null = null

  if (route === 'TENANT_RUNNER') {
    // ── Cross-tenant GLOBAL run guard ───────────────────────────────────────
    //
    // A non-curated GLOBAL workflow owned by a different tenant (e.g. the
    // platform tenant) cannot be run directly from a non-owning tenant's queue:
    // the runner discovers artifacts by `tenantId = caller`, so a GLOBAL row
    // owned by another tenant is never registered on the caller's queue →
    // the Temporal workflow strands RUNNING until the 15-min timeout → FAILED
    // with no useful error.
    //
    // Supported path: fork first (`POST /:id/fork` creates a TENANT-owned copy),
    // then run the fork. Fork-then-run routes and discovers correctly.
    //
    // Curated (STDLIB-routed) GLOBAL workflows never reach this guard.
    // The owner running its own GLOBAL row is also unaffected (tenantId matches).
    if (workflow.visibility === 'GLOBAL' && workflow.tenantId !== tenantId) {
      logger.warn('Cross-tenant GLOBAL workflow run rejected — fork required', {
        tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowOwnerTenantId: workflow.tenantId,
      })
      return { outcome: 'MUST_FORK' }
    }

    // ── Tenant namespace (Phase 3b.2) ───────────────────────────────────────
    //
    // A tenant mid-cutover (DRAINING) or mid-rollback (REVERTING) takes no new
    // runner work until its open executions drain — dry runs included, since
    // they run on the runner too. Refused here, BEFORE ensureTenantRunner, so
    // a refused start never launches a runner. A cut-over (ACTIVE) tenant's
    // run goes to its own namespace. Any other state runs in the shared
    // namespace only where tenant namespaces aren't provisioned (local dev,
    // tests); in staging and prod it is refused (below).
    const namespaceRow = await createTenantTemporalNamespaceRepository(db).findByTenant(tenantId)
    if (namespaceRow && isMigratingStatus(namespaceRow.status)) {
      logger.warn('Workflow start refused — tenant Temporal namespace migrating', {
        tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        namespaceStatus: namespaceRow.status,
      })
      await emitRejectionMetric('TENANT_MIGRATING')
      return { outcome: 'TENANT_MIGRATING' }
    }
    if (namespaceRow?.status === 'ACTIVE') {
      temporalNamespace = namespaceRow.namespace
    } else if (tenantNamespacesConfigured()) {
      // No shared runner exists where namespaces are provisioned: a tenant
      // without an ACTIVE namespace can't run yet. One with no row at all
      // gets it requested now (usually publish already did).
      const blocked = await namespaceNotReadyOutcome(db, tenantId, namespaceRow)
      logger.warn('Workflow start refused — tenant Temporal namespace not ready', {
        tenantId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        namespaceStatus: namespaceRow?.status ?? null,
        outcome: blocked,
      })
      await emitRejectionMetric(blocked)
      return { outcome: blocked }
    }

    // A MANUAL dry run is a one-off rehearsal: never capped or quota-limited,
    // and never counted toward either for live starts (the count helpers'
    // dryRun:false filter), so a tenant can always rehearse at the ceiling.
    // A TRIGGER-fired dry run is different — a dry-run trigger on a busy event
    // starts a runner per event — so it is capped like a live start, counting
    // live AND dry runs, and the dispatcher sees CONCURRENCY_LIMIT /
    // DAILY_QUOTA_EXCEEDED for it as for any trigger.
    const manualDryRun = opts.dryRun === true && provenance.triggerSource === 'USER'
    if (durable) {
      // (b') Open-Workflow cap, instead of the Automation concurrency cap.
      const open = await countOpenDurableWorkflows(db, tenantId)
      const cap = openWorkflowCap()
      if (open >= cap) {
        logger.warn('Open durable Workflow cap reached', {
          tenantId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          open,
          cap,
        })
        await emitRejectionMetric('OPEN_WORKFLOW_LIMIT')
        return { outcome: 'OPEN_WORKFLOW_LIMIT' }
      }
    }
    if (!manualDryRun) {
      const now = new Date()
      const includeDryRuns = opts.dryRun === true

      // (b) Concurrency cap — Automations only (a Workflow took (b') above).
      const activeConcurrent = durable
        ? 0
        : await countTenantRunnerActiveExecutions(db, tenantId, includeDryRuns)
      if (activeConcurrent >= TENANT_RUNNER_CONCURRENCY_CAP) {
        logger.warn('TENANT_RUNNER concurrency cap reached', {
          tenantId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          activeConcurrent,
          cap: TENANT_RUNNER_CONCURRENCY_CAP,
        })
        await emitRejectionMetric('CONCURRENCY_LIMIT')
        return { outcome: 'CONCURRENCY_LIMIT' }
      }

      // (c) Daily quota — every TENANT_RUNNER start, durable Workflows
      // included: it bounds starts, which a Workflow still is (Phase 3c).
      const dailyCount = await countTenantRunnerDailyExecutions(db, tenantId, now, includeDryRuns)
      const quota = dailyQuotaLimit()
      if (dailyCount >= quota) {
        logger.warn('TENANT_RUNNER daily quota reached', {
          tenantId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          dailyCount,
          quota,
        })
        await emitRejectionMetric('DAILY_QUOTA_EXCEEDED')
        return { outcome: 'DAILY_QUOTA_EXCEEDED' }
      }
    }
  }

  // Scale-to-zero runner hook (Phase 3 Unit 9). Only reached for TENANT_RUNNER
  // routes (STDLIB was already the only live route until Unit 10). Kick the
  // launch off NOW so the ~30–60 s cold start overlaps the insert + Temporal
  // start below.
  //
  // A failed launch deliberately does NOT fail the run: the execution still
  // starts on its Temporal queue and the dispatcher's per-minute runner
  // sweep (lib/tenant-runner.ts sweepTenantRunners) retries while QUEUED
  // work exists — degraded latency, never a lost run. ensureTenantRunner
  // never throws for the failures it models and logs/metrics internally.
  //
  // Only for a run in the tenant's own namespace: the only runner family
  // polls that namespace (the legacy shared-key runner is retired). A
  // shared-namespace run reaches here only where tenant namespaces aren't
  // provisioned (local dev, tests), and those have no runner plane either.
  if (route === 'TENANT_RUNNER' && temporalNamespace !== null) {
    await ensureTenantRunner(db, tenantId)
  }

  // Single transaction: lazy-mint the runtime account if needed, then
  // insert the QUEUED execution. A failure rolls back both.
  const inserted = await db.$transaction(async (tx) => {
    const txClient = tx as PrismaClient
    if (!workflow.runtimeApiClientId || !workflow.runtimeTokenCiphertext) {
      // Pre-Unit-3 (Phase 2) workflow — provision its runtime account now.
      await provisionRuntimeServiceAccount(tx, {
        tenantId,
        workflowId: workflow.id,
        createdById:
          provenance.triggerSource === 'USER'
            ? provenance.triggeredByUserId
            : provenance.runtimeAccountCreatedById,
      })
    }
    const execRepo = createWorkflowExecutionRepository(txClient)
    return execRepo.create({
      tenantId,
      workflowId: workflow.id,
      triggeredByUserId: provenance.triggerSource === 'USER' ? provenance.triggeredByUserId : null,
      triggerSource: provenance.triggerSource,
      triggeredByTriggerId:
        provenance.triggerSource === 'USER' ? null : provenance.triggeredByTriggerId,
      temporalWorkflowId: opts.temporalWorkflowId ?? null,
      input: input as Prisma.InputJsonValue,
      dryRun: opts.dryRun ?? false,
      // Recorded at insert, before the Temporal start: a row that exists
      // already knows where it lives, so the runner sweep, history, cancel and
      // the reconciler never re-derive it from the tenant's (changing) status.
      temporalNamespace,
    })
  })

  // Derive the Temporal start options based on route.
  const temporalWorkflowId =
    opts.temporalWorkflowId ?? `wf/${tenantId}/${workflow.name}/${inserted.id}`

  // (a) Per-execution workflow timeout — TENANT_RUNNER only.
  // Manifest may provide timeoutSeconds (already validated: 1..900) to lower
  // the default. Never raise it (values > 900 are rejected at finalize).
  let workflowExecutionTimeout: number | undefined
  if (durable) {
    // A durable Workflow lives up to its manifest's maxLifetimeDays (finalize
    // validated 1..365; absent = 90). timeoutSeconds is refused on a Workflow.
    const days = (workflow.manifest as Record<string, unknown>)['maxLifetimeDays']
    workflowExecutionTimeout =
      (typeof days === 'number' ? days : DEFAULT_MAX_LIFETIME_DAYS) * 24 * 60 * 60
  } else if (route === 'TENANT_RUNNER') {
    const manifestTimeout =
      typeof (workflow.manifest as Record<string, unknown>)['timeoutSeconds'] === 'number'
        ? ((workflow.manifest as Record<string, unknown>)['timeoutSeconds'] as number)
        : undefined
    workflowExecutionTimeout =
      manifestTimeout !== undefined
        ? Math.min(manifestTimeout, DEFAULT_EXECUTION_TIMEOUT_SECONDS)
        : DEFAULT_EXECUTION_TIMEOUT_SECONDS
  }

  const taskQueue = durable
    ? workflowTaskQueue(tenantId, workflow.name)
    : route === 'TENANT_RUNNER'
      ? tenantTaskQueue(tenantId)
      : temporalTaskQueue()

  // Durable Workflows (Phase 3c) are PINNED, at start, to this exact
  // published row: Worker Deployment = workflow name, build id =
  // artifactSha256 (the runner's worker for this row polls as exactly that).
  // Postgres decides which version runs — a trigger bound to an older version
  // runs that version — and the execution stays on it for life, even after a
  // newer version is published. No server-side "current version" is used.
  const versioningOverride =
    durable && workflow.artifactSha256
      ? {
          pinnedTo: { deploymentName: workflow.name, buildId: workflow.artifactSha256 },
        }
      : undefined

  // Start the Temporal workflow. If start_workflow throws, mark the
  // execution FAILED with the error so we don't leak QUEUED rows for
  // runtime failures.
  const dryRun = opts.dryRun ?? false
  const target = { tenantId, namespace: temporalNamespace }
  const startOptions = {
    // dryRun rides the envelope so the tenant runner's subprocess driver sees
    // it and injects the dry-run client + trace capture.
    args: [{ executionId: inserted.id, input, dryRun }],
    taskQueue,
    workflowId: temporalWorkflowId,
    // Tag the execution in Temporal so dry-runs are filterable in the Web UI
    // and never mistaken for a real run. `executionId` names the row that
    // started the instance — how a signal-with-start tells "started" from
    // "signalled an instance that was already running".
    memo: { dryRun, executionId: inserted.id },
    // Idempotent re-submit: if a previous call already started this id,
    // we'd rather error here than start a second run.
    workflowIdReusePolicy: 'REJECT_DUPLICATE' as const,
    // (a) Timeout — TENANT_RUNNER only (undefined = Temporal default for STDLIB)
    ...(workflowExecutionTimeout !== undefined
      ? { workflowExecutionTimeout: `${workflowExecutionTimeout}s` }
      : {}),
    ...(versioningOverride ? { versioningOverride } : {}),
  }
  try {
    let startedRunId: string
    const startSignal = opts.startSignal
    if (startSignal) {
      const handle = await withTemporalClient(target, (client) =>
        client.workflow.signalWithStart(workflow.name, {
          ...startOptions,
          signal: startSignal.name,
          signalArgs: startSignal.args,
        }),
      )
      // signal-with-start signals a RUNNING instance regardless of the reuse
      // policy and reports no "started" flag, so ask the instance which row
      // started it. A failed describe keeps the row (worst case two rows on
      // one instance, both closed by the reconciler) — never a lost delivery.
      let startedBy: unknown = inserted.id
      try {
        const description = await withTemporalClient(target, (client) =>
          client.workflow.getHandle(temporalWorkflowId).describe(),
        )
        startedBy = description.memo?.['executionId']
      } catch (describeErr) {
        logger.warn('Signal-with-start: describe failed — keeping the new row', {
          executionId: inserted.id,
          temporalWorkflowId,
          error: describeErr instanceof Error ? describeErr.message : String(describeErr),
        })
      }
      if (startedBy !== inserted.id) {
        await deleteNeverStartedRow(db, inserted.id)
        logger.warn('Signal-with-start signalled an instance that was already running', {
          workflowId: workflow.id,
          tenantId,
          temporalWorkflowId,
          existingExecutionId: typeof startedBy === 'string' ? startedBy : null,
        })
        return {
          outcome: 'SIGNALLED_EXISTING',
          existingExecutionId: typeof startedBy === 'string' ? startedBy : null,
        }
      }
      // A new instance: the signalled run IS its first run.
      startedRunId = handle.signaledRunId
    } else {
      const handle = await withTemporalClient(target, (client) =>
        client.workflow.start(workflow.name, startOptions),
      )
      startedRunId = handle.firstExecutionRunId ?? ''
    }

    // Eagerly transition QUEUED → RUNNING so the row reflects reality
    // before the worker write-back lands. The worker's PATCH will be a
    // RUNNING-self update (idempotent) once it sees the activity.
    const execRepo = createWorkflowExecutionRepository(db)
    const running = await execRepo.markStarted(inserted.id, {
      temporalWorkflowId,
      temporalRunId: startedRunId,
      startedAt: new Date(),
    })

    logger.info('Workflow execution started', {
      executionId: inserted.id,
      workflowId: workflow.id,
      tenantId,
      route,
      taskQueue,
      temporalWorkflowId,
      temporalRunId: startedRunId || null,
      workflowExecutionTimeout: workflowExecutionTimeout ?? null,
      ...(startSignal ? { startSignal: startSignal.name } : {}),
    })

    return { outcome: 'STARTED', execution: running }
  } catch (err) {
    // REJECT_DUPLICATE fired: the deterministic-id pre-check raced a
    // concurrent dispatch — the workflow is already running under another
    // execution row. Success-already-handled: leave the (orphaned QUEUED)
    // row alone rather than mark it FAILED for a run that IS in flight.
    // instanceof is safe across package copies — the Temporal SDK uses
    // Symbol.hasInstance-based identification for its error classes.
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      // Signal-with-start: a RUNNING instance would have been signalled, so
      // this is a CLOSED one under REJECT_DUPLICATE — the key is not restarted.
      // Unlike a plain start, no other row tracks a live run here, and a
      // QUEUED row with this keyed id would be found as "the open instance" by
      // every later event: delete it.
      if (opts.startSignal) await deleteNeverStartedRow(db, inserted.id)
      logger.warn('Temporal workflow already started — treating as already handled', {
        executionId: inserted.id,
        workflowId: workflow.id,
        tenantId,
        temporalWorkflowId,
      })
      return { outcome: 'ALREADY_STARTED', execution: inserted }
    }

    // A durable Workflow version no worker has polled yet (Phase 3c): nothing
    // was started, so the QUEUED row describes an execution that never
    // existed — delete it rather than record a failure. The runner was
    // already launched above and registers the version within a minute or
    // two; the caller retries.
    if (durable && isPinnedVersionNotRegistered(err)) {
      // deleteMany on (id, QUEUED): idempotent, and it can never remove a row
      // that somehow started. If it fails, the row must still be CLOSED: a
      // stranded QUEUED row is never reconciled, and it would hold an open-
      // Workflow slot, keep the runner sweep demanding a runner, and keep the
      // runner's idle hold on — for an execution that never existed.
      const removed = await db.workflowExecution
        .deleteMany({ where: { id: inserted.id, status: 'QUEUED' } })
        .catch((deleteErr: unknown) => {
          logger.error('Failed to delete a never-started durable workflow row', {
            executionId: inserted.id,
            error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
          })
          return null
        })
      if (removed === null) {
        await createWorkflowExecutionRepository(db)
          .markTerminal(inserted.id, {
            status: 'FAILED',
            errorMessage:
              'Not started: this Workflow version was just published and its worker was not ready yet. Run it again.',
            finishedAt: new Date(),
          })
          .catch(() => null)
      }
      logger.warn('Durable workflow version not registered yet — start deferred', {
        workflowId: workflow.id,
        workflowName: workflow.name,
        tenantId,
        buildId: workflow.artifactSha256,
      })
      await emitRejectionMetric('WORKFLOW_VERSION_STARTING')
      return { outcome: 'WORKFLOW_VERSION_STARTING' }
    }

    // Roll the QUEUED row forward to FAILED so the operator + caller see
    // the runtime failure cleanly. No transaction here — these are two
    // independent failure surfaces (Temporal vs DB).
    const message = err instanceof Error ? err.message : String(err)
    const execRepo = createWorkflowExecutionRepository(db)
    const failed = await execRepo
      .markTerminal(inserted.id, {
        status: 'FAILED',
        errorMessage: `Temporal start_workflow failed: ${message}`,
        finishedAt: new Date(),
      })
      .catch(() => null)

    logger.error('Workflow execution start failed', {
      executionId: inserted.id,
      workflowId: workflow.id,
      tenantId,
      route,
      error: message,
    })

    return { outcome: 'START_FAILED', message, execution: failed }
  }
}
