// ---------------------------------------------------------------------------
// Unit tests for POST /integrations/:id/fetch/:operation — the declarative pull.
//
// Mirrors integration-call.test.ts: the secrets/config repository, decrypt, the
// registry lookup and global fetch are mocked, so no DB or network is needed.
// requirePermission is NOT mocked — real Cedar evaluates the offline policy, so
// this proves the route is actually gated by CallExternal rather than open.
//
// What these pin that the pure unit tests cannot: that the DESCRIPTOR comes off
// the scoped config row, that `capabilities` comes off the resolved definition,
// that each typed resolve-failure maps to its own status, and that paging loops
// the real transport.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'
import { __resetOutboundTokenCacheForTests } from '../services/outbound-oauth'

const { mockFindByKey, mockDecrypt, mockEncrypt, mockResolveDef, mockFetch, mockFindActive } =
  vi.hoisted(() => ({
    mockFindByKey: vi.fn(),
    mockDecrypt: vi.fn(),
    mockEncrypt: vi.fn(),
    mockResolveDef: vi.fn(),
    mockFetch: vi.fn(),
    mockFindActive: vi.fn(),
  }))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))
vi.mock('../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: () => ({ findActiveForScope: mockFindActive }),
}))
vi.mock('../lib/secret-value-crypto', () => ({
  decryptSecretValue: mockDecrypt,
  encryptSecretValue: mockEncrypt,
}))
vi.mock('../integration-validation/registry', () => ({
  resolveIntegrationDefinition: mockResolveDef,
}))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))
const mockUsageRecord = vi.hoisted(() => vi.fn())
vi.mock('../repositories/usage.repository', () => ({
  createUsageRepository: vi.fn(() => ({ record: mockUsageRecord })),
}))
const mockMeterFailed = vi.hoisted(() => vi.fn())
vi.mock('../lib/usage/meter-metrics', () => ({ emitMeterWriteFailed: mockMeterFailed }))

import { integrationFetchHandler } from './integration-fetch'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', {} as unknown as PrismaClient)
    c.set('tenantId', 'test-tenant-id')
    await next()
  })
  app.route('/', integrationFetchHandler)
  return app
}

const ROUTE = '/integrations/atlas_settlement/fetch/settlements'

/** An apikey-mode partner — the Atlas shape, and no OAuth mint to stub. */
const APIKEY_CONFIG: Record<string, { value?: string | null; valueCiphertext?: string | null }> = {
  'CONFIG:BASE_URL': { value: 'https://qa-azapi.atlasworldgroup.com', valueCiphertext: null },
  'CONFIG:AUTH_MODE': { value: 'apikey', valueCiphertext: null },
  'SECRET:API_KEY': { value: null, valueCiphertext: 'sub-key-cipher' },
}

const FETCH_BLOCK = {
  settlements: {
    method: 'GET',
    path: '/settlement/v1/settlement',
    query: { settlementDate: '{{settlementDate}}' },
    decode: 'jsonString',
    recordsPath: 'agentSettlements',
    page: { style: 'none' },
  },
}

/** Atlas returns a JSON STRING containing JSON — the double-encoded shape. */
const atlasRes = (agentSettlements: unknown[], status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(JSON.stringify({ agentSettlements })),
    headers: new Headers({ 'content-type': 'application/json' }),
  }) as unknown as Response

/** A plain (not double-encoded) JSON body. */
const plainRes = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  }) as unknown as Response

beforeEach(() => {
  vi.clearAllMocks()
  __resetOutboundTokenCacheForTests()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  vi.stubGlobal('fetch', mockFetch)
  mockResolveDef.mockResolvedValue({
    id: 'atlas_settlement',
    floor: 'financial_settlement',
    capabilities: ['settlements'],
  })
  mockFindActive.mockResolvedValue({ fetch: FETCH_BLOCK })
  mockDecrypt.mockResolvedValue('the-subscription-key')
  mockFindByKey.mockImplementation(
    async (kind: string, _group: string, key: string) => APIKEY_CONFIG[`${kind}:${key}`] ?? null,
  )
  mockFetch.mockResolvedValue(atlasRes([{ settlementId: 'S-1' }]))
})

