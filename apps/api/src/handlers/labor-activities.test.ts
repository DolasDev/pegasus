/**
 * Integration tests for activity labor on /api/v1/labor — the crews and
 * packers that worked a driver's activities on an order.
 *
 * Runs the real router against Postgres through `createTenantDb`, with Cedar
 * evaluated offline. The legacy activities live in a small in-memory fake
 * behind the mocked mssql-executor client.
 *
 * Crews are platform-wide, so every number this file uses is in the
 * 404-555-02xx block and is wiped by that prefix.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'

vi.mock('../lib/mssql-executor-client', () => ({ executeSql: vi.fn() }))

import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { executeSql } from '../lib/mssql-executor-client'
import { laborHandler } from './labor'

const hasDb = Boolean(process.env['DATABASE_URL'])
const exec = executeSql as unknown as Mock

const SLUG_A = 'test-activity-labor-a'
const SLUG_B = 'test-activity-labor-b'
const PREFIX = '+1404555020'
const num = (n: number) => `(404) 555-020${n}`
const e164 = (n: number) => `${PREFIX}${n}`

// ---------------------------------------------------------------------------
// Fake legacy database: activities on orders.
// ---------------------------------------------------------------------------
interface FakeActivity {
  id: number
  order_num: number
  ActivityType_code: string
  activityType_name: string
  activityType_abbreviation: string
  planned_start: Date | null
  estimated_date: Date | null
  actual_date: Date | null
  assigned_driver_id: number | null
  trip_driver_id: number | null
}

const act = (
  id: number,
  order: number,
  code: string,
  own: Partial<FakeActivity>,
): FakeActivity => ({
  id,
  order_num: order,
  ActivityType_code: code,
  activityType_name: code,
  activityType_abbreviation: code,
  planned_start: new Date('2026-10-20T00:00:00Z'),
  estimated_date: null,
  actual_date: null,
  assigned_driver_id: null,
  trip_driver_id: null,
  ...own,
})

let activities: FakeActivity[] = []
let legacyDown = false

function fakeExecute(
  _cs: string,
  _sql: string,
  opts?: { params?: Array<{ name: string; value: unknown }> },
) {
  if (legacyDown) return Promise.reject(new Error('legacy down'))
  const p = Object.fromEntries((opts?.params ?? []).map((x) => [x.name, x.value]))
  const recordset =
    'orderNum' in p
      ? activities.filter((a) => a.order_num === p['orderNum'])
      : activities.filter((a) => a.id === p['id'])
  return Promise.resolve({ recordset, rowsAffected: [] })
}

let tenantA: string
let tenantB: string
const U: Record<string, { id: string; tenantId: string; roles: string[] }> = {}

function appAs(who: string) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set('principal', { sub: `sub-${who}`, tenantId: u.tenantId, roleNames: u.roles })
    c.set(
      'db',
      createTenantDb(db as unknown as PrismaClient, u.tenantId) as unknown as PrismaClient,
    )
    await next()
  })
  app.route('/labor', laborHandler)
  return app
}

const send = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function data<T = Record<string, unknown>>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code
}

type ActivityOut = {
  id: number
  orderNum: number
  typeCode: string | null
  plannedStart: string | null
  editable: boolean
  crews: Array<{
    phone: string
    displayName: string
    inMyBook: boolean
    inCompanyList: boolean
    packers: Array<{ id: string; lastName: string; selected: boolean }>
  }>
}

const addCrew = (who: string, n: number, name = `Crew ${n}`) =>
  appAs(who).request('/labor/crews', send({ phone: num(n), name }))

async function addPacker(who: string, n: number, lastName: string): Promise<string> {
  const res = await appAs(who).request(
    `/labor/crews/${encodeURIComponent(e164(n))}/packers`,
    send({ firstName: 'P', lastName, phone: '404-555-9999' }),
  )
  return (await data<{ id: string }>(res)).id
}

const putLabor = (who: string, activityId: number, crews: unknown) =>
  appAs(who).request(`/labor/activities/${activityId}`, send({ crews }, 'PUT'))

const getOrder = (who: string, order = 100) =>
  appAs(who).request(`/labor/orders/${order}/activities`)

async function wipe() {
  await db.crew.deleteMany({ where: { phone: { startsWith: PREFIX } } })
  for (const t of [tenantA, tenantB]) {
    await db.activityLaborCrew.deleteMany({ where: { tenantId: t } })
    await db.companyCrewLink.deleteMany({ where: { tenantId: t } })
    await db.crewLink.deleteMany({ where: { tenantId: t } })
    await db.tenantUser.deleteMany({ where: { tenantId: t } })
  }
}

afterAll(async () => {
  if (!hasDb) return
  await wipe().catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('/labor activity labor (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({
        where: { slug },
        create: { name: slug, slug, mssqlConnectionString: 'Server=fake' },
        update: { mssqlConnectionString: 'Server=fake' },
      })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    exec.mockReset()
    exec.mockImplementation(fakeExecute)
    legacyDown = false
    activities = [
      // Order 100: driver 7 packs (assigned) and loads (trip driver); driver 8
      // delivers — assigned wins over the trip's driver.
      act(1, 100, 'PACK', { assigned_driver_id: 7 }),
      act(2, 100, 'LOAD', { assigned_driver_id: 0, trip_driver_id: 7 }),
      act(3, 100, 'RDEL', {
        assigned_driver_id: 8,
        trip_driver_id: 7,
        actual_date: new Date('2026-10-22T00:00:00Z'),
      }),
      act(4, 200, 'PACK', { assigned_driver_id: 8 }),
    ]
    await wipe()
    const mk = async (
      key: string,
      tenantId: string,
      roles: string[],
      longhaulDriverId: number | null = null,
    ) => {
      const row = await db.tenantUser.create({
        data: {
          tenantId,
          email: `${key}@activity-labor.test`,
          roleNames: roles,
          status: 'ACTIVE',
          longhaulDriverId,
        },
      })
      U[key] = { id: row.id, tenantId, roles }
    }
    await mk('driver', tenantA, ['driver'], 7)
    await mk('other', tenantA, ['driver'], 8)
    await mk('unmapped', tenantA, ['driver'])
    await mk('ops', tenantA, ['operations_admin'])
    await mk('sales', tenantA, ['sales'])
    await mk('outsider', tenantB, ['driver'], 7)
  })

  it('shows a driver only the activities they own, editable', async () => {
    const res = await getOrder('driver')
    expect(res.status).toBe(200)
    const list = await data<ActivityOut[]>(res)
    expect(list.map((a) => [a.id, a.editable])).toEqual([
      [1, true],
      [2, true],
    ])
    expect(list[0]).toMatchObject({ orderNum: 100, typeCode: 'PACK', plannedStart: '2026-10-20' })
    expect(list[0]!.crews).toEqual([])
  })

  it('shows an Operations role every activity, read-only', async () => {
    const list = await data<ActivityOut[]>(await getOrder('ops'))
    expect(list.map((a) => [a.id, a.editable])).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ])
  })

  it('refuses a non-Operations login with no driver mapping', async () => {
    expect(await codeOf(await getOrder('sales'))).toBe('DRIVER_NOT_MAPPED')
    const res = await getOrder('unmapped')
    expect(res.status).toBe(403)
    expect(await codeOf(res)).toBe('DRIVER_NOT_MAPPED')
  })

  it('fails closed when the legacy database is down', async () => {
    legacyDown = true
    const res = await getOrder('driver')
    expect(res.status).toBe(503)
    expect(await codeOf(res)).toBe('LEGACY_UNAVAILABLE')
  })

  it('assigns crews and selects packers; other viewers read it', async () => {
    await addCrew('driver', 1, 'Juan Crew')
    await addCrew('driver', 2, 'Ana Crew')
    const diaz = await addPacker('driver', 1, 'Diaz')
    const ruiz = await addPacker('driver', 1, 'Ruiz')

    const res = await putLabor('driver', 1, [
      { phone: num(1), packerIds: [diaz] },
      { phone: num(2), packerIds: [] },
    ])
    expect(res.status).toBe(200)
    const out = await data<ActivityOut>(res)
    expect(out.crews.map((x) => x.phone)).toEqual([e164(1), e164(2)])
    expect(out.crews[0]!.packers.map((p) => [p.lastName, p.selected])).toEqual([
      ['Diaz', true],
      ['Ruiz', false],
    ])
    expect(out.crews[0]).toMatchObject({ displayName: 'Juan Crew', inMyBook: true })

    // An employee sees it, without the crew being in their book.
    const ops = await data<ActivityOut[]>(await getOrder('ops'))
    expect(ops[0]!.crews[0]).toMatchObject({ phone: e164(1), inMyBook: false })
    expect(ops[0]!.crews[0]!.packers.find((p) => p.id === ruiz)!.selected).toBe(false)

    // The row carries the legacy order number and who assigned it.
    const row = await db.activityLaborCrew.findFirst({
      where: { tenantId: tenantA, activityId: 1, crewPhone: e164(1) },
    })
    expect(row).toMatchObject({ orderNum: 100, assignedByUserId: U['driver']!.id })
  })

  it('replaces the whole set: removes crews and re-picks packers, keeping kept rows', async () => {
    await addCrew('driver', 1)
    await addCrew('driver', 2)
    const diaz = await addPacker('driver', 1, 'Diaz')
    const ruiz = await addPacker('driver', 1, 'Ruiz')
    await putLabor('driver', 1, [
      { phone: num(1), packerIds: [diaz] },
      { phone: num(2), packerIds: [] },
    ])
    const before = await db.activityLaborCrew.findFirst({ where: { crewPhone: e164(1) } })

    const res = await putLabor('driver', 1, [{ phone: num(1), packerIds: [ruiz] }])
    const out = await data<ActivityOut>(res)
    expect(out.crews.map((x) => x.phone)).toEqual([e164(1)])
    expect(out.crews[0]!.packers.filter((p) => p.selected).map((p) => p.id)).toEqual([ruiz])
    const after = await db.activityLaborCrew.findFirst({ where: { crewPhone: e164(1) } })
    expect(after!.id).toBe(before!.id)

    const cleared = await data<ActivityOut>(await putLabor('driver', 1, []))
    expect(cleared.crews).toEqual([])
  })

  it('stays editable after the activity has an actual date', async () => {
    activities[0]!.actual_date = new Date('2026-10-21T00:00:00Z')
    await addCrew('driver', 1)
    expect((await putLabor('driver', 1, [{ phone: num(1), packerIds: [] }])).status).toBe(200)
  })

  it("refuses another driver's activity, an employee, and an unknown activity", async () => {
    await addCrew('driver', 1)
    await addCrew('other', 1)
    const notMine = await putLabor('driver', 3, [{ phone: num(1), packerIds: [] }])
    expect(notMine.status).toBe(403)
    expect(await codeOf(notMine)).toBe('NOT_YOUR_ACTIVITY')
    expect((await putLabor('other', 1, [])).status).toBe(403)
    expect(await codeOf(await putLabor('ops', 1, []))).toBe('DRIVER_NOT_MAPPED')
    const unknown = await putLabor('driver', 999, [])
    expect(unknown.status).toBe(404)
    expect(await codeOf(unknown)).toBe('ACTIVITY_NOT_FOUND')
  })

  it('requires a newly assigned crew to be in my book, but keeps one I later removed', async () => {
    await addCrew('other', 1)
    const notMine = await putLabor('driver', 1, [{ phone: num(1), packerIds: [] }])
    expect(notMine.status).toBe(422)
    expect(await codeOf(notMine)).toBe('CREW_NOT_IN_YOUR_LIST')

    await addCrew('driver', 2)
    await putLabor('driver', 1, [{ phone: num(2), packerIds: [] }])
    await appAs('driver').request(`/labor/crews/${encodeURIComponent(e164(2))}`, {
      method: 'DELETE',
    })
    const kept = await putLabor('driver', 1, [{ phone: num(2), packerIds: [] }])
    expect(kept.status).toBe(200)
    expect((await data<ActivityOut>(kept)).crews[0]).toMatchObject({ inMyBook: false })
  })

  it('lets a driver assign a crew from the company list', async () => {
    await addCrew('other', 3, 'Company Crew')
    await appAs('other').request('/labor/company/crews', send({ phone: num(3) }))
    const res = await putLabor('driver', 1, [{ phone: num(3), packerIds: [] }])
    expect(res.status).toBe(200)
    expect((await data<ActivityOut>(res)).crews[0]).toMatchObject({
      phone: e164(3),
      inMyBook: false,
      inCompanyList: true,
    })
    // Another tenant's company list grants nothing.
    await db.activityLaborCrew.deleteMany({ where: { tenantId: tenantA } })
    await db.companyCrewLink.updateMany({
      where: { crewPhone: e164(3) },
      data: { tenantId: tenantB },
    })
    expect(await codeOf(await putLabor('driver', 1, [{ phone: num(3), packerIds: [] }]))).toBe(
      'CREW_NOT_IN_YOUR_LIST',
    )
  })

  it('rejects a packer that is not on its crew, and duplicate crews', async () => {
    await addCrew('driver', 1)
    await addCrew('driver', 2)
    const onTwo = await addPacker('driver', 2, 'Diaz')
    const wrong = await putLabor('driver', 1, [{ phone: num(1), packerIds: [onTwo] }])
    expect(wrong.status).toBe(422)
    expect(await codeOf(wrong)).toBe('PACKER_NOT_ON_CREW')
    const unknown = await putLabor('driver', 1, [{ phone: num(1), packerIds: ['nope'] }])
    expect(await codeOf(unknown)).toBe('PACKER_NOT_ON_CREW')
    const dup = await putLabor('driver', 1, [
      { phone: num(1), packerIds: [] },
      { phone: e164(1), packerIds: [] },
    ])
    expect(dup.status).toBe(400)
    expect(await codeOf(dup)).toBe('DUPLICATE_ACTIVITY_CREW')
  })

  it('drops a deleted packer from the selection', async () => {
    await addCrew('driver', 1)
    const diaz = await addPacker('driver', 1, 'Diaz')
    await putLabor('driver', 1, [{ phone: num(1), packerIds: [diaz] }])
    await appAs('driver').request(`/labor/crews/${encodeURIComponent(e164(1))}/packers/${diaz}`, {
      method: 'DELETE',
    })
    const list = await data<ActivityOut[]>(await getOrder('driver'))
    expect(list[0]!.crews[0]!.packers).toEqual([])
    expect(await db.activityLaborPacker.count({ where: { packerId: diaz } })).toBe(0)
  })

  it('isolates by tenant — the same activity id in another tenant is separate', async () => {
    await addCrew('driver', 1)
    await putLabor('driver', 1, [{ phone: num(1), packerIds: [] }])
    const list = await data<ActivityOut[]>(await getOrder('outsider'))
    expect(list.map((a) => a.id)).toEqual([1, 2])
    expect(list[0]!.crews).toEqual([])
  })

  it('an Operations login that is also a mapped driver edits only its own activities', async () => {
    await db.tenantUser.update({ where: { id: U['ops']!.id }, data: { longhaulDriverId: 8 } })
    const list = await data<ActivityOut[]>(await getOrder('ops'))
    expect(list.map((a) => [a.id, a.editable])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ])
  })

  it("a write never touches another tenant's rows for the same activity id", async () => {
    await addCrew('outsider', 1)
    await putLabor('outsider', 1, [{ phone: num(1), packerIds: [] }])
    await addCrew('driver', 2)
    await putLabor('driver', 1, [{ phone: num(2), packerIds: [] }])
    await putLabor('driver', 1, [])
    const rows = await db.activityLaborCrew.findMany({ where: { activityId: 1 } })
    expect(rows.map((r) => [r.tenantId, r.crewPhone])).toEqual([[tenantB, e164(1)]])
  })

  it('rejects a bad body or id', async () => {
    expect((await appAs('driver').request('/labor/orders/abc/activities')).status).toBe(400)
    const bad = await appAs('driver').request('/labor/activities/1', send({ crews: 'x' }, 'PUT'))
    expect(bad.status).toBe(400)
    expect(await codeOf(bad)).toBe('VALIDATION_ERROR')
  })
})
