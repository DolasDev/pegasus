// ---------------------------------------------------------------------------
// Unit tests for the outbound delivery handler.
//
// The secrets/config repository, decrypt, registry lookup, and global fetch are
// mocked so no DB or network is needed. requirePermission is NOT mocked — real
// Cedar RBAC evaluates the offline wasm policy, so workflow_runtime passes and
// tenant_user / viewer are denied (proving the new DeliverToExternal action is
// wired end-to-end).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { mockFindByKey, mockDecrypt, mockResolveDef, mockFetch } = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockDecrypt: vi.fn(),
  mockResolveDef: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))

vi.mock('../lib/secret-value-crypto', () => ({
  decryptSecretValue: mockDecrypt,
}))

vi.mock('../integration-validation/registry', () => ({
  resolveIntegrationDefinition: mockResolveDef,
}))

// Mounted on m2mV1 (no wildcard auth), so the handler applies dualAuthMiddleware
// itself. Stub it to passthrough; buildApp seeds the principal + db, and real
// requirePermission still evaluates the offline Cedar policy.
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { integrationDeliveryHandler, assertDeliverableUrl } from './integration-delivery'

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
  app.route('/', integrationDeliveryHandler)
  return app
}

const URL_ROW = { value: 'https://partner.example.com/orders', valueCiphertext: null }
const SECRET_ROW = { value: null, valueCiphertext: 'cipher-blob' }
const ROUTE = '/integrations/demo_partner/deliver-to-external'

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  vi.stubGlobal('fetch', mockFetch)
  mockResolveDef.mockResolvedValue({ id: 'demo_partner' })
  mockDecrypt.mockResolvedValue('super-secret-key')
  mockFindByKey.mockImplementation(async (kind: string, _group: string, key: string) => {
    if (kind === 'CONFIG' && key === 'SEND_URL') return URL_ROW
    if (kind === 'SECRET' && key === 'SEND_API_KEY') return SECRET_ROW
    return null
  })
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ accepted: true }),
    headers: new Headers({ 'content-type': 'application/json' }),
  })
})

