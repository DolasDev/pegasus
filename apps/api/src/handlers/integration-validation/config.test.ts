// ---------------------------------------------------------------------------
// Unit tests for the integration-config handler (publish / validate / versions
// / rollback).
//
// Mirrors the workflows.test.ts pattern:
//   - createIntegrationConfigRepository is mocked so no DB is required.
//   - runGatePipeline is mocked so each test controls the gate verdict.
//   - getIntegrationDefinition / refreshRegistryOverlay are mocked (no registry
//     state, no real Prisma overlay refresh).
//   - dualAuthMiddleware is a context-injecting stub — the real dispatch is
//     covered by dual-auth.test.ts. buildApp picks roleNames/userId per test.
//   - requirePermission is NOT mocked — the real implementation enforces RBAC.
//
// The INTEGRATION_CONFIG_PUBLISH_ENABLED master switch is driven via process.env:
// enabled by default in beforeEach, flipped off for the FEATURE_DISABLED cases.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import { _clearAuthzCache } from '../../lib/authz'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockRepo,
  mockTenantFindUnique,
  mockGetIntegrationDefinition,
  mockRefreshRegistryOverlay,
  mockRunGatePipeline,
} = vi.hoisted(() => ({
  mockRepo: {
    publish: vi.fn(),
    findActiveForScope: vi.fn(),
    listVersions: vi.fn(),
    findVersion: vi.fn(),
  },
  mockTenantFindUnique: vi.fn(),
  mockGetIntegrationDefinition: vi.fn(),
  mockRefreshRegistryOverlay: vi.fn(async () => {}),
  mockRunGatePipeline: vi.fn(),
}))

vi.mock('../../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: vi.fn(() => mockRepo),
}))

vi.mock('../../integration-validation/registry', () => ({
  getIntegrationDefinition: mockGetIntegrationDefinition,
  refreshRegistryOverlay: mockRefreshRegistryOverlay,
}))

vi.mock('../../integration-validation/gate-pipeline', () => ({
  runGatePipeline: mockRunGatePipeline,
}))

// The base Prisma client is only passed through to the (mocked) overlay refresh;
// stub the module so importing the handler never builds a real client.
vi.mock('../../db', () => ({ db: {} }))

// dualAuthMiddleware is replaced with a context-injecting stub — its real
// dispatch (Cognito vs vnd_ vs SKIP_AUTH) is covered by dual-auth.test.ts.
vi.mock('../../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { integrationConfigHandler } from './config'
import { dualAuthMiddleware } from '../../middleware/dual-auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
}

function buildApp(
  roleNames: readonly string[] = ['integration_publisher'],
  userId: string | null = 'user-1',
  tenantId: string | null = 'test-tenant-id',
) {
  const fakeDb = {
    tenant: { findUnique: mockTenantFindUnique },
  } as unknown as PrismaClient
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    if (tenantId) c.set('tenantId', tenantId)
    c.set('principal', {
      sub: 'test-sub',
      tenantId: tenantId ?? 'test-tenant-id',
      roleNames: [...roleNames],
    })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', userId ?? undefined)
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/', integrationConfigHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2026-06-19T12:00:00Z')

// A sentinel "base definition" — getIntegrationDefinition is mocked, so the
// handler only checks truthiness; the real shape is exercised by the gate tests.
const baseDef = { id: 'longhaul' } as unknown

const okReport = { ok: true, problems: [], corpus: { total: 1, passed: 1, failures: [] } }
const failReport = {
  ok: false,
  problems: [{ stage: 'mapping', where: 'shipments', problem: 'unmapped' }],
  corpus: { total: 1, passed: 0, failures: [] },
}

const validBody = {
  mapping: { shipments: '$.shipments' },
  rules: [{ id: 'trip-must-have-shipments', field: 'shipments' }],
  corpus: [
    { name: 'clean', input: { order: {}, action: 'save' }, expected: { valid: true, ruleIds: [] } },
  ],
}

const configRow = {
  id: 'cfg-1',
  tenantId: 'test-tenant-id',
  integrationId: 'longhaul',
  version: 3,
  visibility: 'TENANT' as const,
  status: 'PUBLISHED' as const,
  mapping: validBody.mapping,
  rules: validBody.rules,
  corpus: validBody.corpus,
  gateReport: okReport,
  publishedBy: 'user-1',
  createdAt: now,
}

