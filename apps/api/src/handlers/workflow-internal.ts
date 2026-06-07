// ---------------------------------------------------------------------------
// Workflow internal handler — /api/v1/internal
//
// Two worker-only endpoints called by the Fargate Temporal worker (NOT by any
// browser, SPA, or tenant-owned vendor key). Mounted on the m2mV1 router so
// they sit OUTSIDE the tenant-middleware wildcard; tenant context is derived
// per-request from the WorkflowExecution row, not from a subdomain.
//
// Auth model
// ──────────
// A single shared-secret header (`X-Workflow-Broker-Secret`, env
// `WORKFLOW_BROKER_SECRET`) gates BOTH endpoints. There is no Cedar layer
// here — the worker has no Cognito session and no per-tenant vnd_ key (it
// would need one per tenant, defeating the broker design entirely). The
// secret is generated out-of-band, lives in Secrets Manager
// `pegasus/{env}/workflow-broker-secret`, and is injected at Lambda startup.
// Mismatched / missing → 401, no further detail to avoid helping a probe.
//
// Endpoints
// ─────────
// POST   /workflow-runtime-token       — broker: KMS-decrypt + return token
// PATCH  /workflow-executions/:id      — worker write-back: status / result
// ---------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { db as basePrisma } from '../db'
import { createTenantDb } from '../lib/prisma'
import { createWorkflowExecutionRepository } from '../repositories/workflow-execution.repository'
import type { WorkflowExecutionStatus } from '../repositories/workflow-execution.repository'
import { decryptRuntimeToken } from '../lib/runtime-token-crypto'
import { logger } from '../lib/logger'
import type { AppEnv } from '../types'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const BrokerBody = z.object({
  executionId: z.string().uuid(),
})

const PatchBody = z.object({
  status: z.enum([
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'TIMED_OUT',
    'CANCELLED',
  ] as const),
  // The worker passes JSON-shaped result payloads opaquely. We don't
  // re-validate them here; the SDK that wrote them is trusted.
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
  temporalWorkflowId: z.string().optional(),
  temporalRunId: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
})

const TERMINAL_STATUSES: ReadonlySet<WorkflowExecutionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
])

// ---------------------------------------------------------------------------
// Shared-secret middleware
// ---------------------------------------------------------------------------

const BROKER_HEADER = 'X-Workflow-Broker-Secret'

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  // timingSafeEqual demands equal-length buffers; we already early-out above.
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Reject everything that does not present the matching shared-secret header.
 * 401 INVALID_BROKER_SECRET with no further body so the worker can log it
 * cleanly while an attacker probing the endpoint sees nothing of value.
 */
function requireBrokerSecret(): (
  c: { req: { header: (name: string) => string | undefined }; json: (body: unknown, status: 401) => Response },
  next: () => Promise<void>,
) => Promise<Response | void> {
  return async (c, next) => {
    const expected = process.env['WORKFLOW_BROKER_SECRET'] ?? ''
    const presented = c.req.header(BROKER_HEADER) ?? ''
    if (!expected || !presented || !constantTimeEquals(expected, presented)) {
      return c.json({ error: 'unauthorized', code: 'INVALID_BROKER_SECRET' }, 401)
    }
    await next()
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const workflowInternalHandler = new Hono<AppEnv>()

// Every route in this router goes through the shared-secret gate.
workflowInternalHandler.use('*', requireBrokerSecret())

// ---------------------------------------------------------------------------
// POST /workflow-runtime-token
//
// Broker: the worker calls this at activity start to fetch the per-workflow
// runtime token plaintext for `executionId`. The plaintext lives ONLY in the
// HTTP response body and the worker's process memory; it is never logged
// and never stored at rest by the worker.
//
// Request:  { executionId }
// Response: { token: "vnd_..." } | 401 | 404
// ---------------------------------------------------------------------------
workflowInternalHandler.post(
  '/workflow-runtime-token',
  validator('json', (value, c) => {
    const r = BrokerBody.safeParse(value)
    if (!r.success) {
      return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    }
    return r.data
  }),
  async (c) => {
    const { executionId } = c.req.valid('json')

    // The worker's request is tenant-agnostic — we look up the execution on
    // the BASE Prisma client (no tenant scope) to find the owning tenant
    // first, then derive the workflow + ciphertext from there.
    const execution = await basePrisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: {
        id: true,
        tenantId: true,
        workflowId: true,
        status: true,
      },
    })
    if (!execution) {
      return c.json({ error: 'execution not found', code: 'NOT_FOUND' }, 404)
    }
    // Terminal executions don't get fresh tokens issued — defence-in-depth
    // against a late retry from a worker that lost track of state.
    if (execution.status !== 'QUEUED' && execution.status !== 'RUNNING') {
      return c.json(
        { error: 'execution not in an issuable state', code: 'NOT_FOUND' },
        404,
      )
    }
    const workflow = await basePrisma.workflow.findUnique({
      where: { id: execution.workflowId },
      select: { runtimeTokenCiphertext: true },
    })
    if (!workflow?.runtimeTokenCiphertext) {
      return c.json(
        { error: 'runtime token not provisioned', code: 'NOT_FOUND' },
        404,
      )
    }

    const token = await decryptRuntimeToken(workflow.runtimeTokenCiphertext)

    logger.info('broker.token_issued', {
      executionId,
      workflowId: execution.workflowId,
      tenantId: execution.tenantId,
    })

    // Belt-and-braces: tell anything between us and the worker not to cache
    // the body. There SHOULDN'T be a cache in the path (Lambda → ALB →
    // worker), but defence-in-depth costs nothing.
    c.header('Cache-Control', 'no-store')
    return c.json({ token })
  },
)

