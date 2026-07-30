// ---------------------------------------------------------------------------
// Unit tests for the outbound call-external handler.
//
// The secrets/config repository, decrypt, registry lookup, and global fetch are
// mocked so no DB or network is needed. requirePermission is NOT mocked — real
// Cedar RBAC evaluates the offline policy, so workflow_runtime passes and
// tenant_user/viewer are denied (proving the new CallExternal action is wired).
// The outbound OAuth token cache is reset between tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'
import { __resetOutboundTokenCacheForTests } from '../services/outbound-oauth'

const {
  mockFindByKey,
  mockDecrypt,
  mockEncrypt,
  mockGetDef,
  mockFetch,
  mockTokenFindFresh,
  mockTokenUpsert,
  mockTokenDelete,
} = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockDecrypt: vi.fn(),
  mockEncrypt: vi.fn(),
  mockGetDef: vi.fn(),
  mockFetch: vi.fn(),
  mockTokenFindFresh: vi.fn(),
  mockTokenUpsert: vi.fn(),
  mockTokenDelete: vi.fn(),
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))
vi.mock('../lib/secret-value-crypto', () => ({
  decryptSecretValue: mockDecrypt,
  encryptSecretValue: mockEncrypt,
}))
vi.mock('../repositories/outbound-oauth-token.repository', () => ({
  createOutboundOAuthTokenRepository: () => ({
    findFresh: mockTokenFindFresh,
    upsert: mockTokenUpsert,
    deleteKey: mockTokenDelete,
  }),
}))
vi.mock('../integration-validation/registry', () => ({ getIntegrationDefinition: mockGetDef }))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { integrationCallHandler, resolveOutboundUrl } from './integration-call'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = {} as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', fakeDb)
    c.set('tenantId', 'test-tenant-id')
    await next()
  })
  app.route('/', integrationCallHandler)
  return app
}

const ROUTE = '/integrations/sirva_ade_shipment/call-external'

// Default config: an OAuth2 client-credentials integration.
const OAUTH_CONFIG: Record<string, { value?: string | null; valueCiphertext?: string | null }> = {
  'CONFIG:BASE_URL': { value: 'https://openapi.sirva.com/ms', valueCiphertext: null },
  'CONFIG:AUTH_MODE': { value: 'oauth2_client_credentials', valueCiphertext: null },
  'CONFIG:TOKEN_URL': {
    value: 'https://openapi.sirva.com/oauth2/accessrequest',
    valueCiphertext: null,
  },
  'SECRET:CLIENT_ID': { value: null, valueCiphertext: 'cid-cipher' },
  'SECRET:CLIENT_SECRET': { value: null, valueCiphertext: 'csec-cipher' },
}

const tokenRes = (): Response =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ access_token: 'MINT-TOK', expires_in: 600, token_type: 'Bearer' }),
    headers: new Headers({ 'content-type': 'application/json' }),
  }) as unknown as Response

const callRes = (status = 200, body: unknown = { RegNumber: '111422' }): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  }) as unknown as Response

const isTokenUrl = (url: string) => url.includes('/oauth2/accessrequest')

beforeEach(() => {
  vi.clearAllMocks()
  __resetOutboundTokenCacheForTests()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  vi.stubGlobal('fetch', mockFetch)
  mockGetDef.mockReturnValue({ id: 'sirva_ade_shipment' })
  mockDecrypt.mockImplementation(async (cipher: string) =>
    cipher === 'cid-cipher' ? 'the-client-id' : 'the-client-secret',
  )
  mockFindByKey.mockImplementation(
    async (kind: string, _group: string, key: string) => OAUTH_CONFIG[`${kind}:${key}`] ?? null,
  )
  // Default: token mint, then the partner call.
  mockFetch.mockImplementation(async (url: string) => (isTokenUrl(url) ? tokenRes() : callRes()))
  // Shared token tier: off unless a test opts in (production default).
  delete process.env['OUTBOUND_OAUTH_SHARED_CACHE_ENABLED']
  mockEncrypt.mockImplementation(async (p: string) => `enc(${p})`)
  mockTokenFindFresh.mockResolvedValue(null)
  mockTokenUpsert.mockResolvedValue(undefined)
  mockTokenDelete.mockResolvedValue(1)
})

