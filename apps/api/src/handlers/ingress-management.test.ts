// Unit tests for the ingress management routes (sdk-feedback 0021): create /
// rotate / list. The credential repo is mocked; requirePermission runs real
// Cedar — ManageIngress is granted to workflow_developer, denied to viewer.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { mockCreate, mockRotate, mockFindMeta } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRotate: vi.fn(),
  mockFindMeta: vi.fn(),
}))

vi.mock('../repositories/ingress-credential.repository', () => ({
  createIngressCredentialRepository: () => ({
    create: mockCreate,
    rotate: mockRotate,
    findMetaForScope: mockFindMeta,
  }),
}))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { ingressManagementHandler } from './ingress'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

function buildApp(roleNames: readonly string[] = ['workflow_developer']) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', {} as unknown as PrismaClient)
    c.set('tenantId', 'tenant-1')
    c.set('userId', 'user-1')
    await next()
  })
  app.route('/', ingressManagementHandler)
  return app
}

const CREATE = '/integrations/sirva_ade_shipment/ingress'
const ROTATE = '/integrations/sirva_ade_shipment/ingress/rotate'
const meta = {
  tokenPrefix: 'ing_abc12345', // gitleaks:allow — fake test fixture, not a real credential
  enabled: true,
  createdAt: new Date('2026-07-16T00:00:00Z'),
  rotatedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  process.env['INGRESS_PUBLIC_URL'] = 'https://api.pegasus.dolas.dev'
  _clearAuthzCache()
})

describe('POST .../ingress (create)', () => {
  it('201 — mints a credential and returns the one-time token (workflow_developer)', async () => {
    mockCreate.mockResolvedValue({ meta, plainToken: 'ing_secret-token' })
    const res = await buildApp(['workflow_developer']).request(CREATE, { method: 'POST' })
    expect(res.status).toBe(201)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({
      token: 'ing_secret-token',
      tokenPrefix: 'ing_abc12345', // gitleaks:allow — fake test fixture, not a real credential
      url: 'https://api.pegasus.dolas.dev/api/ingress/v1/integrations/sirva_ade_shipment/events',
    })
  })

  it('409 — a credential already exists (create returns null)', async () => {
    mockCreate.mockResolvedValue(null)
    const res = await buildApp().request(CREATE, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('403 — viewer lacks ManageIngress', async () => {
    const res = await buildApp(['viewer']).request(CREATE, { method: 'POST' })
    expect(res.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('POST .../ingress/rotate', () => {
  it('200 — rotates and returns a NEW one-time token', async () => {
    mockRotate.mockResolvedValue({
      meta: { ...meta, rotatedAt: new Date() },
      plainToken: 'ing_new-token',
    })
    const res = await buildApp().request(ROTATE, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await json(res))['data'] as JsonBody)['token']).toBe('ing_new-token')
  })

  it('404 — nothing to rotate', async () => {
    mockRotate.mockResolvedValue(null)
    const res = await buildApp().request(ROTATE, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('GET .../ingress (list)', () => {
  it('200 — returns metadata, never the token', async () => {
    mockFindMeta.mockResolvedValue({
      id: 'c',
      tenantId: 't',
      integrationId: 'sirva_ade_shipment',
      ...meta,
    })
    const res = await buildApp().request(CREATE)
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data['tokenPrefix']).toBe('ing_abc12345')
    expect(data['token']).toBeUndefined()
  })

  it('404 — no credential', async () => {
    mockFindMeta.mockResolvedValue(null)
    const res = await buildApp().request(CREATE)
    expect(res.status).toBe(404)
  })
})
