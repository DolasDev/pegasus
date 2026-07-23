// ---------------------------------------------------------------------------
// Unit tests for the feedback-forms authoring handler.
//
// createFeedbackFormRepository is mocked (no DB). dualAuthMiddleware is stubbed
// to inject the AppEnv context; requirePermission is NOT mocked — real Cedar
// RBAC runs (tenant_admin permits everything; a role without ManageFeedbackForms
// is rejected; viewer can read but not manage). FEEDBACK_ENABLED is toggled
// around the feature gate.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    publish: vi.fn(),
    findActive: vi.fn(),
    listActive: vi.fn(),
    listVersions: vi.fn(),
    findVersion: vi.fn(),
    findVersionForTenant: vi.fn(),
  },
}))

vi.mock('../repositories/feedback-form.repository', () => ({
  createFeedbackFormRepository: vi.fn(() => mockRepo),
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { feedbackFormsHandler } from './feedback-forms'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
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
  app.route('/feedback-forms', feedbackFormsHandler)
  return app
}

const definition = {
  questions: [{ id: 'rating', type: 'rating', label: 'Rate us', required: true }],
}

function formRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ff-1',
    tenantId: 'test-tenant-id',
    formKey: 'post-move-csat',
    version: 1,
    status: 'PUBLISHED',
    title: 'Post-move CSAT',
    definition,
    messageTemplate: null,
    publishedBy: 'user-1',
    createdAt: new Date('2026-07-22T12:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  _clearAuthzCache()
  vi.clearAllMocks()
  process.env['FEEDBACK_ENABLED'] = 'true'
})
afterEach(() => {
  delete process.env['FEEDBACK_ENABLED']
})

describe('feature gate', () => {
  it('404s every route when FEEDBACK_ENABLED is off', async () => {
    delete process.env['FEEDBACK_ENABLED']
    const res = await buildApp().request('/feedback-forms')
    expect(res.status).toBe(404)
  })
})

describe('POST /:formKey/validate', () => {
  it('returns valid:true for a good definition without writing', async () => {
    const res = await buildApp().request(
      '/feedback-forms/post-move-csat/validate',
      post({ title: 'x', definition }),
    )
    expect(res.status).toBe(200)
    expect((await json(res)).data).toEqual({ valid: true, errors: [] })
    expect(mockRepo.publish).not.toHaveBeenCalled()
  })

  it('returns valid:false with errors for a bad definition', async () => {
    const res = await buildApp().request(
      '/feedback-forms/post-move-csat/validate',
      post({ title: 'x', definition: { questions: [] } }),
    )
    expect(res.status).toBe(200)
    const data = (await json(res)).data as { valid: boolean; errors: string[] }
    expect(data.valid).toBe(false)
    expect(data.errors.length).toBeGreaterThan(0)
  })
})

describe('POST /:formKey (publish)', () => {
  it('publishes and returns 201', async () => {
    mockRepo.publish.mockResolvedValue(formRow())
    const res = await buildApp().request(
      '/feedback-forms/post-move-csat',
      post({ title: 'Post-move CSAT', definition }),
    )
    expect(res.status).toBe(201)
    expect(mockRepo.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'test-tenant-id',
        formKey: 'post-move-csat',
        title: 'Post-move CSAT',
      }),
    )
  })

  it('400s a bad definition (no write)', async () => {
    const res = await buildApp().request(
      '/feedback-forms/post-move-csat',
      post({ title: 'x', definition: { questions: [{ id: 'q', type: 'bogus', label: 'x' }] } }),
    )
    expect(res.status).toBe(400)
    expect(mockRepo.publish).not.toHaveBeenCalled()
  })

  it('400s a non-slug form key', async () => {
    const res = await buildApp().request(
      '/feedback-forms/Bad Key',
      post({ title: 'x', definition }),
    )
    expect(res.status).toBe(400)
  })

  it('403s a role without ManageFeedbackForms', async () => {
    const res = await buildApp(['viewer']).request(
      '/feedback-forms/post-move-csat',
      post({ title: 'x', definition }),
    )
    expect(res.status).toBe(403)
  })
})

describe('reads', () => {
  it('viewer can list (ReadFeedbackForms on the baseline)', async () => {
    mockRepo.listActive.mockResolvedValue([formRow()])
    const res = await buildApp(['viewer']).request('/feedback-forms')
    expect(res.status).toBe(200)
    expect((await json(res)).meta).toEqual({ count: 1 })
  })

  it('GET /:formKey 404s when no published form', async () => {
    mockRepo.findActive.mockResolvedValue(null)
    const res = await buildApp(['viewer']).request('/feedback-forms/nope')
    expect(res.status).toBe(404)
  })

  it('GET /:formKey/versions lists history', async () => {
    mockRepo.listVersions.mockResolvedValue([formRow({ version: 2 }), formRow({ version: 1 })])
    const res = await buildApp(['viewer']).request('/feedback-forms/post-move-csat/versions')
    expect(res.status).toBe(200)
    expect((await json(res)).meta).toEqual({ count: 2 })
  })
})

describe('POST /:formKey/rollback/:version', () => {
  it('re-publishes a prior version', async () => {
    mockRepo.findVersion.mockResolvedValue(formRow({ version: 1 }))
    mockRepo.publish.mockResolvedValue(formRow({ version: 3 }))
    const res = await buildApp().request('/feedback-forms/post-move-csat/rollback/1', {
      method: 'POST',
    })
    expect(res.status).toBe(201)
    expect(mockRepo.publish).toHaveBeenCalled()
  })

  it('404s an unknown version', async () => {
    mockRepo.findVersion.mockResolvedValue(null)
    const res = await buildApp().request('/feedback-forms/post-move-csat/rollback/9', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })
})
