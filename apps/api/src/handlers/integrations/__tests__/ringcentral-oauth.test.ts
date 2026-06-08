// Unit tests for the RingCentral OAuth callback — focus on backfill-on-connect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../../types'

const h = vi.hoisted(() => ({
  readOAuthConfig: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  fetchExtensionInfo: vi.fn(),
  signState: vi.fn(),
  buildAuthorizeUrl: vi.fn(),
  storeRefreshToken: vi.fn(),
  deleteRefreshToken: vi.fn(),
  upsertConnection: vi.fn(),
  markTokenRefreshed: vi.fn(),
  listConnectionsByTenant: vi.fn(),
  findConnectionById: vi.fn(),
  deleteConnectionForTenant: vi.fn(),
  enqueueBackfill: vi.fn(),
}))

vi.mock('../../../db', () => ({ db: {} }))
vi.mock('../../../middleware/rbac', () => ({
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
vi.mock('../../../lib/ringcentral-secrets', () => ({
  storeRefreshToken: h.storeRefreshToken,
  deleteRefreshToken: h.deleteRefreshToken,
}))
vi.mock('../../../lib/ringcentral-queue', () => ({ enqueueBackfill: h.enqueueBackfill }))
vi.mock('../../../repositories/messaging.repository', () => ({
  upsertConnection: h.upsertConnection,
  markTokenRefreshed: h.markTokenRefreshed,
  listConnectionsByTenant: h.listConnectionsByTenant,
  findConnectionById: h.findConnectionById,
  deleteConnectionForTenant: h.deleteConnectionForTenant,
}))

import { ringcentralOauthHandler, ringcentralOauthCallbackHandler } from '../ringcentral-oauth'

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

// ---------------------------------------------------------------------------
// Connections list + disconnect
// ---------------------------------------------------------------------------

// Mounts the handler under a parent app that injects the tenantId the real RBAC
// middleware would have set (the mocked requirePermission is a pass-through).
function appForTenant(tenantId = 'tnt-1') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', tenantId)
    await next()
  })
  app.route('/', ringcentralOauthHandler)
  return app
}

const connectionRow = {
  id: 'conn-1',
  tenantId: 'tnt-1',
  rcAccountId: 'acct',
  rcExtensionId: 'ext',
  ownerNumber: '+19085760908',
  tokenSecretArn: 'arn:aws:secretsmanager:::secret/rc/conn-1',
  tokenStatus: 'ACTIVE' as const,
  scopes: ['SMS'],
  lastRefreshedAt: new Date('2026-06-02T10:00:00.000Z'),
  health: 'HEALTHY' as const,
  createdAt: new Date('2026-06-01T09:00:00.000Z'),
  updatedAt: new Date('2026-06-02T10:00:00.000Z'),
}

describe('GET /connections', () => {
  it('maps rows to the public shape and never leaks tokenSecretArn/updatedAt', async () => {
    h.listConnectionsByTenant.mockResolvedValue([connectionRow])
    const res = await appForTenant().request('/connections')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { connections: Record<string, unknown>[] } }
    expect(h.listConnectionsByTenant).toHaveBeenCalledWith(expect.anything(), 'tnt-1')
    expect(body.data.connections).toEqual([
      {
        id: 'conn-1',
        ownerNumber: '+19085760908',
        rcAccountId: 'acct',
        rcExtensionId: 'ext',
        tokenStatus: 'ACTIVE',
        health: 'HEALTHY',
        lastRefreshedAt: '2026-06-02T10:00:00.000Z',
        scopes: ['SMS'],
        createdAt: '2026-06-01T09:00:00.000Z',
      },
    ])
    // Secret pointer + bookkeeping must not appear anywhere in the response.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('tokenSecretArn')
    expect(raw).not.toContain('updatedAt')
    expect(raw).not.toContain('arn:aws:secretsmanager')
  })

  it('returns an empty array when the tenant has no connections', async () => {
    h.listConnectionsByTenant.mockResolvedValue([])
    const res = await appForTenant().request('/connections')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: { connections: [] } })
  })

  it('serialises a null lastRefreshedAt', async () => {
    h.listConnectionsByTenant.mockResolvedValue([{ ...connectionRow, lastRefreshedAt: null }])
    const res = await appForTenant().request('/connections')
    const body = (await res.json()) as { data: { connections: { lastRefreshedAt: unknown }[] } }
    expect(body.data.connections[0]!.lastRefreshedAt).toBeNull()
  })
})

describe('DELETE /connections/:id', () => {
  it('deletes an owned connection and cleans up its secret', async () => {
    h.findConnectionById.mockResolvedValue(connectionRow)
    h.deleteConnectionForTenant.mockResolvedValue(1)
    h.deleteRefreshToken.mockResolvedValue(undefined)

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: { disconnected: true } })
    expect(h.deleteConnectionForTenant).toHaveBeenCalledWith(expect.anything(), 'tnt-1', 'conn-1')
    expect(h.deleteRefreshToken).toHaveBeenCalledWith(connectionRow.tokenSecretArn)
  })

  it('still succeeds when the secret delete fails (best-effort)', async () => {
    h.findConnectionById.mockResolvedValue(connectionRow)
    h.deleteConnectionForTenant.mockResolvedValue(1)
    h.deleteRefreshToken.mockRejectedValue(new Error('SM down'))

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: { disconnected: true } })
  })

  it('does not attempt a secret delete when the row has no tokenSecretArn', async () => {
    h.findConnectionById.mockResolvedValue({ ...connectionRow, tokenSecretArn: null })
    h.deleteConnectionForTenant.mockResolvedValue(1)

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(h.deleteRefreshToken).not.toHaveBeenCalled()
  })

  it('returns 404 for a foreign/missing id (deleteMany count 0) and skips the secret delete', async () => {
    // Row belongs to another tenant → findConnectionById returns it but the
    // tenant guard drops the ARN; deleteMany matches nothing → count 0.
    h.findConnectionById.mockResolvedValue({ ...connectionRow, tenantId: 'other-tnt' })
    h.deleteConnectionForTenant.mockResolvedValue(0)

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      error: 'RingCentral connection not found',
      code: 'NOT_FOUND',
    })
    expect(h.deleteRefreshToken).not.toHaveBeenCalled()
  })
})
