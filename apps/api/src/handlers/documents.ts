// ---------------------------------------------------------------------------
// Documents handler — polymorphic file attachments via S3 presigned URLs.
//
// Upload state machine:
//
//   POST /upload-url          → row created in PENDING_UPLOAD state, presigned PUT issued
//   client PUT to S3
//   POST /:id/finalize        → row promoted to ACTIVE
//   GET  /:id/download-url    → presigned GET (only if ACTIVE)
//   GET  /entity/:type/:id    → list ACTIVE documents
//   DELETE /:id               → soft delete (PENDING_DELETION)
//   PATCH  /:id/archive       → mark ARCHIVED
//
// Per project convention there is NO try/catch in this handler — errors
// bubble up to `app.onError` which renders DomainError as 422 and unknown
// failures as 500. Response bodies never contain `s3Bucket` or `s3Key`.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import {
  archiveDocument,
  createPendingDocument,
  finalizeDocument,
  findDocumentById,
  findDocumentByIdWithLocation,
  listDocumentsForEntity,
  softDeleteDocument,
} from '../repositories'
import {
  buildS3Key,
  documentsBucketName,
  presignDownload,
  presignUpload,
} from '../lib/documents-s3'

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const UPLOAD_URL_TTL_SECONDS = 15 * 60
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.',
  'text/',
] as const

const ALLOWED_ENTITY_TYPES = new Set(['customer', 'quote', 'move', 'invoice'])

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateUploadBody = z.object({
  entityType: z.string().refine((v) => ALLOWED_ENTITY_TYPES.has(v), {
    message: 'entityType must be one of customer, quote, move, invoice',
  }),
  entityId: z.string().min(1),
  documentType: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().refine(isAllowedMime, { message: 'mimeType is not allowed' }),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  category: z.string().min(1).optional(),
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const documentsHandler = new Hono<AppEnv>()

// POST /api/v1/documents/upload-url -------------------------------------------------
documentsHandler.post(
  '/upload-url',
  validator('json', (value, c) => {
    const r = CreateUploadBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to upload documents', 'UNAUTHENTICATED')
    }
    const body = c.req.valid('json')

    // Generate the id up front so the S3 key is final on the first INSERT —
    // avoids a follow-up UPDATE just to rewrite a placeholder key.
    const documentId = randomUUID()
    const s3Key = buildS3Key({
      tenantId,
      entityType: body.entityType,
      entityId: body.entityId,
      documentId,
      filename: body.filename,
    })

    const reserved = await createPendingDocument(db, {
      id: documentId,
      tenantId,
      entityType: body.entityType,
      entityId: body.entityId,
      documentType: body.documentType,
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      uploadedBy: userId,
      s3Bucket: documentsBucketName(),
      s3Key,
      ...(body.category !== undefined ? { category: body.category } : {}),
    })

    const uploadUrl = await presignUpload({
      key: s3Key,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    })

    return c.json(
      {
        data: {
          documentId: reserved.document.id,
          uploadUrl,
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        },
      },
      201,
    )
  },
)

// POST /api/v1/documents/:documentId/finalize ---------------------------------------
documentsHandler.post('/:documentId/finalize', async (c) => {
  const db = c.get('db')
  const id = c.req.param('documentId')
  const data = await finalizeDocument(db, id)
  if (!data) return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data })
})

// GET /api/v1/documents/:documentId/download-url ------------------------------------
documentsHandler.get('/:documentId/download-url', async (c) => {
  const db = c.get('db')
  const id = c.req.param('documentId')
  const found = await findDocumentByIdWithLocation(db, id)
  // Fold "missing" and "not yet ACTIVE" into the same response so an attacker
  // cannot probe for the existence of pending uploads.
  if (!found || found.document.status !== 'ACTIVE') {
    return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404)
  }
  const downloadUrl = await presignDownload(found.s3Key)
  return c.json({
    data: {
      downloadUrl,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    },
  })
})

// GET /api/v1/documents/entity/:entityType/:entityId --------------------------------
documentsHandler.get('/entity/:entityType/:entityId', async (c) => {
  const db = c.get('db')
  const entityType = c.req.param('entityType')
  const entityId = c.req.param('entityId')
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return c.json({ error: 'Invalid entityType', code: 'VALIDATION_ERROR' }, 400)
  }
  const data = await listDocumentsForEntity(db, entityType, entityId)
  return c.json({ data, meta: { count: data.length } })
})

// GET /api/v1/documents/:documentId -------------------------------------------------
documentsHandler.get('/:documentId', async (c) => {
  const db = c.get('db')
  const id = c.req.param('documentId')
  const data = await findDocumentById(db, id)
  if (!data) return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data })
})

// DELETE /api/v1/documents/:documentId ----------------------------------------------
documentsHandler.delete('/:documentId', async (c) => {
  const db = c.get('db')
  const id = c.req.param('documentId')
  const data = await softDeleteDocument(db, id)
  if (!data) return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data })
})

// PATCH /api/v1/documents/:documentId/archive ---------------------------------------
documentsHandler.patch('/:documentId/archive', async (c) => {
  const db = c.get('db')
  const id = c.req.param('documentId')
  const data = await archiveDocument(db, id)
  if (!data) return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data })
})
