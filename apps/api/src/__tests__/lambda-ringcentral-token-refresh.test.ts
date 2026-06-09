// Unit tests for the RingCentral credential health-check cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  // RingCentralOAuthError defined here so the hoisted vi.mock factory can use it.
  class RingCentralOAuthError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
    ) {
      super(message)
    }
    get isPermanent(): boolean {
      return this.status !== undefined && this.status >= 400 && this.status < 500
    }
  }
  return {
    readOAuthConfig: vi.fn(),
    exchangeJwtForToken: vi.fn(),
    getConnectionCredentials: vi.fn(),
    listActiveConnections: vi.fn(),
    markTokenRefreshed: vi.fn(),
    markTokenExpired: vi.fn(),
    updateConnectionHealth: vi.fn(),
    RingCentralOAuthError,
    DEFAULT_API_BASE: 'https://platform.ringcentral.com',
  }
})
const { RingCentralOAuthError } = h

vi.mock('../db', () => ({ db: {} }))
vi.mock('../services/ringcentral/oauth', () => ({
  readOAuthConfig: h.readOAuthConfig,
  exchangeJwtForToken: h.exchangeJwtForToken,
  RingCentralOAuthError: h.RingCentralOAuthError,
  DEFAULT_API_BASE: h.DEFAULT_API_BASE,
}))
vi.mock('../lib/ringcentral-secrets', () => ({
  getConnectionCredentials: h.getConnectionCredentials,
}))
vi.mock('../repositories/messaging.repository', () => ({
  listActiveConnections: h.listActiveConnections,
  markTokenRefreshed: h.markTokenRefreshed,
  markTokenExpired: h.markTokenExpired,
  updateConnectionHealth: h.updateConnectionHealth,
}))

import { handler } from '../lambda-ringcentral-token-refresh'

const CONFIG = { apiBase: 'https://platform.ringcentral.com' }

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
  h.getConnectionCredentials.mockResolvedValue({ clientId: 'c', clientSecret: 's', jwt: 'j' })
})

describe('lambda-ringcentral-credential-check', () => {
  it('no-ops when the integration is disabled', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    await handler()
    expect(h.listActiveConnections).not.toHaveBeenCalled()
  })

  it('verifies each active connection and restores HEALTHY on success', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([
      { id: 'conn-1', tokenSecretArn: 'arn:1' },
      { id: 'conn-2', tokenSecretArn: 'arn:2' },
    ])
    h.exchangeJwtForToken.mockResolvedValue({ access_token: 'at', expires_in: 3600 })

    await handler()

    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(2)
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(expect.anything(), 'conn-1', expect.any(Date))
    expect(h.markTokenExpired).not.toHaveBeenCalled()
  })

  it('marks a connection EXPIRED on a permanent (4xx) failure, without aborting the batch', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([
      { id: 'bad', tokenSecretArn: 'arn:bad' },
      { id: 'good', tokenSecretArn: 'arn:good' },
    ])
    h.exchangeJwtForToken
      .mockRejectedValueOnce(new RingCentralOAuthError('invalid_grant', 400))
      .mockResolvedValueOnce({ access_token: 'at', expires_in: 3600 })

    await handler()

    expect(h.markTokenExpired).toHaveBeenCalledWith(expect.anything(), 'bad')
    expect(h.updateConnectionHealth).not.toHaveBeenCalled()
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(expect.anything(), 'good', expect.any(Date))
  })

  it('flags DEGRADED on a transient (5xx) failure so it retries next run', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'blip', tokenSecretArn: 'arn:blip' }])
    h.exchangeJwtForToken.mockRejectedValueOnce(new RingCentralOAuthError('unavailable', 503))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'blip', 'DEGRADED')
  })

  it('treats a network error (no status) as transient', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'net', tokenSecretArn: 'arn:net' }])
    h.exchangeJwtForToken.mockRejectedValueOnce(new RingCentralOAuthError('ECONNRESET'))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'net', 'DEGRADED')
  })
})
