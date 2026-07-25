// ---------------------------------------------------------------------------
// Unit tests for the integration-config handler (publish / validate / versions
// / rollback).
//
// Mirrors the workflows.test.ts pattern:
//   - createIntegrationConfigRepository is mocked so no DB is required.
//   - runGatePipeline is mocked so each test controls the gate verdict.
//   - getBuiltInDefinition / refreshRegistryOverlay are mocked (no registry
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
  mockGetBuiltInDefinition,
  mockGetFloor,
  mockRefreshRegistryOverlay,
  mockRunGatePipeline,
  mockListIntegrationIds,
  mockGetIntegrationDefinition,
  mockResolveIntegrationDefinition,
} = vi.hoisted(() => ({
  mockRepo: {
    publish: vi.fn(),
    findActiveForScope: vi.fn(),
    findActiveGlobal: vi.fn(),
    findActiveOwn: vi.fn(),
    listVersions: vi.fn(),
    findVersion: vi.fn(),
    countScope: vi.fn(),
    countOtherTenantOverlays: vi.fn(),
    deleteScope: vi.fn(),
  },
  mockTenantFindUnique: vi.fn(),
  mockGetBuiltInDefinition: vi.fn(),
  mockGetFloor: vi.fn(),
  mockRefreshRegistryOverlay: vi.fn(async () => {}),
  mockRunGatePipeline: vi.fn(),
  mockListIntegrationIds: vi.fn(() => [] as string[]),
  mockGetIntegrationDefinition: vi.fn(),
  mockResolveIntegrationDefinition: vi.fn(),
}))

// The requirements-summary endpoint reads the tenant's secret/config store via
// this repo; stub listByKind so loadPresenceSets resolves without a real DB.
const mockSecretConfigRepo = vi.hoisted(() => ({
  listByKind: vi.fn(async (_kind: string) => [] as Array<{ group: string; key: string }>),
}))
vi.mock('../../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: vi.fn(() => mockSecretConfigRepo),
}))

vi.mock('../../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: vi.fn(() => mockRepo),
}))

