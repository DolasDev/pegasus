/**
 * Integration tests for My Crew on /api/v1/labor — a driver's own packers, the
 * "My crew" group on each activity's labor, and the trip-accepted auto-assign
 * (lib/labor-auto-assign.ts) that puts "Every job" members on a trip's labor
 * activities.
 *
 * Runs the real router against Postgres through `createTenantDb`, with Cedar
 * evaluated offline. The legacy activities live in a small in-memory fake
 * behind the mocked mssql-executor client.
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
import { autoAssignOnTripAccepted } from '../lib/labor-auto-assign'
import { laborHandler } from './labor'

const hasDb = Boolean(process.env['DATABASE_URL'])
const exec = executeSql as unknown as Mock

const SLUG_A = 'test-my-crew-a'
const SLUG_B = 'test-my-crew-b'

// ---------------------------------------------------------------------------
// Fake legacy database: activities on orders and trips.
// ---------------------------------------------------------------------------
interface FakeActivity {
  id: number
  order_num: number
  trip_id: number | null
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
  trip_id: null,
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
    'tripId' in p
      ? activities.filter((a) => a.trip_id === p['tripId'])
      : 'orderNum' in p
        ? activities.filter((a) => a.order_num === p['orderNum'])
        : activities.filter((a) => a.id === p['id'])
  return Promise.resolve({ recordset, rowsAffected: [] })
}

let tenantA: string
let tenantB: string
const U: Record<string, { id: string; tenantId: string; roles: string[] }> = {}

const scoped = (tenantId: string) =>
  createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient

function appAs(who: string) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set('principal', { sub: `sub-${who}`, tenantId: u.tenantId, roleNames: u.roles })
    c.set('db', scoped(u.tenantId))
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

type MemberOut = {
  id: string
  firstName: string
  lastName: string
  cidNumber: string | null
  cidIssuedOn: string | null
  phoneDisplay: string | null
  everyJob: boolean
}

type ActivityOut = {
  id: number
  editable: boolean
  myCrew: Array<{
    id: string
    lastName: string
    mine: boolean
    selected: boolean
    phoneDisplay: string | null
    everyJob: boolean
  }>
}

async function addMember(who: string, lastName: string, extra: Record<string, unknown> = {}) {
  const res = await appAs(who).request(
    '/labor/my-crew',
    send({ firstName: 'M', lastName, phone: '404-555-7777', ...extra }),
  )
  expect(res.status).toBe(201)
  return data<MemberOut>(res)
}

const listMine = async (who: string) =>
  data<MemberOut[]>(await appAs(who).request('/labor/my-crew'))

const putLabor = (who: string, activityId: number, body: unknown) =>
  appAs(who).request(`/labor/activities/${activityId}`, send(body, 'PUT'))

const getOrder = async (who: string, order = 100) =>
  data<ActivityOut[]>(await appAs(who).request(`/labor/orders/${order}/activities`))

const accept = (tenantId: string, tripId: number, from = 2, to = 3) =>
  autoAssignOnTripAccepted(scoped(tenantId), {
    tenantId,
    connectionString: 'Server=fake',
    tripId,
    driverId: 7,
    fromStatusId: from,
    toStatusId: to,
  })

async function wipe() {
  for (const t of [tenantA, tenantB]) {
    await db.activityLaborMember.deleteMany({ where: { tenantId: t } })
    await db.driverCrewMember.deleteMany({ where: { tenantId: t } })
    await db.domainEvent.deleteMany({ where: { tenantId: t } })
    await db.tenantUser.deleteMany({ where: { tenantId: t } })
  }
}

afterAll(async () => {
  if (!hasDb) return
  await wipe().catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('/labor My Crew (integration)', () => {
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
      // Trip 50, order 100: driver 7 packs, loads and delivers; an XPU is not
      // labor; driver 8 is assigned the unpack — assigned wins over the trip's driver.
      act(1, 100, 'PACK', { trip_id: 50, trip_driver_id: 7 }),
      act(2, 100, 'LOAD  ', { trip_id: 50, assigned_driver_id: 0, trip_driver_id: 7 }),
      act(3, 100, 'XPU', { trip_id: 50, trip_driver_id: 7 }),
      act(4, 100, 'UNPK', { trip_id: 50, assigned_driver_id: 8, trip_driver_id: 7 }),
      act(5, 100, 'RDEL', { trip_id: 50, trip_driver_id: 7 }),
      // Trip 60: driver 9 has no login.
      act(6, 200, 'PACK', { trip_id: 60, trip_driver_id: 9 }),
    ]
    await wipe()
    const mk = async (
      key: string,
      tenantId: string,
      roles: string[],
      longhaulDriverId: number | null = null,
      status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE',
    ) => {
      const row = await db.tenantUser.create({
        data: {
          tenantId,
          email: `${key}@my-crew.test`,
          roleNames: roles,
          status,
          longhaulDriverId,
        },
      })
      U[key] = { id: row.id, tenantId, roles }
    }
    await mk('driver', tenantA, ['driver'], 7)
    await mk('other', tenantA, ['driver'], 8)
    await mk('ops', tenantA, ['operations_admin'])
    await mk('outsider', tenantB, ['driver'], 7)
  })

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  it('adds, lists A–Z, edits and flags members — private to the driver', async () => {
    await addMember('driver', 'Ruiz')
    const diaz = await addMember('driver', 'Diaz', {
      cidNumber: 'ab-12',
      cidIssuedOn: '2024-01-05',
      everyJob: true,
    })
    expect(diaz).toMatchObject({
      cidNumber: 'AB-12',
      cidIssuedOn: '2024-01-05',
      phoneDisplay: '(404) 555-7777',
      everyJob: true,
    })
    expect((await listMine('driver')).map((m) => [m.lastName, m.everyJob])).toEqual([
      ['Diaz', true],
      ['Ruiz', false],
    ])

    const res = await appAs('driver').request(
      `/labor/my-crew/${diaz.id}`,
      send({ everyJob: false, firstName: 'Ana' }, 'PATCH'),
    )
    expect(res.status).toBe(200)
    expect(await data<MemberOut>(res)).toMatchObject({
      firstName: 'Ana',
      cidNumber: 'AB-12',
      everyJob: false,
    })

    // Nobody else sees or edits them — not another driver, not Operations.
    expect(await listMine('other')).toEqual([])
    expect(await listMine('ops')).toEqual([])
    const theirs = await appAs('other').request(
      `/labor/my-crew/${diaz.id}`,
      send({ everyJob: true }, 'PATCH'),
    )
    expect(theirs.status).toBe(404)
    expect(await codeOf(theirs)).toBe('MEMBER_NOT_FOUND')
  })

  it('validates like a packer and refuses a duplicate identity key', async () => {
    const bad = await appAs('driver').request(
      '/labor/my-crew',
      send({ firstName: 'M', lastName: 'Diaz' }),
    )
    expect(bad.status).toBe(400)
    expect(await codeOf(bad)).toBe('PACKER_CONTACT_REQUIRED')

    await addMember('driver', 'Diaz', { email: 'd@x.test' })
    const dup = await appAs('driver').request(
      '/labor/my-crew',
      send({ firstName: 'Other', lastName: 'DIAZ', email: 'D@x.test' }),
    )
    expect(dup.status).toBe(409)
    expect(await codeOf(dup)).toBe('MEMBER_DUPLICATE')

    // Another driver may have the same person.
    await addMember('other', 'Diaz', { email: 'd@x.test' })
  })

  it('removes softly, and adding the same person again brings them back', async () => {
    const m = await addMember('driver', 'Diaz', { email: 'd@x.test', everyJob: true })
    const del = await appAs('driver').request(`/labor/my-crew/${m.id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect(await listMine('driver')).toEqual([])
    const row = await db.driverCrewMember.findUnique({ where: { id: m.id } })
    expect(row).toMatchObject({ everyJob: false })
    expect(row!.removedAt).not.toBeNull()

    const again = await appAs('driver').request(`/labor/my-crew/${m.id}`, { method: 'DELETE' })
    expect(again.status).toBe(404)

    const back = await addMember('driver', 'Diaz', { email: 'd@x.test', firstName: 'Ana' })
    expect(back).toMatchObject({ id: m.id, firstName: 'Ana', everyJob: false })
    expect((await listMine('driver')).map((x) => x.id)).toEqual([m.id])
  })

  it('refuses an API client', async () => {
    const u = U['driver']!
    const app = new Hono<AppEnv>()
    registerTestErrorHandler(app)
    app.use('*', async (c, next) => {
      c.set('tenantId', u.tenantId)
      c.set('userId', u.id)
      c.set('correlationId', 'corr-test')
      c.set('apiClient', { id: 'k1' } as never)
      c.set('principal', { sub: 'k1', tenantId: u.tenantId, roleNames: [] })
      c.set('db', scoped(u.tenantId))
      await next()
    })
    app.route('/labor', laborHandler)
    const res = await app.request('/labor/my-crew')
    expect(await codeOf(res)).toBe('LABOR_HUMANS_ONLY')
  })

  // -------------------------------------------------------------------------
  // Activity labor: the "My crew" group
  // -------------------------------------------------------------------------

  it('ticks my members on an activity; omitting memberIds leaves them alone', async () => {
    const diaz = await addMember('driver', 'Diaz')
    const ruiz = await addMember('driver', 'Ruiz')

    const res = await putLabor('driver', 1, { crews: [], memberIds: [diaz.id] })
    expect(res.status).toBe(200)
    expect((await data<ActivityOut>(res)).myCrew.map((m) => [m.lastName, m.selected])).toEqual([
      ['Diaz', true],
      ['Ruiz', false],
    ])
    const row = await db.activityLaborMember.findFirst({
      where: { tenantId: tenantA, activityId: 1 },
    })
    expect(row).toMatchObject({
      orderNum: 100,
      memberId: diaz.id,
      assignedByUserId: U['driver']!.id,
    })

    // An app build from before My Crew sends only crews.
    await putLabor('driver', 1, { crews: [] })
    expect(await db.activityLaborMember.count({ where: { activityId: 1 } })).toBe(1)

    // An explicit list replaces the set.
    await putLabor('driver', 1, { crews: [], memberIds: [ruiz.id] })
    const after = await getOrder('driver')
    expect(after[0]!.myCrew.filter((m) => m.selected).map((m) => m.lastName)).toEqual(['Ruiz'])
  })

  it("refuses another driver's member, but keeps one I removed after the job", async () => {
    const theirs = await addMember('other', 'Lopez')
    const bad = await putLabor('driver', 1, { crews: [], memberIds: [theirs.id] })
    expect(bad.status).toBe(422)
    expect(await codeOf(bad)).toBe('MEMBER_NOT_YOURS')

    const diaz = await addMember('driver', 'Diaz')
    await putLabor('driver', 1, { crews: [], memberIds: [diaz.id] })
    await appAs('driver').request(`/labor/my-crew/${diaz.id}`, { method: 'DELETE' })

    // Still on the job, no longer mine to tick elsewhere.
    const [a1] = await getOrder('driver')
    expect(a1!.myCrew).toEqual([
      expect.objectContaining({ id: diaz.id, mine: false, selected: true }),
    ])
    expect((await putLabor('driver', 1, { crews: [], memberIds: [diaz.id] })).status).toBe(200)
    const elsewhere = await putLabor('driver', 2, { crews: [], memberIds: [diaz.id] })
    expect(await codeOf(elsewhere)).toBe('MEMBER_NOT_YOURS')
  })

  it('shows Operations who worked an activity, read-only', async () => {
    const diaz = await addMember('driver', 'Diaz')
    await addMember('driver', 'Ruiz')
    await putLabor('driver', 1, { crews: [], memberIds: [diaz.id] })
    const ops = await getOrder('ops')
    expect(ops[0]).toMatchObject({ id: 1, editable: false })
    expect(ops[0]!.myCrew.map((m) => [m.lastName, m.selected])).toEqual([['Diaz', true]])
  })

  // -------------------------------------------------------------------------
  // Trip accepted → auto-assign
  // -------------------------------------------------------------------------

  it("adds each owner's Every-job members to the trip's labor activities only", async () => {
    const diaz = await addMember('driver', 'Diaz', { everyJob: true })
    const ruiz = await addMember('driver', 'Ruiz', { everyJob: true })
    await addMember('driver', 'Sometimes') // not Every job
    const lopez = await addMember('other', 'Lopez', { everyJob: true })

    const assigned = await accept(tenantA, 50)
    expect(assigned).toEqual([
      { activityId: 1, memberIds: expect.arrayContaining([diaz.id, ruiz.id]) },
      { activityId: 2, memberIds: expect.arrayContaining([diaz.id, ruiz.id]) },
      { activityId: 4, memberIds: [lopez.id] },
      { activityId: 5, memberIds: expect.arrayContaining([diaz.id, ruiz.id]) },
    ])
    const rows = await db.activityLaborMember.findMany({
      where: { tenantId: tenantA },
      orderBy: [{ activityId: 'asc' }],
    })
    expect(rows).toHaveLength(7)
    expect(rows.every((r) => r.assignedByUserId === null && r.orderNum === 100)).toBe(true)
    expect(rows.some((r) => r.activityId === 3)).toBe(false) // XPU

    // The driver sees them ticked on the Labor tab.
    const tab = await getOrder('driver')
    expect(tab.find((a) => a.id === 1)!.myCrew.map((m) => [m.lastName, m.selected])).toEqual([
      ['Diaz', true],
      ['Ruiz', true],
      ['Sometimes', false],
    ])
  })

  it('emits trip.accepted with what it assigned, in the same tenant', async () => {
    const diaz = await addMember('driver', 'Diaz', { everyJob: true })
    await accept(tenantA, 50, 1, 4)
    const events = await db.domainEvent.findMany({ where: { eventType: 'trip.accepted' } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ tenantId: tenantA })
    expect(events[0]!.payload).toEqual({
      tripId: 50,
      driverId: 7,
      fromStatusId: 1,
      toStatusId: 4,
      assigned: [
        { activityId: 1, memberIds: [diaz.id] },
        { activityId: 2, memberIds: [diaz.id] },
        { activityId: 5, memberIds: [diaz.id] },
      ],
    })
  })

  it('is additive and idempotent — an unticked member stays off until the next accept', async () => {
    const diaz = await addMember('driver', 'Diaz', { everyJob: true })
    const ruiz = await addMember('driver', 'Ruiz', { everyJob: true })
    await accept(tenantA, 50)
    await putLabor('driver', 1, { crews: [], memberIds: [ruiz.id] }) // untick Diaz on the pack
    expect(await db.activityLaborMember.count({ where: { tenantId: tenantA } })).toBe(5)

    // Re-running (a second accept after a bounce to Offered) re-adds, never duplicates.
    await accept(tenantA, 50)
    await accept(tenantA, 50)
    expect(await db.activityLaborMember.count({ where: { tenantId: tenantA } })).toBe(6)
    expect(
      await db.activityLaborMember.count({ where: { activityId: 1, memberId: diaz.id } }),
    ).toBe(1)
  })

  it('skips removed members, deactivated logins and unmapped drivers, but still emits', async () => {
    const gone = await addMember('driver', 'Gone', { everyJob: true })
    await appAs('driver').request(`/labor/my-crew/${gone.id}`, { method: 'DELETE' })
    await addMember('other', 'Lopez', { everyJob: true })
    await db.tenantUser.update({ where: { id: U['other']!.id }, data: { status: 'DEACTIVATED' } })

    expect(await accept(tenantA, 50)).toEqual([])
    expect(await accept(tenantA, 60)).toEqual([]) // driver 9 has no login
    expect(await db.activityLaborMember.count({ where: { tenantId: tenantA } })).toBe(0)
    expect(
      await db.domainEvent.count({ where: { tenantId: tenantA, eventType: 'trip.accepted' } }),
    ).toBe(2)
  })

  it("never reaches another tenant's driver with the same driver id", async () => {
    await addMember('outsider', 'Far', { everyJob: true })
    expect(await accept(tenantA, 50)).toEqual([])
    expect(await db.activityLaborMember.count({ where: { tenantId: tenantB } })).toBe(0)
  })

  it('still emits trip.accepted, flagged, when the legacy read fails', async () => {
    await addMember('driver', 'Diaz', { everyJob: true })
    legacyDown = true
    expect(await accept(tenantA, 50)).toEqual([])
    expect(await db.activityLaborMember.count({ where: { tenantId: tenantA } })).toBe(0)
    const events = await db.domainEvent.findMany({ where: { tenantId: tenantA } })
    expect(events.map((e) => e.payload)).toEqual([
      expect.objectContaining({ tripId: 50, assigned: [], assignFailed: true }),
    ])
  })

  it("hides another driver's member's phone and flag from Operations", async () => {
    const diaz = await addMember('driver', 'Diaz', { everyJob: true })
    await putLabor('driver', 1, { crews: [], memberIds: [diaz.id] })
    const [a1] = await getOrder('ops')
    expect(a1!.myCrew).toEqual([
      expect.objectContaining({
        lastName: 'Diaz',
        phoneDisplay: null,
        everyJob: false,
        mine: false,
      }),
    ])
  })

  it('lets a live member take a key a removed member held', async () => {
    const old = await addMember('driver', 'Diaz', { email: 'd@x.test' })
    await appAs('driver').request(`/labor/my-crew/${old.id}`, { method: 'DELETE' })
    const live = await addMember('driver', 'Ruiz')
    const res = await appAs('driver').request(
      `/labor/my-crew/${live.id}`,
      send({ lastName: 'Diaz', email: 'd@x.test' }, 'PATCH'),
    )
    expect(res.status).toBe(200)
  })
})
