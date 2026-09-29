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

const { mockListConnections, mockSendSms, mockReadOAuthConfig, mockOptOuts, mockSends } =
  vi.hoisted(() => ({
    mockListConnections: vi.fn(),
    mockSendSms: vi.fn(),
    mockReadOAuthConfig: vi.fn(),
    mockOptOuts: { find: vi.fn(), isOptedOut: vi.fn(), record: vi.fn() },
    mockSends: {
      claim: vi.fn(),
      reclaimFailed: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    },
  }))

vi.mock('../repositories/sms-opt-out.repository', () => ({
  createSmsOptOutRepository: vi.fn(() => mockOptOuts),
}))

const mockSetReadStatus = vi.hoisted(() => vi.fn())
vi.mock('../services/ringcentral/message-store', () => ({
  setMessageReadStatus: mockSetReadStatus,
}))

vi.mock('../repositories/sms-send.repository', () => ({
  createSmsSendRepository: vi.fn(() => mockSends),
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

// smsHandler now applies dualAuthMiddleware itself (it's mounted on the m2mV1
// router, which has no wildcard auth). Stub it to a passthrough so buildApp's
// own seedPrincipal/db middleware supplies the auth context; real
// requirePermission still evaluates the offline Cedar policy.
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { createHash } from 'node:crypto'
import { smsHandler } from './sms'
import { RingCentralOAuthError } from '../services/ringcentral/oauth'

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

const mockMessageFindFirst = vi.fn()

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = { message: { findFirst: mockMessageFindFirst } } as unknown as PrismaClient
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
  mockOptOuts.isOptedOut.mockResolvedValue(false)
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

// ---------------------------------------------------------------------------
// Opt-out + dedup policy (services/sms/outbound.ts, real — only repos mocked)
// ---------------------------------------------------------------------------

describe('POST /sms/send — opt-out and dedup policy', () => {
  const MSG = { to: '+15005550006', body: 'Rate your pack day 1-5' }
  const now = Date.now()
  const sendRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'send-1',
    dedupKey: 'pulse:1:pack',
    toNumber: MSG.to,
    // sha256('Rate your pack day 1-5')
    bodyHash: createHash('sha256').update(MSG.body).digest('hex'),
    status: 'PENDING',
    providerMessageId: null,
    providerStatus: null,
    lastError: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    ...overrides,
  })

  beforeEach(() => {
    mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
    mockSendSms.mockResolvedValue({ id: 987, messageStatus: 'Queued' })
  })

  it('409 SMS_OPTED_OUT — never calls the provider for an opted-out number', async () => {
    mockOptOuts.isOptedOut.mockResolvedValue(true)
    const res = await buildApp().request('/sms/send', post(MSG))
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('SMS_OPTED_OUT')
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it('409 SMS_OPTED_OUT — records a provider SMS-RC-413 rejection as an opt-out', async () => {
    mockSendSms.mockRejectedValue(
      new RingCentralOAuthError('RingCentral API 400', 400, 'SMS-RC-413'),
    )
    const res = await buildApp().request('/sms/send', post(MSG))
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('SMS_OPTED_OUT')
    expect(mockOptOuts.record).toHaveBeenCalledWith(
      expect.objectContaining({ phoneE164: MSG.to, optedOut: true, source: 'PROVIDER' }),
    )
  })

  it('claims the dedup key, sends once and marks it SENT', async () => {
    mockSends.claim.mockResolvedValue({ outcome: 'claimed', row: sendRow() })
    const res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect(res.status).toBe(202)
    expect((await json(res))['data']).toEqual({ id: 987, status: 'Queued', alreadySent: false })
    expect(mockSends.markSent).toHaveBeenCalledWith('test-tenant-id', 'send-1', {
      messageId: '987',
      status: 'Queued',
    })
  })

  it('200 alreadySent — a retry with a SENT key returns the first send without texting', async () => {
    mockSends.claim.mockResolvedValue({
      outcome: 'exists',
      row: sendRow({ status: 'SENT', providerMessageId: '987', providerStatus: 'Delivered' }),
    })
    const res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({ id: '987', status: 'Delivered', alreadySent: true })
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it('409 SMS_SEND_IN_PROGRESS for a recent PENDING key, SMS_SEND_IN_DOUBT for a stale one', async () => {
    mockSends.claim.mockResolvedValueOnce({ outcome: 'exists', row: sendRow() })
    let res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect((await json(res))['code']).toBe('SMS_SEND_IN_PROGRESS')

    mockSends.claim.mockResolvedValueOnce({
      outcome: 'exists',
      row: sendRow({ updatedAt: new Date(now - 10 * 60 * 1000) }),
    })
    res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('SMS_SEND_IN_DOUBT')
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  it('409 IDEMPOTENCY_KEY_REUSED when the key was used for a different body', async () => {
    mockSends.claim.mockResolvedValue({ outcome: 'exists', row: sendRow({ bodyHash: 'other' }) })
    const res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('reclaims a FAILED key and sends; marks FAILED again if the provider errors', async () => {
    mockSends.claim.mockResolvedValue({ outcome: 'exists', row: sendRow({ status: 'FAILED' }) })
    mockSends.reclaimFailed.mockResolvedValue(true)
    let res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect(res.status).toBe(202)
    expect(mockSends.reclaimFailed).toHaveBeenCalledWith('test-tenant-id', 'send-1')

    mockSendSms.mockRejectedValueOnce(new RingCentralOAuthError('RingCentral API 503', 503))
    res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'pulse:1:pack' }))
    expect(res.status).toBe(502)
    expect(mockSends.markFailed).toHaveBeenCalledWith(
      'test-tenant-id',
      'send-1',
      expect.any(String),
    )
  })

  it('rejects a malformed dedupKey', async () => {
    const res = await buildApp().request('/sms/send', post({ ...MSG, dedupKey: 'has space' }))
    expect(res.status).toBe(400)
  })
})

describe('GET /sms/messages/:id', () => {
  const ID = '6f1c2b8e-0d3a-4c1e-9f7a-2b3c4d5e6f70'

  it('returns the captured message, flagging a purged body', async () => {
    mockMessageFindFirst.mockResolvedValue({
      id: ID,
      source: 'V1_STORE',
      externalId: '4455',
      threadId: null,
      direction: 'INBOUND',
      fromNumber: '+15005550006',
      toNumber: '+15005550001',
      body: null,
      bodyPurgedAt: new Date('2026-09-29T00:00:00Z'),
      rcCreationTime: new Date('2026-09-25T20:00:00Z'),
      capturedAt: new Date('2026-09-25T20:00:05Z'),
    })
    const res = await buildApp().request(`/sms/messages/${ID}`)
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({
      id: ID,
      externalId: '4455',
      direction: 'INBOUND',
      body: null,
      bodyPurged: true,
      createdAt: '2026-09-25T20:00:00.000Z',
    })
  })

  it('404 on an unknown id, 400 on a non-uuid', async () => {
    mockMessageFindFirst.mockResolvedValue(null)
    expect((await buildApp().request(`/sms/messages/${ID}`)).status).toBe(404)
    expect((await buildApp().request('/sms/messages/not-a-uuid')).status).toBe(400)
  })

  it('403 for a persona without ReadTextMessage', async () => {
    const res = await buildApp(['workflow_developer']).request(`/sms/messages/${ID}`)
    expect(res.status).toBe(403)
  })
})

describe('/sms/opt-outs', () => {
  it('GET reports a never-seen number as not opted out', async () => {
    mockOptOuts.find.mockResolvedValue(null)
    const res = await buildApp().request('/sms/opt-outs/+15005550006')
    expect((await json(res))['data']).toMatchObject({
      phone: '+15005550006',
      optedOut: false,
      source: null,
    })
  })

  it('GET returns the stored keyword opt-out', async () => {
    mockOptOuts.find.mockResolvedValue({
      phoneE164: '+15005550006',
      optedOut: true,
      source: 'KEYWORD',
      keyword: 'STOP',
      messageId: 'm-1',
      effectiveAt: new Date('2026-09-25T20:00:00Z'),
      updatedAt: new Date('2026-09-25T20:00:05Z'),
    })
    const res = await buildApp().request('/sms/opt-outs/+15005550006')
    expect((await json(res))['data']).toEqual({
      phone: '+15005550006',
      optedOut: true,
      source: 'KEYWORD',
      keyword: 'STOP',
      updatedAt: '2026-09-25T20:00:00.000Z',
    })
  })

  it('POST records a MANUAL opt-out by default', async () => {
    mockOptOuts.record.mockResolvedValue('created')
    mockOptOuts.find.mockResolvedValue(null)
    const res = await buildApp().request('/sms/opt-outs', post({ phone: '+15005550006' }))
    expect(res.status).toBe(200)
    expect(mockOptOuts.record).toHaveBeenCalledWith(
      expect.objectContaining({ phoneE164: '+15005550006', optedOut: true, source: 'MANUAL' }),
    )
  })

  it('400 on a non-E.164 phone', async () => {
    expect((await buildApp().request('/sms/opt-outs/5551212')).status).toBe(400)
    expect((await buildApp().request('/sms/opt-outs', post({ phone: '555-1212' }))).status).toBe(
      400,
    )
  })
})

describe('POST /sms/messages/:id/read', () => {
  const ID = '6f1c2b8e-0d3a-4c1e-9f7a-2b3c4d5e6f70'
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: ID,
    source: 'V1_STORE',
    externalId: '4455',
    connectionId: 'conn-1',
    ...overrides,
  })

  beforeEach(() => {
    mockListConnections.mockResolvedValue([ACTIVE_CONNECTION])
  })

  it('marks the message read at RingCentral using the capturing connection', async () => {
    mockMessageFindFirst.mockResolvedValue(message())
    mockSetReadStatus.mockResolvedValue({ readStatus: 'Read', changed: true })
    const res = await buildApp().request(`/sms/messages/${ID}/read`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({ id: ID, readStatus: 'Read', alreadyRead: false })
    expect(mockSetReadStatus).toHaveBeenCalledWith(ACTIVE_CONNECTION, '4455', 'Read')
  })

  it('reports alreadyRead for a message that was already read', async () => {
    mockMessageFindFirst.mockResolvedValue(message())
    mockSetReadStatus.mockResolvedValue({ readStatus: 'Read', changed: false })
    const res = await buildApp().request(`/sms/messages/${ID}/read`, { method: 'POST' })
    expect(((await json(res))['data'] as JsonBody)['alreadyRead']).toBe(true)
  })

  it('409 UNSUPPORTED_SOURCE for a thread-store message', async () => {
    mockMessageFindFirst.mockResolvedValue(message({ source: 'THREAD_STORE' }))
    const res = await buildApp().request(`/sms/messages/${ID}/read`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('UNSUPPORTED_SOURCE')
    expect(mockSetReadStatus).not.toHaveBeenCalled()
  })

  it('409 NO_CONNECTION when the tenant has no active connection', async () => {
    mockMessageFindFirst.mockResolvedValue(message())
    mockListConnections.mockResolvedValue([])
    const res = await buildApp().request(`/sms/messages/${ID}/read`, { method: 'POST' })
    expect((await json(res))['code']).toBe('NO_CONNECTION')
  })

  it('404 for an unknown message, locally or at RingCentral', async () => {
    mockMessageFindFirst.mockResolvedValueOnce(null)
    expect((await buildApp().request(`/sms/messages/${ID}/read`, { method: 'POST' })).status).toBe(
      404,
    )
    mockMessageFindFirst.mockResolvedValueOnce(message())
    mockSetReadStatus.mockRejectedValueOnce(new RingCentralOAuthError('RingCentral API 404', 404))
    expect((await buildApp().request(`/sms/messages/${ID}/read`, { method: 'POST' })).status).toBe(
      404,
    )
  })

  it('403 for a persona without UpdateTextMessage', async () => {
    const res = await buildApp(['workflow_developer']).request(`/sms/messages/${ID}/read`, {
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })
})
