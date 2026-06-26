// ---------------------------------------------------------------------------
// Unit tests for the SMS (outbound RingCentral) handler.
//
// listConnectionsByTenant and sendSms are mocked so no DB or network is needed.
// readOAuthConfig is mocked to control the platform-enabled gate.
// requirePermission is NOT mocked — real Cedar RBAC evaluates the offline wasm
// policy, so workflow_runtime passes and tenant_user is denied.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

// ---------------------------------------------------------------------------
// Mocks — hoisted so the vi.mock factories can reference them.
// ---------------------------------------------------------------------------

const { mockListConnections, mockSendSms, mockReadOAuthConfig } = vi.hoisted(() => ({
  mockListConnections: vi.fn(),
  mockSendSms: vi.fn(),
  mockReadOAuthConfig: vi.fn(),
}))

vi.mock('../repositories/messaging.repository', () => ({
  listConnectionsByTenant: mockListConnections,
}))

vi.mock('../services/ringcentral/sms', () => ({
  sendSms: mockSendSms,
}))

vi.mock('../services/ringcentral/oauth', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return {
    ...actual,
    readOAuthConfig: mockReadOAuthConfig,
  }
})

import { smsHandler } from './sms'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const ACTIVE_CONNECTION = {
  id: 'conn-1',
  tenantId: 'test-tenant-id',
  rcAccountId: 'rc-acc-1',
  rcExtensionId: 'rc-ext-1',
  ownerNumber: '+15005550001',
  tokenStatus: 'ACTIVE' as const,
  tokenSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:rc-conn-1-AbCdEf',
  scopes: [] as string[],
  health: 'HEALTHY' as const,
  lastRefreshedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = {} as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', fakeDb)
    await next()
  })
  app.route('/sms', smsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  // Default: integration enabled.
  mockReadOAuthConfig.mockReturnValue({ apiBase: 'https://platform.ringcentral.com' })
})

