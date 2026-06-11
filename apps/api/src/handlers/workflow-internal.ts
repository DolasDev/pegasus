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
// Two credential kinds gate BOTH endpoints (Phase 3 Unit 7). There is no
// Cedar layer here — workers have no Cognito session.
//
//   1. Shared secret (`X-Workflow-Broker-Secret`, env
//      `WORKFLOW_BROKER_SECRET`) — the legacy stdlib worker. Trusted image;
//      full access to any tenant's executions, wire-identical to Phase 2.
//      The secret is generated out-of-band, lives in Secrets Manager
//      `pegasus/{env}/workflow-broker-secret`, and is injected at Lambda
//      startup.
//
//   2. Per-tenant token (`X-Workflow-Broker-Token`, format
//      `wbk_<tenantId>_<48 hex>`) — tenant-runner containers (Unit 8+).
//      Minted/verified by lib/tenant-broker-credential.ts. Both endpoints
//      enforce `execution.tenantId === token.tenantId`; a mismatch is
//      answered 404 exactly like a nonexistent execution, so a token holder
//      cannot probe whether another tenant's executionId exists (matches the
//      tenant-scoping convention everywhere else: cross-tenant rows are
//      invisible, not forbidden).
//
// A separate header (rather than prefix-sniffing one header) keeps the
// legacy worker's path byte-for-byte unchanged and makes which-credential-
// was-presented explicit in code and in probes' failure modes. If the shared
// secret header is present it is validated strictly — an invalid value never
// falls through to the token path. Mismatched / missing → 401, no further
// detail to avoid helping a probe.
//
// Endpoints
// ─────────
// POST   /workflow-runtime-token       — broker: KMS-decrypt + return token
// PATCH  /workflow-executions/:id      — worker write-back: status / result
// GET    /tenant-workflows             — runner artifact discovery (Unit 8):
//                                        executable workflows + presigned GETs
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
import { presignDownload } from '../lib/documents-s3'
import { verifyTenantBrokerToken } from '../lib/tenant-broker-credential'
import { logger } from '../lib/logger'
import type { AppEnv, WorkflowBrokerAuth } from '../types'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const BrokerBody = z.object({
  executionId: z.string().uuid(),
})