describe('POST /integrations/:id/call-external', () => {
  it('200 — GET mints an OAuth token server-side and returns the parsed response', async () => {
    const res = await buildApp(['workflow_runtime']).request(
      ROUTE,
      post({
        method: 'GET',
        path: '/OM/m1/GetShipmentDetail',
        query: { RegNumber: '111422', RegYear: 2014 },
      }),
    )
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({ status: 200, ok: true, dryRun: false })
    expect(data['response']).toEqual({ RegNumber: '111422' })

    // Two fetches: the token mint, then the partner GET with the bearer + joined URL + query.
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const tokenCall = mockFetch.mock.calls.find(([u]) => isTokenUrl(u as string))!
    expect((tokenCall[1] as RequestInit).body).toBe('grant_type=client_credentials')
    const partnerCall = mockFetch.mock.calls.find(([u]) => !isTokenUrl(u as string))!
    const [pUrl, pInit] = partnerCall as [string, RequestInit]
    expect(pUrl).toBe(
      'https://openapi.sirva.com/ms/OM/m1/GetShipmentDetail?RegNumber=111422&RegYear=2014',
    )
    expect((pInit.headers as Record<string, string>)['Authorization']).toBe('Bearer MINT-TOK')
    expect(pInit.method).toBe('GET')
  })

  it('re-mints the token and retries once on a partner 401', async () => {
    let partnerCalls = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (isTokenUrl(url)) return tokenRes()
      partnerCalls += 1
      return partnerCalls === 1
        ? callRes(401, { error: 'invalid_token' })
        : callRes(200, { ok: true })
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(200)
    // token minted twice (initial + re-mint), partner hit twice (401 then success).
    const tokenCalls = mockFetch.mock.calls.filter(([u]) => isTokenUrl(u as string)).length
    expect(tokenCalls).toBe(2)
    expect(partnerCalls).toBe(2)
    expect(((await json(res))['data'] as JsonBody)['response']).toEqual({ ok: true })
  })

  // ── shared token tier wiring (sdk-feedback 0027) ───────────────────────────

  it('does not touch the shared token tier while the flag is off', async () => {
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(200)
    // Flag off is the deployed default — the DB must not be consulted at all.
    expect(mockTokenFindFresh).not.toHaveBeenCalled()
    expect(mockTokenUpsert).not.toHaveBeenCalled()
  })

  it('reads and writes through the shared tier when the flag is on', async () => {
    process.env['OUTBOUND_OAUTH_SHARED_CACHE_ENABLED'] = 'true'
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(200)
    expect(mockTokenFindFresh).toHaveBeenCalledTimes(1)
    // The minted token is written back ENCRYPTED, keyed by tenant+integration+endpoint.
    expect(mockTokenUpsert).toHaveBeenCalledWith(
      {
        tenantId: 'test-tenant-id',
        integrationId: 'sirva_ade_shipment',
        tokenUrl: 'https://openapi.sirva.com/oauth2/accessrequest',
      },
      'enc(MINT-TOK)',
      expect.any(Date),
    )
  })

  it('serves a shared-tier token without minting (the cross-container path)', async () => {
    process.env['OUTBOUND_OAUTH_SHARED_CACHE_ENABLED'] = 'true'
    // This container's L1 is empty (reset in beforeEach) but another container
    // already minted — exactly 0027's two-sequential-calls scenario.
    mockTokenFindFresh.mockResolvedValue({
      tokenCiphertext: 'shared-cipher',
      expiresAt: new Date(Date.now() + 600_000),
    })
    mockDecrypt.mockImplementation(async (cipher: string) => {
      if (cipher === 'shared-cipher') return 'SHARED-TOK'
      return cipher === 'cid-cipher' ? 'the-client-id' : 'the-client-secret'
    })

    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(200)
    // No token-endpoint round-trip at all — the acceptance criterion of 0027.
    expect(mockFetch.mock.calls.filter(([u]) => isTokenUrl(u as string))).toHaveLength(0)
    const partnerCall = mockFetch.mock.calls.find(([u]) => !isTokenUrl(u as string))!
    expect((partnerCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer SHARED-TOK',
    })
  })

  it('a partner 401 deletes the shared row, not just the local one', async () => {
    process.env['OUTBOUND_OAUTH_SHARED_CACHE_ENABLED'] = 'true'
    let partnerCalls = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (isTokenUrl(url)) return tokenRes()
      partnerCalls += 1
      return partnerCalls === 1
        ? callRes(401, { error: 'invalid_token' })
        : callRes(200, { ok: true })
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(200)
    // Without this, every OTHER container keeps presenting the rejected token
    // out of the shared row until its nominal expiry.
    expect(mockTokenDelete).toHaveBeenCalledWith({
      tenantId: 'test-tenant-id',
      integrationId: 'sirva_ade_shipment',
      tokenUrl: 'https://openapi.sirva.com/oauth2/accessrequest',
    })
  })

  it('still succeeds when the shared tier is unavailable', async () => {
    process.env['OUTBOUND_OAUTH_SHARED_CACHE_ENABLED'] = 'true'
    mockTokenFindFresh.mockRejectedValue(new Error('neon: connection terminated'))
    mockTokenUpsert.mockRejectedValue(new Error('neon: connection terminated'))
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    // A cache outage must degrade to minting, never fail the caller's call.
    expect(res.status).toBe(200)
  })

  it('POST sends a JSON body with Content-Type', async () => {
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'POST', path: '/Imaging/m3/AddDocument', body: { ReferenceNumber: 'R1' } }),
    )
    expect(res.status).toBe(200)
    const partnerCall = mockFetch.mock.calls.find(([u]) => !isTokenUrl(u as string))!
    const init = partnerCall[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ ReferenceNumber: 'R1' }))
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('bearer AUTH_MODE uses the static API_KEY secret, no token mint', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'BASE_URL')
        return { value: 'https://p.example.com', valueCiphertext: null }
      if (kind === 'CONFIG' && key === 'AUTH_MODE')
        return { value: 'bearer', valueCiphertext: null }
      if (kind === 'SECRET' && key === 'API_KEY')
        return { value: null, valueCiphertext: 'key-cipher' }
      return null
    })
    mockDecrypt.mockResolvedValue('static-bearer')
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/ping' }))
    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1) // no token mint
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer static-bearer')
  })

  it('none AUTH_MODE sends no Authorization header', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'BASE_URL')
        return { value: 'https://p.example.com', valueCiphertext: null }
      if (kind === 'CONFIG' && key === 'AUTH_MODE') return { value: 'none', valueCiphertext: null }
      return null
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/ping' }))
    expect(res.status).toBe(200)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('403 — tenant_user is denied CallExternal', async () => {
    const res = await buildApp(['tenant_user']).request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('403 — viewer is denied CallExternal', async () => {
    const res = await buildApp(['viewer']).request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(403)
  })

  it('200 — tenant_admin passes (blanket grant)', async () => {
    const res = await buildApp(['tenant_admin']).request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(200)
  })

  it('404 — unknown integration id', async () => {
    mockGetDef.mockReturnValue(undefined)
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — BASE_URL config not set', async () => {
    mockFindByKey.mockResolvedValue(null)
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain('BASE_URL')
  })

  it('404 — TOKEN_URL not set for oauth', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'BASE_URL') return OAUTH_CONFIG['CONFIG:BASE_URL']!
      if (kind === 'CONFIG' && key === 'AUTH_MODE') return OAUTH_CONFIG['CONFIG:AUTH_MODE']!
      return null
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain('TOKEN_URL')
  })

  it('404 — client credentials not set for oauth', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) =>
      kind === 'CONFIG' ? (OAUTH_CONFIG[`CONFIG:${key}`] ?? null) : null,
    )
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain('CLIENT_ID')
  })

  it('400 — SSRF guard blocks a private resolved URL', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'BASE_URL')
        return { value: 'http://169.254.169.254', valueCiphertext: null }
      if (kind === 'CONFIG' && key === 'AUTH_MODE') return { value: 'none', valueCiphertext: null }
      return null
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/latest/meta-data' }))
    expect(res.status).toBe(400)
    expect((await json(res))['code']).toBe('VALIDATION_ERROR')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400 — unsupported AUTH_MODE', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'BASE_URL')
        return { value: 'https://p.example.com', valueCiphertext: null }
      if (kind === 'CONFIG' && key === 'AUTH_MODE')
        return { value: 'wizardry', valueCiphertext: null }
      return null
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(400)
  })

  it('502 — outbound call throws', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (isTokenUrl(url)) return tokenRes()
      throw new Error('ECONNREFUSED')
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('UPSTREAM_ERROR')
  })

  it('returns raw text for a non-JSON (XML) partner response', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      isTokenUrl(url)
        ? tokenRes()
        : ({
            ok: true,
            status: 200,
            text: async () => '<AgentComp><Amount>10</Amount></AgentComp>',
            headers: new Headers({ 'content-type': 'application/xml' }),
          } as unknown as Response),
    )
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/GetAgentComp' }))
    expect(res.status).toBe(200)
    expect(((await json(res))['data'] as JsonBody)['response']).toBe(
      '<AgentComp><Amount>10</Amount></AgentComp>',
    )
  })
})