describe('POST /integrations/:id/fetch/:operation', () => {
  it('200 — resolves the descriptor, substitutes, decodes and extracts records', async () => {
    const res = await buildApp().request(ROUTE, post({ params: { settlementDate: '2026-11-06' } }))
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({
      operation: 'settlements',
      records: [{ settlementId: 'S-1' }],
      recordCount: 1,
      pages: 1,
      truncated: false,
    })
  })

  it('sends the substituted query and the credential header to the partner', async () => {
    await buildApp().request(ROUTE, post({ params: { settlementDate: '2026-11-06' } }))
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://qa-azapi.atlasworldgroup.com/settlement/v1/settlement?settlementDate=2026-11-06',
    )
    // apikey mode puts the secret in the APIM header — never in the URL.
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe(
      'the-subscription-key',
    )
    expect(url).not.toContain('the-subscription-key')
  })

  it('an EMPTY period is a 200 with no records, not an error', async () => {
    // Atlas QA returns exactly this for every settlementDate tried. Failing here
    // would make "nothing settled" indistinguishable from a broken descriptor.
    mockFetch.mockResolvedValue(atlasRes([]))
    const res = await buildApp().request(ROUTE, post({ params: { settlementDate: '2026-11-06' } }))
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ recordCount: 0, records: [] })
  })

  it('403 — denied without CallExternal (real Cedar, not a mock)', async () => {
    const res = await buildApp(['tenant_user']).request(ROUTE, post())
    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — unknown integration', async () => {
    mockResolveDef.mockResolvedValue(undefined)
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — the config publishes no fetch block', async () => {
    mockFindActive.mockResolvedValue({ fetch: null })
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain('no fetch block')
  })

  it('404 — operation not in the published block, naming what IS published', async () => {
    const res = await buildApp().request('/integrations/atlas_settlement/fetch/documents', post())
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain('settlements')
  })

  it('409 — the operation is no longer a capability of the floor', async () => {
    // A 404 would read as "no such route"; this is a contract conflict the
    // tenant fixes by republishing, so it gets its own status.
    mockResolveDef.mockResolvedValue({
      id: 'atlas_settlement',
      floor: 'financial_settlement',
      capabilities: [],
    })
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('CONFLICT')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400 — a missing param, WITHOUT calling the partner', async () => {
    // The load-bearing case: a leftover {{settlementDate}} on the wire returns
    // an opaque partner 400 that hides the real cause.
    const res = await buildApp().request(ROUTE, post({ params: {} }))
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(body['problems'])).toContain('settlementDate')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400 — a stored block that no longer validates', async () => {
    mockFindActive.mockResolvedValue({ fetch: { settlements: { method: 'TELEPORT' } } })
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(400)
    expect((await json(res))['error']).toContain('malformed')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400 — recordsPath resolves to a non-array (a descriptor bug)', async () => {
    mockFetch.mockResolvedValue(plainRes(JSON.stringify({ agentSettlements: { a: 1 } })))
    const res = await buildApp().request(ROUTE, post({ params: { settlementDate: 'd' } }))
    expect(res.status).toBe(400)
    expect((await json(res))['error']).toContain('not an array')
  })

  it('502 — a partner error reports its status, distinct from "could not ask"', async () => {
    mockFetch.mockResolvedValue(plainRes({ message: 'bad date' }, 400))
    const res = await buildApp().request(ROUTE, post({ params: { settlementDate: 'nope' } }))
    expect(res.status).toBe(502)
    expect(await json(res)).toMatchObject({ code: 'UPSTREAM_ERROR', status: 400 })
  })

  it('404 — a required config is unset, surfaced from the shared core', async () => {
    mockFindByKey.mockResolvedValue(null)
    const res = await buildApp().request(ROUTE, post({ params: { settlementDate: 'd' } }))
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain('BASE_URL')
  })

  it('resolves {{config:KEY}} from the config store, and only the referenced key', async () => {
    mockFindActive.mockResolvedValue({
      fetch: {
        settlements: {
          method: 'GET',
          path: '/s',
          query: { vendor: '{{config:VENDOR_ID}}' },
        },
      },
    })
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'VENDOR_ID') return { value: 'A123', valueCiphertext: null }
      return APIKEY_CONFIG[`${kind}:${key}`] ?? null
    })
    mockFetch.mockResolvedValue(plainRes({ ok: true }))
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(200)
    expect((mockFetch.mock.calls[0] as [string])[0]).toContain('vendor=A123')
    // Only the referenced key is read — not the whole group.
    const configKeys = mockFindByKey.mock.calls
      .filter((c) => c[0] === 'CONFIG')
      .map((c) => c[2] as string)
    expect(configKeys).not.toContain('SOME_OTHER_KEY')
    expect(configKeys).toContain('VENDOR_ID')
  })
})

describe('fetch paging', () => {
  const pagedBlock = (page: Record<string, unknown>) => ({
    settlements: { method: 'GET', path: '/s', recordsPath: 'items', page },
  })

  it('pageNumber — loops until a page comes back empty', async () => {
    mockFindActive.mockResolvedValue({
      fetch: pagedBlock({ style: 'pageNumber', param: 'page', startAt: 1, maxPages: 10 }),
    })
    mockFetch
      .mockResolvedValueOnce(plainRes({ items: [1, 2] }))
      .mockResolvedValueOnce(plainRes({ items: [3] }))
      .mockResolvedValueOnce(plainRes({ items: [] }))
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({
      records: [1, 2, 3],
      pages: 3,
      truncated: false,
    })
    // The page index is sent, and it increments from startAt.
    expect((mockFetch.mock.calls[0] as [string])[0]).toContain('page=1')
    expect((mockFetch.mock.calls[1] as [string])[0]).toContain('page=2')
  })

  it('pageNumber — reports truncated when it runs out of budget, not out of data', async () => {
    // A loop that stops on its cap must not look like a complete result set.
    mockFindActive.mockResolvedValue({
      fetch: pagedBlock({ style: 'pageNumber', param: 'page', maxPages: 2 }),
    })
    mockFetch.mockResolvedValue(plainRes({ items: [1] }))
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ pages: 2, truncated: true })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('cursor — follows the cursor and stops when it is absent', async () => {
    mockFindActive.mockResolvedValue({
      fetch: pagedBlock({ style: 'cursor', param: 'next', cursorPath: 'meta.next' }),
    })
    mockFetch
      .mockResolvedValueOnce(plainRes({ items: [1], meta: { next: 'c2' } }))
      .mockResolvedValueOnce(plainRes({ items: [2] }))
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ records: [1, 2], pages: 2 })
    expect((mockFetch.mock.calls[1] as [string])[0]).toContain('next=c2')
  })

  it('style none — exactly one request even if the body looks pageable', async () => {
    mockFindActive.mockResolvedValue({
      fetch: { settlements: { method: 'GET', path: '/s', recordsPath: 'items' } },
    })
    mockFetch.mockResolvedValue(plainRes({ items: [1], meta: { next: 'c2' } }))
    const res = await buildApp().request(ROUTE, post())
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ pages: 1 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
