// ---------------------------------------------------------------------------
// Unit tests for the event-types (custom-event registry) handler.
//
// createTenantEventTypeRepository is mocked so no DB is required.
// dualAuthMiddleware is stubbed to inject the AppEnv context; requirePermission
// is NOT mocked — real Cedar RBAC runs (tenant_admin permits everything; a
// role without ManageEventTypes is rejected). CUSTOM_EVENTS_ENABLED is toggled
// per test around the feature gate.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    create: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
  },
}))

vi.mock('../repositories/tenant-event-type.repository', () => ({
  createTenantEventTypeRepository: vi.fn(() => mockRepo),
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { eventTypesHandler } from './event-types'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(
  roleNames: readonly string[] = ['tenant_admin'],
  userId: string | null = 'user-1',
) {
  const fakeDb = {} as unknown as PrismaClient
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('principal', { sub: 'test-sub', tenantId: 'test-tenant-id', roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', userId ?? undefined)
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/event-types', eventTypesHandler)
  return app
}

const now = new Date('2026-06-21T12:00:00Z')
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'et-1',
    tenantId: 'test-tenant-id',
    name: 'lead.qualified',
    description: null,
    payloadSchema: null,
    domainCondition: null,
    hasDomainCondition: false,
    enabled: true,
    createdByUserId: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _clearAuthzCache()
  process.env['CUSTOM_EVENTS_ENABLED'] = 'true'
})
afterEach(() => {
  delete process.env['CUSTOM_EVENTS_ENABLED']
})

describe('POST /event-types', () => {
  it('creates a custom event type (201)', async () => {
    mockRepo.create.mockResolvedValue(row())
    const res = await buildApp().request('/event-types', post({ name: 'lead.qualified' }))
    expect(res.status).toBe(201)
    const body = await json(res)
    expect((body['data'] as JsonBody)['name']).toBe('lead.qualified')
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'lead.qualified', tenantId: 'test-tenant-id' }),
    )
  })

  it('rejects a reserved built-in name (400)', async () => {
    const res = await buildApp().request('/event-types', post({ name: 'quote.accepted' }))
    expect(res.status).toBe(400)
    expect(mockRepo.create).not.toHaveBeenCalled()
  })

  it('rejects an invalid slug (400)', async () => {
    const res = await buildApp().request('/event-types', post({ name: 'Not A Slug!' }))
    expect(res.status).toBe(400)
  })

  it('rejects an invalid payloadSchema (400)', async () => {
    const res = await buildApp().request(
      '/event-types',
      post({ name: 'lead.qualified', payloadSchema: { type: 'nonsense' } }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects a domainCondition whose sourceEventType is not built-in (400)', async () => {
    const res = await buildApp().request(
      '/event-types',
      post({ name: 'lead.qualified', domainCondition: { sourceEventType: 'my.custom' } }),
    )
    expect(res.status).toBe(400)
  })

  it('accepts a domainCondition with a built-in source and a v2 filter (201)', async () => {
    mockRepo.create.mockResolvedValue(row({ hasDomainCondition: true }))
    const res = await buildApp().request(
      '/event-types',
      post({
        name: 'move.completed.custom',
        domainCondition: {
          sourceEventType: 'move.status_changed',
          filter: { path: 'newStatus', op: 'eq', value: 'COMPLETED' },
        },
      }),
    )
    expect(res.status).toBe(201)
  })

  it('accepts a valid payloadSchema and description (201)', async () => {
    mockRepo.create.mockResolvedValue(row({ description: 'a lead got qualified' }))
    const res = await buildApp().request(
      '/event-types',
      post({
        name: 'lead.qualified',
        description: 'a lead got qualified',
        payloadSchema: { type: 'object', properties: { leadId: { type: 'string' } } },
        enabled: false,
      }),
    )
    expect(res.status).toBe(201)
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, description: 'a lead got qualified' }),
    )
  })

  it('returns 409 on a duplicate name', async () => {
    mockRepo.create.mockRejectedValue(new Error('Unique constraint failed'))
    const res = await buildApp().request('/event-types', post({ name: 'lead.qualified' }))
    expect(res.status).toBe(409)
  })

  it('returns 403 for a role without ManageEventTypes', async () => {
    const res = await buildApp(['tenant_user']).request('/event-types', post({ name: 'x.y' }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when the feature flag is off', async () => {
    delete process.env['CUSTOM_EVENTS_ENABLED']
    const res = await buildApp().request('/event-types', post({ name: 'lead.qualified' }))
    expect(res.status).toBe(404)
  })
})

describe('GET /event-types', () => {
  it('lists the tenant event types', async () => {
    mockRepo.list.mockResolvedValue([row(), row({ id: 'et-2', name: 'deal.won' })])
    const res = await buildApp().request('/event-types')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body['data'] as unknown[]).length).toBe(2)
    expect(mockRepo.list).toHaveBeenCalledWith({})
  })

  it('passes the enabled filter through (both values)', async () => {
    mockRepo.list.mockResolvedValue([])
    await buildApp().request('/event-types?enabled=false')
    expect(mockRepo.list).toHaveBeenCalledWith({ enabled: false })
    await buildApp().request('/event-types?enabled=true')
    expect(mockRepo.list).toHaveBeenLastCalledWith({ enabled: true })
  })

  it('returns one by name, 404 on miss', async () => {
    mockRepo.findByName.mockResolvedValueOnce(row())
    expect((await buildApp().request('/event-types/lead.qualified')).status).toBe(200)
    mockRepo.findByName.mockResolvedValueOnce(null)
    expect((await buildApp().request('/event-types/missing')).status).toBe(404)
  })
})