// ---------------------------------------------------------------------------
// Azure API Management partners (docs/atlas-world-group-api).
//
// An APIM gateway authenticates with a NAMED HEADER rather than a bearer, and
// Atlas additionally declares `On-Behalf-Of` on 142 of its 255 operations.
// Neither was expressible before, so no Atlas operation was callable at all.
// ---------------------------------------------------------------------------
describe('call-external — APIM-shaped partners', () => {
  /** Config for an `AUTH_MODE=apikey` integration (the Atlas shape). */
  const APIKEY_CONFIG: Record<string, { value?: string | null; valueCiphertext?: string | null }> =
    {
      'CONFIG:BASE_URL': {
        value: 'https://qa-azapi.atlasworldgroup.com/estimating/v2',
        valueCiphertext: null,
      },
      'CONFIG:AUTH_MODE': { value: 'apikey', valueCiphertext: null },
      'SECRET:API_KEY': { value: null, valueCiphertext: 'subkey-cipher' },
    }

  const useApiKeyConfig = (
    extra: Record<string, { value?: string | null; valueCiphertext?: string | null }> = {},
  ) => {
    const cfg = { ...APIKEY_CONFIG, ...extra }
    mockFindByKey.mockImplementation(
      async (kind: string, _group: string, key: string) => cfg[`${kind}:${key}`] ?? null,
    )
    mockDecrypt.mockImplementation(async (cipher: string) =>
      cipher === 'subkey-cipher' ? 'sub-key-abc123' : 'other-secret',
    )
    mockFetch.mockImplementation(async () => callRes())
  }

  const lastFetchHeaders = (): Record<string, string> =>
    (mockFetch.mock.calls.at(-1)?.[1] as { headers: Record<string, string> }).headers

  it('sends the subscription key as Ocp-Apim-Subscription-Key by default', async () => {
    useApiKeyConfig()
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/Estimating/1' }))
    expect(res.status).toBe(200)
    expect(lastFetchHeaders()['Ocp-Apim-Subscription-Key']).toBe('sub-key-abc123')
    // apikey mode must NOT also set an Authorization header.
    expect(lastFetchHeaders()['Authorization']).toBeUndefined()
  })

  it('honors a custom API_KEY_HEADER name from config', async () => {
    useApiKeyConfig({ 'CONFIG:API_KEY_HEADER': { value: 'X-Api-Key', valueCiphertext: null } })
    await buildApp().request(ROUTE, post({ method: 'GET', path: '/Estimating/1' }))
    expect(lastFetchHeaders()['X-Api-Key']).toBe('sub-key-abc123')
  })

  it('400s when API_KEY_HEADER config names a reserved header', async () => {
    // Otherwise `API_KEY_HEADER=Authorization` would reintroduce the very
    // override the reserved list exists to prevent, via the config back door.
    useApiKeyConfig({ 'CONFIG:API_KEY_HEADER': { value: 'Authorization', valueCiphertext: null } })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(400)
    expect(String((await json(res))['error'])).toMatch(/reserved/i)
  })

  it('404s when the api-key secret is not set', async () => {
    const cfg = { ...APIKEY_CONFIG }
    delete cfg['SECRET:API_KEY']
    mockFindByKey.mockImplementation(
      async (kind: string, _group: string, key: string) => cfg[`${kind}:${key}`] ?? null,
    )
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    expect(res.status).toBe(404)
  })

  it('passes a literal `headers` entry through (On-Behalf-Of)', async () => {
    useApiKeyConfig()
    await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/Estimating/1', headers: { 'On-Behalf-Of': 'jdoe' } }),
    )
    expect(lastFetchHeaders()['On-Behalf-Of']).toBe('jdoe')
  })

  it('resolves a `secretHeaders` entry from the encrypted store', async () => {
    useApiKeyConfig({ 'SECRET:PARTNER_TOKEN': { value: null, valueCiphertext: 'ptok-cipher' } })
    mockDecrypt.mockImplementation(async (cipher: string) =>
      cipher === 'subkey-cipher' ? 'sub-key-abc123' : 'resolved-partner-token',
    )
    await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/x', secretHeaders: { 'X-Partner-Token': 'PARTNER_TOKEN' } }),
    )
    expect(lastFetchHeaders()['X-Partner-Token']).toBe('resolved-partner-token')
  })

  it('404s (naming the key) when a secretHeaders secret is unset', async () => {
    useApiKeyConfig()
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/x', secretHeaders: { 'X-K': 'NO_SUCH_SECRET' } }),
    )
    expect(res.status).toBe(404)
    expect(String((await json(res))['error'])).toContain('NO_SUCH_SECRET')
  })

  it('400s on a reserved header, before any config read', async () => {
    // The guard that stops a workflow from overriding AUTH_MODE's credential.
    useApiKeyConfig()
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/x', headers: { Authorization: 'Bearer attacker' } }),
    )
    expect(res.status).toBe(400)
    expect(String((await json(res))['error'])).toMatch(/reserved/i)
    expect(mockFindByKey).not.toHaveBeenCalled()
  })

  it('400s on a CRLF-bearing header value (request splitting)', async () => {
    useApiKeyConfig()
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'GET', path: '/x', headers: { 'X-A': 'ok\r\nX-Evil: 1' } }),
    )
    expect(res.status).toBe(400)
  })

  it('returns the full response header set, not just content-type', async () => {
    useApiKeyConfig()
    mockFetch.mockImplementation(async () => {
      const h = new Headers({
        'content-type': 'application/json',
        'x-ms-request-id': 'req-42',
        'ocp-apim-trace-location': 'https://trace.example/1',
      })
      h.append('set-cookie', 'session=leak')
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
        headers: h,
      } as unknown as Response
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/x' }))
    const headers = ((await json(res))['data'] as JsonBody)['headers'] as Record<string, string>
    expect(headers['x-ms-request-id']).toBe('req-42')
    expect(headers['ocp-apim-trace-location']).toBe('https://trace.example/1')
    expect(headers['set-cookie']).toBeUndefined()
  })
})

