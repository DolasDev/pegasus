// ---------------------------------------------------------------------------
// /api/v1/automation-steps — a durable Workflow runs an Automation as a step
// (the SDK's `run_automation()`; plan: plans/completed/df49a7ef-workflow-automation-steps.md).
//
//   POST /                       start (idempotent on the calling activity)
//   GET  /:executionId           poll: status / result / errorMessage
//   POST /:executionId/cancel    the Workflow cancelled the step
//
// Called only by the `pegasus.run_automation` activity, on the Workflow's own
// `vnd_` runtime token. Every route needs RunAutomationStep (granted to
// workflow_runtime) AND — enforced here, invisible to Cedar — a CALLER whose
// token belongs to a WORKFLOW-kind row. An Automation's token passes Cedar and
// is refused below, so Automations still can't start each other, and a step's
// target must itself be an Automation, so Workflows can't start Workflows.
//
// The start goes through startWorkflowExecution like any other run: same
// concurrency cap, daily quota, kill switch, namespace states and outcome →
// HTTP mapping as POST /workflows/:id/run (the SDK retries the "not now"
// ones). Through the API and not as a Temporal child workflow because only
// the API path writes the execution row, mints the runtime token and applies
// those limits.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { compareSemver } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { createWorkflowRepository, type WorkflowRow } from '../repositories/workflow.repository'
import { createWorkflowExecutionRepository } from '../repositories/workflow-execution.repository'
import { startWorkflowExecution } from '../lib/start-workflow-execution'
import { logger } from '../lib/logger'
import {
  NAME_REGEX,
  VERSION_REGEX,
  requestCancelResponse,
  startResultToResponse,
  toExecutionResponse,
} from './workflows'

/** Bounds the ids that make up the step key (a Temporal id is ≤ 1000 bytes
 * in practice; ours are far shorter). */
const ID_PART = z.string().min(1).max(512)

const StartBody = z
  .object({
    automation: z.string().regex(NAME_REGEX),
    version: z.string().regex(VERSION_REGEX).optional(),
    input: z.record(z.string(), z.unknown()).optional().default({}),
    parentTemporalWorkflowId: ID_PART,
    parentTemporalRunId: ID_PART,
    activityId: ID_PART,
  })
  .strict()

export const automationStepsHandler = new Hono<AppEnv>()

automationStepsHandler.use('*', dualAuthMiddleware)

/**
 * The durable Workflow row the calling runtime token belongs to, or a 403.
 * A human (Cognito) caller and an Automation's token are both refused.
 */
async function loadCallerWorkflow(
  c: Context<AppEnv>,
): Promise<{ ok: true; caller: WorkflowRow } | { ok: false; response: Response }> {
  const tenantId = c.get('tenantId')
  const apiClientId = c.get('apiClient')?.id
  const caller =
    tenantId && apiClientId
      ? await createWorkflowRepository(c.get('db')).findByRuntimeApiClientId(apiClientId, tenantId)
      : null
  if (!caller || caller.kind !== 'WORKFLOW') {
    return {
      ok: false,
      response: c.json(
        {
          error: 'Only a durable Workflow can run an Automation as a step (run_automation).',
          code: 'STEP_CALLER_NOT_WORKFLOW',
        },
        403,
      ),
    }
  }
  return { ok: true, caller }
}

/**
 * Pick the Automation a step names. Among the matching Automations (`version`
 * pins exactly), the tenant's own rows win over GLOBAL ones (a fork shadows
 * its original), and a bare name takes the newest ACTIVE version (semver,
 * upload time breaking ties) — decided per call, so an Automation published
 * mid-Workflow is used by the Workflow's later steps. Only Automations shadow:
 * an own durable Workflow of the same name doesn't hide a GLOBAL Automation.
 */
function resolveTarget(
  candidates: WorkflowRow[],
  tenantId: string,
  version: string | undefined,
):
  | { ok: true; target: WorkflowRow }
  | { ok: false; code: 'AUTOMATION_NOT_FOUND' | 'STEP_TARGET_NOT_AUTOMATION' } {
  const matching = candidates.filter((w) => version === undefined || w.version === version)
  const automations = matching.filter((w) => w.kind === 'AUTOMATION')
  if (automations.length === 0) {
    return {
      ok: false,
      code: matching.length > 0 ? 'STEP_TARGET_NOT_AUTOMATION' : 'AUTOMATION_NOT_FOUND',
    }
  }
  const own = automations.filter((w) => w.tenantId === tenantId)
  const newest = (own.length > 0 ? own : automations).reduce((best, w) => {
    const bySemver = compareSemver(w.version, best.version)
    if (bySemver !== 0) return bySemver > 0 ? w : best
    return w.createdAt > best.createdAt ? w : best
  })
  return { ok: true, target: newest }
}

/** A step this caller started (its parent row is one of the caller's
 * executions), or null — not found and not yours are indistinguishable. */