describe('PATCH /event-types/:name', () => {
  it('updates enabled', async () => {
    mockRepo.findByName.mockResolvedValue(row())
    mockRepo.update.mockResolvedValue(row({ enabled: false }))
    const res = await buildApp().request('/event-types/lead.qualified', patch({ enabled: false }))
    expect(res.status).toBe(200)
    expect(mockRepo.update).toHaveBeenCalledWith('et-1', { enabled: false })
  })

  it('updates schema + condition + description and re-validates', async () => {
    mockRepo.findByName.mockResolvedValue(row())
    mockRepo.update.mockResolvedValue(row({ description: 'now described' }))
    const res = await buildApp().request(
      '/event-types/lead.qualified',
      patch({
        description: 'now described',
        payloadSchema: { type: 'object', properties: { leadId: { type: 'string' } } },
        domainCondition: { sourceEventType: 'quote.accepted' },
      }),
    )
    expect(res.status).toBe(200)
    expect(mockRepo.update).toHaveBeenCalledWith(
      'et-1',
      expect.objectContaining({ description: 'now described' }),
    )
  })

  it('rejects an invalid payloadSchema on update (400)', async () => {
    mockRepo.findByName.mockResolvedValue(row())
    const res = await buildApp().request(
      '/event-types/lead.qualified',
      patch({ payloadSchema: { type: 'bogus' } }),
    )
    expect(res.status).toBe(400)
    expect(mockRepo.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid domainCondition on update (400)', async () => {
    mockRepo.findByName.mockResolvedValue(row())
    const res = await buildApp().request(
      '/event-types/lead.qualified',
      patch({ domainCondition: { sourceEventType: 'not.builtin' } }),
    )
    expect(res.status).toBe(400)
    expect(mockRepo.update).not.toHaveBeenCalled()
  })

  it('404 when the type does not exist', async () => {
    mockRepo.findByName.mockResolvedValue(null)
    const res = await buildApp().request('/event-types/missing', patch({ enabled: false }))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /event-types/:name', () => {
  it('hard-deletes and returns 204', async () => {
    mockRepo.findByName.mockResolvedValue(row())
    const res = await buildApp().request('/event-types/lead.qualified', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mockRepo.deleteById).toHaveBeenCalledWith('et-1')
  })

  it('404 when the type does not exist', async () => {
    mockRepo.findByName.mockResolvedValue(null)
    const res = await buildApp().request('/event-types/missing', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
