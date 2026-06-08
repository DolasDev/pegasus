// Unit tests for the RingCentral subscription-renewal cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  class RateLimitError extends Error {
    constructor(public readonly retryAfterMs: number) {
      super('rate limited')
    }
  }
  return {
    readOAuthConfig: vi.fn(),
    readWebhookUrl: vi.fn(),
    ensureForConnection: vi.fn(),
    listActiveConnections: vi.fn(),
    RateLimitError,
  }
})
const { RateLimitError } = h

vi.mock('../db', () => ({ db: {} }))
vi.mock('../services/ringcentral/oauth', () => ({ readOAuthConfig: h.readOAuthConfig }))
vi.mock('../services/ringcentral/subscription-manager', () => ({
  ensureForConnection: h.ensureForConnection,
  readWebhookUrl: h.readWebhookUrl,
}))
vi.mock('../services/ringcentral/client', () => ({ RateLimitError: h.RateLimitError }))
vi.mock('../repositories/messaging.repository', () => ({
  listActiveConnections: h.listActiveConnections,
}))

import { handler } from '../lambda-ringcentral-renew'

const CONFIG = {
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'r',
  apiBase: 'b',
  stateSecret: 'x',
}
const URL = 'https://api/webhook'

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
})

describe('lambda-ringcentral-renew', () => {
  it('no-ops when the flag is off', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    h.readWebhookUrl.mockReturnValue(URL)
    await handler()
    expect(h.listActiveConnections).not.toHaveBeenCalled()
  })

  it('no-ops when the webhook URL is not configured', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.readWebhookUrl.mockReturnValue(null)
    await handler()
    expect(h.listActiveConnections).not.toHaveBeenCalled()
  })

  it('ensures a subscription for each active connection', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.readWebhookUrl.mockReturnValue(URL)
    h.listActiveConnections.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    h.ensureForConnection.mockResolvedValue('renewed')
    await handler()
    expect(h.ensureForConnection).toHaveBeenCalledTimes(2)
  })

  it('isolates a per-connection failure and continues', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.readWebhookUrl.mockReturnValue(URL)
    h.listActiveConnections.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    h.ensureForConnection
      .mockRejectedValueOnce(new RateLimitError(30_000))
      .mockResolvedValueOnce('created')
    await handler()
    expect(h.ensureForConnection).toHaveBeenCalledTimes(2)
  })
})
