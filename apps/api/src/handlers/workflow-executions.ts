// ---------------------------------------------------------------------------
// /api/v1/workflow-executions — executions by id alone, tenant-wide.
// (plan: plans/in-progress/workflow-instance-surfaces.md)
//
//   GET  /                         list (default: OPEN durable Workflows, every version)
//   GET  /:executionId             one execution + its Workflow's declared signals/queries
//   POST /:executionId/query       run a declared @workflow.query on an open Workflow
//   POST /:executionId/cancel      cooperative cancel (same as /workflows/:id/executions/:eid/cancel)
//   POST /:executionId/terminate   forcible end; also cancels the Workflow's open steps
//
// /workflows/:id/executions is scoped to ONE version row; an open durable
// Workflow's instances span every version of its name, and the tenant UI needs
// to open an execution it knows only by id (a step's parentExecutionId). So
// these live on their own mount, like automation-steps, clear of /workflows/:id.
//
// Every route is tenant-scoped in the handler (another tenant's row is a 404,
// never a 403). The kill switch gates none of them: reads are reads, and
// cancel / terminate close things — what an operator flipping it wants
// (DECIDE-4 already lets signals reach open Workflows under the switch).
// Nothing here is granted to workflow_runtime: a Workflow can't query or
// terminate Workflows.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { isGrpcServiceError } from '@temporalio/client'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { createWorkflowRepository, type WorkflowRow } from '../repositories/workflow.repository'
import {
  createWorkflowExecutionRepository,
  TERMINAL_STATUSES,
  type WorkflowExecutionRow,
} from '../repositories/workflow-execution.repository'
import { TenantTemporalKeyUnavailableError, withTemporalClient } from '../lib/temporal-client'
import { executionHandle } from '../lib/workflow-execution-handle'
import { declaredQueries, declaredSignals } from '../lib/signal-workflow-execution'
import {
  CORRELATION_KEY_REGEX,
  correlatedTemporalWorkflowId,
  correlationKeyOf,
} from '../lib/workflow-signal-routing'
import { ensureTenantRunner } from '../lib/tenant-runner'
import { logger } from '../lib/logger'
import {
  NAME_REGEX,
  SIGNAL_NAME_REGEX,
  requestCancelResponse,
  toExecutionResponse,
  type WorkflowExecutionResponse,
} from './workflows'

const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 200

/** How long a query may wait for a worker. A missing poller is NOT reported
 * fast: Temporal holds the query ~29 s before "no poller seen" (probed
 * 2026-11-14, GOTCHAS.md), which would outlive API Gateway's 29 s. */
export const QUERY_DEADLINE_MS = 8_000
/** A cold runner takes 30–60 s; the SDK retries 503 on this hint. */
export const QUERY_RETRY_AFTER_SECONDS = 15
const MAX_QUERY_ARGS_BYTES = 128 * 1024
const MAX_QUERY_RESULT_BYTES = 256 * 1024

/** gRPC codes meaning "no worker answered in time": CANCELLED (our deadline),
 * DEADLINE_EXCEEDED (Temporal's query timeout), FAILED_PRECONDITION ("no
 * poller seen for task queue recently"). */
const NO_WORKER_GRPC_CODES: ReadonlySet<number> = new Set([1, 4, 9])

export type WorkflowInstanceResponse = WorkflowExecutionResponse & {
  /** The executed row's kind; null only if the row was deleted. */
  kind: 'AUTOMATION' | 'WORKFLOW' | null
  /** The business key of an event-routed instance (`wfl/<tenant>/<name>/<key>`);
   * null for a manual run or an Automation. */
  correlationKey: string | null
}

function toInstanceResponse(row: WorkflowExecutionRow): WorkflowInstanceResponse {
  return {
    ...toExecutionResponse(row),
    kind: row.workflow?.kind ?? null,
    correlationKey: correlationKeyOf(row.temporalWorkflowId),
  }
}

const notFound = (c: Context<AppEnv>) =>
  c.json({ error: 'Execution not found', code: 'NOT_FOUND' }, 404)

async function loadExecution(
  c: Context<AppEnv>,
): Promise<
  | { ok: true; execution: WorkflowExecutionRow; workflow: WorkflowRow | null }
  | { ok: false; response: Response }
> {
  const tenantId = c.get('tenantId')
  const db = c.get('db')
  const execution = await createWorkflowExecutionRepository(db).findByIdForTenant(
    c.req.param('executionId') ?? '',
    tenantId,
  )
  if (!execution) return { ok: false, response: notFound(c) }
  const workflow = await createWorkflowRepository(db).findByIdForTenant(
    execution.workflowId,
    tenantId,
    { includeRetired: true },
  )
  return { ok: true, execution, workflow }
}

