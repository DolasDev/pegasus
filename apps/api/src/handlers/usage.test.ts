// ---------------------------------------------------------------------------
// Unit tests for GET /api/v1/usage/summary — authorization and query parsing.
//
// buildUsageSummary is mocked; its windows and breakdowns are covered against a
// real DB in lib/usage/__tests__/usage-summary.test.ts. requirePermission is
// NOT mocked: the offline Cedar policies decide who reads usage.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const mockBuild = vi.hoisted(() => vi.fn())
vi.mock('../lib/usage/usage-summary', () => ({ buildUsageSummary: mockBuild }))
vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { usageHandler } from './usage'

function buildApp(roleNames: readonly string[]) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames }))
  app.use('*', async (c, next) => {
    c.set('db', {} as PrismaClient)
    await next()
  })
  app.route('/usage', usageHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  mockBuild.mockResolvedValue({ usedTermToDate: 7 })
})

describe('GET /usage/summary', () => {
  it.each([['tenant_admin'], ['workflow_runtime']])('200 for %s', async (role) => {
    const res = await buildApp([role]).request('/usage/summary')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { usedTermToDate: 7 } })
    expect(mockBuild).toHaveBeenCalledWith(expect.anything(), 'test-tenant-id', {})
  })

  it.each([['viewer'], ['dispatcher'], ['workflow_developer'], ['accountant']])(
    '403 for %s — usage is a billing view',
    async (role) => {
      const res = await buildApp([role]).request('/usage/summary')
      expect(res.status).toBe(403)
      expect(mockBuild).not.toHaveBeenCalled()
    },
  )

  it('passes a year through', async () => {
    await buildApp(['tenant_admin']).request('/usage/summary?year=2027')
    expect(mockBuild).toHaveBeenCalledWith(expect.anything(), 'test-tenant-id', { year: 2027 })
  })

  it.each(['abc', '1999', '2026.5'])('400 for year=%s', async (year) => {
    const res = await buildApp(['tenant_admin']).request(`/usage/summary?year=${year}`)
    expect(res.status).toBe(400)
  })
})