vi.mock('../../integration-validation/registry', () => ({
  // getGateBase resolves the gate ground-truth (built-in id or floor); the tests
  // drive it via mockGetBuiltInDefinition (renamed intent, same control point).
  getGateBase: mockGetBuiltInDefinition,
  getFloor: mockGetFloor,
  refreshRegistryOverlay: mockRefreshRegistryOverlay,
  listIntegrationIds: mockListIntegrationIds,
  getIntegrationDefinition: mockGetIntegrationDefinition,
  resolveIntegrationDefinition: mockResolveIntegrationDefinition,
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

// A sentinel "base definition" — getGateBase is mocked, so the handler only
// checks truthiness + reads `.floor`; the real shape is exercised by the gate tests.
const baseDef = { id: 'demo_partner', floor: 'shipment_status_update' } as unknown

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
  integrationId: 'demo_partner',
  version: 3,
  visibility: 'TENANT' as const,
  status: 'PUBLISHED' as const,
  mapping: validBody.mapping,
  rules: validBody.rules,
  corpus: validBody.corpus,
  gateReport: okReport,
  publishedBy: 'user-1',
  forkedFromConfigId: null,
  forkedFromVersion: null,
  createdAt: now,
}

// A GLOBAL platform config that a tenant forks from.
const globalRow = {
  ...configRow,
  id: 'cfg-global-1',
  tenantId: 'platform-tenant-id',
  version: 7,
  visibility: 'GLOBAL' as const,
}

const PATH = '/integrations/demo_partner/config'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration-config handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'true'
    _clearAuthzCache()
    mockGetBuiltInDefinition.mockReturnValue(baseDef)
    mockGetFloor.mockReturnValue({ floor: 'shipment_status_update' })
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

    it('allows the viewer read-only role to read the active config', async () => {
      // ReadIntegrationConfig is on the viewer baseline (20-viewer.cedar) so
      // business users can view mappings/rules in-product; publish stays
      // restricted (see the publish-denial case above).
      mockRepo.findActiveForScope.mockResolvedValue(configRow)
      const res = await buildApp(['viewer']).request(PATH)
      expect(res.status).toBe(200)
      const body = (await json(res)).data as JsonBody
      expect(body['mapping']).toEqual(configRow.mapping)
      expect(body['rules']).toEqual(configRow.rules)
      expect('gateReport' in body).toBe(false)
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
      mockGetBuiltInDefinition.mockReturnValue(undefined)
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
      mockGetBuiltInDefinition.mockReturnValue(undefined)
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
          integrationId: 'demo_partner',
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

    it('threads floor/displayName/externalShape/externalMapping into the publish (0019 + 0020)', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.publish.mockResolvedValue({
        ...configRow,
        floor: 'shipment_status_update',
        displayName: 'Weichert',
      })
      const externalShape = { type: 'object', properties: { ref: { type: 'string' } } }
      const externalMapping = { ref: 'serviceOrderNumber' }
      const res = await buildApp().request(
        PATH,
        post({
          ...validBody,
          floor: 'shipment_status_update',
          displayName: 'Weichert',
          externalShape,
          externalMapping,
        }),
      )
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['displayName']).toBe('Weichert')
      expect(body['floor']).toBe('shipment_status_update')
      expect(mockRepo.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          floor: 'shipment_status_update',
          displayName: 'Weichert',
          externalShape,
          externalMapping,
        }),
      )
    })

    it('404s a new-partner publish whose floor is unknown', async () => {
      mockGetFloor.mockReturnValueOnce(undefined)
      const res = await buildApp().request(
        '/integrations/new_partner/config',
        post({ ...validBody, floor: 'no_such_floor' }),
      )
      expect(res.status).toBe(404)
      expect(mockRepo.publish).not.toHaveBeenCalled()
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

    it('allows the viewer read-only role to list versions', async () => {
      mockRepo.listVersions.mockResolvedValue([configRow])
      const res = await buildApp(['viewer']).request(`${PATH}/versions`)
      expect(res.status).toBe(200)
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
      mockGetBuiltInDefinition.mockReturnValue(undefined)
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
          integrationId: 'demo_partner',
          mapping: configRow.mapping,
          rules: configRow.rules,
          publishedBy: 'user-1',
        }),
      )
      expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /config/fork', () => {
    const FORK = `${PATH}/fork`

    beforeEach(() => {
      // Default happy-path fork context: no existing own config, a GLOBAL source
      // exists, the gate passes, and publish returns a forked TENANT row.
      mockRepo.findActiveOwn.mockResolvedValue(null)
      mockRepo.findActiveGlobal.mockResolvedValue(globalRow)
      mockRepo.publish.mockResolvedValue({
        ...configRow,
        id: 'cfg-forked-1',
        version: 1,
        forkedFromConfigId: globalRow.id,
        forkedFromVersion: globalRow.version,
      })
    })

    it('returns 403 FEATURE_DISABLED when the master switch is off', async () => {
      process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'false'
      const res = await buildApp().request(FORK, post())
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FEATURE_DISABLED')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 403 without PublishIntegrationConfig (viewer)', async () => {
      const res = await buildApp(['viewer']).request(FORK, post())
      expect(res.status).toBe(403)
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown integration', async () => {
      mockGetBuiltInDefinition.mockReturnValue(undefined)
      const res = await buildApp().request('/integrations/ghost/config/fork', post())
      expect(res.status).toBe(404)
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 400 when the platform tenant tries to fork its own GLOBAL config', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      const res = await buildApp().request(FORK, post())
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('PLATFORM_TENANT_CANNOT_FORK')
      expect(mockRepo.findActiveGlobal).not.toHaveBeenCalled()
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 409 when the tenant already has its own config', async () => {
      mockRepo.findActiveOwn.mockResolvedValue(configRow)
      const res = await buildApp().request(FORK, post())
      expect(res.status).toBe(409)
      const body = await json(res)
      expect(body.code).toBe('CONFLICT')
      // The 409 has to point at the way out, or the tenant is stuck exactly as
      // sdk-feedback 0030 describes.
      expect(String(body.error)).toContain('force=true')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 404 when no GLOBAL platform config exists to fork', async () => {
      mockRepo.findActiveGlobal.mockResolvedValue(null)
      const res = await buildApp().request(FORK, post())
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('returns 422 GATE_FAILED when the platform config no longer passes the gate', async () => {
      mockRunGatePipeline.mockReturnValue(failReport)
      const res = await buildApp().request(FORK, post())
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('GATE_FAILED')
      expect(mockRepo.publish).not.toHaveBeenCalled()
    })

    it('forks the GLOBAL config into a TENANT config with provenance on success', async () => {
      const res = await buildApp().request(FORK, post())
      expect(res.status).toBe(201)
      const body = (await json(res)).data as JsonBody
      expect(body['visibility']).toBe('TENANT')
      expect(body['forkedFromConfigId']).toBe(globalRow.id)
      expect(body['forkedFromVersion']).toBe(globalRow.version)
      // Publishes a TENANT copy of the GLOBAL source's mapping/rules/corpus,
      // stamped with fork provenance.
      expect(mockRepo.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationId: 'demo_partner',
          tenantId: 'test-tenant-id',
          visibility: 'TENANT',
          mapping: globalRow.mapping,
          rules: globalRow.rules,
          publishedBy: 'user-1',
          forkedFromConfigId: globalRow.id,
          forkedFromVersion: globalRow.version,
        }),
      )
      expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
    })

    // ── ?force=true — refresh an existing overlay (sdk-feedback 0030 part B) ──

    describe('?force=true', () => {
      const FORK_FORCE = `${FORK}?force=true`

      it('refreshes an existing overlay from GLOBAL as a new tenant version', async () => {
        // The tenant sits on a stale v3 overlay; publish() supersedes it and
        // returns v4 — the refresh is a new version, not a replacement in place,
        // so the pre-refresh config stays rollback-able.
        mockRepo.findActiveOwn.mockResolvedValue(configRow)
        mockRepo.publish.mockResolvedValue({
          ...configRow,
          id: 'cfg-refreshed-1',
          version: configRow.version + 1,
          forkedFromConfigId: globalRow.id,
          forkedFromVersion: globalRow.version,
        })

        const res = await buildApp().request(FORK_FORCE, post())
        expect(res.status).toBe(201)
        const body = (await json(res)).data as JsonBody
        expect(body['version']).toBe(configRow.version + 1)
        expect(body['visibility']).toBe('TENANT')
        // Provenance points at the CURRENT global, which is the whole point:
        // the tenant is now tracking upstream again.
        expect(body['forkedFromConfigId']).toBe(globalRow.id)
        expect(body['forkedFromVersion']).toBe(globalRow.version)
        expect(mockRepo.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: 'test-tenant-id',
            visibility: 'TENANT',
            mapping: globalRow.mapping,
            forkedFromConfigId: globalRow.id,
            forkedFromVersion: globalRow.version,
          }),
        )
        // The refreshed overlay must become the live one immediately.
        expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
        // Never a destructive path — the lineage survives (contrast DELETE).
        expect(mockRepo.deleteScope).not.toHaveBeenCalled()
      })

      it('behaves like a plain fork when the tenant has no overlay yet', async () => {
        mockRepo.findActiveOwn.mockResolvedValue(null)
        const res = await buildApp().request(FORK_FORCE, post())
        expect(res.status).toBe(201)
        expect(((await json(res)).data as JsonBody)['version']).toBe(1)
      })

      it('still refuses the platform tenant', async () => {
        mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
        const res = await buildApp().request(FORK_FORCE, post())
        expect(res.status).toBe(400)
        expect((await json(res)).code).toBe('PLATFORM_TENANT_CANNOT_FORK')
        expect(mockRepo.publish).not.toHaveBeenCalled()
      })

      it('still 404s when there is no GLOBAL config to refresh from', async () => {
        // Force must not be read as "publish something anyway" — with no
        // upstream source there is nothing to re-sync to.
        mockRepo.findActiveOwn.mockResolvedValue(configRow)
        mockRepo.findActiveGlobal.mockResolvedValue(null)
        const res = await buildApp().request(FORK_FORCE, post())
        expect(res.status).toBe(404)
        expect(mockRepo.publish).not.toHaveBeenCalled()
      })

      it('still 422s when the GLOBAL config no longer passes the current gate', async () => {
        // A forced refresh must not resurrect a config the floor has outgrown.
        mockRepo.findActiveOwn.mockResolvedValue(configRow)
        mockRunGatePipeline.mockReturnValue(failReport)
        const res = await buildApp().request(FORK_FORCE, post())
        expect(res.status).toBe(422)
        expect((await json(res)).code).toBe('GATE_FAILED')
        expect(mockRepo.publish).not.toHaveBeenCalled()
      })

      it('ignores a non-"true" force value (409 stays the default)', async () => {
        mockRepo.findActiveOwn.mockResolvedValue(configRow)
        const res = await buildApp().request(`${FORK}?force=1`, post())
        expect(res.status).toBe(409)
        expect(mockRepo.publish).not.toHaveBeenCalled()
      })
    })
  })

  // ── DELETE /config (sdk-feedback 0030 + 0031) ─────────────────────────────

  describe('DELETE /config', () => {
    const del = (): RequestInit => ({ method: 'DELETE' })
    const DEL = PATH
    const DEL_FORCE = `${PATH}?force=true`

    beforeEach(() => {
      // Default happy-path delete context: the scope owns one lineage of two
      // versions and nobody else overlays the id.
      mockRepo.countScope.mockResolvedValue(2)
      mockRepo.countOtherTenantOverlays.mockResolvedValue(0)
      mockRepo.deleteScope.mockResolvedValue(2)
    })

    it('returns 403 FEATURE_DISABLED when the master switch is off', async () => {
      process.env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] = 'false'
      const res = await buildApp().request(DEL, del())
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FEATURE_DISABLED')
      expect(mockRepo.deleteScope).not.toHaveBeenCalled()
    })

    it('returns 403 without PublishIntegrationConfig (viewer can read but not delete)', async () => {
      const res = await buildApp(['viewer']).request(DEL, del())
      expect(res.status).toBe(403)
      expect(mockRepo.deleteScope).not.toHaveBeenCalled()
    })

    it('returns 404 when the caller owns no config for the id', async () => {
      mockRepo.countScope.mockResolvedValue(0)
      const res = await buildApp().request(DEL, del())
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
      expect(mockRepo.deleteScope).not.toHaveBeenCalled()
    })

    it('deletes the tenants own overlay so it re-inherits GLOBAL (0030)', async () => {
      const res = await buildApp().request(DEL, del())
      expect(res.status).toBe(200)
      expect((await json(res)).data).toEqual({
        integrationId: 'demo_partner',
        visibility: 'TENANT',
        deleted: 2,
      })
      expect(mockRepo.deleteScope).toHaveBeenCalledWith('demo_partner', 'test-tenant-id')
      // A tenant delete never consults the GLOBAL dependents guard.
      expect(mockRepo.countOtherTenantOverlays).not.toHaveBeenCalled()
      expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
    })

    it('deletes the GLOBAL lineage for the platform tenant (0031)', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      const res = await buildApp().request(DEL, del())
      expect(res.status).toBe(200)
      expect((await json(res)).data).toMatchObject({ visibility: 'GLOBAL', deleted: 2 })
      expect(mockRepo.deleteScope).toHaveBeenCalledWith('demo_partner', 'test-tenant-id')
      expect(mockRefreshRegistryOverlay).toHaveBeenCalledTimes(1)
    })

    it('returns 409 DEPENDENTS_EXIST when other tenants still overlay a GLOBAL id', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.countOtherTenantOverlays.mockResolvedValue(3)
      const res = await buildApp().request(DEL, del())
      expect(res.status).toBe(409)
      const body = await json(res)
      expect(body['code']).toBe('DEPENDENTS_EXIST')
      expect(body['dependents']).toBe(3)
      expect(mockRepo.deleteScope).not.toHaveBeenCalled()
      expect(mockRefreshRegistryOverlay).not.toHaveBeenCalled()
    })

    it('force=true deletes the GLOBAL despite dependents, without touching their rows', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.countOtherTenantOverlays.mockResolvedValue(3)
      const res = await buildApp().request(DEL_FORCE, del())
      expect(res.status).toBe(200)
      // The guard is skipped entirely, and only the caller's own scope is deleted.
      expect(mockRepo.countOtherTenantOverlays).not.toHaveBeenCalled()
      expect(mockRepo.deleteScope).toHaveBeenCalledTimes(1)
      expect(mockRepo.deleteScope).toHaveBeenCalledWith('demo_partner', 'test-tenant-id')
    })

    it('ignores a non-"true" force value (a tenant cannot fuzz past the guard)', async () => {
      mockTenantFindUnique.mockResolvedValue({ isPlatformTenant: true })
      mockRepo.countOtherTenantOverlays.mockResolvedValue(1)
      const res = await buildApp().request(`${PATH}?force=1`, del())
      expect(res.status).toBe(409)
      expect(mockRepo.deleteScope).not.toHaveBeenCalled()
    })
  })
})