export const workflowExecutionsHandler = new Hono<AppEnv>()

workflowExecutionsHandler.use('*', dualAuthMiddleware)

// ---------------------------------------------------------------------------
// GET /?kind=&open=&name=&correlationKey=&limit=&before=
//
// kind defaults to WORKFLOW; open defaults to true for WORKFLOW and false for
// AUTOMATION. correlationKey needs name (the key is unique per Workflow name).
// ---------------------------------------------------------------------------
const ListQuery = z
  .object({
    kind: z.enum(['WORKFLOW', 'AUTOMATION']).optional().default('WORKFLOW'),
    open: z.enum(['true', 'false']).optional(),
    name: z.string().regex(NAME_REGEX).optional(),
    correlationKey: z.string().regex(CORRELATION_KEY_REGEX).optional(),
    limit: z.coerce.number().int().positive().optional(),
    before: z.string().min(1).max(64).optional(),
  })
  .refine((q) => q.correlationKey === undefined || q.name !== undefined, {
    message: 'correlationKey needs name',
    path: ['correlationKey'],
  })

workflowExecutionsHandler.get('/', requirePermission(Actions.ReadWorkflow), async (c) => {
  const parsed = ListQuery.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      {
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        code: 'VALIDATION_ERROR',
      },
      400,
    )
  }
  const q = parsed.data
  const tenantId = c.get('tenantId')
  const limit = Math.min(q.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  const open = q.open !== undefined ? q.open === 'true' : q.kind === 'WORKFLOW'

  const rows = await createWorkflowExecutionRepository(c.get('db')).listForTenant(tenantId, {
    limit,
    before: q.before ?? null,
    kind: q.kind,
    open,
    ...(q.name ? { name: q.name } : {}),
    ...(q.name && q.correlationKey
      ? { temporalWorkflowId: correlatedTemporalWorkflowId(tenantId, q.name, q.correlationKey) }
      : {}),
  })
  return c.json({ data: rows.map(toInstanceResponse), meta: { count: rows.length, limit } })
})

// ---------------------------------------------------------------------------
// GET /:executionId
// ---------------------------------------------------------------------------
workflowExecutionsHandler.get(
  '/:executionId',
  requirePermission(Actions.ReadWorkflow),
  async (c) => {
    const loaded = await loadExecution(c)
    if (!loaded.ok) return loaded.response
    const { execution, workflow } = loaded
    const durable = workflow?.kind === 'WORKFLOW'
    return c.json({
      data: {
        ...toInstanceResponse(execution),
        signals: durable ? declaredSignals(workflow.manifest) : [],
        queries: durable ? declaredQueries(workflow.manifest) : [],
      },
    })
  },
)

// ---------------------------------------------------------------------------
// POST /:executionId/query  { name, args? }
//
// Runs a query the execution's Workflow version declares (manifest `queries`)
// on the open instance. A query needs a live worker and the tenant's runner
// idle-exits, so the runner is ensured alongside the query; if no worker
// answers within QUERY_DEADLINE_MS the reply is 503 WORKFLOW_WORKER_STARTING
// + Retry-After, and the caller retries (the SDK does, for up to 90 s).
//
// 200 { data: { result } } | 404 | 409 EXECUTION_NOT_QUERYABLE |
// 422 NOT_A_WORKFLOW / QUERY_NOT_DECLARED / QUERY_FAILED / QUERY_RESULT_TOO_LARGE |
// 503 WORKFLOW_WORKER_STARTING | 502 TEMPORAL_QUERY_FAILED
// ---------------------------------------------------------------------------
const QueryBody = z
  .object({
    name: z.string().regex(SIGNAL_NAME_REGEX, {
      message: 'name must be a declared query name (letters, digits, _; max 64)',
    }),
    args: z.array(z.unknown()).max(20).optional().default([]),
  })
  .strict()

