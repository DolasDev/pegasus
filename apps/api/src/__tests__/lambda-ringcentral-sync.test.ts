// Unit tests for the RingCentral reconciliation-sync cron.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  class RateLimitError extends Error {
    constructor(public readonly retryAfterMs: number) {
      super('rate limited')
    }
  }
  return {
    readOAuthConfig: vi.fn(),
    syncConnection: vi.fn(),
    listActiveConnections: vi.fn(),
    RateLimitError,
  }
})
const { RateLimitError } = h

vi.mock('../db', () => ({ db: {} }))
vi.mock('../services/ringcentral/oauth', () => ({ readOAuthConfig: h.readOAuthConfig }))
vi.mock('../services/ringcentral/sync', () => ({ syncConnection: h.syncConnection }))
vi.mock('../services/ringcentral/client', () => ({ RateLimitError: h.RateLimitError }))
vi.mock('../repositories/messaging.repository', () => ({
  listActiveConnections: h.listActiveConnections,
}))

import { handler } from '../lambda-ringcentral-sync'

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

describe('lambda-ringcentral-sync', () => {
  it('no-ops when disabled', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    await handler()
    expect(h.listActiveConnections).not.toHaveBeenCalled()
  })

  it('syncs every active connection', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    h.syncConnection.mockResolvedValue({ captured: 3 })
    await handler()
    expect(h.syncConnection).toHaveBeenCalledTimes(2)
  })

  it('isolates a rate-limited connection and continues with the rest', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    h.syncConnection
      .mockRejectedValueOnce(new RateLimitError(30_000))
      .mockResolvedValueOnce({ captured: 1 })
    await handler()
    expect(h.syncConnection).toHaveBeenCalledTimes(2) // did not abort
  })

  it('isolates an arbitrary failure and continues', async () => {
    h.readOAuthConfig.mockReturnValue(CONFIG)
    h.listActiveConnections.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    h.syncConnection.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ captured: 0 })
    await handler()
    expect(h.syncConnection).toHaveBeenCalledTimes(2)
  })
})
