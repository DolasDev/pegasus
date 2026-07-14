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
//   4. ensureTenantRunner (per-tenant runner)  — kick off before Temporal start
//   5. lazy runtime-service-account mint       — same transaction as insert
//   6. insert the QUEUED WorkflowExecution row with provenance
//   7. Temporal `workflow.start` with REJECT_DUPLICATE
//      - STDLIB: stdlib task queue (unchanged Phase-2 behavior)
//      - TENANT_RUNNER: per-tenant queue + workflowExecutionTimeout
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
import { getTemporalClient, temporalTaskQueue } from './temporal-client'
import { resolveWorkflowRoute, tenantTaskQueue } from './workflow-route'
import { ensureTenantRunner } from './tenant-runner'
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

type RejectionReason = 'CONCURRENCY_LIMIT' | 'DAILY_QUOTA_EXCEEDED'

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
   * false. Not threaded through retry/dispatcher — those always run live.
   */
  dryRun?: boolean
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
 * Count of this tenant's QUEUED and RUNNING TENANT_RUNNER-lane executions.
 *
 * "TENANT_RUNNER-lane" means the workflow was non-curated + executable.
 * Both conditions are checked explicitly:
 *   - workflow.executable=true   — excludes pre-upload / non-eligible rows
 *   - workflow.name NOT IN (CURATED_WORKFLOW_NAMES) — excludes STDLIB-lane
 *     executions; curated GLOBAL workflows have executable=true after their
 *     own finalize, so omitting this filter would count STDLIB runs against
 *     the TENANT_RUNNER cap (false throttle).
 */
async function countTenantRunnerActiveExecutions(
  db: PrismaClient,
  tenantId: string,
): Promise<number> {
  return db.workflowExecution.count({
    where: {
      tenantId,
      status: { in: ['QUEUED', 'RUNNING'] },
      // Dry-runs are benign rehearsals and never count against the cap.
      dryRun: false,
      workflow: {
        executable: true,
        name: { notIn: [...CURATED_WORKFLOW_NAMES] },
      },
    },
  })
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
): Promise<number> {
  return db.workflowExecution.count({
    where: {
      tenantId,
      createdAt: { gte: utcDayStart(now) },
      // Dry-runs are benign rehearsals and never consume daily quota.
      dryRun: false,
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
export async function startWorkflowExecution(
  db: PrismaClient,
  opts: StartWorkflowExecutionOptions,
): Promise<StartWorkflowExecutionResult> {
  const { workflow, tenantId, input, provenance } = opts

  const route = resolveWorkflowRoute(workflow)

  if (route === 'NOT_EXECUTABLE') {
    return { outcome: 'NOT_EXECUTABLE' }
  }

  // Dry-run is a TENANT_RUNNER-only capability: interception lives in the
  // subprocess driver. Reject (never silently perform side effects) a dry-run
  // of a curated STDLIB workflow, which runs real activities with no seam.
  if (opts.dryRun && route !== 'TENANT_RUNNER') {
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

    // Dry-runs are benign rehearsals: never capped or quota-limited (and they
    // don't count toward either — see the count helpers' dryRun:false filter),
    // so a tenant can always rehearse even at the real-run ceiling.
    if (!opts.dryRun) {
      const now = new Date()

      // (b) Concurrency cap
      const activeConcurrent = await countTenantRunnerActiveExecutions(db, tenantId)
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

      // (c) Daily quota
      const dailyCount = await countTenantRunnerDailyExecutions(db, tenantId, now)
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
  if (route === 'TENANT_RUNNER') {
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
    })
  })

  // Derive the Temporal start options based on route.
  const temporalWorkflowId =
    opts.temporalWorkflowId ?? `wf/${tenantId}/${workflow.name}/${inserted.id}`

  // (a) Per-execution workflow timeout — TENANT_RUNNER only.
  // Manifest may provide timeoutSeconds (already validated: 1..900) to lower
  // the default. Never raise it (values > 900 are rejected at finalize).
  let workflowExecutionTimeout: number | undefined
  if (route === 'TENANT_RUNNER') {
    const manifestTimeout =
      typeof (workflow.manifest as Record<string, unknown>)['timeoutSeconds'] === 'number'
        ? ((workflow.manifest as Record<string, unknown>)['timeoutSeconds'] as number)
        : undefined
    workflowExecutionTimeout =
      manifestTimeout !== undefined
        ? Math.min(manifestTimeout, DEFAULT_EXECUTION_TIMEOUT_SECONDS)
        : DEFAULT_EXECUTION_TIMEOUT_SECONDS
  }

  const taskQueue = route === 'TENANT_RUNNER' ? tenantTaskQueue(tenantId) : temporalTaskQueue()

  // Start the Temporal workflow. If start_workflow throws, mark the
  // execution FAILED with the error so we don't leak QUEUED rows for
  // runtime failures.
  const dryRun = opts.dryRun ?? false
  try {
    const client = await getTemporalClient()
    const handle = await client.workflow.start(workflow.name, {
      // dryRun rides the envelope so the tenant runner's subprocess driver sees
      // it and injects the dry-run client + trace capture.
      args: [{ executionId: inserted.id, input, dryRun }],
      taskQueue,
      workflowId: temporalWorkflowId,
      // Tag the execution in Temporal so dry-runs are filterable in the Web UI
      // and never mistaken for a real run.
      memo: { dryRun },
      // Idempotent re-submit: if a previous call already started this id,
      // we'd rather error here than start a second run.
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      // (a) Timeout — TENANT_RUNNER only (undefined = Temporal default for STDLIB)
      ...(workflowExecutionTimeout !== undefined
        ? { workflowExecutionTimeout: `${workflowExecutionTimeout}s` }
        : {}),
    })

    // Eagerly transition QUEUED → RUNNING so the row reflects reality
    // before the worker write-back lands. The worker's PATCH will be a
    // RUNNING-self update (idempotent) once it sees the activity.
    const execRepo = createWorkflowExecutionRepository(db)
    const running = await execRepo.markStarted(inserted.id, {
      temporalWorkflowId: handle.workflowId,
      temporalRunId: handle.firstExecutionRunId ?? '',
      startedAt: new Date(),
    })

    logger.info('Workflow execution started', {
      executionId: inserted.id,
      workflowId: workflow.id,
      tenantId,
      route,
      taskQueue,
      temporalWorkflowId: handle.workflowId,
      temporalRunId: handle.firstExecutionRunId ?? null,
      workflowExecutionTimeout: workflowExecutionTimeout ?? null,
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
      logger.warn('Temporal workflow already started — treating as already handled', {
        executionId: inserted.id,
        workflowId: workflow.id,
        tenantId,
        temporalWorkflowId,
      })
      return { outcome: 'ALREADY_STARTED', execution: inserted }
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
