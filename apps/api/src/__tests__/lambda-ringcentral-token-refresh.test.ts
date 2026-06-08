// Unit tests for the RingCentral token-refresh cron.
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
    refreshAccessToken: vi.fn(),
    getRefreshToken: vi.fn(),
    storeRefreshToken: vi.fn(),
    listActiveConnections: vi.fn(),
    markTokenRefreshed: vi.fn(),
    markTokenExpired: vi.fn(),
    updateConnectionHealth: vi.fn(),
    RingCentralOAuthError,
  }
})
const { RingCentralOAuthError } = h

vi.mock('../db', () => ({ db: {} }))
vi.mock('../services/ringcentral/oauth', () => ({
  readOAuthConfig: h.readOAuthConfig,
  refreshAccessToken: h.refreshAccessToken,
  RingCentralOAuthError: h.RingCentralOAuthError,
}))
vi.mock('../lib/ringcentral-secrets', () => ({
  getRefreshToken: h.getRefreshToken,
  storeRefreshToken: h.storeRefreshToken,
}))
vi.mock('../repositories/messaging.repository', () => ({
  listActiveConnections: h.listActiveConnections,
  markTokenRefreshed: h.markTokenRefreshed,
  markTokenExpired: h.markTokenExpired,
  updateConnectionHealth: h.updateConnectionHealth,
}))

import { handler } from '../lambda-ringcentral-token-refresh'

const CONFIG = {
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'r',
  apiBase: 'b',
  stateSecret: 'x',
}

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
})

describe('lambda-ringcentral-token-refresh', () => {
  it('no-ops when the integration is disabled', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    await handler()
    expect(h.listActiveConnections).not.toHaveBeenCalled()
  })

  it('refreshes each active connection and persists the rotated token', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([
      { id: 'conn-1', tokenSecretArn: 'arn:1' },
      { id: 'conn-2', tokenSecretArn: 'arn:2' },
    ])
    h.getRefreshToken.mockResolvedValue('old-rt')
    h.refreshAccessToken.mockResolvedValue({ refresh_token: 'new-rt' })
    h.storeRefreshToken.mockResolvedValue('arn:rotated')

    await handler()

    expect(h.refreshAccessToken).toHaveBeenCalledTimes(2)
    expect(h.storeRefreshToken).toHaveBeenCalledWith('conn-1', 'new-rt')
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(
      expect.anything(),
      'conn-1',
      expect.any(Date),
      'arn:rotated',
    )
    expect(h.markTokenExpired).not.toHaveBeenCalled()
  })

  it('marks a connection EXPIRED on a permanent (4xx) failure, without aborting the batch', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([
      { id: 'bad', tokenSecretArn: 'arn:bad' },
      { id: 'good', tokenSecretArn: 'arn:good' },
    ])
    h.getRefreshToken.mockResolvedValue('rt')
    h.refreshAccessToken
      .mockRejectedValueOnce(new RingCentralOAuthError('invalid_grant', 400))
      .mockResolvedValueOnce({ refresh_token: 'new-rt' })
    h.storeRefreshToken.mockResolvedValue('arn:rotated')

    await handler()

    expect(h.markTokenExpired).toHaveBeenCalledWith(expect.anything(), 'bad')
    expect(h.updateConnectionHealth).not.toHaveBeenCalled()
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(
      expect.anything(),
      'good',
      expect.any(Date),
      'arn:rotated',
    )
  })

  it('keeps a connection ACTIVE (DEGRADED) on a transient (5xx) failure so it retries next run', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'blip', tokenSecretArn: 'arn:blip' }])
    h.getRefreshToken.mockResolvedValue('rt')
    h.refreshAccessToken.mockRejectedValueOnce(
      new RingCentralOAuthError('service unavailable', 503),
    )

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'blip', 'DEGRADED')
  })

  it('treats a network error (no status) as transient', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'net', tokenSecretArn: 'arn:net' }])
    h.getRefreshToken.mockResolvedValue('rt')
    h.refreshAccessToken.mockRejectedValueOnce(new RingCentralOAuthError('ECONNRESET'))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'net', 'DEGRADED')
  })
})