const PATH = '/integrations/longhaul/config'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration-config handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'true'
    _clearAuthzCache()
    mockGetIntegrationDefinition.mockReturnValue(baseDef)
    mockRunGatePipeline.mockReturnValue(okReport)
    mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
    mockRepo.publish.mockResolvedValue(configRow)
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('returns 403 publishing without PublishIntegrationConfig (viewer)', async () => {
      const res = await buildApp(['viewer']).request(PATH, post(validBody))
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 403 reading the active config without ReadIntegrationConfig (viewer)', async () => {
      const res = await buildApp(['viewer']).request(PATH)
      expect(res.status).toBe(403)
    })

    it('allows integration_publisher to publish', async () => {
      const res = await buildApp(['integration_publisher']).request(PATH, post(validBody))
      expect(res.status).toBe(201)
    })

    it('allows tenant_admin to publish (covers both actions implicitly)', async () => {
      const res = await buildApp(['tenant_admin']).request(PATH, post(validBody))
      expect(res.status).toBe(201)
    })

    it('allows dry-run validate for integration_publisher', async () => {
      const res = await buildApp(['integration_publisher']).request(
        `${PATH}/validate`,
        post(validBody),
      )
      expect(res.status).toBe(200)
    })
  })

  // ── POST /config/validate (dry-run) ─────────────────────────────────────────

  describe('POST /config/validate', () => {
    it('returns 400 on a malformed body', async () => {
      const res = await buildApp().request(`${PATH}/validate`, post({ mapping: {}, rules: {} }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 for an unknown integration', async () => {
      mockGetIntegrationDefinition.mockReturnValue(undefined)
      const res = await buildApp().request('/integrations/ghost/config/validate', post(validBody))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 200 with the gate report and never writes', async () => {
      const res = await buildApp().request(`${PATH}/validate`, post(validBody))
      expect(res.status).toBe(200)
      expect((await json(res)).data).toEqual(okReport)
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 200 with a failing report (dry-run does not error on gate failure)', async () => {
      mockRunGatePipeline.mockReturnValue(failReport)
      const res = await buildApp().request(`${PATH}/validate`, post(validBody))
      expect(res.status).toBe(200)
      expect(((await json(res)).data as JsonBody)['ok']).toBe(false)
    })

    it('is available even when the publish master switch is off', async () => {
      process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'false'
      const res = await buildApp().request(`${PATH}/validate`, post(validBody))
      expect(res.status).toBe(200)
    })
  })

  // ── POST /config (publish) ──────────────────────────────────────────────────

  describe('POST /config', () => {
    it('returns 403 FEATURE_DISABLED when the master switch is off', async () => {
      process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'false'
      const res = await buildApp().request(PATH, post(validBody))
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FEATURE_DISABLED')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 400 on a malformed body', async () => {
      const res = await buildApp().request(PATH, post({ mapping: {}, rules: {}, corpus: 'nope' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 for an unknown integration', async () => {
      mockGetIntegrationDefinition.mockReturnValue(undefined)
      const res = await buildApp().request('/integrations/ghost/config', post(validBody))
      expect(res.status).toBe(404)
    })

    it('returns 422 GATE_FAILED with the report and writes nothing', async () => {
      mockRunGatePipeline.mockReturnValue(failReport)
      const res = await buildApp().request(PATH, post(validBody))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('GATE_FAILED')
      expect((body.report as JsonBody)['ok']).toBe(false)
      expect(mockRepo.publish).not.toHaveBeenCalled()
      expect(mockRefreshRegistryOverlay).not.toHaveBeenCalled()
    })

    it('returns 422 UNAUTHENTICATED when no tenant context', async () => {
      const res = await buildApp(['integration_publisher'], 'user-1', null).request(
        PATH,
        post(validBody),
      )
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })

    it('returns 422 UNAUTHENTICATED when no authenticated user', async () => {
      const res = await buildApp(['integration_publisher'], null).request(PATH, post(validBody))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('UNAUTHENTICATED')
    })

    it('publishes a TENANT-visibility row for a non-platform tenant', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: false })
      const res = await buildApp().request(PATH, post(validBody))
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['visibility']).toBe('TENANT')
      expect(body['version']).toBe(3)
      expect(mockRepo.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationId: 'longhaul',
          tenantId: 'test-tenant-id',
          visibility: 'TENANT',
          publishedBy: 'user-1',
        }),
      )
      // Overlay is refreshed so the live validator picks up the new config.
      expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
    })

    it('publishes a GLOBAL-visibility row when the tenant is the platform tenant', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.publish.mockResolvedValue({ ...configRow, visibility: 'GLOBAL' })
      const res = await buildApp().request(PATH, post(validBody))
      expect(res.status).toBe(201)
      expect(((await json(res)).data as JsonBody)['visibility']).toBe('GLOBAL')
      expect(mockRepo.publish).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'GLOBAL' }),
      )
    })

    it('rejects publish when the tenant row is not found (DomainError NOT_FOUND)', async () => {
      mockTenantFindUnique.mockResolvedValue(null)
      const res = await buildApp().request(PATH, post(validBody))
      // DomainError surfaces via the error handler (422), carrying the NOT_FOUND code.
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('NOT_FOUND')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('does not leak gateReport in the published row projection', async () => {
      const res = await buildApp().request(PATH, post(validBody))
      const body = (await json(res)).data as JsonBody
      expect('gateReport' in body).toBe(false)
      expect(body['mapping']).toBeDefined()
    })
  })

  // ── GET /config (active) ─────────────────────────────────────────────────────

  describe('GET /config', () => {
    it('returns 200 with the active config', async () => {
      mockRepo.findActiveForScope.mockResolvedValue(configRow)
      const res = await buildApp().request(PATH)
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['id']).toBe('cfg-1')
      expect('gateReport' in body).toBe(false)
    })

    it('returns 404 when no config is published for the scope', async () => {
      mockRepo.findActiveForScope.mockResolvedValue(null)
      const res = await buildApp().request(PATH)
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('is readable when the publish master switch is off (read is not gated)', async () => {
      process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'false'
      mockRepo.findActiveForScope.mockResolvedValue(configRow)
      const res = await buildApp().request(PATH)
      expect(res.status).toBe(200)
    })
  })

  // ── GET /config/versions ─────────────────────────────────────────────────────

  describe('GET /config/versions', () => {
    it('returns the version history with a count and the compact projection', async () => {
      mockRepo.listVersions.mockResolvedValue([
        configRow,
        { ...configRow, id: 'cfg-0', version: 2 },
      ])
      const res = await buildApp().request(`${PATH}/versions`)
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(2)
      // Summary projection omits the large blobs.
      expect('mapping' in data[0]!).toBe(false)
      expect('gateReport' in data[0]!).toBe(false)
      expect((body.meta as JsonBody)['count']).toBe(2)
    })

    it('returns 403 for a viewer (ReadIntegrationConfig required)', async () => {
      const res = await buildApp(['viewer']).request(`${PATH}/versions`)
      expect(res.status).toBe(403)
    })
  })

  // ── POST /config/rollback/:version ───────────────────────────────────────────

  describe('POST /config/rollback/:version', () => {
    beforeEach(() => {
      mockRepo.findVersion.mockResolvedValue(configRow)
    })

    it('returns 403 FEATURE_DISABLED when the master switch is off', async () => {
      process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'false'
      const res = await buildApp().request(`${PATH}/rollback/2`, post())
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FEATURE_DISABLED')
    })

    it('returns 403 without PublishIntegrationConfig (viewer)', async () => {
      const res = await buildApp(['viewer']).request(`${PATH}/rollback/2`, post())
      expect(res.status).toBe(403)
    })

    it('returns 400 on a non-numeric version', async () => {
      const res = await buildApp().request(`${PATH}/rollback/abc`, post())
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 on a version below 1', async () => {
      const res = await buildApp().request(`${PATH}/rollback/0`, post())
      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown integration', async () => {
      mockGetIntegrationDefinition.mockReturnValue(undefined)
      const res = await buildApp().request('/integrations/ghost/config/rollback/2', post())
      expect(res.status).toBe(404)
    })

    it('returns 404 when the source version does not exist', async () => {
      mockRepo.findVersion.mockResolvedValue(null)
      const res = await buildApp().request(`${PATH}/rollback/99`, post())
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 422 GATE_FAILED when the rolled-back config no longer passes', async () => {
      mockRunGatePipeline.mockReturnValue(failReport)
      const res = await buildApp().request(`${PATH}/rollback/2`, post())
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('GATE_FAILED')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('re-publishes the prior version as a new version on success', async () => {
      mockRepo.publish.mockResolvedValue({ ...configRow, version: 4 })
      const res = await buildApp().request(`${PATH}/rollback/2`, post())
      expect(res.status).toBe(201)
      expect(((await json(res)).data as JsonBody)['version']).toBe(4)
      // The source version's mapping/rules/corpus are re-published verbatim.
      expect(mockRepo.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationId: 'longhaul',
          mapping: configRow.mapping,
          rules: configRow.rules,
          publishedBy: 'user-1',
        }),
      )
      expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
    })
  })
})