const PatchBody = z.object({
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as const),
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
// Broker auth middleware — shared secret OR per-tenant token
// ---------------------------------------------------------------------------

const BROKER_HEADER = 'X-Workflow-Broker-Secret'
const BROKER_TOKEN_HEADER = 'X-Workflow-Broker-Token'

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  // timingSafeEqual demands equal-length buffers; we already early-out above.
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Authenticates every request as either the legacy shared-secret worker
 * (full access) or a per-tenant `wbk_` token (confined to its tenant), and
 * stamps the resulting principal on the context as `brokerAuth`.
 *
 * Precedence: a present shared-secret header is validated strictly — wrong
 * values 401 immediately and never fall through to the token path. Requests
 * with neither header 401 with the same INVALID_BROKER_SECRET code as before
 * Unit 7 (wire-identical for the legacy worker). All failures carry no
 * further detail so an attacker probing the endpoint learns nothing.
 */
function requireBrokerAuth(): (
  c: {
    req: { header: (name: string) => string | undefined }
    json: (body: unknown, status: 401) => Response
    set: (key: 'brokerAuth', value: WorkflowBrokerAuth) => void
  },
  next: () => Promise<void>,
) => Promise<Response | void> {
  return async (c, next) => {
    const presentedSecret = c.req.header(BROKER_HEADER)
    if (presentedSecret !== undefined) {
      const expected = process.env['WORKFLOW_BROKER_SECRET'] ?? ''
      if (!expected || !presentedSecret || !constantTimeEquals(expected, presentedSecret)) {
        return c.json({ error: 'unauthorized', code: 'INVALID_BROKER_SECRET' }, 401)
      }
      c.set('brokerAuth', { kind: 'shared' })
      await next()
      return
    }

    const presentedToken = c.req.header(BROKER_TOKEN_HEADER)
    if (presentedToken !== undefined) {
      const verified = presentedToken
        ? await verifyTenantBrokerToken(basePrisma, presentedToken)
        : null
      if (!verified) {
        return c.json({ error: 'unauthorized', code: 'INVALID_BROKER_TOKEN' }, 401)
      }
      c.set('brokerAuth', { kind: 'tenant', tenantId: verified.tenantId })
      await next()
      return
    }

    return c.json({ error: 'unauthorized', code: 'INVALID_BROKER_SECRET' }, 401)
  }
}

/**
 * True when `auth` is NOT allowed to touch an execution row owned by
 * `executionTenantId`. Shared-secret principals may touch anything; tenant
 * principals only their own tenant's rows. Callers answer a denial with the
 * same 404 body as a nonexistent execution — see the module header.
 */
function deniedForTenant(auth: WorkflowBrokerAuth | undefined, executionTenantId: string): boolean {
  // brokerAuth is always set by requireBrokerAuth before any route runs;
  // treat an impossible-missing value as a denial, never as shared access.
  if (!auth) return true
  return auth.kind === 'tenant' && auth.tenantId !== executionTenantId
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const workflowInternalHandler = new Hono<AppEnv>()

// Every route in this router goes through the broker auth gate.
workflowInternalHandler.use('*', requireBrokerAuth())

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
    // Tenant confinement (Unit 7): a per-tenant token may only mint runtime
    // tokens for its own tenant's executions. Cross-tenant rows are answered
    // exactly like missing rows so the executionId namespace can't be probed.
    if (deniedForTenant(c.get('brokerAuth'), execution.tenantId)) {
      logger.warn('broker.token_denied_cross_tenant', { executionId })
      return c.json({ error: 'execution not found', code: 'NOT_FOUND' }, 404)
    }
    // Terminal executions don't get fresh tokens issued — defence-in-depth
    // against a late retry from a worker that lost track of state.
    if (execution.status !== 'QUEUED' && execution.status !== 'RUNNING') {
      return c.json({ error: 'execution not in an issuable state', code: 'NOT_FOUND' }, 404)
    }
    const workflow = await basePrisma.workflow.findUnique({
      where: { id: execution.workflowId },
      select: { runtimeTokenCiphertext: true },
    })
    if (!workflow?.runtimeTokenCiphertext) {
      return c.json({ error: 'runtime token not provisioned', code: 'NOT_FOUND' }, 404)
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
    // Tenant confinement (Unit 7): a per-tenant token may only write back to
    // its own tenant's executions. Answered like a missing row, and BEFORE
    // transition validation so a cross-tenant probe can't learn row state
    // from an INVALID_TRANSITION 400.
    if (deniedForTenant(c.get('brokerAuth'), existing.tenantId)) {
      logger.warn('broker.patch_denied_cross_tenant', { executionId })
      return c.json({ error: 'execution not found', code: 'NOT_FOUND' }, 404)
    }

    const fromStatus = existing.status as WorkflowExecutionStatus
    const toStatus = body.status as WorkflowExecutionStatus

    // Idempotent terminal: same terminal status already recorded → no-op.
    if (TERMINAL_STATUSES.has(fromStatus) && fromStatus === toStatus) {
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
      if (fromStatus === 'RUNNING') return toStatus === 'RUNNING' || TERMINAL_STATUSES.has(toStatus)
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

// ---------------------------------------------------------------------------
// GET /tenant-workflows
//
// Runner artifact discovery (Phase 3 Unit 8). The tenant-runner container
// holds NO AWS credentials — this endpoint is its only path to artifacts:
// it lists the tenant's `executable: true` workflows together with the
// integrity digest recorded at finalize and a short-lived presigned GET URL
// per artifact. The runner re-hashes each download against `artifactSha256`
// before unpacking (the Unit 6 TOCTOU defence); rows without a digest are
// excluded here because the runner could never verify them.
//
// Tenant confinement (same posture as the other two endpoints): a `wbk_`
// token is pinned to its own tenant — a `tenantId` query param is only
// accepted when it matches (anything else is a 400, leaking nothing about
// other tenants). The shared secret must say which tenant it wants.
//
// Request:  GET /tenant-workflows[?tenantId=<uuid>]
// Response: { data: [{ id, name, version, entryPoints, artifactSha256,
//             artifactSizeBytes, createdAt, downloadUrl,
//             downloadUrlExpiresInSeconds }] } | 400 | 401
// ---------------------------------------------------------------------------

/** TTL baked into lib/documents-s3.ts presignDownload — surfaced to the
 * runner so it can reason about staleness without parsing the URL. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60

/** Minimal shape pulled out of the stored (finalize-validated) manifest.
 * A row whose manifest somehow lacks entry points is unusable by the runner
 * and is skipped with a warning rather than failing the whole listing. */
const ManifestEntryPoints = z.object({ entryPoints: z.array(z.string()).min(1) })

workflowInternalHandler.get('/tenant-workflows', async (c) => {
  const auth = c.get('brokerAuth')
  const requestedTenantId = c.req.query('tenantId')

  let tenantId: string
  if (auth?.kind === 'tenant') {
    // A per-tenant token may only ever list its own tenant. An explicit
    // param is tolerated only when it agrees — anything else is rejected
    // without revealing whether the other tenant exists.
    if (requestedTenantId !== undefined && requestedTenantId !== auth.tenantId) {
      return c.json(
        { error: 'tenantId does not match the presented token', code: 'VALIDATION_ERROR' },
        400,
      )
    }
    tenantId = auth.tenantId
  } else {
    // Shared secret: full access, but it must say which tenant it wants.
    const parsed = z.string().uuid().safeParse(requestedTenantId)
    if (!parsed.success) {
      return c.json(
        { error: 'tenantId query param (uuid) is required', code: 'VALIDATION_ERROR' },
        400,
      )
    }
    tenantId = parsed.data
  }

  // Base client on purpose: this router sits outside the tenant middleware,
  // and the where-clause IS the tenant scope (mirrors the other endpoints).
  const rows = await basePrisma.workflow.findMany({
    where: {
      tenantId,
      executable: true,
      // executable:true implies a Unit-6 finalize, but the digest is what
      // the runner's whole security model hangs on — filter explicitly.
      artifactSha256: { not: null },
    },
    select: {
      id: true,
      name: true,
      version: true,
      manifest: true,
      artifactKey: true,
      artifactSha256: true,
      artifactSizeBytes: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const data = []
  for (const row of rows) {
    const manifest = ManifestEntryPoints.safeParse(row.manifest)
    if (!manifest.success) {
      logger.warn('broker.tenant_workflows.row_skipped_no_entry_points', {
        workflowId: row.id,
        tenantId,
      })
      continue
    }
    data.push({
      id: row.id,
      name: row.name,
      version: row.version,
      entryPoints: manifest.data.entryPoints,
      artifactSha256: row.artifactSha256,
      artifactSizeBytes: row.artifactSizeBytes,
      createdAt: row.createdAt.toISOString(),
      // The presigned URL is the runner's entire authorization to the
      // artifact bytes; the raw S3 key stays internal (it is embedded in
      // the signed URL by construction, but never exposed as a field).
      downloadUrl: await presignDownload(row.artifactKey),
      downloadUrlExpiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    })
  }

  logger.info('broker.tenant_workflows.listed', {
    tenantId,
    count: data.length,
    authKind: auth?.kind ?? 'unknown',
  })

  // Presigned URLs are short-lived credentials — keep every cache out.
  c.header('Cache-Control', 'no-store')
  return c.json({ data })
})
