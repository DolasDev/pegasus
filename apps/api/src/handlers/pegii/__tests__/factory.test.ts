import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../../types'
import type { EntityConfig } from '../types'

vi.mock('../../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../../repositories/pegii/generic.repository', () => ({
  allIds: vi.fn(),
  readById: vi.fn(),
  readByCode: vi.fn(),
  readList: vi.fn(),
  write: vi.fn(),
}))

import { createEntityRouter } from '../factory'
import * as repo from '../../../repositories/pegii/generic.repository'

const testConfig: EntityConfig = {
  slug: 'settings',
  tableName: 'settings',
  idField: 'id',
  codeField: 'id',
  idType: 'integer',
  orderBy: 'ORDER BY name',
  searchKeywords: [{ keyword: 'ID', toSql: (p) => `id=${p}` }],
}

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('mssqlPool' as never, {} as never)
    c.set('db', {} as never)
    c.set('correlationId', 'test-corr')
    c.set('role', 'tenant_admin')
    c.set('userId', 'test-user')
    await next()
  })
  app.route('/', createEntityRouter(testConfig))
  return app
}

describe('factory - createEntityRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /ids', () => {
    it('returns list of IDs', async () => {
      vi.mocked(repo.allIds).mockResolvedValue([1, 2, 3])
      const res = await buildApp().request('/ids')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.data).toEqual([1, 2, 3])
    })

    it('passes query param q to allIds', async () => {
      vi.mocked(repo.allIds).mockResolvedValue([1])
      await buildApp().request('/ids?q=ACTIVE')
      expect(repo.allIds).toHaveBeenCalledWith(expect.anything(), testConfig, 'ACTIVE')
    })
  })

  describe('GET /:id', () => {
    it('returns row by ID', async () => {
      vi.mocked(repo.readById).mockResolvedValue({ id: 1, name: 'test' })
      const res = await buildApp().request('/1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.data).toEqual({ id: 1, name: 'test' })
    })

    it('returns 404 with correlationId when not found', async () => {
      vi.mocked(repo.readById).mockResolvedValue(null)
      const res = await buildApp().request('/999')
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.correlationId).toBe('test-corr')
    })

    it('returns 400 with correlationId for invalid integer ID', async () => {
      const res = await buildApp().request('/abc')
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.correlationId).toBe('test-corr')
    })
  })

  describe('GET /code/:code', () => {
    it('returns row by code', async () => {
      vi.mocked(repo.readByCode).mockResolvedValue({ id: 1, code: 'ABC' })
      const res = await buildApp().request('/code/ABC')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.data).toEqual({ id: 1, code: 'ABC' })
    })

    it('returns 404 with correlationId when not found', async () => {
      vi.mocked(repo.readByCode).mockResolvedValue(null)
      const res = await buildApp().request('/code/MISSING')
      expect(res.status).toBe(404)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.correlationId).toBe('test-corr')
    })
  })

  describe('GET /', () => {
    it('returns list with metadata', async () => {
      vi.mocked(repo.readList).mockResolvedValue([{ id: 1 }, { id: 2 }])
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.data).toHaveLength(2)
      expect(body.meta).toEqual({ count: 2, limit: 1000, offset: 0 })
    })

    it('respects limit and offset params', async () => {
      vi.mocked(repo.readList).mockResolvedValue([])
      await buildApp().request('/?limit=50&offset=10')
      expect(repo.readList).toHaveBeenCalledWith(expect.anything(), testConfig, '', 50, 10)
    })

    it('caps limit at 1000', async () => {
      vi.mocked(repo.readList).mockResolvedValue([])
      await buildApp().request('/?limit=5000')
      expect(repo.readList).toHaveBeenCalledWith(expect.anything(), testConfig, '', 1000, 0)
    })
  })

  describe('POST /', () => {
    it('creates new record', async () => {
      vi.mocked(repo.write).mockResolvedValue({ id: 42, name: 'new' })
      const res = await buildApp().request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.data).toEqual({ id: 42, name: 'new' })
    })
  })

  describe('PUT /:id', () => {
    it('updates existing record', async () => {
      vi.mocked(repo.write).mockResolvedValue({ id: 1, name: 'updated' })
      const res = await buildApp().request('/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.data).toEqual({ id: 1, name: 'updated' })
    })

    it('returns 400 with correlationId for invalid integer ID', async () => {
      const res = await buildApp().request('/abc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.correlationId).toBe('test-corr')
    })
  })
})
