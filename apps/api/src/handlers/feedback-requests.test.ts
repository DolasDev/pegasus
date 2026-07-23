// ---------------------------------------------------------------------------
// Unit tests for the feedback-requests mint handler.
//
// The form + request repositories and the RingCentral send path are mocked (no
// DB, no network). Real Cedar RBAC runs: workflow_runtime holds
// CreateFeedbackRequest; a viewer does not. FEEDBACK_ENABLED is on per test.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockFormRepo, mockReqRepo, mockReadOAuthConfig, mockListConnections, mockSendSms } =
  vi.hoisted(() => ({
    mockFormRepo: { findActive: vi.fn() },
    mockReqRepo: { mint: vi.fn(), findById: vi.fn() },
    mockReadOAuthConfig: vi.fn(),
    mockListConnections: vi.fn(),
    mockSendSms: vi.fn(),
  }))

vi.mock('../repositories/feedback-form.repository', () => ({
  createFeedbackFormRepository: vi.fn(() => mockFormRepo),
}))
vi.mock('../repositories/feedback-request.repository', () => ({
  createFeedbackRequestRepository: vi.fn(() => mockReqRepo),
}))
vi.mock('../repositories/messaging.repository', () => ({
  listConnectionsByTenant: mockListConnections,
}))
vi.mock('../services/ringcentral/oauth', () => ({
  readOAuthConfig: mockReadOAuthConfig,
  RingCentralOAuthError: class extends Error {},
}))
vi.mock('../services/ringcentral/sms', () => ({ sendSms: mockSendSms }))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { feedbackRequestsHandler } from './feedback-requests'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = {} as unknown as PrismaClient
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('principal', { sub: 'svc', tenantId: 'test-tenant-id', roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', 'svc-user')
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/feedback-requests', feedbackRequestsHandler)
  return app
}

const activeForm = {
  id: 'ff-1',
  tenantId: 'test-tenant-id',
  formKey: 'post-move-csat',
  version: 2,
  status: 'PUBLISHED',
  title: 'CSAT',
  definition: { questions: [] },
  messageTemplate: 'Rate move {{subjectId}}: {{url}}',
  publishedBy: 'u',
  createdAt: new Date(),
}

function mintResult() {
  return {
    plainToken: 'fbk_' + 'a'.repeat(48),
    row: {
      id: 'req-1',
      tenantId: 'test-tenant-id',
      formKey: 'post-move-csat',
      formVersion: 2,
      subjectType: 'move',
      subjectId: '123',
      status: 'PENDING',
      expiresAt: new Date('2026-07-25T12:00:00Z'),
      respondedAt: null,
      responsePayload: null,
      createdAt: new Date(),
    },
  }
}

beforeEach(() => {
  _clearAuthzCache()
  vi.clearAllMocks()
  process.env['FEEDBACK_ENABLED'] = 'true'
  process.env['FEEDBACK_PUBLIC_WEB_URL'] = 'https://acme.pegasus.dev'
})
afterEach(() => {
  delete process.env['FEEDBACK_ENABLED']
  delete process.env['FEEDBACK_PUBLIC_WEB_URL']
})

describe('POST / (mint)', () => {
  it('mints a link and returns requestId + url + expiresAt', async () => {
    mockFormRepo.findActive.mockResolvedValue(activeForm)
    mockReqRepo.mint.mockResolvedValue(mintResult())
    const res = await buildApp().request(
      '/feedback-requests',
      post({ formKey: 'post-move-csat', subject: { type: 'move', id: '123' } }),
    )
    expect(res.status).toBe(201)
    const data = (await json(res)).data as { requestId: string; url: string; delivery?: unknown }
    expect(data.requestId).toBe('req-1')
    expect(data.url).toBe(`https://acme.pegasus.dev/f/fbk_${'a'.repeat(48)}`)
    expect(data.delivery).toBeUndefined() // mint-only
    // Version pinned from the active form.
    expect(mockReqRepo.mint).toHaveBeenCalledWith(expect.objectContaining({ formVersion: 2 }))
  })

  it('404s when the form is not published', async () => {
    mockFormRepo.findActive.mockResolvedValue(null)
    const res = await buildApp().request(
      '/feedback-requests',
      post({ formKey: 'ghost', subject: { type: 'move', id: '1' } }),
    )
    expect(res.status).toBe(404)
    expect(mockReqRepo.mint).not.toHaveBeenCalled()
  })

  it('403s a role without CreateFeedbackRequest', async () => {
    const res = await buildApp(['viewer']).request(
      '/feedback-requests',
      post({ formKey: 'post-move-csat', subject: { type: 'move', id: '1' } }),
    )
    expect(res.status).toBe(403)
  })

  it('rejects a bad E.164 before minting when channel is sms', async () => {
    const res = await buildApp().request(
      '/feedback-requests',
      post({
        formKey: 'post-move-csat',
        subject: { type: 'move', id: '1' },
        channel: 'sms',
        to: 'nope',
      }),
    )
    expect(res.status).toBe(400)
    expect(mockReqRepo.mint).not.toHaveBeenCalled()
  })

  it('sends the SMS sugar path and reports delivery=sent', async () => {
    mockFormRepo.findActive.mockResolvedValue(activeForm)
    mockReqRepo.mint.mockResolvedValue(mintResult())
    mockReadOAuthConfig.mockReturnValue({ clientId: 'x' })
    mockListConnections.mockResolvedValue([
      { tokenStatus: 'ACTIVE', tokenSecretArn: 'arn', ownerNumber: '+15005550006' },
    ])
    mockSendSms.mockResolvedValue({ id: 42, messageStatus: 'Queued' })

    const res = await buildApp().request(
      '/feedback-requests',
      post({
        formKey: 'post-move-csat',
        subject: { type: 'move', id: '123' },
        channel: 'sms',
        to: '+15005550006',
      }),
    )
    expect(res.status).toBe(201)
    const data = (await json(res)).data as { url: string; delivery: { status: string; id: number } }
    expect(data.delivery.status).toBe('sent')
    // The rendered message carried the url + subjectId.
    const [, to, body] = mockSendSms.mock.calls[0]!
    expect(to).toBe('+15005550006')
    expect(body).toContain('/f/fbk_')
    expect(body).toContain('123')
  })

  it('still returns the link (delivery=failed) when no RC connection exists', async () => {
    mockFormRepo.findActive.mockResolvedValue(activeForm)
    mockReqRepo.mint.mockResolvedValue(mintResult())
    mockReadOAuthConfig.mockReturnValue({ clientId: 'x' })
    mockListConnections.mockResolvedValue([])

    const res = await buildApp().request(
      '/feedback-requests',
      post({
        formKey: 'post-move-csat',
        subject: { type: 'move', id: '123' },
        channel: 'sms',
        to: '+15005550006',
      }),
    )
    expect(res.status).toBe(201)
    const data = (await json(res)).data as { url: string; delivery: { status: string } }
    expect(data.url).toContain('/f/fbk_')
    expect(data.delivery.status).toBe('failed')
  })
})

describe('GET /:id (status)', () => {
  it('returns the request status', async () => {
    mockReqRepo.findById.mockResolvedValue(mintResult().row)
    const res = await buildApp().request('/feedback-requests/req-1')
    expect(res.status).toBe(200)
    expect((await json(res)).data).toMatchObject({ id: 'req-1', status: 'PENDING' })
  })

  it('404s an unknown id', async () => {
    mockReqRepo.findById.mockResolvedValue(null)
    const res = await buildApp().request('/feedback-requests/ghost')
    expect(res.status).toBe(404)
  })
})
