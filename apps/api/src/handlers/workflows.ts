// ---------------------------------------------------------------------------
// Workflows handler — /api/v1/workflows
//
// Phase 1 surface for the Python workflow store. Tenants (and the platform
// team's CI under the platform tenant) upload signed Python artifacts via
// the SDK CLI; the artifact lives in the shared documents bucket, the row
// lives here, and the tenant UI lists what's visible.
//
// Endpoints:
//   POST   /upload-url        — issues a presigned PUT for the artifact zip
//   POST   /                  — finalize: writes the row after the upload
//   GET    /                  — list (caller's tenant ∪ GLOBAL)
//   GET    /:id               — fetch one (visibility-checked)
//   GET    /:id/download-url  — presigned GET for the source zip
//   POST   /:id/fork          — copy a GLOBAL workflow into the caller's store
//   POST   /:id/triggers      — attach an EVENT/SCHEDULE trigger (Phase 3 U2)
//   GET    /:id/triggers      — list the caller-tenant's triggers
//   PATCH  /:id/triggers/:triggerId   — partial update (kind immutable)
//   DELETE /:id/triggers/:triggerId   — hard delete
//
// Visibility is derived server-side: tenants flagged isPlatformTenant=true
// upload as GLOBAL; everyone else uploads as TENANT. There is no client-facing
// way to set visibility — that is the whole point of the platform-tenant gate.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient, Prisma } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import { requirePermission } from '../middleware/rbac'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions, ALL_ACTIONS } from '../authz/actions'
import { createWorkflowRepository } from '../repositories/workflow.repository'
import type { WorkflowRow, WorkflowVisibility } from '../repositories/workflow.repository'
import { createApiClientRepository } from '../repositories/api-client.repository'
import { createWorkflowExecutionRepository } from '../repositories/workflow-execution.repository'
import type { WorkflowExecutionRow } from '../repositories/workflow-execution.repository'
import { createWorkflowTriggerRepository } from '../repositories/workflow-trigger.repository'
import type { WorkflowTriggerRow } from '../repositories/workflow-trigger.repository'
import type { AppEnv } from '../types'
import { presignDownload, presignUpload } from '../lib/documents-s3'
import { encryptRuntimeToken } from '../lib/runtime-token-crypto'
import { getTemporalClient, temporalTaskQueue } from '../lib/temporal-client'
import { CURATED_WORKFLOW_NAMES } from '../lib/curated-workflows'
import { DOMAIN_EVENT_TYPES } from '../lib/domain-events'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024 // 25 MB
const ARTIFACT_MIME_TYPE = 'application/zip'
const UPLOAD_URL_TTL_SECONDS = 15 * 60
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60

/**
 * (name, version) characters allowed in S3 keys without escaping. Locked
 * down so the path component below is safe to interpolate into an S3 key.
 */
const NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/
const VERSION_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/

/** Every valid action id in the Cedar action catalog. */
const VALID_ACTION_IDS = new Set(ALL_ACTIONS.map((a) => a.id))

const ManifestSchema = z.object({
  name: z.string().regex(NAME_REGEX, {
    message: 'name must be lowercase letters/digits/_/-, 1–64 chars',
  }),
  version: z.string().regex(VERSION_REGEX, {
    message: 'version must be semver (e.g. 1.2.3 or 1.2.3-beta.1)',
  }),
  entryPoints: z.array(z.string().min(1)).min(1),
  description: z.string().optional(),
  // Action ids the workflow needs at runtime. Each must be a known Cedar
  // action — an unknown id fails validation here, before any upload row is
  // written.
  requiredActions: z
    .array(z.string())
    .optional()
    .default([])
    .superRefine((ids, ctx) => {
      for (const id of ids) {
        if (!VALID_ACTION_IDS.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `requiredActions contains unknown action id: ${id}`,
          })
        }
      }
    }),
})

const UploadUrlBody = z.object({
  name: z.string().regex(NAME_REGEX),
  version: z.string().regex(VERSION_REGEX),
  sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
})

const FinalizeBody = z.object({
  workflowId: z.string().uuid(),
  manifest: ManifestSchema,
})

