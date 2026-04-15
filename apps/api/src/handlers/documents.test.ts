// ---------------------------------------------------------------------------
// Unit tests for the documents handler.
//
// The S3 helper is mocked so the test never touches AWS, and the repository
// is mocked so the test never touches Postgres. Critical assertion: response
// bodies must NEVER contain `s3Bucket` / `s3Key`.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

vi.mock('../lib/documents-s3', () => ({
  buildS3Key: vi.fn(() => 'tenant-1/customer/cust-1/doc-1/file.pdf'),
  documentsBucketName: vi.fn(() => 'pegasus-documents-test'),
  presignUpload: vi.fn(async () => 'https://s3.example/put?sig=mock'),
  presignDownload: vi.fn(async () => 'https://s3.example/get?sig=mock'),
}))

vi.mock('../repositories', () => ({
  createPendingDocument: vi.fn(),
  finalizeDocument: vi.fn(),
  findDocumentById: vi.fn(),
  findDocumentByIdWithLocation: vi.fn(),
  listDocumentsForEntity: vi.fn(),
  softDeleteDocument: vi.fn(),
  archiveDocument: vi.fn(),
}))

import { documentsHandler } from './documents'
import {
  createPendingDocument,
  finalizeDocument,
  findDocumentById,
  findDocumentByIdWithLocation,
  listDocumentsForEntity,
  softDeleteDocument,
  archiveDocument,
} from '../repositories'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('userId', 'user-1')
    c.set('db', {} as unknown as PrismaClient)
    await next()
  })
  app.route('/', documentsHandler)
  return app
}

const mockDoc = {
  id: 'doc-1',
  entityType: 'customer',
  entityId: 'cust-1',
  documentType: 'contract',
  filename: 'agreement.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1234,
  status: 'ACTIVE',
  uploadedBy: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const validUploadBody = {
  entityType: 'customer',
  entityId: 'cust-1',
  documentType: 'contract',
  filename: 'agreement.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1234,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// POST /upload-url
// ---------------------------------------------------------------------------

describe('POST /upload-url', () => {
  it('returns 201 with documentId + uploadUrl and never leaks s3Key', async () => {
    ;(createPendingDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      document: { ...mockDoc, status: 'PENDING_UPLOAD' },
      s3Bucket: 'pegasus-documents-test',
      s3Key: 'pending',
    })

    const app = buildApp()
    const res = await app.request('/upload-url', post(validUploadBody))

    expect(res.status).toBe(201)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['documentId']).toBe('doc-1')
    expect(data['uploadUrl']).toMatch(/^https:\/\/s3\.example\/put/)
    expect(data['expiresInSeconds']).toBe(900)

    // Critical: snapshot the response keys to ensure no S3 internals leak.
    expect(Object.keys(data).sort()).toEqual(['documentId', 'expiresInSeconds', 'uploadUrl'])
    expect(JSON.stringify(body)).not.toContain('s3Key')
    expect(JSON.stringify(body)).not.toContain('s3Bucket')
  })

  it('rejects oversize uploads with 400', async () => {
    const app = buildApp()
    const res = await app.request(
      '/upload-url',
      post({ ...validUploadBody, sizeBytes: 200 * 1024 * 1024 }),
    )
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('rejects disallowed mime types with 400', async () => {
    const app = buildApp()
    const res = await app.request(
      '/upload-url',
      post({ ...validUploadBody, mimeType: 'application/x-msdownload' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown entity types with 400', async () => {
    const app = buildApp()
    const res = await app.request('/upload-url', post({ ...validUploadBody, entityType: 'foo' }))
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /:id/finalize
// ---------------------------------------------------------------------------

describe('POST /:documentId/finalize', () => {
  it('returns the updated document on success', async () => {
    ;(finalizeDocument as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc)
    const app = buildApp()
    const res = await app.request('/doc-1/finalize', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body['data'] as Record<string, unknown>)['id']).toBe('doc-1')
  })

  it('returns 404 when missing', async () => {
    ;(finalizeDocument as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/doc-1/finalize', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /:id/download-url
// ---------------------------------------------------------------------------

describe('GET /:documentId/download-url', () => {
  it('returns a presigned URL when ACTIVE and never leaks s3Key', async () => {
    ;(findDocumentByIdWithLocation as ReturnType<typeof vi.fn>).mockResolvedValue({
      document: mockDoc,
      s3Bucket: 'pegasus-documents-test',
      s3Key: 'tenant-1/customer/cust-1/doc-1/file.pdf',
    })

    const app = buildApp()
    const res = await app.request('/doc-1/download-url')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['downloadUrl']).toMatch(/^https:\/\/s3\.example\/get/)
    expect(Object.keys(data).sort()).toEqual(['downloadUrl', 'expiresInSeconds'])
    expect(JSON.stringify(body)).not.toContain('s3Key')
    expect(JSON.stringify(body)).not.toContain('s3Bucket')
  })

  it('returns 404 when document missing', async () => {
    ;(findDocumentByIdWithLocation as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/doc-1/download-url')
    expect(res.status).toBe(404)
  })

  it('returns 404 when document is PENDING_UPLOAD (does not distinguish from missing)', async () => {
    ;(findDocumentByIdWithLocation as ReturnType<typeof vi.fn>).mockResolvedValue({
      document: { ...mockDoc, status: 'PENDING_UPLOAD' },
      s3Bucket: 'pegasus-documents-test',
      s3Key: 'tenant-1/customer/cust-1/doc-1/file.pdf',
    })
    const app = buildApp()
    const res = await app.request('/doc-1/download-url')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /entity/:entityType/:entityId
// ---------------------------------------------------------------------------

describe('GET /entity/:entityType/:entityId', () => {
  it('returns a list with meta.count', async () => {
    ;(listDocumentsForEntity as ReturnType<typeof vi.fn>).mockResolvedValue([mockDoc, mockDoc])
    const app = buildApp()
    const res = await app.request('/entity/customer/cust-1')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body['meta'] as Record<string, unknown>)['count']).toBe(2)
    expect(JSON.stringify(body)).not.toContain('s3Key')
  })

  it('rejects unknown entity types with 400', async () => {
    const app = buildApp()
    const res = await app.request('/entity/foo/bar')
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// DELETE / PATCH archive
// ---------------------------------------------------------------------------

describe('DELETE /:documentId', () => {
  it('soft-deletes', async () => {
    ;(softDeleteDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockDoc,
      status: 'PENDING_DELETION',
    })
    const app = buildApp()
    const res = await app.request('/doc-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
  })

  it('returns 404 when missing', async () => {
    ;(softDeleteDocument as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/doc-1', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /:documentId/archive', () => {
  it('archives', async () => {
    ;(archiveDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockDoc,
      status: 'ARCHIVED',
    })
    const app = buildApp()
    const res = await app.request('/doc-1/archive', { method: 'PATCH' })
    expect(res.status).toBe(200)
  })
})

describe('GET /:documentId', () => {
  it('returns the document and never leaks s3 fields', async () => {
    ;(findDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc)
    const app = buildApp()
    const res = await app.request('/doc-1')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(JSON.stringify(body)).not.toContain('s3Key')
    expect(JSON.stringify(body)).not.toContain('s3Bucket')
  })
})
