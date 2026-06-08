// Unit tests for the RingCentral OAuth callback — focus on backfill-on-connect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  readOAuthConfig: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  fetchExtensionInfo: vi.fn(),
  signState: vi.fn(),
  buildAuthorizeUrl: vi.fn(),
  storeRefreshToken: vi.fn(),
  upsertConnection: vi.fn(),
  markTokenRefreshed: vi.fn(),
  enqueueBackfill: vi.fn(),
}))

vi.mock('../../../db', () => ({ db: {} }))
vi.mock('../../middleware/rbac', () => ({
  requirePermission: () => (_c: unknown, next: () => unknown) => next(),
}))
vi.mock('../../../services/ringcentral/oauth', () => ({
  readOAuthConfig: h.readOAuthConfig,
  verifyState: h.verifyState,
  exchangeCodeForToken: h.exchangeCodeForToken,
  fetchExtensionInfo: h.fetchExtensionInfo,
  signState: h.signState,
  buildAuthorizeUrl: h.buildAuthorizeUrl,
}))
vi.mock('../../../lib/ringcentral-secrets', () => ({ storeRefreshToken: h.storeRefreshToken }))
vi.mock('../../../lib/ringcentral-queue', () => ({ enqueueBackfill: h.enqueueBackfill }))
vi.mock('../../../repositories/messaging.repository', () => ({
  upsertConnection: h.upsertConnection,
  markTokenRefreshed: h.markTokenRefreshed,
}))

import { ringcentralOauthCallbackHandler } from '../ringcentral-oauth'

const CONFIG = {
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'r',
  apiBase: 'b',
  stateSecret: 'x',
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.readOAuthConfig.mockReturnValue(CONFIG)
  h.verifyState.mockReturnValue({
    tenantId: 'tnt-1',
    ownerNumber: '+19085760908',
    nonce: 'n',
    iat: 1,
  })
  h.exchangeCodeForToken.mockResolvedValue({
    access_token: 'at',
    refresh_token: 'rt',
    scope: 'SMS',
  })
  h.fetchExtensionInfo.mockResolvedValue({ rcAccountId: 'acct', rcExtensionId: 'ext' })
  h.upsertConnection.mockResolvedValue({ id: 'conn-1' })
  h.storeRefreshToken.mockResolvedValue('arn:secret')
  h.markTokenRefreshed.mockResolvedValue({})
  h.enqueueBackfill.mockResolvedValue(true)
  delete process.env['RINGCENTRAL_BACKFILL_DAYS']
})

afterEach(() => {
  delete process.env['RINGCENTRAL_BACKFILL_DAYS']
})

function callback() {
  return ringcentralOauthCallbackHandler.request('/oauth/callback?code=abc&state=xyz')
}

describe('ringcentral oauth callback — backfill on connect', () => {
  it('enqueues a backfill for the new connection after connecting', async () => {
    const res = await callback()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'connected', connectionId: 'conn-1' })
    // Default (no env) → undefined days; the sync service applies its own default.
    expect(h.enqueueBackfill).toHaveBeenCalledWith('tnt-1', 'conn-1', undefined)
  })

  it('caps RINGCENTRAL_BACKFILL_DAYS and passes it through', async () => {
    process.env['RINGCENTRAL_BACKFILL_DAYS'] = '1000'
    await callback()
    expect(h.enqueueBackfill).toHaveBeenCalledWith('tnt-1', 'conn-1', 365)
  })

  it('ignores an invalid RINGCENTRAL_BACKFILL_DAYS', async () => {
    process.env['RINGCENTRAL_BACKFILL_DAYS'] = 'not-a-number'
    await callback()
    expect(h.enqueueBackfill).toHaveBeenCalledWith('tnt-1', 'conn-1', undefined)
  })

  it('still returns connected when the backfill enqueue fails (cron backstops)', async () => {
    h.enqueueBackfill.mockRejectedValue(new Error('SQS unavailable'))
    const res = await callback()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'connected' })
  })
})
