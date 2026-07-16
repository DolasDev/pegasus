// ---------------------------------------------------------------------------
// /api/v1/blobs — opaque byte storage for workflows (sdk-feedback/0025).
//
// A workflow stages binary files it will upload (e.g. an ADE shipment document)
// or lands binary files it retrieves, without materializing them in workflow
// memory or proxying them through the API Lambda (whose payload ceiling is a few
// MB). Bytes flow runner↔S3 directly via presigned URLs:
//
//   POST /blobs/upload-url            WriteBlob  { contentType, sizeBytes }
//        -> { blobId, uploadUrl, expiresInSeconds }   (client PUTs bytes to S3)
//   GET  /blobs/:blobId/download-url  ReadBlob
//        -> { downloadUrl, expiresInSeconds }          (client GETs bytes from S3)
//
// Isolation is by construction: the S3 key is `blobs/{tenantId}/{blobId}` built
// from the REQUESTING tenant, so a tenant can only ever address its own blobs.
// TTL is an S3 lifecycle rule on the `blobs/` prefix (see documents-stack.ts).
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import {
  buildBlobS3Key,
  newBlobId,
  presignUpload,
  presignDownload,
  headObject,
} from '../lib/documents-s3'

/** Documented size cap for a blob (200 MB — covers the ADE GetImage ceiling). */
export const BLOB_MAX_BYTES = 200 * 1024 * 1024

/** Opaque blob-id shape (minted as a uuid; validated to bar path traversal). */
const BLOB_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

const UploadUrlBody = z
  .object({
    contentType: z.string().min(1).max(256).default('application/octet-stream'),
    sizeBytes: z.number().int().positive(),
  })
  .strict()

export const blobsHandler = new Hono<AppEnv>()

blobsHandler.use('*', dualAuthMiddleware)

// POST /blobs/upload-url — mint a blobId + presigned PUT (size/type baked in).
blobsHandler.post(
  '/blobs/upload-url',
  requirePermission(Actions.WriteBlob),
  validator('json', (value, c) => {
    const r = UploadUrlBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    if (!tenantId) throw new DomainError('Authenticated tenant required', 'UNAUTHENTICATED')
    const { contentType, sizeBytes } = c.req.valid('json')
    if (sizeBytes > BLOB_MAX_BYTES) {
      return c.json(
        {
          error: `sizeBytes exceeds the ${BLOB_MAX_BYTES}-byte blob cap`,
          code: 'VALIDATION_ERROR',
        },
        413,
      )
    }
    const blobId = newBlobId()
    const key = buildBlobS3Key(tenantId, blobId)
    const uploadUrl = await presignUpload({ key, mimeType: contentType, sizeBytes })
    return c.json({ data: { blobId, uploadUrl, expiresInSeconds: 15 * 60 } }, 201)
  },
)

// GET /blobs/:blobId/download-url — presigned GET for a blob the tenant owns.
blobsHandler.get('/blobs/:blobId/download-url', requirePermission(Actions.ReadBlob), async (c) => {
  const tenantId = c.get('tenantId')
  if (!tenantId) throw new DomainError('Authenticated tenant required', 'UNAUTHENTICATED')
  const blobId = c.req.param('blobId') ?? ''
  if (!BLOB_ID_RE.test(blobId)) {
    return c.json({ error: 'invalid blobId', code: 'VALIDATION_ERROR' }, 400)
  }
  const key = buildBlobS3Key(tenantId, blobId)
  // Confirm the object exists (and, by the tenant-prefixed key, belongs to this
  // tenant) before signing — a missing/expired blob is a 404, not a dead URL.
  const head = await headObject(key)
  if (!head) return c.json({ error: 'Blob not found', code: 'NOT_FOUND' }, 404)
  const downloadUrl = await presignDownload(key)
  return c.json({ data: { downloadUrl, expiresInSeconds: 5 * 60, size: head.sizeBytes } })
})