describe('call-external — timeout and throttling', () => {
  const NO_AUTH_CONFIG: Record<string, { value?: string | null; valueCiphertext?: string | null }> =
    {
      'CONFIG:BASE_URL': {
        value: 'https://qa-azapi.atlasworldgroup.com/agents/v1',
        valueCiphertext: null,
      },
      'CONFIG:AUTH_MODE': { value: 'none', valueCiphertext: null },
    }

  const useConfig = (
    extra: Record<string, { value?: string | null; valueCiphertext?: string | null }> = {},
  ) => {
    const cfg = { ...NO_AUTH_CONFIG, ...extra }
    mockFindByKey.mockImplementation(
      async (kind: string, _group: string, key: string) => cfg[`${kind}:${key}`] ?? null,
    )
  }

  /** A 429 carrying `Retry-After: 0` so the test does not actually sleep. */
  const throttled = (): Response =>
    ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
      headers: new Headers({ 'content-type': 'text/plain', 'retry-after': '0' }),
    }) as unknown as Response

  it('504 UPSTREAM_TIMEOUT when the partner does not respond', async () => {
    useConfig()
    mockFetch.mockImplementation(async () => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    })
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/Agents' }))
    expect(res.status).toBe(504)
    expect((await json(res))['code']).toBe('UPSTREAM_TIMEOUT')
  })

  it('retries a 429 on an idempotent GET and reports the attempt count', async () => {
    useConfig()
    mockFetch
      .mockImplementationOnce(async () => throttled())
      .mockImplementation(async () => callRes())
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/Agents' }))
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data['status']).toBe(200)
    expect(data['attempts']).toBe(2)
  })

  it('does NOT retry a 429 on a POST — a repeat could double-write at the partner', async () => {
    useConfig()
    mockFetch.mockImplementation(async () => throttled())
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'POST', path: '/Agents', body: { a: 1 } }),
    )
    const data = (await json(res))['data'] as JsonBody
    expect(data['status']).toBe(429)
    expect(data['attempts']).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries a POST the caller declared non-mutating', async () => {
    useConfig()
    mockFetch
      .mockImplementationOnce(async () => throttled())
      .mockImplementation(async () => callRes())
    const res = await buildApp().request(
      ROUTE,
      post({ method: 'POST', path: '/report', body: {}, mutating: false }),
    )
    expect(((await json(res))['data'] as JsonBody)['attempts']).toBe(2)
  })

  it('stops after MAX_RETRIES and returns the last 429', async () => {
    useConfig({ 'CONFIG:MAX_RETRIES': { value: '1', valueCiphertext: null } })
    mockFetch.mockImplementation(async () => throttled())
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/Agents' }))
    const data = (await json(res))['data'] as JsonBody
    expect(data['status']).toBe(429)
    expect(data['attempts']).toBe(2) // initial + 1 retry
  })

  it('does not retry a 500 — usually a deterministic partner bug', async () => {
    useConfig()
    mockFetch.mockImplementation(async () => callRes(500, { error: 'boom' }))
    const res = await buildApp().request(ROUTE, post({ method: 'GET', path: '/Agents' }))
    expect(((await json(res))['data'] as JsonBody)['attempts']).toBe(1)
  })
})

describe('resolveOutboundUrl', () => {
  it('joins base + path without dropping the base path segment', () => {
    expect(resolveOutboundUrl('https://openapi.sirva.com/ms', '/OM/m1/Get')).toBe(
      'https://openapi.sirva.com/ms/OM/m1/Get',
    )
    expect(resolveOutboundUrl('https://h.example.com/', 'a/b')).toBe('https://h.example.com/a/b')
  })
  it('appends query params', () => {
    expect(resolveOutboundUrl('https://h.example.com', '/q', { a: 1, b: 'x' })).toBe(
      'https://h.example.com/q?a=1&b=x',
    )
  })
})