// ---------------------------------------------------------------------------
// PATCH /workflow-executions/:id
//
// Worker write-back. Updates the execution row when the worker observes a
// state transition. Validates the state machine:
//   QUEUED → RUNNING → { COMPLETED | FAILED | TIMED_OUT | CANCELLED }
// Reverse / cross transitions return 400. Idempotent on terminal: if the row
// is already in the requested terminal state, the PATCH no-ops and returns
// 200 (the worker may retry on a network hiccup).
//
// Request:  { status, result?, errorMessage?, temporalWorkflowId?,
//             temporalRunId?, startedAt?, finishedAt? }
// Response: 200 { data: WorkflowExecutionResponse } | 400 | 401 | 404
// ---------------------------------------------------------------------------
workflowInternalHandler.patch(
  '/workflow-executions/:id',
  validator('json', (value, c) => {
    const r = PatchBody.safeParse(value)
    if (!r.success) {
      return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    }
    return r.data
  }),
  async (c) => {
    const executionId = c.req.param('id') ?? ''
    const body = c.req.valid('json')

    const existing = await basePrisma.workflowExecution.findUnique({
      where: { id: executionId },
      select: { id: true, tenantId: true, status: true, finishedAt: true },
    })
    if (!existing) {
      return c.json({ error: 'execution not found', code: 'NOT_FOUND' }, 404)
    }

    const fromStatus = existing.status as WorkflowExecutionStatus
    const toStatus = body.status as WorkflowExecutionStatus

    // Idempotent terminal: same terminal status already recorded → no-op.
    if (
      TERMINAL_STATUSES.has(fromStatus) &&
      fromStatus === toStatus
    ) {
      logger.info('broker.patch.idempotent_noop', {
        executionId,
        status: fromStatus,
      })
      // Build a tenant-scoped view to return the existing row.
      const tenantDb = createTenantDb(basePrisma, existing.tenantId)
      const repo = createWorkflowExecutionRepository(tenantDb as unknown as PrismaClient)
      const row = await repo.findById(executionId)
      return c.json({ data: row })
    }

    // Validate transitions:
    //   QUEUED → RUNNING               OK
    //   QUEUED → terminal              OK (failed before reaching RUNNING)
    //   RUNNING → terminal             OK
    //   RUNNING → RUNNING              OK (idempotent re-PATCH)
    //   terminal → anything-but-self   reject
    //   anything → QUEUED              reject (only the API insert sets QUEUED)
    const valid = (() => {
      if (toStatus === 'QUEUED') return false
      if (TERMINAL_STATUSES.has(fromStatus)) return false
      if (fromStatus === 'QUEUED') return toStatus === 'RUNNING' || TERMINAL_STATUSES.has(toStatus)
      if (fromStatus === 'RUNNING')
        return toStatus === 'RUNNING' || TERMINAL_STATUSES.has(toStatus)
      return false
    })()
    if (!valid) {
      return c.json(
        {
          error: `invalid status transition: ${fromStatus} → ${toStatus}`,
          code: 'INVALID_TRANSITION',
        },
        400,
      )
    }

    // Build a tenant-scoped Prisma client so the repo writes carry tenantId
    // via the extension. The execution lookup above gave us the tenantId
    // directly from the (base) row, so we don't need any per-request tenant
    // header.
    const tenantDb = createTenantDb(basePrisma, existing.tenantId)
    const repo = createWorkflowExecutionRepository(tenantDb as unknown as PrismaClient)

    let updated
    if (toStatus === 'RUNNING') {
      const startedAt = body.startedAt ? new Date(body.startedAt) : new Date()
      const temporalWorkflowId = body.temporalWorkflowId ?? ''
      const temporalRunId = body.temporalRunId ?? ''
      if (!temporalWorkflowId || !temporalRunId) {
        return c.json(
          {
            error: 'RUNNING transition requires temporalWorkflowId + temporalRunId',
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
      updated = await repo.markStarted(executionId, {
        temporalWorkflowId,
        temporalRunId,
        startedAt,
      })
      logger.info('broker.patch.marked_running', {
        executionId,
        tenantId: existing.tenantId,
        temporalWorkflowId,
        temporalRunId,
      })
    } else {
      // Terminal transition.
      const finishedAt = body.finishedAt ? new Date(body.finishedAt) : new Date()
      const terminalInput: {
        status: Exclude<WorkflowExecutionStatus, 'QUEUED' | 'RUNNING'>
        finishedAt: Date
        result?: object | null
        errorMessage?: string | null
      } = {
        status: toStatus as Exclude<WorkflowExecutionStatus, 'QUEUED' | 'RUNNING'>,
        finishedAt,
      }
      if (body.result !== undefined) {
        terminalInput.result = body.result as object | null
      }
      if (body.errorMessage !== undefined) {
        terminalInput.errorMessage = body.errorMessage
      }
      updated = await repo.markTerminal(executionId, terminalInput)
      logger.info('broker.patch.marked_terminal', {
        executionId,
        tenantId: existing.tenantId,
        status: toStatus,
      })
    }

    return c.json({ data: updated })
  },
)
