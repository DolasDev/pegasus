// ---------------------------------------------------------------------------
// Unit tests for the longhaul activities handler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import type { ConnectionPool } from 'mssql'
import type { PrismaClient } from '@prisma/client'

const mockDb = {}
vi.mock('../../lib/longhaul-db', () => ({
  getLonghaulDb: vi.fn(() => mockDb),
  longhaulDbConfigured: vi.fn(() => true),
}))

vi.mock('../../repositories/longhaul/activities.repository', () => ({
  saveActivity: vi.fn(),
}))

import { saveActivity } from '../../repositories/longhaul/activities.repository'
import { activitiesRouter } from './activities'

const MOCK_USER = {
  code: 42,
  first_name: 'Test',
  last_name: 'User',
  active: 'Y',
  win_username: 'testuser',
}

function buildApp() {
  const app = new Hono<OnPremEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', MOCK_USER)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    await next()
  })
  app.route('/', activitiesRouter)
  return app
}

// ---------------------------------------------------------------------------
// POST /activities/:id
// ---------------------------------------------------------------------------

describe('POST /activities/:id', () => {
  it('returns 200 on successful activity save', async () => {
    vi.mocked(saveActivity).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request('/activities/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_date: '2026-04-01', status: 'Completed' }),
    })
    expect(res.status).toBe(200)
    expect(saveActivity).toHaveBeenCalledWith(
      expect.anything(),
      10,
      expect.objectContaining({ actual_date: '2026-04-01' }),
      MOCK_USER.code,
    )
  })

  it('returns 400 for non-numeric activity id', async () => {
    const app = buildApp()
    const res = await app.request('/activities/not-a-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Completed' }),
    })
    expect(res.status).toBe(400)
  })
})