const RunBody = z.object({
  // Workflow-defined arbitrary JSON. Pegasus does NOT validate its shape
  // here — that contract belongs to the workflow author. Defaults to {}
  // so the SDK can call `run_workflow(id)` with no input.
  input: z.record(z.string(), z.unknown()).optional().default({}),
})

const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 200

/** The five launch domain-event types as a Set for O(1) membership checks. */
const DOMAIN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(DOMAIN_EVENT_TYPES)

/**
 * Conservative shape check for a 5-field cron expression (minute, hour,
 * day-of-month, month, day-of-week): single-space-separated fields built from
 * digits, letters (month/day names), `*`, `,`, `-`, `/` and `?`. Deliberately
 * NOT a semantic validator — full validation (field ranges, step values,
 * impossible dates) happens when Unit 4 realizes the trigger as a Temporal
 * Schedule. No new dependencies.
 */
const CRON_FIELD = '[0-9A-Za-z*,/?-]+'
const CRON_EXPRESSION_REGEX = new RegExp(`^${CRON_FIELD}(?: ${CRON_FIELD}){4}$`)

/** True for a plain JSON object — rejects arrays, null, and primitives. */
function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Trigger create body. Kind-conditional: EVENT rows subscribe to a domain
// event (eventType required, optional filter, no cron); SCHEDULE rows carry a
// cron expression (no eventType/filter). SCHEDULE rows are INERT in this unit
// — stored but nothing creates Temporal Schedules until Phase 3 Unit 4, and
// EVENT rows wait for the Unit 3 dispatcher.
const CreateTriggerBody = z
  .object({
    kind: z.enum(['EVENT', 'SCHEDULE']),
    eventType: z.string().optional(),
    filter: z.unknown().optional(),
    cronExpression: z.string().optional(),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((body, ctx) => {
    if (body.kind === 'EVENT') {
      if (!body.eventType || !DOMAIN_EVENT_TYPE_SET.has(body.eventType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `EVENT triggers require eventType, one of: ${DOMAIN_EVENT_TYPES.join(', ')}`,
        })
      }
      if (body.filter !== undefined && !isPlainJsonObject(body.filter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'filter must be a plain JSON object',
        })
      }
      if (body.cronExpression !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'cronExpression is only valid for SCHEDULE triggers',
        })
      }
    } else {
      if (!body.cronExpression || !CRON_EXPRESSION_REGEX.test(body.cronExpression)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'SCHEDULE triggers require cronExpression: 5 space-separated cron fields (minute hour day-of-month month day-of-week)',
        })
      }
      if (body.eventType !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'eventType is only valid for EVENT triggers',
        })
      }
      if (body.filter !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'filter is only valid for EVENT triggers',
        })
      }
    }
  })

