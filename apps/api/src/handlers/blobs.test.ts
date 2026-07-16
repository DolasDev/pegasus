// ---------------------------------------------------------------------------
// Unit tests for the blobs handler (sdk-feedback/0025).
//
// documents-s3 is mocked (no S3); requirePermission is NOT mocked — real Cedar
// RBAC runs, so Read/WriteBlob gate workflow_runtime✓ and workflow_developer✗.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { mockPresignUpload, mockPresignDownload, mockHeadObject, mockNewBlobId, mockBuildKey } =
  vi.hoisted(() => ({
    mockPresignUpload: vi.fn(),
    mockPresignDownload: vi.fn(),
    mockHeadObject: vi.fn(),
    mockNewBlobId: vi.fn(),
    mockBuildKey: vi.fn(),
  }))

vi.mock('../lib/documents-s3', () => ({
  presignUpload: mockPresignUpload,
  presignDownload: mockPresignDownload,
  headObject: mockHeadObject,
  newBlobId: mockNewBlobId,
  buildBlobS3Key: mockBuildKey,
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { blobsHandler, BLOB_MAX_BYTES } from './blobs'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = {} as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', fakeDb)
    c.set('tenantId', 'test-tenant-id')
    await next()
  })
  app.route('/', blobsHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  mockNewBlobId.mockReturnValue('blob-uuid-1')
  mockBuildKey.mockImplementation((t: string, id: string) => `blobs/${t}/${id}`)
  mockPresignUpload.mockResolvedValue('https://s3.test/put')
  mockPresignDownload.mockResolvedValue('https://s3.test/get')
  mockHeadObject.mockResolvedValue({ sizeBytes: 1234 })
})

describe('POST /blobs/upload-url', () => {
  it('201 — mints a blobId + presigned PUT for workflow_runtime', async () => {
    const res = await buildApp(['workflow_runtime']).request(
      '/blobs/upload-url',
      post({ contentType: 'application/pdf', sizeBytes: 2048 }),
    )
    expect(res.status).toBe(201)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({ blobId: 'blob-uuid-1', uploadUrl: 'https://s3.test/put' })
    expect(mockBuildKey).toHaveBeenCalledWith('test-tenant-id', 'blob-uuid-1')
    expect(mockPresignUpload).toHaveBeenCalledWith({
      key: 'blobs/test-tenant-id/blob-uuid-1',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    })
  })

  it('413 — over the size cap is rejected', async () => {
    const res = await buildApp().request(
      '/blobs/upload-url',
      post({ sizeBytes: BLOB_MAX_BYTES + 1 }),
    )
    expect(res.status).toBe(413)
    expect(mockPresignUpload).not.toHaveBeenCalled()
  })

  it('403 — workflow_developer lacks WriteBlob', async () => {
    const res = await buildApp(['workflow_developer']).request(
      '/blobs/upload-url',
      post({ sizeBytes: 10 }),
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /blobs/:blobId/download-url', () => {
  it('200 — presigned GET for an existing tenant blob', async () => {
    const res = await buildApp(['workflow_runtime']).request('/blobs/blob-uuid-1/download-url')
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({ downloadUrl: 'https://s3.test/get', size: 1234 })
    expect(mockBuildKey).toHaveBeenCalledWith('test-tenant-id', 'blob-uuid-1')
  })

  it('404 — a missing/expired blob (headObject null)', async () => {
    mockHeadObject.mockResolvedValue(null)
    const res = await buildApp().request('/blobs/gone/download-url')
    expect(res.status).toBe(404)
    expect(mockPresignDownload).not.toHaveBeenCalled()
  })

  it('400 — an invalid blobId (path-traversal shape)', async () => {
    const res = await buildApp().request('/blobs/..%2Fother/download-url')
    expect(res.status).toBe(400)
  })

  it('403 — workflow_developer lacks ReadBlob', async () => {
    const res = await buildApp(['workflow_developer']).request('/blobs/blob-uuid-1/download-url')
    expect(res.status).toBe(403)
  })
})
