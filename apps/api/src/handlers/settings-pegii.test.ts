// ---------------------------------------------------------------------------
// Unit tests for the pegII settings handler
//
// db, the overlay resolver, and the pegII client are mocked so no DB or tunnel
// is required. requirePermission is NOT mocked — real RBAC is enforced.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipalForRole } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'
import type * as PegiiApiClient from '../lib/pegii-api-client'

const { mockDb } = vi.hoisted(() => ({
  mockDb: { tenant: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('../db', () => ({ db: mockDb }))

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }))
vi.mock('../lib/pegii-overlay-target', () => ({ resolvePegiiOverlayTarget: mockResolve }))

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))
vi.mock('../lib/pegii-api-client', async () => {
  const actual = await vi.importActual<typeof PegiiApiClient>('../lib/pegii-api-client')
  return { ...actual, createPegiiApiClient: vi.fn(() => ({ get: mockGet })) }
})

import { settingsPegiiHandler } from './settings-pegii'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

function patchReq(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function buildApp(role: string | null = 'tenant_admin') {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipalForRole(role))
  app.use('*', async (c, next) => {
    c.set('db', {} as unknown as PrismaClient)
    await next()
  })
  app.route('/', settingsPegiiHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
})

describe('GET /pegii', () => {
  it('returns 403 for a non-admin role', async () => {
    const res = await buildApp('viewer').request('/pegii')
    expect(res.status).toBe(403)
  })

  it('reports credential presence only, never the ref value', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      customerSource: 'pegii',
      pegiiApiBaseUrl: 'https://h:8443',
      pegiiApiKeyRef: 'arn:aws:secret:super-secret',
    })
    const res = await buildApp().request('/pegii')
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody
    expect(data).toEqual({
      customerSource: 'pegii',
      pegiiApiBaseUrl: 'https://h:8443',
      pegiiApiKeyConfigured: true,
    })
    expect(JSON.stringify(data)).not.toContain('super-secret')
  })

  it('normalizes a null customerSource to prisma', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      customerSource: null,
      pegiiApiBaseUrl: null,
      pegiiApiKeyRef: null,
    })
    const res = await buildApp().request('/pegii')
    const data = (await json(res)).data as JsonBody
    expect(data['customerSource']).toBe('prisma')
    expect(data['pegiiApiKeyConfigured']).toBe(false)
  })
})

describe('PATCH /pegii', () => {
  it('updates the customer source and echoes masked config', async () => {
    mockDb.tenant.update.mockResolvedValue({
      customerSource: 'pegii',
      pegiiApiBaseUrl: 'https://h:8443',
      pegiiApiKeyRef: 'arn:k',
    })
    const res = await buildApp().request('/pegii', patchReq({ customerSource: 'pegii' }))
    expect(res.status).toBe(200)
    expect(mockDb.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerSource: 'pegii' } }),
    )
    const data = (await json(res)).data as JsonBody
    expect(data['pegiiApiKeyConfigured']).toBe(true)
  })

  it('rejects an invalid customerSource value', async () => {
    const res = await buildApp().request('/pegii', patchReq({ customerSource: 'mssql' }))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('VALIDATION_ERROR')
  })

  it('rejects unknown fields (strict schema)', async () => {
    const res = await buildApp().request('/pegii', patchReq({ nope: 1 }))
    expect(res.status).toBe(400)
  })
})

describe('POST /pegii/test', () => {
  it('returns PEER_INACTIVE without hitting the client when the peer is down', async () => {
    mockResolve.mockResolvedValue({
      ok: false,
      code: 'PEGII_API_PEER_INACTIVE',
      message: 'tenant peer is PENDING, not ACTIVE',
    })
    const res = await buildApp().request('/pegii/test', { method: 'POST' })
    expect(res.status).toBe(200)
    const data = (await json(res)).data as JsonBody
    expect(data).toMatchObject({ ok: false, code: 'PEER_INACTIVE' })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns OK when the health probe succeeds', async () => {
    mockResolve.mockResolvedValue({ ok: true, target: { base: 'https://h:8443', apiKey: null } })
    mockGet.mockResolvedValue({ status: 'up' })
    const res = await buildApp().request('/pegii/test', { method: 'POST' })
    const data = (await json(res)).data as JsonBody
    expect(data['ok']).toBe(true)
    expect(data['code']).toBe('OK')
    expect(mockGet).toHaveBeenCalledWith('/health')
  })
})