// Trigger partial-update body. `.strict()` rejects unknown keys — notably
// `kind`, which is immutable (delete + recreate to change a trigger's kind).
// Kind-conditional checks (cron on EVENT etc.) need the existing row and run
// in the PATCH handler after the trigger is loaded.
const UpdateTriggerBody = z
  .object({
    enabled: z.boolean().optional(),
    eventType: z.string().optional(),
    filter: z.unknown().optional(),
    cronExpression: z.string().optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

type WorkflowResponse = {
  id: string
  tenantId: string
  name: string
  version: string
  visibility: WorkflowVisibility
  manifest: WorkflowRow['manifest']
  createdByUserId: string
  forkedFromWorkflowId: string | null
  forkedFromVersion: string | null
  createdAt: string
  updatedAt: string
}

type WorkflowExecutionResponse = {
  id: string
  tenantId: string
  workflowId: string
  status: WorkflowExecutionRow['status']
  input: WorkflowExecutionRow['input']
  result: WorkflowExecutionRow['result']
  errorMessage: string | null
  temporalWorkflowId: string | null
  temporalRunId: string | null
  // Nullable since Phase 3 Unit 2: trigger-fired executions (Units 3/4) have
  // no user. Manual runs keep setting it, so existing consumers see no change.
  triggeredByUserId: string | null
  triggerSource: WorkflowExecutionRow['triggerSource']
  triggeredByTriggerId: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

function toExecutionResponse(row: WorkflowExecutionRow): WorkflowExecutionResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workflowId: row.workflowId,
    status: row.status,
    input: row.input,
    result: row.result,
    errorMessage: row.errorMessage,
    temporalWorkflowId: row.temporalWorkflowId,
    temporalRunId: row.temporalRunId,
    triggeredByUserId: row.triggeredByUserId,
    triggerSource: row.triggerSource,
    triggeredByTriggerId: row.triggeredByTriggerId,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

type WorkflowTriggerResponse = {
  id: string
  tenantId: string
  workflowId: string
  kind: WorkflowTriggerRow['kind']
  eventType: string | null
  filter: WorkflowTriggerRow['filter']
  cronExpression: string | null
  enabled: boolean
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

function toTriggerResponse(row: WorkflowTriggerRow): WorkflowTriggerResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workflowId: row.workflowId,
    kind: row.kind,
    eventType: row.eventType,
    filter: row.filter,
    cronExpression: row.cronExpression,
    enabled: row.enabled,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toResponse(row: WorkflowRow): WorkflowResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    version: row.version,
    visibility: row.visibility,
    manifest: row.manifest,
    createdByUserId: row.createdByUserId,
    forkedFromWorkflowId: row.forkedFromWorkflowId,
    forkedFromVersion: row.forkedFromVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Canonical S3 key for a workflow artifact. Lives in the shared documents
 * bucket alongside per-entity attachments; the `workflows/` prefix keeps
 * lifecycle rules and converter-Lambda filters from picking them up.
 */
function buildArtifactKey(tenantId: string, workflowId: string, version: string): string {
  return `workflows/${tenantId}/${workflowId}/${version}.zip`
}

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
async function provisionRuntimeServiceAccount(
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
// Router
// ---------------------------------------------------------------------------

export const workflowsHandler = new Hono<AppEnv>()

// Authenticate every workflows route through dualAuthMiddleware: the tenant
// SPA reaches the GET endpoints with a Cognito session, while the Python SDK
// CLI uploads with a vnd_ workflow_developer vendor key. Both resolve to the
// same AppEnv context, so the per-route requirePermission checks below are
// agnostic to which credential authenticated the request.
workflowsHandler.use('*', dualAuthMiddleware)

// ---------------------------------------------------------------------------
// POST /upload-url
//
// Issues a presigned PUT URL for the workflow zip. No row is created at this
// step — the row is written on POST / once the artifact has landed in S3.
// The returned `workflowId` must be passed back to finalize.
//
// Concurrent uploads of the same (name, version) both succeed at upload time;
// one wins the unique constraint at finalize, the other receives 409.
//
// Request:  { name, version, sizeBytes }
// Response: { data: { workflowId, uploadUrl, expiresInSeconds } } (201)
// ---------------------------------------------------------------------------
workflowsHandler.post(
  '/upload-url',
  requirePermission(Actions.UploadWorkflow),
  validator('json', (value, c) => {
    const r = UploadUrlBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to upload workflows', 'UNAUTHENTICATED')
    }
    const { name, version, sizeBytes } = c.req.valid('json')

    const repo = createWorkflowRepository(c.get('db'))
    const existing = await repo.findByNaturalKey(tenantId, name, version)
    if (existing) {
      return c.json(
        {
          error: `A workflow named ${name}@${version} already exists for this tenant`,
          code: 'CONFLICT',
        },
        409,
      )
    }

    const workflowId = randomUUID()
    const artifactKey = buildArtifactKey(tenantId, workflowId, version)
    const uploadUrl = await presignUpload({
      key: artifactKey,
      mimeType: ARTIFACT_MIME_TYPE,
      sizeBytes,
    })

    logger.info('Workflow upload-url issued', { workflowId, tenantId, name, version })

    return c.json(
      {
        data: {
          workflowId,
          uploadUrl,
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        },
      },
      201,
    )
  },
)

// ---------------------------------------------------------------------------
// POST /
//
// Finalize an upload by recording the row. Visibility is derived from the
// uploading tenant's isPlatformTenant flag — the client cannot influence it.
//
// Request:  { workflowId, manifest }
// Response: { data: WorkflowResponse } (201) | 409 (duplicate)
// ---------------------------------------------------------------------------
workflowsHandler.post(
  '/',
  requirePermission(Actions.UploadWorkflow),
  validator('json', (value, c) => {
    const r = FinalizeBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to upload workflows', 'UNAUTHENTICATED')
    }
    const { workflowId, manifest } = c.req.valid('json')
    const db = c.get('db')

    // Resolve visibility from the uploading tenant.
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { isPlatformTenant: true },
    })
    if (!tenant) {
      throw new DomainError('Tenant not found', 'NOT_FOUND')
    }
    const visibility: WorkflowVisibility = tenant.isPlatformTenant ? 'GLOBAL' : 'TENANT'

    // Create the workflow row and provision its runtime service account in one
    // transaction: the service-account TenantUser, its scoped vnd_ key, and the
    // KMS-encrypted credential columns all commit together or roll back together.
    const row = await db
      .$transaction(async (tx) => {
        const repo = createWorkflowRepository(tx as PrismaClient)
        const created = await repo.create({
          id: workflowId,
          tenantId,
          name: manifest.name,
          version: manifest.version,
          visibility,
          artifactKey: buildArtifactKey(tenantId, workflowId, manifest.version),
          manifest,
          createdByUserId: userId,
        })
        // Returns the row with the runtime columns the provisioning step wrote.
        return provisionRuntimeServiceAccount(tx, {
          tenantId,
          workflowId: created.id,
          createdById: userId,
        })
      })
      // P2002 = unique-constraint violation; (tenantId, name, version) already used.
      .catch((err: unknown) => {
        const code = (err as { code?: string }).code
        if (code === 'P2002') {
          return null
        }
        throw err
      })

    if (!row) {
      return c.json(
        {
          error: `A workflow named ${manifest.name}@${manifest.version} already exists for this tenant`,
          code: 'CONFLICT',
        },
        409,
      )
    }

    logger.info('Workflow finalized', {
      id: row.id,
      tenantId,
      name: row.name,
      version: row.version,
      visibility,
    })
    return c.json({ data: toResponse(row) }, 201)
  },
)

// ---------------------------------------------------------------------------
// GET /
//
// Lists every workflow visible to the caller's tenant: the tenant's own rows
// plus every GLOBAL row across the platform. Newest first.
//
// Response: { data: WorkflowResponse[], meta: { count } }
// ---------------------------------------------------------------------------
workflowsHandler.get('/', requirePermission(Actions.ReadWorkflow), async (c) => {
  const tenantId = c.get('tenantId')
  const repo = createWorkflowRepository(c.get('db'))
  const rows = await repo.listForTenant(tenantId)
  return c.json({ data: rows.map(toResponse), meta: { count: rows.length } })
})

// ---------------------------------------------------------------------------
// GET /:id
//
// Fetch one workflow. Visible if it belongs to the caller's tenant or has
// visibility=GLOBAL — otherwise 404 (deliberately indistinguishable from
// "does not exist" so we don't leak cross-tenant IDs).
// ---------------------------------------------------------------------------
workflowsHandler.get('/:id', requirePermission(Actions.ReadWorkflow), async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id') ?? ''
  const repo = createWorkflowRepository(c.get('db'))
  const row = await repo.findByIdForTenant(id, tenantId)
  if (!row) return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data: toResponse(row) })
})

