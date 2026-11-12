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
import { logger } from '../lib/logger'
import { __resetOutboundTokenCacheForTests } from '../services/outbound-oauth'

const {
  mockFindByKey,
  mockDecrypt,
  mockEncrypt,
  mockResolveDef,
  mockFetch,
  mockFindActive,
  mockCacheFind,
  mockCacheUpsert,
} = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockDecrypt: vi.fn(),
  mockEncrypt: vi.fn(),
  mockResolveDef: vi.fn(),
  mockFetch: vi.fn(),
  mockFindActive: vi.fn(),
  mockCacheFind: vi.fn(),
  mockCacheUpsert: vi.fn(),
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))
vi.mock('../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: () => ({ findActiveForScope: mockFindActive }),
}))
vi.mock('../repositories/integration-fetch-cache.repository', () => ({
  createIntegrationFetchCacheRepository: () => ({
    find: mockCacheFind,
    upsert: mockCacheUpsert,
  }),
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
  // A cold cache by default, so every pre-existing test exercises the miss path.
  mockCacheFind.mockResolvedValue(null)
  mockCacheUpsert.mockResolvedValue(undefined)
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

// ---------------------------------------------------------------------------
// Freshness + provenance (C4/C5). What these pin: that the response ALWAYS
// says where its records came from, that `attempts` stays a count of real
// partner requests, that every cache failure degrades instead of failing a good
// read, and that a hit still enforces the descriptor's own 404/409 rules.
// ---------------------------------------------------------------------------

/** A stored row as the repository hands one back. */
const cached = (overrides: Record<string, unknown> = {}) => ({
  records: [{ settlementId: 'S-CACHED' }],
  recordCount: 1,
  pages: 1,
  attempts: 1,
  status: 200,
  truncated: false,
  fetchedAt: new Date(Date.now() - 10_000),
  ...overrides,
})

describe('freshness + provenance', () => {
  const body = { params: { settlementDate: '2026-11-06' } }

  it('states provenance on a MISS: source "fetched" and an asOf', async () => {
    const res = await buildApp().request(ROUTE, post(body))
    const data = (await json(res))['data'] as JsonBody
    expect(data['source']).toBe('fetched')
    expect(Date.parse(data['asOf'] as string)).not.toBeNaN()
  })

  it('serves a fresh row without calling the partner, and says source "cached"', async () => {
    mockCacheFind.mockResolvedValue(cached())
    const res = await buildApp().request(ROUTE, post(body))
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data['records']).toEqual([{ settlementId: 'S-CACHED' }])
    expect(data['source']).toBe('cached')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports attempts/pages 0 on a hit — so summing attempts still counts partner calls', async () => {
    mockCacheFind.mockResolvedValue(cached({ attempts: 4, pages: 3 }))
    const res = await buildApp().request(ROUTE, post(body))
    const data = (await json(res))['data'] as JsonBody
    expect(data['attempts']).toBe(0)
    expect(data['pages']).toBe(0)
  })

  it('carries a cached TRUNCATED flag through — a partial read stays partial', async () => {
    mockCacheFind.mockResolvedValue(cached({ truncated: true }))
    const res = await buildApp().request(ROUTE, post(body))
    expect((await json(res))['data']).toMatchObject({ truncated: true, source: 'cached' })
  })

  it('reports asOf as the row fetchedAt, not the time of this call', async () => {
    const fetchedAt = new Date(Date.now() - 30_000)
    mockCacheFind.mockResolvedValue(cached({ fetchedAt }))
    const res = await buildApp().request(ROUTE, post(body))
    expect((await json(res))['data']).toMatchObject({ asOf: fetchedAt.toISOString() })
  })

  it('MISSES a row older than the 60s default TTL', async () => {
    mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date(Date.now() - 61_000) }))
    const res = await buildApp().request(ROUTE, post(body))
    expect((await json(res))['data']).toMatchObject({ source: 'fetched' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('honours a call-site maxAge TIGHTER than the age of the row', async () => {
    mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date(Date.now() - 30_000) }))
    const res = await buildApp().request(ROUTE, post({ ...body, maxAge: 5 }))
    expect((await json(res))['data']).toMatchObject({ source: 'fetched' })
  })

  it('honours a call-site maxAge LOOSER than the default', async () => {
    mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date(Date.now() - 600_000) }))
    const res = await buildApp().request(ROUTE, post({ ...body, maxAge: 3600 }))
    expect((await json(res))['data']).toMatchObject({ source: 'cached' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maxAge 0 forces a partner call even against a row written a moment ago', async () => {
    mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date() }))
    const res = await buildApp().request(ROUTE, post({ ...body, maxAge: 0 }))
    expect((await json(res))['data']).toMatchObject({ source: 'fetched' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('refresh forces a partner call and still WRITES THROUGH', async () => {
    mockCacheFind.mockResolvedValue(cached())
    const res = await buildApp().request(ROUTE, post({ ...body, refresh: true }))
    expect((await json(res))['data']).toMatchObject({ source: 'fetched' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockCacheUpsert).toHaveBeenCalledTimes(1)
  })

  it('uses the descriptor maxAgeSeconds when the caller is silent', async () => {
    mockFindActive.mockResolvedValue({
      fetch: { settlements: { ...FETCH_BLOCK.settlements, maxAgeSeconds: 900 } },
    })
    mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date(Date.now() - 600_000) }))
    const res = await buildApp().request(ROUTE, post(body))
    expect((await json(res))['data']).toMatchObject({ source: 'cached' })
  })

  it('lets the CALL SITE override a descriptor maxAgeSeconds', async () => {
    mockFindActive.mockResolvedValue({
      fetch: { settlements: { ...FETCH_BLOCK.settlements, maxAgeSeconds: 900 } },
    })
    mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date(Date.now() - 600_000) }))
    const res = await buildApp().request(ROUTE, post({ ...body, maxAge: 60 }))
    expect((await json(res))['data']).toMatchObject({ source: 'fetched' })
  })

  it('400 — a negative maxAge is refused, not silently clamped', async () => {
    const res = await buildApp().request(ROUTE, post({ ...body, maxAge: -1 }))
    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('writes the fetched result through on a miss', async () => {
    await buildApp().request(ROUTE, post(body))
    expect(mockCacheUpsert).toHaveBeenCalledTimes(1)
    const [key, stored] = mockCacheUpsert.mock.calls[0] as [JsonBody, JsonBody]
    expect(key).toMatchObject({
      tenantId: 'test-tenant-id',
      integrationId: 'atlas_settlement',
      operation: 'settlements',
    })
    expect(key['requestHash']).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).toMatchObject({ records: [{ settlementId: 'S-1' }], recordCount: 1 })
  })

  it('keys the cache per RESOLVED request — a different param is a different entry', async () => {
    await buildApp().request(ROUTE, post({ params: { settlementDate: '2026-11-06' } }))
    await buildApp().request(ROUTE, post({ params: { settlementDate: '2026-12-06' } }))
    const [first] = mockCacheUpsert.mock.calls[0] as [JsonBody]
    const [second] = mockCacheUpsert.mock.calls[1] as [JsonBody]
    expect(first['requestHash']).not.toBe(second['requestHash'])
  })

  it('keys the cache on the DESCRIPTOR too — a republished recordsPath cannot serve old rows', async () => {
    await buildApp().request(ROUTE, post(body))
    mockFindActive.mockResolvedValue({
      fetch: { settlements: { ...FETCH_BLOCK.settlements, recordsPath: 'documents' } },
    })
    await buildApp().request(ROUTE, post(body))
    const [first] = mockCacheUpsert.mock.calls[0] as [JsonBody]
    const [second] = mockCacheUpsert.mock.calls[1] as [JsonBody]
    expect(first['requestHash']).not.toBe(second['requestHash'])
  })

  it('does NOT cache an over-cap result, but still serves it', async () => {
    // One record over 256 KB — serving it is right, caching it is not.
    const big = [{ blob: 'x'.repeat(300 * 1024) }]
    mockFetch.mockResolvedValue(plainRes({ items: big }))
    mockFindActive.mockResolvedValue({
      fetch: { settlements: { method: 'GET', path: '/s', recordsPath: 'items' } },
    })
    const res = await buildApp().request(ROUTE, post(body))
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ recordCount: 1, source: 'fetched' })
    expect(mockCacheUpsert).not.toHaveBeenCalled()
  })

  // The cap is a boundary, so test the boundary rather than a value far past it
  // — an off-by-one here silently stops caching a whole class of result.
  describe.each([
    ['at the cap', 0, true],
    ['one byte over the cap', 1, false],
  ])('a payload %s', (_label, over, shouldStore) => {
    it(`${shouldStore ? 'is' : 'is not'} cached`, async () => {
      // `records` serializes as `[{"blob":"x…"}]` — 13 bytes of wrapper around
      // the run of x's, so this lands the array exactly on MAX_CACHED_BYTES.
      const wrapper = JSON.stringify([{ blob: '' }]).length
      const blob = 'x'.repeat(256 * 1024 - wrapper + over)
      mockFetch.mockResolvedValue(plainRes({ items: [{ blob }] }))
      mockFindActive.mockResolvedValue({
        fetch: { settlements: { method: 'GET', path: '/s', recordsPath: 'items' } },
      })
      const res = await buildApp().request(ROUTE, post(body))
      expect(res.status).toBe(200)
      expect(mockCacheUpsert).toHaveBeenCalledTimes(shouldStore ? 1 : 0)
    })
  })

  it('degrades to a miss when the cache READ throws', async () => {
    mockCacheFind.mockRejectedValue(new Error('pg is down'))
    const res = await buildApp().request(ROUTE, post(body))
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ source: 'fetched', recordCount: 1 })
  })

  it('still serves the records when the cache WRITE throws', async () => {
    mockCacheUpsert.mockRejectedValue(new Error('pg is down'))
    const res = await buildApp().request(ROUTE, post(body))
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ source: 'fetched', recordCount: 1 })
  })

  it('404s on an unknown operation even with a warm cache — a hit is not a bypass', async () => {
    mockCacheFind.mockResolvedValue(cached())
    const res = await buildApp().request('/integrations/atlas_settlement/fetch/documents', post())
    expect(res.status).toBe(404)
  })

  it('409s on a withdrawn capability even with a warm cache', async () => {
    mockCacheFind.mockResolvedValue(cached())
    mockResolveDef.mockResolvedValue({
      id: 'atlas_settlement',
      floor: 'financial_settlement',
      capabilities: [],
    })
    const res = await buildApp().request(ROUTE, post(body))
    expect(res.status).toBe(409)
  })

  it('400s on an unfillable template even with a warm cache — the hash needs the filled op', async () => {
    mockCacheFind.mockResolvedValue(cached())
    const res = await buildApp().request(ROUTE, post({ params: {} }))
    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // C5 defers single-flight and the plan's Risks section makes this metric the
  // price of that: without it, adding coordination later would be a guess rather
  // than a decision on data. So the log field is tested, not just emitted.
  describe('the duplicate-fetch metric (the instrumented half of the C5 bet)', () => {
    /** The `cache`/`duplicate`/`cacheWrite` fields of the completion log line. */
    async function completionLog(reqBody: unknown): Promise<Record<string, unknown>> {
      const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
      try {
        await buildApp().request(ROUTE, post(reqBody))
        const call = info.mock.calls.find(([message]) => message === 'integration fetch completed')
        return (call?.[1] ?? {}) as Record<string, unknown>
      } finally {
        info.mockRestore()
      }
    }

    it('logs duplicate false when nothing landed while we were on the wire', async () => {
      // No row before, no row after — we are the only fetcher.
      mockCacheFind.mockResolvedValue(null)
      expect(await completionLog(body)).toMatchObject({ cache: 'miss', duplicate: false })
    })

    it('logs duplicate TRUE when another container cached the same request mid-flight', async () => {
      mockCacheFind
        .mockResolvedValueOnce(null) // pre-call: cold
        // post-call: computed when the handler asks, i.e. DURING our call —
        // someone else's write landed while we were on the wire.
        .mockImplementationOnce(async () => cached({ fetchedAt: new Date() }))
      expect(await completionLog(body)).toMatchObject({ cache: 'miss', duplicate: true })
    })

    it('does not call a STALE pre-existing row a duplicate', async () => {
      // The row was already there and nobody refreshed it — a miss we caused, not a race.
      const stale = cached({ fetchedAt: new Date(Date.now() - 600_000) })
      mockCacheFind.mockResolvedValue(stale)
      expect(await completionLog(body)).toMatchObject({ cache: 'miss', duplicate: false })
    })

    it('still serves the records, and reports OUR fetch, when a duplicate is detected', async () => {
      // Last-write-wins: both containers asked the same idempotent question.
      mockCacheFind
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async () => cached({ fetchedAt: new Date() }))
      const res = await buildApp().request(ROUTE, post(body))
      expect(res.status).toBe(200)
      expect((await json(res))['data']).toMatchObject({
        source: 'fetched',
        records: [{ settlementId: 'S-1' }],
      })
      expect(mockCacheUpsert).toHaveBeenCalledTimes(1)
    })

    it('distinguishes a caller-forced refresh from an ordinary miss', async () => {
      mockCacheFind.mockResolvedValue(cached())
      expect(await completionLog({ ...body, refresh: true })).toMatchObject({ cache: 'refresh' })
    })

    it('records why a result was not cached', async () => {
      const big = [{ blob: 'x'.repeat(300 * 1024) }]
      mockFetch.mockResolvedValue(plainRes({ items: big }))
      mockFindActive.mockResolvedValue({
        fetch: { settlements: { method: 'GET', path: '/s', recordsPath: 'items' } },
      })
      expect(await completionLog(body)).toMatchObject({ cacheWrite: 'skipped:oversize' })
    })

    it('reports a hit with the age of what it served, so the TTL can be tuned on data', async () => {
      mockCacheFind.mockResolvedValue(cached({ fetchedAt: new Date(Date.now() - 42_000) }))
      const line = await completionLog(body)
      expect(line['cache']).toBe('hit')
      // A lower bound, not an equality: the age is measured when the handler
      // runs, so a stalled runner legitimately reports more than 42.
      expect(line['ageSeconds']).toBeGreaterThanOrEqual(42)
    })
  })
})
