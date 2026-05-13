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
//
// Visibility is derived server-side: tenants flagged isPlatformTenant=true
// upload as GLOBAL; everyone else uploads as TENANT. There is no client-facing
// way to set visibility — that is the whole point of the platform-tenant gate.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { DomainError } from '@pegasus/domain'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { createWorkflowRepository } from '../repositories/workflow.repository'
import type { WorkflowRow, WorkflowVisibility } from '../repositories/workflow.repository'
import type { AppEnv } from '../types'
import { presignDownload, presignUpload } from '../lib/documents-s3'
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

const ManifestSchema = z.object({
  name: z.string().regex(NAME_REGEX, {
    message: 'name must be lowercase letters/digits/_/-, 1–64 chars',
  }),
  version: z.string().regex(VERSION_REGEX, {
    message: 'version must be semver (e.g. 1.2.3 or 1.2.3-beta.1)',
  }),
  entryPoints: z.array(z.string().min(1)).min(1),
  description: z.string().optional(),
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
  createdAt: string
  updatedAt: string
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const workflowsHandler = new Hono<AppEnv>()

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

    const repo = createWorkflowRepository(db)
    const row = await repo
      .create({
        id: workflowId,
        tenantId,
        name: manifest.name,
        version: manifest.version,
        visibility,
        artifactKey: buildArtifactKey(tenantId, workflowId, manifest.version),
        manifest,
        createdByUserId: userId,
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
