// ---------------------------------------------------------------------------
// Unit tests for the longhaul reference data handler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import type { ConnectionPool } from 'mssql'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../lib/longhaul-db', () => ({
  getLonghaulDb: vi.fn(),
  longhaulDbConfigured: vi.fn(() => true),
}))

vi.mock('../../repositories/longhaul/reference.repository', () => ({
  getDrivers: vi.fn(),
  getStates: vi.fn(),
  getZones: vi.fn(),
  getPlanners: vi.fn(),
  getDispatchers: vi.fn(),
  getVersion: vi.fn(),
  getActivityTypes: vi.fn(),
  getUserByWindowsUsername: vi.fn(),
}))

import {
  getDrivers,
  getStates,
  getZones,
  getPlanners,
  getDispatchers,
  getVersion,
  getActivityTypes,
} from '../../repositories/longhaul/reference.repository'
import { referenceRouter } from './reference'

const MOCK_USER = {
  code: 42,
  first_name: 'Test',
  last_name: 'User',
  active: 'Y',
  win_username: 'testuser',
}

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', MOCK_USER)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    await next()
  })
  app.route('/', referenceRouter)
  return app
}

type JsonBody = Record<string, unknown>
async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

// ---------------------------------------------------------------------------

describe('GET /drivers', () => {
  it('returns drivers list', async () => {
    vi.mocked(getDrivers).mockResolvedValue([{ id: 1, driver_name: 'John Doe' }])
    const app = buildApp()
    const res = await app.request('/drivers')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body['data'])).toBe(true)
  })
})

describe('GET /users/me', () => {
  it('returns the authenticated longhaul user', async () => {
    const app = buildApp()
    const res = await app.request('/users/me')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body['data'] as Record<string, unknown>)?.['code']).toBe(42)
  })
})

describe('GET /version', () => {
  it('returns version data', async () => {
    vi.mocked(getVersion).mockResolvedValue({ max: '1.3.7' })
    const app = buildApp()
    const res = await app.request('/version')
    expect(res.status).toBe(200)
  })
})

describe('GET /states', () => {
  it('returns states list', async () => {
    vi.mocked(getStates).mockResolvedValue([{ state_id: 1, geo_code: 'VA', geo_name: 'Virginia' }])
    const app = buildApp()
    const res = await app.request('/states')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body['data'])).toBe(true)
  })
})

describe('GET /zones', () => {
  it('returns zones list', async () => {
    vi.mocked(getZones).mockResolvedValue([
      { zone_id: 1, zone_code: 'SE', zone_description: 'South East' },
    ])
    const app = buildApp()
    const res = await app.request('/zones')
    expect(res.status).toBe(200)
  })
})

describe('GET /planners', () => {
  it('returns planners list', async () => {
    vi.mocked(getPlanners).mockResolvedValue([
      { code: 10, first_name: 'Alice', last_name: 'Smith' },
    ])
    const app = buildApp()
    const res = await app.request('/planners')
    expect(res.status).toBe(200)
  })
})

describe('GET /dispatchers', () => {
  it('returns dispatchers list', async () => {
    vi.mocked(getDispatchers).mockResolvedValue([
      { code: 20, first_name: 'Bob', last_name: 'Jones' },
    ])
    const app = buildApp()
    const res = await app.request('/dispatchers')
    expect(res.status).toBe(200)
  })
})

describe('GET /activity-types', () => {
  it('returns activity types list', async () => {
    vi.mocked(getActivityTypes).mockResolvedValue([
      { activityTypeId: 1, code: 'LOAD', name: 'Load' },
    ])
    const app = buildApp()
    const res = await app.request('/activity-types')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body['data'])).toBe(true)
  })
})
