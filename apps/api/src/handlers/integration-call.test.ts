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

const { mockFindByKey, mockDecrypt, mockGetDef, mockFetch } = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockDecrypt: vi.fn(),
  mockGetDef: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))
vi.mock('../lib/secret-value-crypto', () => ({ decryptSecretValue: mockDecrypt }))
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