async function loadOwnStep(c: Context<AppEnv>, caller: WorkflowRow) {
  const db = c.get('db')
  const execRepo = createWorkflowExecutionRepository(db)
  const step = await execRepo.findById(c.req.param('executionId') ?? '')
  if (!step || step.triggerSource !== 'WORKFLOW' || !step.parentExecutionId) return null
  const parent = await execRepo.findById(step.parentExecutionId)
  if (!parent || parent.workflowId !== caller.id) return null
  return step
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// ---------------------------------------------------------------------------
// POST / — start a step, or return the one this activity already started.
//
// Response: 201 (started) | 200 (step-key replay: the existing row, whatever
// its status) | 400 | 403 STEP_CALLER_NOT_WORKFLOW | 404 PARENT_NOT_OPEN /
// AUTOMATION_NOT_FOUND | 422 STEP_TARGET_NOT_AUTOMATION | the /run surface
// (423 WORKFLOWS_DISABLED, 429 CONCURRENCY_LIMIT / DAILY_QUOTA_EXCEEDED,
// 409 TENANT_MIGRATING / TENANT_NAMESPACE_PROVISIONING, 503, 502, …).
// ---------------------------------------------------------------------------
automationStepsHandler.post(
  '/',
  requirePermission(Actions.RunAutomationStep),
  validator('json', (value, c) => {
    const r = StartBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const loaded = await loadCallerWorkflow(c)
    if (!loaded.ok) return loaded.response
    const { caller } = loaded
    const tenantId = c.get('tenantId') as string
    const db = c.get('db')
    const body = c.req.valid('json')
    const execRepo = createWorkflowExecutionRepository(db)

    // The parent must be an OPEN instance of the caller's own Workflow: a
    // token can't start steps for another Workflow, or for a closed one.
    const parent = await db.workflowExecution.findFirst({
      where: {
        tenantId,
        temporalWorkflowId: body.parentTemporalWorkflowId,
        workflowId: caller.id,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: { id: true },
    })
    if (!parent) {
      return c.json(
        {
          error: `No open execution of Workflow "${caller.name}" has Temporal id ${body.parentTemporalWorkflowId}`,
          code: 'PARENT_NOT_OPEN',
        },
        404,
      )
    }

    const stepKey = `${body.parentTemporalWorkflowId}/${body.parentTemporalRunId}/${body.activityId}`
    const existing = await execRepo.findByStepKey(stepKey)
    if (existing) return c.json({ data: toExecutionResponse(existing) }, 200)

    const candidates = await createWorkflowRepository(db).listActiveByNameForTenant(
      body.automation,
      tenantId,
    )
    const resolved = resolveTarget(candidates, tenantId, body.version)
    if (!resolved.ok) {
      const label = body.version ? `${body.automation}@${body.version}` : body.automation
      return resolved.code === 'AUTOMATION_NOT_FOUND'
        ? c.json({ error: `No active Automation "${label}"`, code: resolved.code }, 404)
        : c.json(
            {
              error: `"${label}" is a durable Workflow; a step must be an Automation`,
              code: resolved.code,
            },
            422,
          )
    }

    let result: Awaited<ReturnType<typeof startWorkflowExecution>>
    try {
      result = await startWorkflowExecution(db, {
        workflow: resolved.target,
        tenantId,
        input: body.input,
        provenance: {
          triggerSource: 'WORKFLOW',
          parentExecutionId: parent.id,
          stepKey,
          runtimeAccountCreatedById: caller.createdByUserId,
        },
      })
    } catch (err) {
      // Two attempts of one activity raced: the loser reads the winner's row.
      if (!isUniqueViolation(err)) throw err
      const winner = await execRepo.findByStepKey(stepKey)
      if (winner) return c.json({ data: toExecutionResponse(winner) }, 200)
      // The winner's Temporal start failed and released the key in between:
      // nothing is running, so ask the activity to retry (it retries 5xx).
      c.header('Retry-After', '5')
      return c.json(
        { error: 'A concurrent attempt of this step just failed; retry', code: 'STEP_START_RACE' },
        503,
      )
    }

    if (result.outcome === 'START_FAILED' && result.execution) {
      // Temporal refused the start: keep the FAILED row for the record, but
      // free its key so the activity's retry starts afresh instead of reading
      // this failure back as the step's outcome.
      await execRepo.releaseStepKey(result.execution.id)
    }
    if (result.outcome === 'STARTED') {
      logger.info('Automation step started', {
        tenantId,
        parentExecutionId: parent.id,
        callerWorkflowId: caller.id,
        executionId: result.execution.id,
        automation: resolved.target.name,
        version: resolved.target.version,
      })
    }
    return startResultToResponse(c, resolved.target.name, result)
  },
)

// GET /:executionId — the step's current row (status, result, errorMessage).
automationStepsHandler.get(
  '/:executionId',
  requirePermission(Actions.RunAutomationStep),
  async (c) => {
    const loaded = await loadCallerWorkflow(c)
    if (!loaded.ok) return loaded.response
    const step = await loadOwnStep(c, loaded.caller)
    if (!step) return c.json({ error: 'Step not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data: toExecutionResponse(step) })
  },
)

// POST /:executionId/cancel — 202 | 404 | 409 EXECUTION_NOT_CANCELLABLE | 502.
automationStepsHandler.post(
  '/:executionId/cancel',
  requirePermission(Actions.RunAutomationStep),
  async (c) => {
    const loaded = await loadCallerWorkflow(c)
    if (!loaded.ok) return loaded.response
    const step = await loadOwnStep(c, loaded.caller)
    if (!step) return c.json({ error: 'Step not found', code: 'NOT_FOUND' }, 404)
    return requestCancelResponse(c, step.workflowId, step)
  },
)
