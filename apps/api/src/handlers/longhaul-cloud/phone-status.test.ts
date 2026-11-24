/**
 * Driver phone status (Operations → Itinerary) + the permission-aware device
 * registration it reads.
 *
 * The roll-up and the role gate are unit-tested; the registration → delivery →
 * dispatcher read path runs against real Postgres (skipped without
 * DATABASE_URL), through the tenant-scoped client tenantMiddleware installs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { registerTestErrorHandler } from '../../test-helpers'
import { deviceTokensHandler } from '../device-tokens'
import { listActiveTokensForUser } from '../../repositories/device-tokens.repository'
import {
  driverPhoneStatusHandler,
  summarizePhoneStatus,
  type PhoneStatusDevice,
} from './phone-status'

const hasDb = Boolean(process.env['DATABASE_URL'])

const device = (
  permission: PhoneStatusDevice['permission'],
  lastSeenAt = '2026-11-24T00:00:00.000Z',
): PhoneStatusDevice => ({ platform: 'IOS', permission, lastSeenAt })

describe('summarizePhoneStatus', () => {
  it('is notLinked when no login is mapped to the driver id', () => {
    expect(summarizePhoneStatus(false, [])).toEqual({
      status: 'notLinked',
      lastSeenAt: null,
      devices: [],
    })
  })

  it('is noApp when the mapped login has no active phone', () => {
    expect(summarizePhoneStatus(true, []).status).toBe('noApp')
  })

  it('is decided by the phone opened MOST RECENTLY, with that phone’s time', () => {
    const r = summarizePhoneStatus(true, [
      device('granted', '2026-10-01T00:00:00.000Z'), // old handset in a drawer
      device('blocked', '2026-11-20T00:00:00.000Z'), // the phone they carry
    ])
    expect(r.status).toBe('off')
    expect(r.lastSeenAt).toBe('2026-11-20T00:00:00.000Z')
    expect(r.devices.map((d) => d.permission)).toEqual(['blocked', 'granted'])
  })

  it('maps each permission of the deciding phone', () => {
    expect(summarizePhoneStatus(true, [device('granted')]).status).toBe('on')
    expect(summarizePhoneStatus(true, [device('limited')]).status).toBe('on')
    expect(summarizePhoneStatus(true, [device('askable')]).status).toBe('off')
    expect(summarizePhoneStatus(true, [device('channelOff')]).status).toBe('off')
    expect(summarizePhoneStatus(true, [device(null)]).status).toBe('unknown')
  })
})

function gateApp(roleNames: string[]) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('principal', { sub: 's', tenantId: 'tenant-1', roleNames } as never)
    c.set('db', {} as never) // never reached when the gate or validation refuses
    await next()
  })
  app.get('/phone-status', driverPhoneStatusHandler)
  return app
}

describe('GET /onprem/longhaul/drivers/phone-status — gate + validation', () => {
  it('refuses a driver or any non-Operations login', async () => {
    for (const roles of [['driver'], ['sales'], []]) {
      const res = await gateApp(roles).request('/phone-status?longhaulDriverId=7')
      expect(res.status).toBe(403)
      expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN')
    }
  })

  it('needs at least one driver id', async () => {
    const res = await gateApp(['long_distance_dispatch']).request('/phone-status')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR')
  })
})

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

const SLUG = 'test-phone-status'
let tenantId: string

function scoped() {
  return createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient
}

function appAs(userId: string | undefined, roleNames: string[]) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('userId', userId)
    c.set('correlationId', 'corr-1')
    c.set('principal', { sub: 's', tenantId, roleNames } as never)
    c.set('db', scoped())
    await next()
  })
  app.route('/device-tokens', deviceTokensHandler)
  app.get('/phone-status', driverPhoneStatusHandler)
  return app
}

async function register(app: Hono<AppEnv>, token: string, permission?: string) {
  const res = await app.request('/device-tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'ANDROID',
      expoPushToken: `ExponentPushToken[${token}]`,
      ...(permission ? { permission } : {}),
    }),
  })
  expect(res.status).toBe(201)
}

async function phoneStatus(query: string) {
  const res = await appAs(undefined, ['long_distance_dispatch']).request(`/phone-status?${query}`)
  expect(res.status).toBe(200)
  type One = { status: string; lastSeenAt: string | null; devices: unknown[] }
  return ((await res.json()) as { data: { longhaul: One | null; local: One | null } }).data
}

async function wipe() {
  if (!tenantId) return
  await db.deviceToken.deleteMany({ where: { tenantId } })
  await db.tenantUser.deleteMany({ where: { tenantId } })
}

afterAll(async () => {
  if (hasDb) {
    await wipe().catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('driver phone status (integration)', () => {
  let driverId: string
  let driver: Hono<AppEnv>

  beforeAll(async () => {
    const t = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: SLUG, slug: SLUG },
      update: {},
    })
    tenantId = t.id
  })

  beforeEach(async () => {
    await wipe()
    const u = await db.tenantUser.create({
      data: { tenantId, email: 'driver@ps.test', longhaulDriverId: 4711, status: 'ACTIVE' },
    })
    driverId = u.id
    driver = appAs(driverId, ['driver'])
  })

  it('reports notLinked for a driver id no login is mapped to', async () => {
    expect((await phoneStatus('longhaulDriverId=999')).longhaul?.status).toBe('notLinked')
  })

  it('reports noApp for a mapped login with no phone', async () => {
    expect((await phoneStatus('longhaulDriverId=4711')).longhaul?.status).toBe('noApp')
  })

  it('registers a phone with notifications OFF, shows it as off, and never pushes to it', async () => {
    await register(driver, 'off1', 'blocked')

    const data = await phoneStatus('longhaulDriverId=4711')
    expect(data.local).toBeNull()
    expect(data.longhaul).toEqual({
      status: 'off',
      lastSeenAt: expect.any(String),
      devices: [{ platform: 'ANDROID', permission: 'blocked', lastSeenAt: expect.any(String) }],
    })
    // No login emails reach Operations roles (only tenant_admin lists users).
    expect(JSON.stringify(data)).not.toContain('driver@ps.test')
    // The token is on file for visibility only — delivery skips it.
    expect(await listActiveTokensForUser(scoped(), tenantId, driverId)).toEqual([])
  })

  it('flips to on (and deliverable) when the driver turns notifications on', async () => {
    await register(driver, 'p1', 'askable')
    await register(driver, 'p1', 'granted')

    expect((await phoneStatus('longhaulDriverId=4711')).longhaul?.status).toBe('on')
    expect(await listActiveTokensForUser(scoped(), tenantId, driverId)).toEqual([
      'ExponentPushToken[p1]',
    ])
  })

  it('an older app that sends no permission leaves the stored value untouched', async () => {
    await register(driver, 'p2', 'blocked')
    await register(driver, 'p2') // old app version re-registers
    expect((await phoneStatus('longhaulDriverId=4711')).longhaul?.status).toBe('off')
  })

  it('a legacy row (no permission ever reported) is unknown but still delivered to', async () => {
    await register(driver, 'legacy')
    expect((await phoneStatus('longhaulDriverId=4711')).longhaul?.status).toBe('unknown')
    expect(await listActiveTokensForUser(scoped(), tenantId, driverId)).toEqual([
      'ExponentPushToken[legacy]',
    ])
  })

  it('a switched-off Android channel still delivers but reads as off', async () => {
    await register(driver, 'ch', 'channelOff')
    expect((await phoneStatus('longhaulDriverId=4711')).longhaul?.status).toBe('off')
    expect(await listActiveTokensForUser(scoped(), tenantId, driverId)).toHaveLength(1)
  })

  it('ignores deactivated logins', async () => {
    await db.tenantUser.create({
      data: { tenantId, email: 'gone@ps.test', localDriverEmployeeId: 3097, status: 'DEACTIVATED' },
    })
    expect((await phoneStatus('localDriverEmployeeId=3097')).local?.status).toBe('notLinked')
  })

  // The two ids are different numbering spaces and sometimes different
  // people: a phone that's on for one must not make the other read "on".
  it('answers each picked id separately — never one merged verdict', async () => {
    await register(driver, 'lh', 'granted') // the longhaul driver's phone
    const crew = await db.tenantUser.create({
      data: { tenantId, email: 'crew@ps.test', localDriverEmployeeId: 3097, status: 'ACTIVE' },
    })
    await register(appAs(crew.id, ['driver']), 'crew', 'blocked')

    const data = await phoneStatus('longhaulDriverId=4711&localDriverEmployeeId=3097')
    expect(data.longhaul?.status).toBe('on')
    expect(data.local?.status).toBe('off')
  })

  it('rejects an unknown permission value', async () => {
    const res = await driver.request('/device-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'IOS',
        expoPushToken: 'ExponentPushToken[x]',
        permission: 'maybe',
      }),
    })
    expect(res.status).toBe(400)
  })
})