describe('POST /integrations/:id/deliver-to-external', () => {
  it('200 — delivers server-side for workflow_runtime and returns delivered:true', async () => {
    const res = await buildApp(['workflow_runtime']).request(
      ROUTE,
      post({ external: { orderNumber: 'S-1' } }),
    )
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({ delivered: true, status: 200, dryRun: false })
    expect(data['response']).toEqual({ accepted: true })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://partner.example.com/orders')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer super-secret-key',
    )
    expect(init.body).toBe(JSON.stringify({ orderNumber: 'S-1' }))
  })

  it('200 — also passes for tenant_admin (blanket grant)', async () => {
    const res = await buildApp(['tenant_admin']).request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(200)
  })

  it('403 — tenant_user is denied DeliverToExternal', async () => {
    const res = await buildApp(['tenant_user']).request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('403 — viewer is denied DeliverToExternal', async () => {
    const res = await buildApp(['viewer']).request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — unknown integration id', async () => {
    mockResolveDef.mockResolvedValue(undefined)
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — delivery URL config not set', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) =>
      kind === 'SECRET' && key === 'SEND_API_KEY' ? SECRET_ROW : null,
    )
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain("'SEND_URL'")
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404 — API-key secret not set', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) =>
      kind === 'CONFIG' && key === 'SEND_URL' ? URL_ROW : null,
    )
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(404)
    expect((await json(res))['error']).toContain("'SEND_API_KEY'")
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('400 — SSRF guard blocks a private/link-local delivery URL', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'SEND_URL')
        return { value: 'http://169.254.169.254/latest/meta-data', valueCiphertext: null }
      if (kind === 'SECRET' && key === 'SEND_API_KEY') return SECRET_ROW
      return null
    })
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(400)
    expect((await json(res))['code']).toBe('VALIDATION_ERROR')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('200 delivered:false — partner returns a non-2xx status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
      headers: new Headers({ 'content-type': 'text/plain' }),
    })
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({ delivered: false, status: 500 })
    expect(data['response']).toBe('boom')
  })

  it('502 — outbound request throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(502)
    expect((await json(res))['code']).toBe('UPSTREAM_ERROR')
  })

  it('merges extra headers from headersConfig', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'SEND_URL') return URL_ROW
      if (kind === 'SECRET' && key === 'SEND_API_KEY') return SECRET_ROW
      if (kind === 'CONFIG' && key === 'SEND_HEADERS')
        return { value: JSON.stringify({ 'X-Partner': 'demo' }), valueCiphertext: null }
      return null
    })
    const res = await buildApp().request(
      ROUTE,
      post({ external: {}, headersConfig: 'SEND_HEADERS' }),
    )
    expect(res.status).toBe(200)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Partner']).toBe('demo')
  })

  // ── header symmetry with call-external (docs/atlas-world-group-api) ───────
  // `headersConfig` reads a plaintext CONFIG row, so it was never a safe home
  // for a partner credential. `secretHeaders` is.

  const sentHeaders = (): Record<string, string> =>
    (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>

  it('passes literal `headers` through', async () => {
    const res = await buildApp().request(
      ROUTE,
      post({ external: {}, headers: { 'On-Behalf-Of': 'jdoe' } }),
    )
    expect(res.status).toBe(200)
    expect(sentHeaders()['On-Behalf-Of']).toBe('jdoe')
  })

  it('resolves `secretHeaders` from the encrypted store, not plaintext config', async () => {
    mockFindByKey.mockImplementation(async (kind: string, _g: string, key: string) => {
      if (kind === 'CONFIG' && key === 'SEND_URL') return URL_ROW
      if (kind === 'SECRET' && key === 'SEND_API_KEY') return SECRET_ROW
      if (kind === 'SECRET' && key === 'ATLAS_SUB_KEY')
        return { value: null, valueCiphertext: 'atlas-cipher' }
      return null
    })
    mockDecrypt.mockImplementation(async (cipher: string) =>
      cipher === 'atlas-cipher' ? 'sub-key-abc' : 'super-secret-key',
    )
    const res = await buildApp().request(
      ROUTE,
      post({ external: {}, secretHeaders: { 'Ocp-Apim-Subscription-Key': 'ATLAS_SUB_KEY' } }),
    )
    expect(res.status).toBe(200)
    expect(sentHeaders()['Ocp-Apim-Subscription-Key']).toBe('sub-key-abc')
  })

  it('400 — a reserved header cannot be overridden', async () => {
    const res = await buildApp().request(
      ROUTE,
      post({ external: {}, headers: { Authorization: 'Bearer attacker' } }),
    )
    expect(res.status).toBe(400)
    expect(String((await json(res))['error'])).toMatch(/reserved/i)
  })

  it('404 — a secretHeaders key that is not set', async () => {
    const res = await buildApp().request(
      ROUTE,
      post({ external: {}, secretHeaders: { 'X-K': 'MISSING_KEY' } }),
    )
    expect(res.status).toBe(404)
    expect(String((await json(res))['error'])).toContain('MISSING_KEY')
  })

  it('returns the partner response headers', async () => {
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    const data = (await json(res))['data'] as JsonBody
    expect((data['headers'] as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('504 — the partner does not respond within the timeout', async () => {
    const err = new Error('aborted')
    err.name = 'TimeoutError'
    mockFetch.mockRejectedValue(err)
    const res = await buildApp().request(ROUTE, post({ external: {} }))
    expect(res.status).toBe(504)
    expect((await json(res))['code']).toBe('UPSTREAM_TIMEOUT')
  })
})

describe('assertDeliverableUrl', () => {
  it.each(['https://partner.example.com/x', 'http://partner.example.com:8080/x'])(
    'allows public http(s): %s',
    (u) => {
      expect(assertDeliverableUrl(u)).toBeNull()
    },
  )

  it.each([
    'ftp://partner.example.com',
    'file:///etc/passwd',
    'http://localhost/x',
    'http://127.0.0.1/x',
    'http://10.1.2.3/x',
    'http://192.168.0.1/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data',
    'not-a-url',
  ])('rejects: %s', (u) => {
    expect(assertDeliverableUrl(u)).not.toBeNull()
  })
})
