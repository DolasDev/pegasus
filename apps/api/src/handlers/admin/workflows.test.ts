// ---------------------------------------------------------------------------
// Unit tests for admin workflows handler
//
// db is mocked via vi.hoisted so the same mock functions are shared across
// the vi.mock factory and test bodies.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    workflow: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../../db', () => ({ db: mockDb }))

import { adminWorkflowsRouter } from './workflows'

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', 'admin@platform.com')
    await next()
  })
  app.route('/workflows', adminWorkflowsRouter)
  return app
}

const now = new Date('2026-05-14T12:00:00Z')

const mockRow = {
  id: 'wf-1',
  tenantId: 'platform-tenant-id',
  name: 'send_quote_followup',
  version: '1.0.0',
  visibility: 'GLOBAL' as const,
  manifest: {
    name: 'send_quote_followup',
    version: '1.0.0',
    entryPoints: ['workflows.send_quote_followup:SendQuoteFollowup'],
  },
  createdByUserId: 'user-1',
  createdAt: now,
  updatedAt: now,
  tenant: { id: 'platform-tenant-id', name: 'Pegasus Platform', slug: 'platform' },
}

describe('admin workflows handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /', () => {
    it('returns 200 with every GLOBAL workflow + owning tenant info', async () => {
      mockDb.workflow.findMany.mockResolvedValue([mockRow])
      const res = await buildApp().request('/workflows')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['tenantName']).toBe('Pegasus Platform')
      expect(data[0]!['tenantSlug']).toBe('platform')
      expect(data[0]!['visibility']).toBe('GLOBAL')
      // Joined `tenant` object is flattened to tenantName/tenantSlug and not leaked verbatim.
      expect('tenant' in data[0]!).toBe(false)
      expect((body.meta as JsonBody)['count']).toBe(1)
    })

    it('filters server-side to visibility=GLOBAL only', async () => {
      mockDb.workflow.findMany.mockResolvedValue([])
      await buildApp().request('/workflows')
      expect(mockDb.workflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { visibility: 'GLOBAL' } }),
      )
    })

    it('returns 200 with empty list when nothing is GLOBAL', async () => {
      mockDb.workflow.findMany.mockResolvedValue([])
      const res = await buildApp().request('/workflows')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody[]).length).toBe(0)
      expect((body.meta as JsonBody)['count']).toBe(0)
    })

    it('returns 500 INTERNAL_ERROR on DB failure', async () => {
      mockDb.workflow.findMany.mockRejectedValue(new Error('db down'))
      const res = await buildApp().request('/workflows')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })
})
