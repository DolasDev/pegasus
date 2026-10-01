// ---------------------------------------------------------------------------
// Unit tests for the email handler: request validation, outcome → HTTP mapping
// and pegII error mapping. sendTenantEmail is mocked (its policy is covered
// against Postgres in services/email/__tests__/outbound.test.ts); real Cedar
// RBAC runs — workflow_runtime holds SendEmail, workflow_developer does not.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))
vi.mock('../services/email/outbound', () => ({ sendTenantEmail: mockSend }))
vi.mock('../gateways/pegii-email.gateway', () => ({ resolveEmailGateway: vi.fn() }))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { emailHandler } from './email'
import { PegiiApiError } from '../lib/pegii-api-client'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', {} as unknown as PrismaClient)
    await next()
  })
  app.route('/email', emailHandler)
  return app
}

const MAIL = {
  to: 'coord@nwmovers.test',
  cc: ['lead@nwmovers.test'],
  subject: 'Negative Load Pulse Survey Text Received for Order Number: 490317',
  body: 'Customer Reply: 2',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
})

describe('POST /email/send', () => {
  it('202 on a fresh send; normalises a single `to` to a list and defaults bodyType', async () => {
    mockSend.mockResolvedValue({ kind: 'sent', id: 'e-1', alreadySent: false })
    const res = await buildApp().request(
      '/email/send',
      post({ ...MAIL, dedupKey: 'pulse:1:load:esc' }),
    )
    expect(res.status).toBe(202)
    expect((await json(res))['data']).toEqual({ id: 'e-1', alreadySent: false })
    expect(mockSend.mock.calls[0]![2]).toEqual({
      to: ['coord@nwmovers.test'],
      cc: ['lead@nwmovers.test'],
      subject: MAIL.subject,
      body: MAIL.body,
      bodyType: 'text',
      dedupKey: 'pulse:1:load:esc',
    })
  })

  it('200 alreadySent on a replay', async () => {
    mockSend.mockResolvedValue({ kind: 'sent', id: 'e-1', alreadySent: true })
    const res = await buildApp().request('/email/send', post(MAIL))
    expect(res.status).toBe(200)
  })

  it.each([
    [{ kind: 'not_configured' }, 409, 'EMAIL_RECIPIENTS_NOT_CONFIGURED'],
    [{ kind: 'recipient_not_allowed', recipients: ['x@gmail.test'] }, 400, 'RECIPIENT_NOT_ALLOWED'],
    [{ kind: 'too_many_recipients' }, 400, 'TOO_MANY_RECIPIENTS'],
    [{ kind: 'body_too_large' }, 413, 'BODY_TOO_LARGE'],
    [{ kind: 'daily_limit' }, 429, 'EMAIL_DAILY_LIMIT'],
    [{ kind: 'in_progress' }, 409, 'EMAIL_SEND_IN_PROGRESS'],
    [{ kind: 'in_doubt' }, 409, 'EMAIL_SEND_IN_DOUBT'],
    [{ kind: 'key_reused' }, 409, 'IDEMPOTENCY_KEY_REUSED'],
  ])('maps %o to %i %s', async (outcome, status, code) => {
    mockSend.mockResolvedValue(outcome)
    const res = await buildApp().request('/email/send', post(MAIL))
    expect(res.status).toBe(status)
    expect((await json(res))['code']).toBe(code)
  })

  it('keeps the site’s own email errors meaningful', async () => {
    mockSend.mockRejectedValueOnce(
      new PegiiApiError('PEGII_API_HTTP_ERROR', 'no smtp', 503, 'EMAIL_NOT_CONFIGURED'),
    )
    let res = await buildApp().request('/email/send', post(MAIL))
    expect([res.status, (await json(res))['code']]).toEqual([503, 'EMAIL_NOT_CONFIGURED'])

    mockSend.mockRejectedValueOnce(
      new PegiiApiError('PEGII_API_HTTP_ERROR', 'smtp refused', 502, 'EMAIL_SEND_FAILED'),
    )
    res = await buildApp().request('/email/send', post(MAIL))
    expect([res.status, (await json(res))['code']]).toEqual([502, 'EMAIL_SEND_FAILED'])
  })

  it('maps other pegII failures through the shared mapper', async () => {
    mockSend.mockRejectedValueOnce(new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'old site'))
    const res = await buildApp().request('/email/send', post(MAIL))
    expect([res.status, (await json(res))['code']]).toEqual([503, 'PEGII_CAPABILITY_MISSING'])
  })

  it('rejects a multi-line subject (header injection), bad addresses and unknown fields', async () => {
    for (const bad of [
      { ...MAIL, subject: 'Hi\r\nBcc: attacker@evil.test' },
      { ...MAIL, to: 'not-an-address' },
      { ...MAIL, from: 'spoof@nwmovers.test' },
      { ...MAIL, bodyType: 'markdown' },
    ]) {
      expect((await buildApp().request('/email/send', post(bad))).status).toBe(400)
    }
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('403 for a persona without SendEmail', async () => {
    const res = await buildApp(['workflow_developer']).request('/email/send', post(MAIL))
    expect(res.status).toBe(403)
  })
})
