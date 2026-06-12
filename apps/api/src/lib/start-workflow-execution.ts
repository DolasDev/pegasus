// ---------------------------------------------------------------------------
// Shared workflow-run path — starts a server-side workflow execution.
//
// Extracted from `POST /workflows/:id/run` (Phase 3 Unit 3) so the trigger
// dispatcher Lambda fires executions through the exact same sequence the
// manual endpoint uses:
//
//   1. curated-executability gate (CURATED_WORKFLOW_NAMES)
//   2. lazy runtime-service-account mint when the workflow predates Phase 2
//      Unit 3 (same transaction as the execution insert)
//   3. insert the QUEUED WorkflowExecution row with provenance
//   4. Temporal `workflow.start` with REJECT_DUPLICATE
//   5. eager QUEUED → RUNNING on success / FAILED on Temporal start error
//
// Callers own everything around this sequence: authz, validation, and HTTP
// response shapes (the manual handler); event/trigger matching and dispatch
// stamping (the dispatcher Lambda). Results are returned as a discriminated
// union — this module never throws for the outcomes it models.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { createApiClientRepository } from '../repositories/api-client.repository'
import { createWorkflowRepository } from '../repositories/workflow.repository'
import type { WorkflowRow } from '../repositories/workflow.repository'
import { createWorkflowExecutionRepository } from '../repositories/workflow-execution.repository'
import type { WorkflowExecutionRow } from '../repositories/workflow-execution.repository'
import { encryptRuntimeToken } from './runtime-token-crypto'
import { getTemporalClient, temporalTaskQueue } from './temporal-client'
import { CURATED_WORKFLOW_NAMES } from './curated-workflows'
import { ensureTenantRunner, executionNeedsTenantRunner } from './tenant-runner'
import { logger } from './logger'

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
}

export type StartWorkflowExecutionResult =
  /** Temporal accepted the start; the row is RUNNING. */
  | { outcome: 'STARTED'; execution: WorkflowExecutionRow }
  /** Curated-allowlist gate: nothing was written or started. */
  | { outcome: 'NOT_EXECUTABLE' }
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
// Start
// ---------------------------------------------------------------------------

/**
 * Starts a server-side execution of `workflow`. See the module header for the
 * exact sequence. Phase-2 contract notes (unchanged by the extraction):
 *
 *   - Only curated names (CURATED_WORKFLOW_NAMES) are executable. The worker
 *     refuses to register anything else, so we bail here for a clean error
 *     story instead of letting the row sit QUEUED forever.
 *   - The runtime token is NOT placed in Temporal workflow args (Temporal
 *     history is durable; a credential there outlives the run). The worker
 *     fetches the token from the broker by `executionId` at activity start.
 *   - REJECT_DUPLICATE makes re-submission of the same Temporal workflow id
 *     an error rather than a second run; for the dispatcher's deterministic
 *     ids that error is mapped to ALREADY_STARTED (success-already-handled).
 */
export async function startWorkflowExecution(
  db: PrismaClient,
  opts: StartWorkflowExecutionOptions,
): Promise<StartWorkflowExecutionResult> {
  const { workflow, tenantId, input, provenance } = opts

  if (!CURATED_WORKFLOW_NAMES.has(workflow.name)) {
    return { outcome: 'NOT_EXECUTABLE' }
  }

  // Scale-to-zero runner hook (Phase 3 Unit 9). For executions that will
  // route to a per-tenant runner task, kick the launch off NOW so the
  // ~30–60 s cold start overlaps the insert + Temporal start below.
  //
  // INERT TODAY by construction: executionNeedsTenantRunner is the exact
  // complement of the curated gate that just passed above, so this branch
  // cannot be taken until Unit 10 replaces both with the real routing
  // decision. It is wired (and tested) now so flipping the criterion is the
  // only change Unit 10 needs on this path.
  //
  // A failed launch deliberately does NOT fail the run: the execution still
  // starts on its Temporal queue and the dispatcher's per-minute runner
  // sweep (lib/tenant-runner.ts sweepTenantRunners) retries while QUEUED
  // work exists — degraded latency, never a lost run. ensureTenantRunner
  // never throws for the failures it models and logs/metrics internally.
  if (executionNeedsTenantRunner(workflow)) {
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
    })
  })

  // Start the Temporal workflow. If start_workflow throws, mark the
  // execution FAILED with the error so we don't leak QUEUED rows for
  // runtime failures.
  const temporalWorkflowId =
    opts.temporalWorkflowId ?? `wf/${tenantId}/${workflow.name}/${inserted.id}`
  try {
    const client = await getTemporalClient()
    const handle = await client.workflow.start(workflow.name, {
      args: [{ executionId: inserted.id, input }],
      taskQueue: temporalTaskQueue(),
      workflowId: temporalWorkflowId,
      // Idempotent re-submit: if a previous call already started this id,
      // we'd rather error here than start a second run.
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
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
      temporalWorkflowId: handle.workflowId,
      temporalRunId: handle.firstExecutionRunId ?? null,
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
      error: message,
    })

    return { outcome: 'START_FAILED', message, execution: failed }
  }
}