describe('GET /integrations/configs (m2m list)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
    mockListIntegrationIds.mockReturnValue(['demo_partner', 'ghost'])
    mockGetIntegrationDefinition.mockImplementation((id: string) =>
      id === 'ghost'
        ? undefined // an id with no definition is skipped
        : { id, displayName: 'Demo Partner', description: 'a demo' },
    )
  })

  it('lists the tenant integrations with active-config summary for integration_publisher', async () => {
    mockRepo.findActiveForScope.mockResolvedValue(configRow)
    const res = await buildApp(['integration_publisher']).request('/integrations/configs')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[]; meta: { count: number } }
    // 'ghost' (no definition) is skipped → only demo_partner.
    expect(body.meta.count).toBe(1)
    expect(body.data[0]).toMatchObject({
      // configRow has no displayName, so the route falls back to def.displayName.
      id: 'demo_partner',
      name: 'Demo Partner',
      published: true,
      version: configRow.version,
      visibility: 'TENANT',
    })
  })

  it('marks an integration with no active config as unpublished', async () => {
    mockRepo.findActiveForScope.mockResolvedValue(null)
    const res = await buildApp(['integration_publisher']).request('/integrations/configs')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ published: boolean; version: null }> }
    expect(body.data[0]).toMatchObject({ published: false, version: null, visibility: null })
  })

  it('rejects a role without ReadIntegrationConfig with 403', async () => {
    const res = await buildApp(['driver']).request('/integrations/configs')
    expect(res.status).toBe(403)
    expect(mockListIntegrationIds).not.toHaveBeenCalled()
  })
})

