// The crew list behind Operations → Itinerary: who may read it, and how the
// legacy read's outcomes become statuses. The SQL lives in chat-access.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../lib/chat-access', () => ({
  legacyConnectionString: vi.fn(),
  listLocalDrivers: vi.fn(),
}))

import { operationsLocalDriversHandler } from './local-drivers'
import { legacyConnectionString, listLocalDrivers } from '../../lib/chat-access'

const connectionStringMock = legacyConnectionString as unknown as Mock
const listMock = listLocalDrivers as unknown as Mock

function buildApp(roleNames: string[]) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('principal', {
      sub: 's',
      tenantId: 'tenant-1',
      roleNames,
    } as AppEnv['Variables']['principal'])
    await next()
  })
  app.get('/onprem/longhaul/local-drivers', operationsLocalDriversHandler)
  return app
}

async function get(roles: string[]) {
  const res = await buildApp(roles).request('/onprem/longhaul/local-drivers')
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionStringMock.mockResolvedValue('Server=a,1433')
  listMock.mockResolvedValue([{ employeeId: 3097, name: 'Sherwood, Benjamin' }])
})

describe('GET /onprem/longhaul/local-drivers', () => {
  it.each([
    'long_distance_dispatch',
    'operations_admin',
    'central_planning_dispatch',
    'tenant_admin',
  ])('lists the crews for %s', async (role) => {
    const { status, body } = await get([role])
    expect(status).toBe(200)
    expect(body['data']).toEqual([{ employeeId: 3097, name: 'Sherwood, Benjamin' }])
    expect(connectionStringMock).toHaveBeenCalledWith('tenant-1')
  })

  it('refuses a driver or any non-Operations login, without a legacy read', async () => {
    for (const roles of [['driver'], ['sales'], []]) {
      const { status, body } = await get(roles)
      expect(status).toBe(403)
      expect(body['code']).toBe('FORBIDDEN')
    }
    expect(listMock).not.toHaveBeenCalled()
  })

  it('answers 422 when the tenant has no legacy database', async () => {
    connectionStringMock.mockResolvedValue(null)
    const { status, body } = await get(['long_distance_dispatch'])
    expect(status).toBe(422)
    expect(body['code']).toBe('MSSQL_NOT_CONFIGURED')
  })

  it('answers 503 when the legacy read fails', async () => {
    listMock.mockRejectedValue(new Error('timeout'))
    const { status, body } = await get(['long_distance_dispatch'])
    expect(status).toBe(503)
    expect(body['code']).toBe('LEGACY_UNAVAILABLE')
  })
})
