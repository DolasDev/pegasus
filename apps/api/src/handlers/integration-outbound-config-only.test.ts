// ---------------------------------------------------------------------------
// Regression guard for sdk-feedback 0038 — the outbound plane must resolve a
// CONFIG-ONLY integration (a published GLOBAL config referencing a floor, with
// no built-in registry entry — the thing 0020 enabled) from a process whose
// in-process registry overlay was NEVER populated.
//
// This is the whole bug: `getIntegrationDefinition` reads a module-level overlay
// that only the four config-mutation handlers warm, so on horizontally-scaled
// Lambda the outbound handlers 404'd `Unknown integration` on every container
// that had not itself served the publish — ~2 runs in 3 for `weichert`.
//
// So, unlike the sibling handler suites, this file deliberately does NOT mock
// `../integration-validation/registry`. The REAL resolver runs against a fake
// Prisma that serves one GLOBAL row, and every test asserts the overlay stayed
// cold (`getIntegrationDefinition` → undefined) while the call still resolved.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { mockFindByKey, mockDecrypt, mockFetch, mockFindFirst } = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockDecrypt: vi.fn(),
  mockFetch: vi.fn(),
  mockFindFirst: vi.fn(),
}))

// The unscoped client the handlers resolve through — GLOBAL rows carry no
// tenantId, so the request-scoped client is the wrong one to ask.
vi.mock('../db', () => ({
  db: { integrationConfig: { findFirst: mockFindFirst } } as unknown as PrismaClient,
}))

vi.mock('../repositories/workflow-secret-config.repository', () => ({
  createWorkflowSecretConfigRepository: () => ({ findByKey: mockFindByKey }),
}))
vi.mock('../lib/secret-value-crypto', () => ({
  decryptSecretValue: mockDecrypt,
  encryptSecretValue: vi.fn(),
}))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { integrationCallHandler } from './integration-call'
import { integrationDeliveryHandler } from './integration-delivery'
import { getIntegrationDefinition } from '../integration-validation/registry'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// A config-only partner: no built-in entry, resolvable ONLY through its
// published GLOBAL row (mirrors `weichert`).
const CONFIG_ONLY_ID = 'acme_status'
const GLOBAL_ROW = {
  integrationId: CONFIG_ONLY_ID,
  version: 1,
  visibility: 'GLOBAL',
  status: 'PUBLISHED',
  floor: 'shipment_status_update',
  displayName: 'ACME',
  mapping: { serviceOrderNumber: 'InvolvedParties.ShipperEmployer.Identity.Description' },
  rules: [],
  externalShape: {
    type: 'object',
    additionalProperties: false,
    properties: { ref: { type: 'string' } },
  },
  externalMapping: { ref: 'serviceOrderNumber' },
}

function buildApp(handler: Hono<AppEnv>) {
  const scopedDb = {} as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames: ['workflow_runtime'] }))
  app.use('*', async (c, next) => {
    c.set('db', scopedDb)
    c.set('tenantId', 'test-tenant-id')
    await next()
  })
  app.route('/', handler)
  return app
}

const CONFIG: Record<string, { value?: string | null; valueCiphertext?: string | null }> = {
  // call-external, auth-free so the test turns on the registry gate alone.
  'CONFIG:BASE_URL': { value: 'https://partner.example.com', valueCiphertext: null },
  'CONFIG:AUTH_MODE': { value: 'none', valueCiphertext: null },
  // deliver-to-external.
  'CONFIG:SEND_URL': { value: 'https://partner.example.com/orders', valueCiphertext: null },
  'SECRET:SEND_API_KEY': { value: null, valueCiphertext: 'cipher-blob' },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  vi.stubGlobal('fetch', mockFetch)
  mockDecrypt.mockResolvedValue('super-secret-key')
  mockFindByKey.mockImplementation(
    async (kind: string, _group: string, key: string) => CONFIG[`${kind}:${key}`] ?? null,
  )
  // The tenant has no own row; the GLOBAL row is the only thing that resolves
  // this id (`findActiveForScope`: own → GLOBAL).
  mockFindFirst.mockImplementation(async (args: { where: { integrationId: string } }) =>
    args.where.integrationId === CONFIG_ONLY_ID ? GLOBAL_ROW : null,
  )
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ accepted: true }),
    headers: new Headers({ 'content-type': 'application/json' }),
  })
})

describe('outbound plane resolves a config-only integration with a COLD overlay (0038)', () => {
  it('the in-process overlay really is cold — the sync lookup cannot see the id', () => {
    // If this ever starts passing, the test below stops proving anything.
    expect(getIntegrationDefinition(CONFIG_ONLY_ID)).toBeUndefined()
  })

  it('call-external resolves it instead of 404 Unknown integration', async () => {
    const res = await buildApp(integrationCallHandler).request(
      `/integrations/${CONFIG_ONLY_ID}/call-external`,
      post({ method: 'GET', path: '/orders/1' }),
    )
    expect(res.status).toBe(200)
    expect(getIntegrationDefinition(CONFIG_ONLY_ID)).toBeUndefined()
  })

  it('deliver-to-external resolves it instead of 404 Unknown integration', async () => {
    const res = await buildApp(integrationDeliveryHandler).request(
      `/integrations/${CONFIG_ONLY_ID}/deliver-to-external`,
      post({ external: { ref: 'O-1' }, urlConfig: 'SEND_URL', apiKeySecret: 'SEND_API_KEY' }),
    )
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ delivered: true })
    expect(getIntegrationDefinition(CONFIG_ONLY_ID)).toBeUndefined()
  })

  it('a genuinely unknown id still 404s Unknown integration on both routes', async () => {
    const call = await buildApp(integrationCallHandler).request(
      '/integrations/ghost_status/call-external',
      post({ method: 'GET', path: '/orders/1' }),
    )
    expect(call.status).toBe(404)
    expect(await json(call)).toMatchObject({
      code: 'NOT_FOUND',
      error: "Unknown integration 'ghost_status'",
    })

    const deliver = await buildApp(integrationDeliveryHandler).request(
      '/integrations/ghost_status/deliver-to-external',
      post({ external: {}, urlConfig: 'SEND_URL', apiKeySecret: 'SEND_API_KEY' }),
    )
    expect(deliver.status).toBe(404)
    expect(await json(deliver)).toMatchObject({
      code: 'NOT_FOUND',
      error: "Unknown integration 'ghost_status'",
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
