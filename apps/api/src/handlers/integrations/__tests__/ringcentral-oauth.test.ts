// Unit tests for the RingCentral connections handler (BYO JWT connect + list + disconnect).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../../types'

const h = vi.hoisted(() => {
  class RingCentralOAuthError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
    ) {
      super(message)
      this.name = 'RingCentralOAuthError'
    }
    get isPermanent(): boolean {
      return this.status !== undefined && this.status >= 400 && this.status < 500
    }
  }
  return {
    RingCentralOAuthError,
    readOAuthConfig: vi.fn(),
    exchangeJwtForToken: vi.fn(),
    fetchExtensionInfo: vi.fn(),
    storeConnectionCredentials: vi.fn(),
    deleteConnectionCredentials: vi.fn(),
    upsertConnection: vi.fn(),
    markTokenRefreshed: vi.fn(),
    listConnectionsByTenant: vi.fn(),
    findConnectionById: vi.fn(),
    deleteConnectionForTenant: vi.fn(),
    enqueueBackfill: vi.fn(),
  }
})

vi.mock('../../../db', () => ({ db: {} }))
vi.mock('../../../middleware/rbac', () => ({
  requirePermission: () => (_c: unknown, next: () => unknown) => next(),
}))
vi.mock('../../../services/ringcentral/oauth', () => ({
  readOAuthConfig: h.readOAuthConfig,
  exchangeJwtForToken: h.exchangeJwtForToken,
  fetchExtensionInfo: h.fetchExtensionInfo,
  RingCentralOAuthError: h.RingCentralOAuthError,
}))
vi.mock('../../../lib/ringcentral-secrets', () => ({
  storeConnectionCredentials: h.storeConnectionCredentials,
  deleteConnectionCredentials: h.deleteConnectionCredentials,
}))
vi.mock('../../../lib/ringcentral-queue', () => ({ enqueueBackfill: h.enqueueBackfill }))
vi.mock('../../../repositories/messaging.repository', () => ({
  upsertConnection: h.upsertConnection,
  markTokenRefreshed: h.markTokenRefreshed,
  listConnectionsByTenant: h.listConnectionsByTenant,
  findConnectionById: h.findConnectionById,
  deleteConnectionForTenant: h.deleteConnectionForTenant,
}))

import { ringcentralOauthHandler } from '../ringcentral-oauth'

const VALID_BODY = {
  clientId: 'cid',
  clientSecret: 'csec',
  jwt: 'the-jwt',
  number: '+19085760908',
}

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

function postConnect(body: unknown, tenantId = 'tnt-1') {
  return appForTenant(tenantId).request('/connections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const v of Object.values(h)) {
    if (typeof v === 'function' && 'mockReset' in v) (v as ReturnType<typeof vi.fn>).mockReset()
  }
  h.readOAuthConfig.mockReturnValue({ apiBase: 'https://platform.devtest.ringcentral.com' })
  h.exchangeJwtForToken.mockResolvedValue({ access_token: 'at', expires_in: 3600 })
  h.fetchExtensionInfo.mockResolvedValue({ rcAccountId: 'acct', rcExtensionId: 'ext' })
  h.upsertConnection.mockResolvedValue({ id: 'conn-1' })
  h.storeConnectionCredentials.mockResolvedValue('arn:secret')
  h.markTokenRefreshed.mockResolvedValue({})
  h.enqueueBackfill.mockResolvedValue(true)
  delete process.env['RINGCENTRAL_BACKFILL_DAYS']
})

afterEach(() => {
  delete process.env['RINGCENTRAL_BACKFILL_DAYS']
})

