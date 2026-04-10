// ---------------------------------------------------------------------------
// Unit tests for the settings handler
//
// The db module is mocked so no DB is required.
// requireRole is NOT mocked — the real implementation enforces RBAC.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'

// ---------------------------------------------------------------------------
// Mock the db module
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../db', () => ({
  db: mockDb,
}))

import { settingsHandler } from './settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function patchReq(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function buildApp(role: string | null = 'tenant_admin', userId = 'user-1') {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', {} as unknown as PrismaClient)
    if (role !== null) c.set('role', role)
    c.set('userId', userId)
    await next()
  })
  app.route('/', settingsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settings handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── GET /mssql ────────────────────────────────────────────────────────────

  describe('GET /mssql', () => {
    it('returns 403 for non-admin role', async () => {
      const res = await buildApp('tenant_user').request('/mssql')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns masked connection string', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=myserver;Database=mydb;User Id=sa;Password=secret123;',
      })
      const res = await buildApp().request('/mssql')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['mssqlConnectionString']).toBe(
        'Server=myserver;Database=mydb;User Id=sa;Password=****;',
      )
    })

    it('returns null when not configured', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ mssqlConnectionString: null })
      const res = await buildApp().request('/mssql')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['mssqlConnectionString']).toBeNull()
    })

    it('returns 500 on DB error', async () => {
      mockDb.tenant.findUnique.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/mssql')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── PATCH /mssql ──────────────────────────────────────────────────────────

  describe('PATCH /mssql', () => {
    it('returns 403 for non-admin role', async () => {
      const res = await buildApp('tenant_user').request(
        '/mssql',
        patchReq({ mssqlConnectionString: 'Server=x;Password=y;' }),
      )
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('updates and returns masked value', async () => {
      mockDb.tenant.update.mockResolvedValue({
        mssqlConnectionString: 'Server=newhost;Database=db;Password=newsecret;',
      })
      const res = await buildApp().request(
        '/mssql',
        patchReq({ mssqlConnectionString: 'Server=newhost;Database=db;Password=newsecret;' }),
      )
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['mssqlConnectionString']).toBe(
        'Server=newhost;Database=db;Password=****;',
      )
      expect(mockDb.tenant.update).toHaveBeenCalledWith({
        where: { id: 'test-tenant-id' },
        data: { mssqlConnectionString: 'Server=newhost;Database=db;Password=newsecret;' },
        select: { mssqlConnectionString: true },
      })
    })

    it('with null clears the connection string', async () => {
      mockDb.tenant.update.mockResolvedValue({ mssqlConnectionString: null })
      const res = await buildApp().request(
        '/mssql',
        patchReq({ mssqlConnectionString: null }),
      )
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['mssqlConnectionString']).toBeNull()
    })

    it('with invalid body returns 400', async () => {
      const res = await buildApp().request('/mssql', patchReq({}))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('with empty string returns 400', async () => {
      const res = await buildApp().request(
        '/mssql',
        patchReq({ mssqlConnectionString: '' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 500 on DB error', async () => {
      mockDb.tenant.update.mockRejectedValue(new Error('db error'))
      const res = await buildApp().request(
        '/mssql',
        patchReq({ mssqlConnectionString: 'Server=x;Password=y;' }),
      )
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })
})
