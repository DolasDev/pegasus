import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findSubscriptionByRcId: vi.fn(),
  recordWebhookEvent: vi.fn(),
  enqueueCapture: vi.fn(),
}))

vi.mock('../../../db', () => ({ db: {} }))
vi.mock('../../../repositories/messaging.repository', () => ({
  findSubscriptionByRcId: h.findSubscriptionByRcId,
  recordWebhookEvent: h.recordWebhookEvent,
}))
vi.mock('../../../lib/ringcentral-queue', () => ({ enqueueCapture: h.enqueueCapture }))

import { ringcentralWebhookHandler } from '../ringcentral-webhook'

const sub = {
  tenantId: 'tnt-1',
  connectionId: 'conn-1',
  subscriptionId: 'rc-sub-1',
  verificationToken: 'vtok-secret',
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.recordWebhookEvent.mockResolvedValue('evt-1')
  h.enqueueCapture.mockResolvedValue(true)
})

function post(headers: Record<string, string>, body?: unknown) {
  return ringcentralWebhookHandler.request('/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe('ringcentral webhook', () => {
  it('echoes the Validation-Token on the handshake with 200 and does no work', async () => {
    const res = await post({ 'validation-token': 'handshake-abc' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Validation-Token')).toBe('handshake-abc')
    expect(h.findSubscriptionByRcId).not.toHaveBeenCalled()
  })

  it('400s when the payload has no subscriptionId', async () => {
    const res = await post({}, { event: 'x' })
    expect(res.status).toBe(400)
  })

  it('404s for an unknown subscription', async () => {
    h.findSubscriptionByRcId.mockResolvedValue(null)
    const res = await post({ 'verification-token': 'whatever' }, { subscriptionId: 'nope' })
    expect(res.status).toBe(404)
  })

  it('401s on a verification-token mismatch', async () => {
    h.findSubscriptionByRcId.mockResolvedValue(sub)
    const res = await post({ 'verification-token': 'wrong' }, { subscriptionId: 'rc-sub-1' })
    expect(res.status).toBe(401)
    expect(h.recordWebhookEvent).not.toHaveBeenCalled()
  })

  it('401s when the verification-token header is absent', async () => {
    h.findSubscriptionByRcId.mockResolvedValue(sub)
    const res = await post({}, { subscriptionId: 'rc-sub-1' })
    expect(res.status).toBe(401)
  })

  it('accepts a valid event: persists the raw event and enqueues a capture job', async () => {
    h.findSubscriptionByRcId.mockResolvedValue(sub)
    const payload = {
      subscriptionId: 'rc-sub-1',
      body: { lastModifiedTime: '2026-06-02T10:00:00Z' },
    }
    const res = await post({ 'verification-token': 'vtok-secret' }, payload)
    expect(res.status).toBe(200)
    expect(h.recordWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'tnt-1',
      expect.objectContaining({ subscriptionId: 'rc-sub-1', connectionId: 'conn-1' }),
    )
    expect(h.enqueueCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookEventId: 'evt-1',
        tenantId: 'tnt-1',
        subscriptionId: 'rc-sub-1',
      }),
    )
  })
})