describe('POST /connections (BYO JWT connect)', () => {
  it('validates the JWT, records the connection, stores the secret, and backfills', async () => {
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ data: { connectionId: 'conn-1' } })

    expect(h.exchangeJwtForToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'cid', clientSecret: 'csec', jwt: 'the-jwt' }),
      'https://platform.devtest.ringcentral.com',
    )
    expect(h.upsertConnection).toHaveBeenCalledWith(
      expect.anything(),
      'tnt-1',
      expect.objectContaining({
        rcAccountId: 'acct',
        rcExtensionId: 'ext',
        ownerNumber: '+19085760908',
        scopes: [],
      }),
    )
    expect(h.storeConnectionCredentials).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ clientId: 'cid', clientSecret: 'csec', jwt: 'the-jwt' }),
    )
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(
      expect.anything(),
      'conn-1',
      expect.any(Date),
      'arn:secret',
    )
    expect(h.enqueueBackfill).toHaveBeenCalledWith('tnt-1', 'conn-1', undefined)
  })

  it('400s with INVALID_CREDENTIALS and persists nothing when the JWT is rejected', async () => {
    h.exchangeJwtForToken.mockRejectedValue(new h.RingCentralOAuthError('invalid_grant', 400))
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(h.upsertConnection).not.toHaveBeenCalled()
    expect(h.storeConnectionCredentials).not.toHaveBeenCalled()
  })

  it('400s when extension-info fails permanently (e.g. a missing scope)', async () => {
    h.fetchExtensionInfo.mockRejectedValue(new h.RingCentralOAuthError('insufficient scope', 403))
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(h.upsertConnection).not.toHaveBeenCalled()
  })

  it('502s with PERSIST_FAILED when storing the credential secret fails', async () => {
    h.storeConnectionCredentials.mockRejectedValue(new Error('Secrets Manager down'))
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ code: 'PERSIST_FAILED' })
  })

  it('502s on a transient exchange failure (does not sideline the creds)', async () => {
    h.exchangeJwtForToken.mockRejectedValue(new h.RingCentralOAuthError('busy', 503))
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ code: 'EXCHANGE_FAILED' })
  })

  it('400s on a missing field or a non-E.164 number', async () => {
    const { jwt: _omit, ...noJwt } = VALID_BODY
    expect((await postConnect(noJwt)).status).toBe(400)
    expect((await postConnect({ ...VALID_BODY, number: 'not-a-number' })).status).toBe(400)
    expect(h.exchangeJwtForToken).not.toHaveBeenCalled()
  })

  it('503s when the integration is disabled', async () => {
    h.readOAuthConfig.mockReturnValue(null)
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(503)
    expect(h.exchangeJwtForToken).not.toHaveBeenCalled()
  })

  it('still 201s when the backfill enqueue fails (cron backstops); caps backfill days', async () => {
    process.env['RINGCENTRAL_BACKFILL_DAYS'] = '1000'
    h.enqueueBackfill.mockRejectedValue(new Error('SQS unavailable'))
    const res = await postConnect(VALID_BODY)
    expect(res.status).toBe(201)
    expect(h.enqueueBackfill).toHaveBeenCalledWith('tnt-1', 'conn-1', 365)
  })
})

// ---------------------------------------------------------------------------
// Connections list + disconnect
// ---------------------------------------------------------------------------

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

  it('serializes a null lastRefreshedAt', async () => {
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
    h.deleteConnectionCredentials.mockResolvedValue(undefined)

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: { disconnected: true } })
    expect(h.deleteConnectionForTenant).toHaveBeenCalledWith(expect.anything(), 'tnt-1', 'conn-1')
    expect(h.deleteConnectionCredentials).toHaveBeenCalledWith(connectionRow.tokenSecretArn)
  })

  it('still succeeds when the secret delete fails (best-effort)', async () => {
    h.findConnectionById.mockResolvedValue(connectionRow)
    h.deleteConnectionForTenant.mockResolvedValue(1)
    h.deleteConnectionCredentials.mockRejectedValue(new Error('SM down'))

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ data: { disconnected: true } })
  })

  it('does not attempt a secret delete when the row has no tokenSecretArn', async () => {
    h.findConnectionById.mockResolvedValue({ ...connectionRow, tokenSecretArn: null })
    h.deleteConnectionForTenant.mockResolvedValue(1)

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(h.deleteConnectionCredentials).not.toHaveBeenCalled()
  })

  it('returns 404 for a foreign/missing id (deleteMany count 0) and skips the secret delete', async () => {
    h.findConnectionById.mockResolvedValue({ ...connectionRow, tenantId: 'other-tnt' })
    h.deleteConnectionForTenant.mockResolvedValue(0)

    const res = await appForTenant().request('/connections/conn-1', { method: 'DELETE' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      error: 'RingCentral connection not found',
      code: 'NOT_FOUND',
    })
    expect(h.deleteConnectionCredentials).not.toHaveBeenCalled()
  })
})
