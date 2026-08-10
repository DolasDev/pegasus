// ---------------------------------------------------------------------------
// Unit tests for the blob integration in call-external (sdk-feedback/0025):
// resolving {"$blob": id} in a request body to inline base64, and landing a
// partner response into a blob via response_to_blob. documents-s3 + config repo
// + fetch are mocked. requirePermission runs real Cedar (workflow_runtime).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'
import { __resetOutboundTokenCacheForTests } from '../services/outbound-oauth'

const {
  mockFindByKey,
  mockResolveDef,
  mockFetch,
  mockGetBuf,
  mockPutBuf,
  mockNewBlobId,
  mockBuildKey,
} = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockResolveDef: vi.fn(),
  mockFetch: vi.fn(),
  mockGetBuf: vi.fn(),
  mockPutBuf: vi.fn(),
  mockNewBlobId: vi.fn(),
  mockBuildKey: vi.fn(),
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))
vi.mock('../lib/secret-value-crypto', () => ({ decryptSecretValue: vi.fn() }))
vi.mock('../integration-validation/registry', () => ({
  resolveIntegrationDefinition: mockResolveDef,
}))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))
vi.mock('../lib/documents-s3', () => ({
  getObjectBuffer: mockGetBuf,
  putObjectBuffer: mockPutBuf,
  newBlobId: mockNewBlobId,
  buildBlobS3Key: mockBuildKey,
}))

import { integrationCallHandler } from './integration-call'

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
  app.route('/', integrationCallHandler)
  return app
}

const ROUTE = '/integrations/sirva_ade_document/call-external'

beforeEach(() => {
  vi.clearAllMocks()
  __resetOutboundTokenCacheForTests()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  vi.stubGlobal('fetch', mockFetch)
  mockResolveDef.mockResolvedValue({ id: 'sirva_ade_document' })
  mockBuildKey.mockImplementation((t: string, id: string) => `blobs/${t}/${id}`)
  mockNewBlobId.mockReturnValue('blob-out-1')
  // A 'none'-auth integration keeps the auth path out of these tests.
  mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
    if (kind === 'CONFIG' && key === 'BASE_URL')
      return { value: 'https://p.example.com', valueCiphertext: null }
    if (kind === 'CONFIG' && key === 'AUTH_MODE') return { value: 'none', valueCiphertext: null }
    return null
  })
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
    arrayBuffer: async () => Buffer.from('response-image-bytes'),
    headers: new Headers({ 'content-type': 'image/tiff' }),
  })
})

describe('call-external $blob body resolution', () => {
  it('resolves {"$blob": id} to inline base64 fetched server-side', async () => {
    mockGetBuf.mockResolvedValue(Buffer.from('PDF-BYTES'))
    const res = await buildApp().request(
      ROUTE,
      post({
        method: 'POST',
        path: '/Imaging/m3/AddDocument',
        body: { ReferenceNumber: 'R1', FileData: { $blob: 'blob-in-1' } },
      }),
    )
    expect(res.status).toBe(200)
    expect(mockGetBuf).toHaveBeenCalledWith('blobs/test-tenant-id/blob-in-1')
    // The outbound body carried base64 in place of the $blob ref.
    const sentBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string)
    expect(sentBody.FileData).toBe(Buffer.from('PDF-BYTES').toString('base64'))
    expect(sentBody.ReferenceNumber).toBe('R1')
  })

  it('413 — a $blob over the inline cap is rejected before sending', async () => {
    mockGetBuf.mockResolvedValue(Buffer.alloc(6 * 1024 * 1024)) // > 5 MB inline cap
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'POST', path: '/x', body: { FileData: { $blob: 'big' } } }),
    )
    expect(res.status).toBe(413)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — a $blob referencing a missing blob', async () => {
    mockGetBuf.mockRejectedValue(new Error('NoSuchKey'))
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'POST', path: '/x', body: { FileData: { $blob: 'gone' } } }),
    )
    expect(res.status).toBe(404)
  })
})

describe('call-external response_to_blob', () => {
  it('lands the response body into a blob and returns blobId', async () => {
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/IMAGING/m2/GetImage', responseToBlob: true }),
    )
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data['blobId']).toBe('blob-out-1')
    expect(data['size']).toBe(Buffer.from('response-image-bytes').length)
    expect(mockPutBuf).toHaveBeenCalledWith(
      'blobs/test-tenant-id/blob-out-1',
      Buffer.from('response-image-bytes'),
      'image/tiff',
    )
  })

  it('413 — a response over the inline cap is not landed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      arrayBuffer: async () => Buffer.alloc(6 * 1024 * 1024),
      headers: new Headers({ 'content-type': 'image/tiff' }),
    })
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/big', responseToBlob: true }),
    )
    expect(res.status).toBe(413)
    expect(mockPutBuf).not.toHaveBeenCalled()
  })
})