// ---------------------------------------------------------------------------
// GET /:id/download-url
//
// Presigned GET for the workflow source zip — the Phase-1 stand-in for the
// "fork to my store" flow: tenants download a GLOBAL workflow's source and
// re-upload it under their own tenant.
// ---------------------------------------------------------------------------
workflowsHandler.get('/:id/download-url', requirePermission(Actions.ReadWorkflow), async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id') ?? ''
  const repo = createWorkflowRepository(c.get('db'))
  const row = await repo.findByIdForTenant(id, tenantId)
  if (!row) return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)

  const downloadUrl = await presignDownload(row.artifactKey)
  return c.json({
    data: {
      downloadUrl,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    },
  })
})

// ---------------------------------------------------------------------------
// POST /:id/fork
//
// One-click fork: copy a GLOBAL platform-library workflow into the caller's
// own tenant store. Replaces the Phase-1 download-and-reupload workaround.
//
// 404 if the source is not visible to the caller OR is not GLOBAL — only
// platform-library workflows are forkable (a tenant's own workflows already
// live in its store). 409 if the caller already has a workflow with the same
// (name, version). 201 with the new TENANT-visibility row otherwise.
//
// Response: { data: WorkflowResponse } (201) | 404 | 409
// ---------------------------------------------------------------------------
workflowsHandler.post('/:id/fork', requirePermission(Actions.UploadWorkflow), async (c) => {
  const tenantId = c.get('tenantId')
  const userId = c.get('userId')
  if (!userId) {
    throw new DomainError('Authenticated user required to fork workflows', 'UNAUTHENTICATED')
  }
  const id = c.req.param('id') ?? ''
  const repo = createWorkflowRepository(c.get('db'))

  const source = await repo.findByIdForTenant(id, tenantId)
  // Only GLOBAL workflows are forkable. A non-visible source and a visible
  // non-GLOBAL source both 404 — never leak which is which.
  if (!source || source.visibility !== 'GLOBAL') {
    return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
  }

  const db = c.get('db')
  // Fork the row and provision its runtime service account in one transaction.
  // The S3 artifact copy inside forkGlobalToTenant runs before the row insert;
  // a unique-key clash leaves only an orphan artifact, never a partial row.
  const row = await db
    .$transaction(async (tx) => {
      const txRepo = createWorkflowRepository(tx as PrismaClient)
      const forked = await txRepo.forkGlobalToTenant(source, tenantId, userId)
      return provisionRuntimeServiceAccount(tx, {
        tenantId,
        workflowId: forked.id,
        createdById: userId,
      })
    })
    // P2002 = unique-constraint violation; (tenantId, name, version) already used.
    .catch((err: unknown) => {
      const code = (err as { code?: string }).code
      if (code === 'P2002') {
        return null
      }
      throw err
    })

  if (!row) {
    return c.json(
      {
        error: `A workflow named ${source.name}@${source.version} already exists for this tenant`,
        code: 'CONFLICT',
      },
      409,
    )
  }

  logger.info('Workflow forked', {
    id: row.id,
    tenantId,
    forkedFromWorkflowId: source.id,
    forkedFromVersion: source.version,
  })
  return c.json({ data: toResponse(row) }, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/run
//
// Trigger a server-side execution of a workflow. Phase-2 contract:
//
//   - Only curated names (CURATED_WORKFLOW_NAMES) are executable. The worker
//     refuses to register anything else, so we reject 400 here for a clean
//     error story instead of letting the row sit QUEUED forever.
//   - The workflow's runtime account must exist. Workflows finalized BEFORE
//     Unit 3 lack runtime columns — they're lazily minted here on first run
//     in the same transaction as the QUEUED execution insert.
//   - The runtime token is NOT placed in Temporal workflow args (Temporal
//     history is durable; a credential there outlives the run). The worker
//     fetches the token from the broker by `executionId` at activity start.
//   - The Temporal workflow id is `wf/<tenantId>/<name>/<executionId>` with
//     REJECT_DUPLICATE — re-submission of the same execution returns the
//     existing handle instead of starting a second run.
//
// Request:  { input? }
// Response: { data: WorkflowExecutionResponse } (201) | 400 | 404 | 502
// ---------------------------------------------------------------------------
workflowsHandler.post(
  '/:id/run',
  requirePermission(Actions.RunWorkflow),
  validator('json', (value, c) => {
    // POST with no body is allowed — { input: {} } is the default.
    const inputValue = value == null ? {} : value
    const r = RunBody.safeParse(inputValue)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to run workflows', 'UNAUTHENTICATED')
    }
    const workflowId = c.req.param('id') ?? ''
    const { input } = c.req.valid('json')
    const db = c.get('db')

    const repo = createWorkflowRepository(db)
    const workflow = await repo.findByIdForTenant(workflowId, tenantId)
    if (!workflow) {
      return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
    }
    if (!CURATED_WORKFLOW_NAMES.has(workflow.name)) {
      return c.json(
        {
          error: `Workflow "${workflow.name}" is not in the executable allowlist (Phase 2 runs curated stdlib workflows only)`,
          code: 'WORKFLOW_NOT_EXECUTABLE',
        },
        400,
      )
    }

    // Single transaction: lazy-mint the runtime account if needed, then
    // insert the QUEUED execution. A failure rolls back both.
    const inserted = await db.$transaction(async (tx) => {
      const txClient = tx as PrismaClient
      if (!workflow.runtimeApiClientId || !workflow.runtimeTokenCiphertext) {
        // Pre-Unit-3 workflow — provision its runtime account now.
        await provisionRuntimeServiceAccount(tx, {
          tenantId,
          workflowId: workflow.id,
          createdById: userId,
        })
      }
      const execRepo = createWorkflowExecutionRepository(txClient)
      return execRepo.create({
        tenantId,
        workflowId: workflow.id,
        triggeredByUserId: userId,
        input: input as Prisma.InputJsonValue,
      })
    })

    // Start the Temporal workflow. If start_workflow throws, mark the
    // execution FAILED with the error so we don't leak QUEUED rows for
    // runtime failures.
    const temporalWorkflowId = `wf/${tenantId}/${workflow.name}/${inserted.id}`
    try {
      const client = await getTemporalClient()
      const handle = await client.workflow.start(workflow.name, {
        args: [{ executionId: inserted.id, input }],
        taskQueue: temporalTaskQueue(),
        workflowId: temporalWorkflowId,
        // Idempotent re-submit: if a previous call already started this id,
        // we'd rather error here than start a second run. The catch below
        // converts the WorkflowExecutionAlreadyStartedError into a 409.
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

      return c.json({ data: toExecutionResponse(running) }, 201)
    } catch (err) {
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

      return c.json(
        {
          error: `Failed to start workflow on Temporal: ${message}`,
          code: 'TEMPORAL_START_FAILED',
          data: failed ? toExecutionResponse(failed) : null,
        },
        502,
      )
    }
  },
)

// ---------------------------------------------------------------------------
// GET /:id/executions?limit=&before=
//
// Tenant-scoped paged list of executions for a workflow, newest first.
// `before` accepts the id of the last row on the previous page (cursor by
// (queuedAt, id) — robust to inserts during pagination).
// ---------------------------------------------------------------------------
workflowsHandler.get('/:id/executions', requirePermission(Actions.ReadWorkflow), async (c) => {
  const tenantId = c.get('tenantId')
  const workflowId = c.req.param('id') ?? ''
  const db = c.get('db')

  const repo = createWorkflowRepository(db)
  const workflow = await repo.findByIdForTenant(workflowId, tenantId)
  if (!workflow) {
    return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
  }

  const limitParam = c.req.query('limit')
  const before = c.req.query('before') ?? null
  let limit = LIST_DEFAULT_LIMIT
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return c.json({ error: 'limit must be a positive integer', code: 'VALIDATION_ERROR' }, 400)
    }
    limit = Math.min(parsed, LIST_MAX_LIMIT)
  }

  const execRepo = createWorkflowExecutionRepository(db)
  const rows = await execRepo.listByWorkflow(workflow.id, { limit, before })
  return c.json({
    data: rows.map(toExecutionResponse),
    meta: { count: rows.length, limit },
  })
})

// ---------------------------------------------------------------------------
// GET /:id/executions/:executionId
//
// Tenant-scoped fetch. 404 if the execution does not belong to this workflow
// or is not visible to the caller's tenant.
// ---------------------------------------------------------------------------
workflowsHandler.get(
  '/:id/executions/:executionId',
  requirePermission(Actions.ReadWorkflow),
  async (c) => {
    const tenantId = c.get('tenantId')
    const workflowId = c.req.param('id') ?? ''
    const executionId = c.req.param('executionId') ?? ''
    const db = c.get('db')

    const repo = createWorkflowRepository(db)
    const workflow = await repo.findByIdForTenant(workflowId, tenantId)
    if (!workflow) {
      return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
    }

    const execRepo = createWorkflowExecutionRepository(db)
    const row = await execRepo.findById(executionId)
    if (!row || row.workflowId !== workflow.id) {
      return c.json({ error: 'Execution not found', code: 'NOT_FOUND' }, 404)
    }
    return c.json({ data: toExecutionResponse(row) })
  },
)

// ---------------------------------------------------------------------------
// POST /:id/triggers
//
// Attach a trigger to a workflow the caller can see (own TENANT row or
// GLOBAL — same visibility rule as GET /:id). The trigger row itself always
// belongs to the caller's tenant, even on a GLOBAL workflow.
//
// Phase 3 Unit 2 contract: triggers are stored but NOTHING fires them yet.
// EVENT rows wait for the Unit 3 dispatcher; SCHEDULE rows are inert until
// Unit 4 realizes them as Temporal Schedules.
//
// Request:  { kind, eventType?, filter?, cronExpression?, enabled? }
// Response: { data: WorkflowTriggerResponse } (201) | 400 | 404
// ---------------------------------------------------------------------------
workflowsHandler.post(
  '/:id/triggers',
  requirePermission(Actions.ManageWorkflowTriggers),
  validator('json', (value, c) => {
    const r = CreateTriggerBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to manage triggers', 'UNAUTHENTICATED')
    }
    const workflowId = c.req.param('id') ?? ''
    const body = c.req.valid('json')
    const db = c.get('db')

    const repo = createWorkflowRepository(db)
    const workflow = await repo.findByIdForTenant(workflowId, tenantId)
    if (!workflow) {
      return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
    }

    const triggerRepo = createWorkflowTriggerRepository(db)
    const row = await triggerRepo.create({
      tenantId,
      workflowId: workflow.id,
      kind: body.kind,
      eventType: body.eventType ?? null,
      filter: body.filter !== undefined ? (body.filter as Prisma.InputJsonValue) : null,
      cronExpression: body.cronExpression ?? null,
      enabled: body.enabled,
      createdByUserId: userId,
    })

    logger.info('Workflow trigger created', {
      triggerId: row.id,
      workflowId: workflow.id,
      tenantId,
      kind: row.kind,
      eventType: row.eventType,
      enabled: row.enabled,
    })
    return c.json({ data: toTriggerResponse(row) }, 201)
  },
)

// ---------------------------------------------------------------------------
// GET /:id/triggers
//
// Tenant-scoped list of the caller's triggers on a workflow, newest first —
// including triggers the tenant attached to a GLOBAL workflow (each tenant
// only ever sees its own rows; the repo is auto-scoped via the extension).
// Read-level gate, mirroring GET /:id/executions.
// ---------------------------------------------------------------------------
workflowsHandler.get('/:id/triggers', requirePermission(Actions.ReadWorkflow), async (c) => {
  const tenantId = c.get('tenantId')
  const workflowId = c.req.param('id') ?? ''
  const db = c.get('db')

  const repo = createWorkflowRepository(db)
  const workflow = await repo.findByIdForTenant(workflowId, tenantId)
  if (!workflow) {
    return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
  }

  const triggerRepo = createWorkflowTriggerRepository(db)
  const rows = await triggerRepo.listByWorkflow(workflow.id)
  return c.json({ data: rows.map(toTriggerResponse), meta: { count: rows.length } })
})

// ---------------------------------------------------------------------------
// PATCH /:id/triggers/:triggerId
//
// Partial update: enabled (both kinds), eventType/filter (EVENT only),
// cronExpression (SCHEDULE only). `kind` is immutable — the body schema is
// strict, so a kind key (or any unknown key) is a 400. 404 if the trigger is
// not the caller-tenant's or does not belong to this workflow.
//
// Response: { data: WorkflowTriggerResponse } | 400 | 404
// ---------------------------------------------------------------------------
workflowsHandler.patch(
  '/:id/triggers/:triggerId',
  requirePermission(Actions.ManageWorkflowTriggers),
  validator('json', (value, c) => {
    const r = UpdateTriggerBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const workflowId = c.req.param('id') ?? ''
    const triggerId = c.req.param('triggerId') ?? ''
    const body = c.req.valid('json')
    const db = c.get('db')

    const repo = createWorkflowRepository(db)
    const workflow = await repo.findByIdForTenant(workflowId, tenantId)
    if (!workflow) {
      return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
    }

    const triggerRepo = createWorkflowTriggerRepository(db)
    // findById is tenant-scoped — another tenant's trigger resolves to null,
    // indistinguishable from "does not exist".
    const trigger = await triggerRepo.findById(triggerId)
    if (!trigger || trigger.workflowId !== workflow.id) {
      return c.json({ error: 'Trigger not found', code: 'NOT_FOUND' }, 404)
    }

    // Kind-conditional field validation against the (immutable) stored kind.
    if (trigger.kind === 'EVENT') {
      if (body.cronExpression !== undefined) {
        return c.json(
          { error: 'cronExpression is only valid for SCHEDULE triggers', code: 'VALIDATION_ERROR' },
          400,
        )
      }
      if (body.eventType !== undefined && !DOMAIN_EVENT_TYPE_SET.has(body.eventType)) {
        return c.json(
          {
            error: `eventType must be one of: ${DOMAIN_EVENT_TYPES.join(', ')}`,
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
      if (body.filter !== undefined && !isPlainJsonObject(body.filter)) {
        return c.json(
          { error: 'filter must be a plain JSON object', code: 'VALIDATION_ERROR' },
          400,
        )
      }
    } else {
      if (body.eventType !== undefined || body.filter !== undefined) {
        return c.json(
          { error: 'eventType/filter are only valid for EVENT triggers', code: 'VALIDATION_ERROR' },
          400,
        )
      }
      if (body.cronExpression !== undefined && !CRON_EXPRESSION_REGEX.test(body.cronExpression)) {
        return c.json(
          {
            error:
              'cronExpression must be 5 space-separated cron fields (minute hour day-of-month month day-of-week)',
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
    }

    const updateInput: {
      enabled?: boolean
      eventType?: string
      filter?: Prisma.InputJsonValue
      cronExpression?: string
    } = {}
    if (body.enabled !== undefined) updateInput.enabled = body.enabled
    if (body.eventType !== undefined) updateInput.eventType = body.eventType
    if (body.filter !== undefined) updateInput.filter = body.filter as Prisma.InputJsonValue
    if (body.cronExpression !== undefined) updateInput.cronExpression = body.cronExpression

    const updated = await triggerRepo.update(triggerId, updateInput)

    logger.info('Workflow trigger updated', {
      triggerId,
      workflowId: workflow.id,
      tenantId,
      enabled: updated.enabled,
    })
    return c.json({ data: toTriggerResponse(updated) })
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id/triggers/:triggerId
//
// Hard delete. Same scoping as PATCH: 404 if the trigger is not the
// caller-tenant's or does not belong to this workflow. 204 on success.
// ---------------------------------------------------------------------------
workflowsHandler.delete(
  '/:id/triggers/:triggerId',
  requirePermission(Actions.ManageWorkflowTriggers),
  async (c) => {
    const tenantId = c.get('tenantId')
    const workflowId = c.req.param('id') ?? ''
    const triggerId = c.req.param('triggerId') ?? ''
    const db = c.get('db')

    const repo = createWorkflowRepository(db)
    const workflow = await repo.findByIdForTenant(workflowId, tenantId)
    if (!workflow) {
      return c.json({ error: 'Workflow not found', code: 'NOT_FOUND' }, 404)
    }

    const triggerRepo = createWorkflowTriggerRepository(db)
    const trigger = await triggerRepo.findById(triggerId)
    if (!trigger || trigger.workflowId !== workflow.id) {
      return c.json({ error: 'Trigger not found', code: 'NOT_FOUND' }, 404)
    }

    await triggerRepo.deleteById(triggerId)

    logger.info('Workflow trigger deleted', { triggerId, workflowId: workflow.id, tenantId })
    return c.body(null, 204)
  },
)
