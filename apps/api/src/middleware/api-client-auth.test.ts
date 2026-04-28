// ---------------------------------------------------------------------------
// Unit tests for apiClientAuthMiddleware
//
// Covers both auth paths:
//   1. Platform-key path — VPN_AGENT_APIKEY_HASH env var injected by ApiStack;
//      no DB row required.
//   2. Tenant-scoped DB path — falls back when the platform hash doesn't match
//      or isn't configured. ApiClient repository is mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import crypto from 'node:crypto'
import type { ApiClientEnv } from '../types'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    findByPrefix: vi.fn(),
    touchLastUsed: vi.fn(),
  },
}))

vi.mock('../repositories/api-client.repository', () => ({
  createApiClientRepository: vi.fn(() => mockRepo),
}))

vi.mock('../db', () => ({
  db: {},
}))

import { apiClientAuthMiddleware } from './api-client-auth'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<ApiClientEnv>()
  app.use('*', apiClientAuthMiddleware)
  app.get('/test', (c) =>
    c.json({
      tenantId: c.get('tenantId'),
      apiClientId: c.get('apiClient')?.id,
      scopes: c.get('apiClient')?.scopes,
    }),
  )
  return app
}

const PLATFORM_TOKEN = 'vnd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PLATFORM_HASH = crypto.createHash('sha256').update(PLATFORM_TOKEN).digest('hex')

const TENANT_TOKEN = 'vnd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const TENANT_HASH = crypto.createHash('sha256').update(TENANT_TOKEN).digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['VPN_AGENT_APIKEY_HASH']
})

afterEach(() => {
  delete process.env['VPN_AGENT_APIKEY_HASH']
})

describe('apiClientAuthMiddleware — platform-key path', () => {
  it('authenticates against VPN_AGENT_APIKEY_HASH without touching the DB', async () => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
    const app = buildApp()

    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${PLATFORM_TOKEN}` },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tenantId: string | null
      apiClientId: string
      scopes: string[]
    }
    expect(body.tenantId).toBeNull()
    expect(body.apiClientId).toBe('platform-vpn-agent')
    expect(body.scopes).toEqual(['vpn:sync'])
    expect(mockRepo.findByPrefix).not.toHaveBeenCalled()
  })

  it('falls through to DB when VPN_AGENT_APIKEY_HASH is unset', async () => {
    // No env var set — middleware should jump straight to the DB path.
    mockRepo.findByPrefix.mockResolvedValue({
      id: 'apc_1',
      tenantId: 'tnt_1',
      keyPrefix: TENANT_TOKEN.slice(0, 12),
      keyHash: TENANT_HASH,
      scopes: ['orders:read'],
      revokedAt: null,
      createdById: 'usr_1',
      name: 'Acme integration',
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mockRepo.touchLastUsed.mockResolvedValue(undefined)

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${TENANT_TOKEN}` },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { tenantId: string; apiClientId: string }
    expect(body.tenantId).toBe('tnt_1')
    expect(body.apiClientId).toBe('apc_1')
    expect(mockRepo.findByPrefix).toHaveBeenCalledOnce()
  })

  it('falls through to DB on platform-hash mismatch', async () => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
    mockRepo.findByPrefix.mockResolvedValue(null)

    const app = buildApp()
    // Token whose hash does NOT match PLATFORM_HASH.
    const otherToken = 'vnd_cccccccccccccccccccccccccccccccccccccccccccccccc'
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${otherToken}` },
    })

    expect(res.status).toBe(401)
    expect(mockRepo.findByPrefix).toHaveBeenCalledOnce()
  })

  it('rejects non-vnd_ tokens before hashing', async () => {
    process.env['VPN_AGENT_APIKEY_HASH'] = PLATFORM_HASH
    const app = buildApp()
    const res = await app.request('/test', { headers: { Authorization: 'Bearer eyJhbGc...' } })
    expect(res.status).toBe(401)
    expect(mockRepo.findByPrefix).not.toHaveBeenCalled()
  })

  it('rejects requests without Authorization header', async () => {
    const app = buildApp()
    const res = await app.request('/test')
    expect(res.status).toBe(401)
  })
})