workflowExecutionsHandler.post(
  '/:executionId/query',
  requirePermission(Actions.QueryWorkflowExecution),
  validator('json', (value, c) => {
    const r = QueryBody.safeParse(value)
    if (!r.success) {
      return c.json(
        { error: r.error.issues[0]?.message ?? 'Invalid body', code: 'VALIDATION_ERROR' },
        400,
      )
    }
    if (JSON.stringify(r.data.args).length > MAX_QUERY_ARGS_BYTES) {
      return c.json({ error: 'query args exceed 128 KiB', code: 'VALIDATION_ERROR' }, 400)
    }
    return r.data
  }),
  async (c) => {
    const { name, args } = c.req.valid('json')
    const loaded = await loadExecution(c)
    if (!loaded.ok) return loaded.response
    const { execution, workflow } = loaded

    if (workflow?.kind !== 'WORKFLOW') {
      return c.json(
        {
          error: 'Only durable Workflows answer queries — this is an Automation',
          code: 'NOT_A_WORKFLOW',
        },
        422,
      )
    }
    const declared = declaredQueries(workflow.manifest)
    if (!declared.includes(name)) {
      return c.json(
        {
          error: `Workflow ${workflow.name}@${workflow.version} does not declare query "${name}" (declared: ${declared.length ? declared.join(', ') : 'none'})`,
          code: 'QUERY_NOT_DECLARED',
        },
        422,
      )
    }
    const notQueryable = (reason: string) =>
      c.json({ error: reason, code: 'EXECUTION_NOT_QUERYABLE' }, 409)
    if (TERMINAL_STATUSES.has(execution.status)) {
      return notQueryable(
        `Execution is already ${execution.status} — only open Workflows are queried`,
      )
    }
    const temporalWorkflowId = execution.temporalWorkflowId
    if (!temporalWorkflowId) {
      return notQueryable(
        'Execution has not started on Temporal yet — try again once it is running',
      )
    }

    // Wake the runner alongside the query, not after it: a cold start is the
    // long pole, so it should begin before the deadline runs out.
    const ensured = ensureTenantRunner(c.get('db'), execution.tenantId).catch((err: unknown) => {
      logger.warn('Tenant-runner ensure before query failed', {
        executionId: execution.id,
        tenantId: execution.tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    try {
      const result = await withTemporalClient(
        { tenantId: execution.tenantId, namespace: execution.temporalNamespace },
        (client) =>
          client.connection.withDeadline(Date.now() + QUERY_DEADLINE_MS, () =>
            executionHandle(client, { ...execution, temporalWorkflowId }).query(name, ...args),
          ),
      )
      const size = JSON.stringify(result ?? null).length
      if (size > MAX_QUERY_RESULT_BYTES) {
        return c.json(
          {
            error: `Query result is ${size} bytes; the limit is ${MAX_QUERY_RESULT_BYTES}`,
            code: 'QUERY_RESULT_TOO_LARGE',
          },
          422,
        )
      }
      return c.json({ data: { result: result ?? null } })
    } catch (err) {
      return queryErrorResponse(c, err, execution)
    } finally {
      await ensured
    }
  },
)

function queryErrorResponse(
  c: Context<AppEnv>,
  err: unknown,
  execution: WorkflowExecutionRow,
): Response {
  const name = err instanceof Error ? err.name : ''
  // Match classes by name (the codebase idiom). The TS client reports BOTH an
  // unknown query name and a query handler that raised as
  // QueryNotRegisteredError (gRPC INVALID_ARGUMENT) — probed, see GOTCHAS.md.
  if (name === 'QueryNotRegisteredError') {
    return c.json({ error: `Query failed: ${(err as Error).message}`, code: 'QUERY_FAILED' }, 422)
  }
  if (name === 'WorkflowNotFoundError' || name === 'QueryRejectedError') {
    return c.json(
      { error: 'Execution is no longer running on Temporal', code: 'EXECUTION_NOT_QUERYABLE' },
      409,
    )
  }
  if (err instanceof TenantTemporalKeyUnavailableError) {
    return c.json(
      { error: 'Execution is no longer running on Temporal', code: 'EXECUTION_NOT_QUERYABLE' },
      409,
    )
  }
  const cause = err instanceof Error ? err.cause : undefined
  const grpc = isGrpcServiceError(err) ? err : isGrpcServiceError(cause) ? cause : null
  if (grpc && NO_WORKER_GRPC_CODES.has(grpc.code)) {
    c.header('Retry-After', String(QUERY_RETRY_AFTER_SECONDS))
    return c.json(
      {
        error:
          'No worker answered yet — the tenant runner is starting. Retry after the Retry-After delay.',
        code: 'WORKFLOW_WORKER_STARTING',
      },
      503,
    )
  }
  logger.error('Failed to query workflow execution', {
    executionId: execution.id,
    tenantId: execution.tenantId,
    error: err instanceof Error ? err.message : String(err),
  })
  return c.json(
    { error: 'Failed to query the Workflow on Temporal', code: 'TEMPORAL_QUERY_FAILED' },
    502,
  )
}

// ---------------------------------------------------------------------------
// POST /:executionId/cancel — cooperative; the Workflow's code decides what
// to do (its run_automation steps cancel their own Automations). 202 + the
// still-open row; the reconciler closes it.
// ---------------------------------------------------------------------------
workflowExecutionsHandler.post(
  '/:executionId/cancel',
  requirePermission(Actions.CancelWorkflowExecution),
  async (c) => {
    const loaded = await loadExecution(c)
    if (!loaded.ok) return loaded.response
    return requestCancelResponse(c, loaded.execution.workflowId, loaded.execution)
  },
)

// ---------------------------------------------------------------------------
// POST /:executionId/terminate  { reason }
//
// Forcible: Temporal ends the run without running any more of its code. The
// row is closed here at once (CANCELLED, "Terminated: <reason>") rather than
// waiting for a reconcile tick. A terminated Workflow's run_automation
// activities get no cancel hook, so its OPEN steps are cancelled too (best
// effort; a failure is logged, and those steps still end at their own timeout).
//
// 202 { data: row } | 404 | 409 EXECUTION_NOT_TERMINABLE | 502 TEMPORAL_TERMINATE_FAILED
// ---------------------------------------------------------------------------
const TerminateBody = z
  .object({ reason: z.string().trim().min(1, { message: 'reason is required' }).max(500) })
  .strict()

workflowExecutionsHandler.post(
  '/:executionId/terminate',
  requirePermission(Actions.TerminateWorkflowExecution),
  validator('json', (value, c) => {
    const r = TerminateBody.safeParse(value)
    if (!r.success) {
      return c.json(
        { error: r.error.issues[0]?.message ?? 'Invalid body', code: 'VALIDATION_ERROR' },
        400,
      )
    }
    return r.data
  }),
  async (c) => {
    const { reason } = c.req.valid('json')
    const loaded = await loadExecution(c)
    if (!loaded.ok) return loaded.response
    const { execution } = loaded
    const tenantId = c.get('tenantId')
    const notTerminable = (message: string) =>
      c.json({ error: message, code: 'EXECUTION_NOT_TERMINABLE' }, 409)

    if (TERMINAL_STATUSES.has(execution.status)) {
      return notTerminable(`Execution is already ${execution.status} — nothing to terminate`)
    }
    const temporalWorkflowId = execution.temporalWorkflowId
    if (!temporalWorkflowId) {
      return notTerminable(
        'Execution has not started on Temporal yet — try again once it is running',
      )
    }

    try {
      await withTemporalClient(
        { tenantId: execution.tenantId, namespace: execution.temporalNamespace },
        (client) => executionHandle(client, { ...execution, temporalWorkflowId }).terminate(reason),
      )
    } catch (err) {
      if (err instanceof Error && err.name === 'WorkflowNotFoundError') {
        return notTerminable('Execution is no longer running on Temporal')
      }
      logger.error('Failed to terminate workflow execution', {
        executionId: execution.id,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
      return c.json(
        {
          error: 'Failed to terminate the execution on Temporal',
          code: 'TEMPORAL_TERMINATE_FAILED',
        },
        502,
      )
    }

    const repo = createWorkflowExecutionRepository(c.get('db'))
    const closed = await repo.markTerminatedIfOpen(execution.id, tenantId, {
      errorMessage: `Terminated: ${reason}`,
      finishedAt: new Date(),
    })
    const cancelledSteps = await cancelOpenSteps(repo, tenantId, execution.id)
    logger.info('Workflow execution terminated', {
      executionId: execution.id,
      tenantId,
      cancelledSteps,
    })
    return c.json({ data: toInstanceResponse(closed ?? execution) }, 202)
  },
)

/** Cancel a terminated Workflow's open step Automations; returns how many
 * cancels Temporal accepted. Never throws. */
async function cancelOpenSteps(
  repo: ReturnType<typeof createWorkflowExecutionRepository>,
  tenantId: string,
  parentExecutionId: string,
): Promise<number> {
  const steps = await repo.listOpenSteps(tenantId, parentExecutionId)
  let accepted = 0
  for (const step of steps) {
    const stepTemporalId = step.temporalWorkflowId
    if (!stepTemporalId) continue
    try {
      await withTemporalClient(
        { tenantId: step.tenantId, namespace: step.temporalNamespace },
        (client) =>
          executionHandle(client, { ...step, temporalWorkflowId: stepTemporalId }).cancel(),
      )
      accepted += 1
    } catch (err) {
      logger.warn('Failed to cancel a terminated Workflow step', {
        parentExecutionId,
        stepExecutionId: step.id,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return accepted
}
