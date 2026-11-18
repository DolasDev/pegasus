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
  class RingCentralTokenExchangeError extends RingCentralOAuthError {}
  return {
    RingCentralTokenExchangeError,
    readOAuthConfig: vi.fn(),
    withRingCentralToken: vi.fn(),
    clientGet: vi.fn(),
    listActiveConnections: vi.fn(),
    markTokenRefreshed: vi.fn(),
    markTokenExpired: vi.fn(),
    updateConnectionHealth: vi.fn(),
    RingCentralOAuthError,
  }
})
const { RingCentralOAuthError, RingCentralTokenExchangeError } = h

vi.mock('../db', () => ({ db: {} }))
vi.mock('../services/ringcentral/oauth', () => ({
  readOAuthConfig: h.readOAuthConfig,
  RingCentralOAuthError: h.RingCentralOAuthError,
  RingCentralTokenExchangeError: h.RingCentralTokenExchangeError,
}))
vi.mock('../services/ringcentral/client', () => ({
  withRingCentralToken: h.withRingCentralToken,
}))
vi.mock('../repositories/messaging.repository', () => ({
  listActiveConnections: h.listActiveConnections,
  markTokenRefreshed: h.markTokenRefreshed,
  markTokenExpired: h.markTokenExpired,
  updateConnectionHealth: h.updateConnectionHealth,
}))

import { handler, EXTENSION_INFO_PATH } from '../lambda-ringcentral-token-refresh'

const CONFIG = { apiBase: 'https://platform.ringcentral.com' }

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
  // Pass-through to a fake client whose GET is h.clientGet. A
  // RingCentralTokenExchangeError thrown from clientGet stands in for the
  // token endpoint refusing the JWT (withRingCentralToken surfaces it as-is);
  // a plain RingCentralOAuthError is the probe API call failing.
  h.withRingCentralToken.mockImplementation(
    (_conn: unknown, call: (c: { get: typeof h.clientGet }) => Promise<unknown>) =>
      call({ get: h.clientGet }),
  )
  h.clientGet.mockResolvedValue({ id: 1 })
})

describe('lambda-ringcentral-credential-check', () => {
  it('no-ops when the integration is disabled', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    await handler()
    expect(h.listActiveConnections).not.toHaveBeenCalled()
  })

  it('probes each connection with the SHARED token (no mint of its own) and restores HEALTHY', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    const conns = [
      { id: 'conn-1', tokenSecretArn: 'arn:1' },
      { id: 'conn-2', tokenSecretArn: 'arn:2' },
    ]
    h.listActiveConnections.mockResolvedValue(conns)

    await handler()

    expect(h.withRingCentralToken).toHaveBeenCalledWith(conns[0], expect.any(Function))
    expect(h.withRingCentralToken).toHaveBeenCalledWith(conns[1], expect.any(Function))
    expect(h.clientGet).toHaveBeenCalledWith(EXTENSION_INFO_PATH)
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(expect.anything(), 'conn-1', expect.any(Date))
    expect(h.markTokenExpired).not.toHaveBeenCalled()
  })

  it('marks a connection EXPIRED when the token endpoint refuses the JWT (4xx), without aborting the batch', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([
      { id: 'bad', tokenSecretArn: 'arn:bad' },
      { id: 'good', tokenSecretArn: 'arn:good' },
    ])
    h.clientGet
      .mockRejectedValueOnce(new RingCentralTokenExchangeError('invalid_grant', 400))
      .mockResolvedValueOnce({ id: 1 })

    await handler()

    expect(h.markTokenExpired).toHaveBeenCalledWith(expect.anything(), 'bad')
    expect(h.updateConnectionHealth).not.toHaveBeenCalled()
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(expect.anything(), 'good', expect.any(Date))
  })

  it('does NOT expire a connection on a 4xx from the probe call itself (only DEGRADED)', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'probe', tokenSecretArn: 'arn:probe' }])
    h.clientGet.mockRejectedValueOnce(new RingCentralOAuthError('RingCentral API 401', 401))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'probe', 'DEGRADED')
  })

  it('flags DEGRADED on a transient (5xx) failure so it retries next run', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'blip', tokenSecretArn: 'arn:blip' }])
    h.clientGet.mockRejectedValueOnce(new RingCentralOAuthError('unavailable', 503))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'blip', 'DEGRADED')
  })

  it('treats a 429 from the token endpoint as transient, not a dead credential', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'busy', tokenSecretArn: 'arn:busy' }])
    h.clientGet.mockRejectedValueOnce(new RingCentralTokenExchangeError('rate limited', 429))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'busy', 'DEGRADED')
  })

  it('treats a network error (no status) as transient', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'net', tokenSecretArn: 'arn:net' }])
    h.clientGet.mockRejectedValueOnce(new RingCentralOAuthError('ECONNRESET'))

    await handler()

    expect(h.markTokenExpired).not.toHaveBeenCalled()
    expect(h.updateConnectionHealth).toHaveBeenCalledWith(expect.anything(), 'net', 'DEGRADED')
  })
})
