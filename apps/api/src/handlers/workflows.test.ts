// ---------------------------------------------------------------------------
// Unit tests for the workflows handler
//
// createWorkflowRepository is mocked so no DB is required.
// presignUpload / presignDownload are mocked so no AWS SDK is called.
// requirePermission is NOT mocked — the real implementation enforces RBAC.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRepo, mockTenantFindUnique, mockPresignUpload, mockPresignDownload } = vi.hoisted(
  () => ({
    mockRepo: {
      create: vi.fn(),
      findByIdForTenant: vi.fn(),
      listForTenant: vi.fn(),
      findByNaturalKey: vi.fn(),
    },
    mockTenantFindUnique: vi.fn(),
    mockPresignUpload: vi.fn(),
    mockPresignDownload: vi.fn(),
  }),
)

vi.mock('../repositories/workflow.repository', () => ({
  createWorkflowRepository: vi.fn(() => mockRepo),
}))

vi.mock('../lib/documents-s3', () => ({
  presignUpload: mockPresignUpload,
  presignDownload: mockPresignDownload,
}))

import { workflowsHandler } from './workflows'

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

function buildApp(
  roleNames: readonly string[] = ['tenant_admin'],
  userId: string | null = 'user-1',
) {
  const fakeDb = {
    tenant: { findUnique: mockTenantFindUnique },
  } as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', fakeDb)
    c.set('userId', userId ?? undefined)
    await next()
  })
  app.route('/', workflowsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2026-05-13T12:00:00Z')

const validManifest = {
  name: 'send_quote_followup',
  version: '1.0.0',
  entryPoints: ['workflows.send_quote_followup:SendQuoteFollowup'],
  description: 'Email a follow-up to the customer 3 days after a quote is sent.',
}

const mockRow = {
  id: 'wf-1',
  tenantId: 'test-tenant-id',
  name: validManifest.name,
  version: validManifest.version,
  visibility: 'TENANT' as const,
  artifactKey: 'workflows/test-tenant-id/wf-1/1.0.0.zip',
  manifest: validManifest,
  createdByUserId: 'user-1',
  createdAt: now,
  updatedAt: now,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workflows handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
    mockPresignUpload.mockResolvedValue('https://s3.example/put?sig=abc')
    mockPresignDownload.mockResolvedValue('https://s3.example/get?sig=xyz')
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('returns 403 when uploading without workflow_developer role', async () => {
      const res = await buildApp(['viewer']).request(
        '/upload-url',
        post({ name: 'x', version: '1.0.0', sizeBytes: 1024 }),
      )
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 on POST / without workflow_developer role', async () => {
      const res = await buildApp(['viewer']).request(
        '/',
        post({ workflowId: '00000000-0000-0000-0000-000000000001', manifest: validManifest }),
      )
      expect(res.status).toBe(403)
    })

    it('returns 403 listing when principal has no roles', async () => {
      const res = await buildApp([]).request('/')
      expect(res.status).toBe(403)
    })

    it('allows tenant_user to list (read baseline includes workflow:read)', async () => {
      mockRepo.listForTenant.mockResolvedValue([mockRow])
      const res = await buildApp(['viewer']).request('/')
      expect(res.status).toBe(200)
    })

    it('allows workflow_developer to upload', async () => {
      mockRepo.findByNaturalKey.mockResolvedValue(null)
      const res = await buildApp(['workflow_developer']).request(
        '/upload-url',
        post({ name: validManifest.name, version: validManifest.version, sizeBytes: 1024 }),
      )
      expect(res.status).toBe(201)
    })
  })

  // ── POST /upload-url ──────────────────────────────────────────────────────

  describe('POST /upload-url', () => {
    it('returns 400 on invalid name', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'Has Spaces', version: '1.0.0', sizeBytes: 1024 }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 on invalid version', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'wf', version: 'not-semver', sizeBytes: 1024 }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when sizeBytes exceeds limit', async () => {
      const res = await buildApp().request(
        '/upload-url',
        post({ name: 'wf', version: '1.0.0', sizeBytes: 999_999_999 }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 409 when (tenant, name, version) already exists', async () => {
      mockRepo.findByNaturalKey.mockResolvedValue(mockRow)
      const res = await buildApp().request(
        '/upload-url',
        post({ name: validManifest.name, version: validManifest.version, sizeBytes: 1024 }),
      )
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 201 with workflowId + uploadUrl on success', async () => {
      mockRepo.findByNaturalKey.mockResolvedValue(null)
      const res = await buildApp().request(
        '/upload-url',
        post({ name: validManifest.name, version: validManifest.version, sizeBytes: 2048 }),
      )
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(typeof body['workflowId']).toBe('string')
      expect(body['uploadUrl']).toBe('https://s3.example/put?sig=abc')
      expect(body['expiresInSeconds']).toBe(15 * 60)
      // S3 key path is server-derived and never leaks to the response.
      expect('artifactKey' in body).toBe(false)
    })
  })

  // ── POST / (finalize) ─────────────────────────────────────────────────────

  describe('POST /', () => {
    const workflowId = 'a1b2c3d4-e5f6-4789-89ab-cdef01234567'

    it('returns 400 on invalid manifest', async () => {
      const res = await buildApp().request(
        '/',
        post({ workflowId, manifest: { name: 'x', version: 'bad', entryPoints: ['x'] } }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 on invalid workflowId', async () => {
      const res = await buildApp().request(
        '/',
        post({ workflowId: 'not-a-uuid', manifest: validManifest }),
      )
      expect(res.status).toBe(400)
    })

    it('writes a TENANT-visibility row when tenant is not the platform tenant', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue({ ...mockRow, visibility: 'TENANT' })
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['visibility']).toBe('TENANT')
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'TENANT', tenantId: 'test-tenant-id' }),
      )
    })

    it('writes a GLOBAL-visibility row when tenant is flagged isPlatformTenant', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.create.mockResolvedValue({ ...mockRow, visibility: 'GLOBAL' })
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['visibility']).toBe('GLOBAL')
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'GLOBAL' }),
      )
    })

    it('returns 409 CONFLICT on unique-constraint violation (P2002)', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockRejectedValue(Object.assign(new Error('Unique'), { code: 'P2002' }))
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 422 when no authenticated user (UNAUTHENTICATED DomainError)', async () => {
      const res = await buildApp(['tenant_admin'], null).request(
        '/',
        post({ workflowId, manifest: validManifest }),
      )
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })

    it('strips artifactKey from the response', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      mockRepo.create.mockResolvedValue(mockRow)
      const res = await buildApp().request('/', post({ workflowId, manifest: validManifest }))
      const body = (await json(res)).data as JsonBody
      expect('artifactKey' in body).toBe(false)
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with the union of tenant + GLOBAL workflows', async () => {
      mockRepo.listForTenant.mockResolvedValue([
        mockRow,
        { ...mockRow, id: 'wf-2', visibility: 'GLOBAL' },
      ])
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(2)
      expect(data.every((r) => !('artifactKey' in r))).toBe(true)
      expect((body.meta as JsonBody)['count']).toBe(2)
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 with the workflow when visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(mockRow)
      const res = await buildApp().request('/wf-1')
      expect(res.status).toBe(200)
      expect(((await json(res)).data as JsonBody)['id']).toBe('wf-1')
    })

    it('returns 404 when not visible to this tenant', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── GET /:id/download-url ─────────────────────────────────────────────────

  describe('GET /:id/download-url', () => {
    it('returns 404 when workflow not visible', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(null)
      const res = await buildApp().request('/wf-1/download-url')
      expect(res.status).toBe(404)
    })

    it('returns 200 with presigned downloadUrl', async () => {
      mockRepo.findByIdForTenant.mockResolvedValue(mockRow)
      const res = await buildApp().request('/wf-1/download-url')
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['downloadUrl']).toBe('https://s3.example/get?sig=xyz')
      expect(body['expiresInSeconds']).toBe(5 * 60)
      expect(mockPresignDownload).toHaveBeenCalledWith(mockRow.artifactKey)
    })

    it('lets a tenant download a GLOBAL workflow it does not own', async () => {
      // The repo handles visibility; if it returns the row, the handler trusts it.
      mockRepo.findByIdForTenant.mockResolvedValue({
        ...mockRow,
        tenantId: 'platform-tenant-id',
        visibility: 'GLOBAL' as const,
      })
      const res = await buildApp().request('/wf-1/download-url')
      expect(res.status).toBe(200)
    })
  })
})