describe('GET /integrations/requirements-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
    mockListIntegrationIds.mockReturnValue(['sirva_ade', 'demo_partner'])
    mockResolveIntegrationDefinition.mockImplementation(
      async (_db: unknown, id: string) =>
        id === 'sirva_ade'
          ? {
              id: 'sirva_ade',
              displayName: 'Sirva ADE',
              requiredSecrets: [{ key: 'SEND_API_KEY', group: 'sirva' }],
              requiredConfigs: [{ key: 'SEND_URL', group: 'sirva' }],
            }
          : { id: 'demo_partner', displayName: 'Demo Partner' }, // declares nothing
    )
  })

  it('resolves each declared key present/missing and totals the gaps', async () => {
    mockSecretConfigRepo.listByKind.mockImplementation(
      async (kind: string) => (kind === 'SECRET' ? [{ group: 'sirva', key: 'SEND_API_KEY' }] : []), // URL config missing
    )

    const res = await buildApp(['integration_publisher']).request(
      '/integrations/requirements-summary',
    )
    expect(res.status).toBe(200)
    const { data } = (await json(res)) as {
      data: {
        totalMissing: number
        integrations: Array<{
          integrationId: string
          missingCount: number
          requirements: Array<Record<string, unknown>>
        }>
      }
    }
    expect(data.totalMissing).toBe(1)
    const sirva = data.integrations.find((i) => i.integrationId === 'sirva_ade')!
    expect(sirva.missingCount).toBe(1)
    expect(sirva.requirements).toEqual([
      { kind: 'SECRET', key: 'SEND_API_KEY', group: 'sirva', description: null, present: true },
      { kind: 'CONFIG', key: 'SEND_URL', group: 'sirva', description: null, present: false },
    ])
    const demo = data.integrations.find((i) => i.integrationId === 'demo_partner')!
    expect(demo.requirements).toEqual([])
  })

  it('is the literal path, not captured by /:integrationId/config', async () => {
    const res = await buildApp(['integration_publisher']).request(
      '/integrations/requirements-summary',
    )
    expect(res.status).toBe(200)
    expect(mockRepo.findActiveForScope).not.toHaveBeenCalled()
  })

  it('rejects a role without ReadIntegrationConfig with 403', async () => {
    const res = await buildApp(['driver']).request('/integrations/requirements-summary')
    expect(res.status).toBe(403)
  })
})
