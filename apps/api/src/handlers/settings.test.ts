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
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipalForRole } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'
import type * as MssqlExecutorClient from '../lib/mssql-executor-client'

// ---------------------------------------------------------------------------
// Mock the db module
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tenant: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../db', () => ({
  db: mockDb,
}))

const { mockExecuteSql } = vi.hoisted(() => ({ mockExecuteSql: vi.fn() }))

vi.mock('../lib/mssql-executor-client', async () => {
  const actual = await vi.importActual<typeof MssqlExecutorClient>('../lib/mssql-executor-client')
  return { ...actual, executeSql: mockExecuteSql }
})

import { settingsHandler } from './settings'
import { MssqlExecError } from '../lib/mssql-executor-client'

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
  registerTestErrorHandler(app)
  app.use('*', seedPrincipalForRole(role))
  app.use('*', async (c, next) => {
    c.set('db', {} as unknown as PrismaClient)
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
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
  })

  // ── GET /mssql ────────────────────────────────────────────────────────────

  describe('GET /mssql', () => {
    it('returns 403 for non-admin role', async () => {
      const res = await buildApp('viewer').request('/mssql')
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
      const res = await buildApp('viewer').request(
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
      expect(data['mssqlConnectionString']).toBe('Server=newhost;Database=db;Password=****;')
      expect(mockDb.tenant.update).toHaveBeenCalledWith({
        where: { id: 'test-tenant-id' },
        data: { mssqlConnectionString: 'Server=newhost;Database=db;Password=newsecret;' },
        select: { mssqlConnectionString: true },
      })
    })

    it('with null clears the connection string', async () => {
      mockDb.tenant.update.mockResolvedValue({ mssqlConnectionString: null })
      const res = await buildApp().request('/mssql', patchReq({ mssqlConnectionString: null }))
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
      const res = await buildApp().request('/mssql', patchReq({ mssqlConnectionString: '' }))
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

  // ── POST /mssql/test ────────────────────────────────────────────────────────

  describe('POST /mssql/test', () => {
    const post: RequestInit = { method: 'POST' }

    it('returns 403 for non-admin role', async () => {
      const res = await buildApp('viewer').request('/mssql/test', post)
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns NOT_CONFIGURED when no connection string is set', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ mssqlConnectionString: null })
      const res = await buildApp().request('/mssql/test', post)
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody
      expect(data['ok']).toBe(false)
      expect(data['code']).toBe('NOT_CONFIGURED')
      expect(mockExecuteSql).not.toHaveBeenCalled()
    })

    it('returns ok when SELECT 1 succeeds', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=h,61873;Password=p;',
      })
      mockExecuteSql.mockResolvedValue({
        recordset: [{ ok: 1 }],
        recordsets: [[{ ok: 1 }]],
        rowsAffected: [1],
      })
      const res = await buildApp().request('/mssql/test', post)
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody
      expect(data['ok']).toBe(true)
      expect(data['code']).toBe('OK')
      expect(mockExecuteSql).toHaveBeenCalledWith('Server=h,61873;Password=p;', 'SELECT 1 AS ok', {
        timeoutMs: 10_000,
      })
    })

    it('classifies a connect failure as CONNECT_TIMEOUT', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=h,61873;Password=p;',
      })
      mockExecuteSql.mockRejectedValue(
        new MssqlExecError(
          'EXECUTOR_QUERY_ERROR',
          'QUERY_FAILED: Failed to connect to 10.0.0.2:61873 in 15000ms',
        ),
      )
      const res = await buildApp().request('/mssql/test', post)
      const data = (await json(res)).data as JsonBody
      expect(data['ok']).toBe(false)
      expect(data['code']).toBe('CONNECT_TIMEOUT')
      // the raw connection string (and its password) must never be echoed
      expect(JSON.stringify(data)).not.toContain('Password=p')
    })

    it('classifies a login failure as LOGIN_FAILED', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=h,61873;Password=p;',
      })
      mockExecuteSql.mockRejectedValue(
        new MssqlExecError(
          'EXECUTOR_QUERY_ERROR',
          "QUERY_FAILED: Login failed for user 'saPegasus'.",
        ),
      )
      const res = await buildApp().request('/mssql/test', post)
      const data = (await json(res)).data as JsonBody
      expect(data['code']).toBe('LOGIN_FAILED')
    })

    it('classifies an executor/invoke failure as EXECUTOR_ERROR', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({
        mssqlConnectionString: 'Server=h,61873;Password=p;',
      })
      mockExecuteSql.mockRejectedValue(
        new MssqlExecError(
          'EXECUTOR_NOT_CONFIGURED',
          'MSSQL_EXECUTOR_FUNCTION_NAME env var is not set',
        ),
      )
      const res = await buildApp().request('/mssql/test', post)
      const data = (await json(res)).data as JsonBody
      expect(data['code']).toBe('EXECUTOR_ERROR')
    })
  })

  // ── /app (tenant-wide UI preferences) ──────────────────────────────────────
  //
  // The interesting behaviors are: parse-with-defaults on GET (the brand-new
  // {} blob hydrates into seven sections), strict validation on PATCH (typo'd
  // section name is rejected), and the operations.longhaulClient → Tenant
  // column mirror (the cloud-direct longhaul handlers still read the column,
  // so the mirror keeps them working without changes).
  // ---------------------------------------------------------------------------

  describe('GET /app', () => {
    it('returns 403 for non-admin role', async () => {
      const res = await buildApp('viewer').request('/app')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('hydrates a {} row into a fully-shaped AppSettings object', async () => {
      // findUniqueOrThrow is used by getAppSettings; mock it on the same surface
      // so the existing mock infrastructure carries it.
      mockDb.tenant['findUniqueOrThrow'] = vi.fn().mockResolvedValue({ appSettings: {} })
      const res = await buildApp().request('/app')
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody
      expect(Object.keys(data).sort()).toEqual([
        'billing',
        'customers',
        'dashboard',
        'dispatch',
        'moves',
        'operations',
        'quotes',
      ])
      expect(data['operations']).toEqual({})
    })

    it('returns the persisted operations.longhaulClient', async () => {
      mockDb.tenant['findUniqueOrThrow'] = vi
        .fn()
        .mockResolvedValue({ appSettings: { operations: { longhaulClient: 'qmm' } } })
      const res = await buildApp().request('/app')
      const data = (await json(res)).data as JsonBody
      const ops = data['operations'] as JsonBody
      expect(ops['longhaulClient']).toBe('qmm')
    })
  })

  describe('PATCH /app', () => {
    it('returns 403 for non-admin role', async () => {
      const res = await buildApp('viewer').request(
        '/app',
        patchReq({ operations: { longhaulClient: 'qmm' } }),
      )
      expect(res.status).toBe(403)
    })

    it('rejects a typo section name (strict root)', async () => {
      const res = await buildApp().request('/app', patchReq({ operatins: {} }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('rejects an invalid longhaulClient value', async () => {
      const res = await buildApp().request(
        '/app',
        patchReq({ operations: { longhaulClient: 'acme' } }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('writes the merged settings AND mirrors longhaulClient into the column', async () => {
      mockDb.tenant['findUniqueOrThrow'] = vi.fn().mockResolvedValue({
        appSettings: { operations: { longhaulClient: 'nwi' } },
      })
      mockDb.tenant.update.mockResolvedValue({})

      const res = await buildApp().request(
        '/app',
        patchReq({ operations: { longhaulClient: 'qmm' } }),
      )

      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody
      const ops = data['operations'] as JsonBody
      expect(ops['longhaulClient']).toBe('qmm')

      // Two writes: (1) the merged appSettings JSON, (2) the mirror column.
      expect(mockDb.tenant.update).toHaveBeenCalledTimes(2)
      const calls = mockDb.tenant.update.mock.calls.map((c: unknown[]) => c[0])
      const settingsWrite = calls.find(
        (c: unknown) =>
          (c as JsonBody)['data'] && 'appSettings' in ((c as JsonBody)['data'] as JsonBody),
      )
      const mirrorWrite = calls.find(
        (c: unknown) =>
          (c as JsonBody)['data'] && 'longhaulClient' in ((c as JsonBody)['data'] as JsonBody),
      )
      expect(settingsWrite).toBeTruthy()
      expect(mirrorWrite).toBeTruthy()
      expect(((mirrorWrite as JsonBody)['data'] as JsonBody)['longhaulClient']).toBe('qmm')
    })

    it('null clears the mirror column (admin "unconfigure" path)', async () => {
      mockDb.tenant['findUniqueOrThrow'] = vi.fn().mockResolvedValue({
        appSettings: { operations: { longhaulClient: 'nwi' } },
      })
      mockDb.tenant.update.mockResolvedValue({})

      await buildApp().request('/app', patchReq({ operations: { longhaulClient: null } }))

      const calls = mockDb.tenant.update.mock.calls.map((c: unknown[]) => c[0])
      const mirrorWrite = calls.find(
        (c: unknown) =>
          (c as JsonBody)['data'] && 'longhaulClient' in ((c as JsonBody)['data'] as JsonBody),
      )
      expect(((mirrorWrite as JsonBody)['data'] as JsonBody)['longhaulClient']).toBeNull()
    })

    it('skips the mirror write when operations is not in the patch', async () => {
      mockDb.tenant['findUniqueOrThrow'] = vi.fn().mockResolvedValue({ appSettings: {} })
      mockDb.tenant.update.mockResolvedValue({})

      await buildApp().request('/app', patchReq({ dashboard: {} }))

      // Only the appSettings write fires; no separate longhaulClient mirror.
      expect(mockDb.tenant.update).toHaveBeenCalledTimes(1)
      const arg = mockDb.tenant.update.mock.calls[0]![0] as JsonBody
      expect('appSettings' in (arg['data'] as JsonBody)).toBe(true)
    })
  })
})