describe('POST /sms/send', () => {
  describe('happy path', () => {
    it('202 — sends SMS and returns id + status for workflow_runtime role', async () => {
      mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
      mockSendSms.mockResolvedValue({ id: 123456, messageStatus: 'Sent' })

      const res = await buildApp(['workflow_runtime']).request(
        '/sms/send',
        post({ to: '+15005550006', body: 'Hello from Pegasus' }),
      )

      expect(res.status).toBe(202)
      const body = await json(res)
      const data = body['data'] as JsonBody
      expect(data['id']).toBe(123456)
      expect(data['status']).toBe('Sent')

      expect(mockSendSms).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conn-1', ownerNumber: '+15005550001' }),
        '+15005550006',
        'Hello from Pegasus',
      )
    })

    it('202 — also passes for tenant_admin role', async () => {
      mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
      mockSendSms.mockResolvedValue({ id: 789, messageStatus: 'Queued' })

      const res = await buildApp(['tenant_admin']).request(
        '/sms/send',
        post({ to: '+15005550006', body: 'Admin SMS' }),
      )

      expect(res.status).toBe(202)
    })
  })

  describe('validation errors', () => {
    it('400 VALIDATION_ERROR — non-E.164 to number', async () => {
      const res = await buildApp().request('/sms/send', post({ to: '555-1234', body: 'Hello' }))
      expect(res.status).toBe(400)
      const body = await json(res)
      expect(body['code']).toBe('VALIDATION_ERROR')
      expect(mockSendSms).not.toHaveBeenCalled()
    })

    it('400 VALIDATION_ERROR — empty body', async () => {
      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: '' }))
      expect(res.status).toBe(400)
      expect((await json(res))['code']).toBe('VALIDATION_ERROR')
      expect(mockSendSms).not.toHaveBeenCalled()
    })

    it('400 VALIDATION_ERROR — body exceeds 1000 chars', async () => {
      const res = await buildApp().request(
        '/sms/send',
        post({ to: '+15005550006', body: 'x'.repeat(1001) }),
      )
      expect(res.status).toBe(400)
      expect((await json(res))['code']).toBe('VALIDATION_ERROR')
    })

    it('400 VALIDATION_ERROR — missing required fields', async () => {
      const res = await buildApp().request('/sms/send', post({}))
      expect(res.status).toBe(400)
      expect((await json(res))['code']).toBe('VALIDATION_ERROR')
    })
  })

  describe('authorization', () => {
    it('403 FORBIDDEN — tenant_user role denied SendSms', async () => {
      const res = await buildApp(['tenant_user']).request(
        '/sms/send',
        post({ to: '+15005550006', body: 'Hello' }),
      )
      expect(res.status).toBe(403)
      expect((await json(res))['code']).toBe('FORBIDDEN')
      expect(mockSendSms).not.toHaveBeenCalled()
    })

    it('403 FORBIDDEN — viewer role denied SendSms', async () => {
      const res = await buildApp(['viewer']).request(
        '/sms/send',
        post({ to: '+15005550006', body: 'Hello' }),
      )
      expect(res.status).toBe(403)
      expect(mockSendSms).not.toHaveBeenCalled()
    })
  })

  describe('platform integration gate', () => {
    it('503 — when RINGCENTRAL_ENABLED is not set (integration disabled)', async () => {
      mockReadOAuthConfig.mockReturnValue(null)

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(503)
      const body = await json(res)
      expect(body['error']).toContain('RingCentral integration is not enabled')
      expect(body['code']).toBe('SERVICE_UNAVAILABLE')
      expect(mockListConnections).not.toHaveBeenCalled()
    })
  })

  describe('connection lookup', () => {
    it('404 NOT_FOUND — tenant has no active connection', async () => {
      mockListConnections.mockResolvedValue([])

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(404)
      const body = await json(res)
      expect(body['code']).toBe('NOT_FOUND')
      expect(body['error']).toMatch(/RingCentral is not connected/)
      expect(mockSendSms).not.toHaveBeenCalled()
    })

    it('404 NOT_FOUND — connection exists but token is EXPIRED', async () => {
      mockListConnections.mockResolvedValue([{ ...ACTIVE_CONNECTION, tokenStatus: 'EXPIRED' }])

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(404)
      expect((await json(res))['code']).toBe('NOT_FOUND')
    })

    it('404 NOT_FOUND — connection is ACTIVE but tokenSecretArn is null', async () => {
      mockListConnections.mockResolvedValue([{ ...ACTIVE_CONNECTION, tokenSecretArn: null }])

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(404)
      expect((await json(res))['code']).toBe('NOT_FOUND')
    })
  })

  describe('upstream error handling', () => {
    it('429 — RateLimitError propagated with Retry-After header', async () => {
      mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
      const { RateLimitError } = await import('../services/ringcentral/client')
      mockSendSms.mockRejectedValue(new RateLimitError(30_000))

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('30')
    })

    it('502 UPSTREAM_ERROR — permanent RingCentralOAuthError (4xx status)', async () => {
      mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
      const { RingCentralOAuthError } = await import('../services/ringcentral/oauth')
      mockSendSms.mockRejectedValue(new RingCentralOAuthError('Token revoked', 401))

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(502)
      const body = await json(res)
      expect(body['code']).toBe('UPSTREAM_ERROR')
    })

    it('502 UPSTREAM_ERROR — transient RingCentral 5xx (non-permanent) also mapped', async () => {
      mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
      const { RingCentralOAuthError } = await import('../services/ringcentral/oauth')
      mockSendSms.mockRejectedValue(new RingCentralOAuthError('RC overloaded', 503))

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(502)
      const body = await json(res)
      expect(body['code']).toBe('UPSTREAM_ERROR')
    })

    it('500 — unexpected non-RC errors bubble to the app error handler', async () => {
      mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
      mockSendSms.mockRejectedValue(new Error('Network failure'))

      const res = await buildApp().request('/sms/send', post({ to: '+15005550006', body: 'Hello' }))

      expect(res.status).toBe(500)
      expect((await json(res))['code']).toBe('INTERNAL_ERROR')
    })
  })
})
