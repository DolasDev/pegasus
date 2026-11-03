/**
 * Integration tests for /api/v1/services-filters.
 *
 * Runs the real router against Postgres through `createTenantDb`, the same
 * scoped client tenantMiddleware installs, so tenant isolation, ownership and
 * the preferences-backed default are exercised end to end.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { servicesFiltersHandler } from './services-filters'
import type { ServicesFilterQuery } from '../lib/services-filter-query'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG_A = 'test-services-filters-a'
const SLUG_B = 'test-services-filters-b'

const QUERY: ServicesFilterQuery = {
  v: 1,
  dateFromOffsetDays: 0,
  dateToOffsetDays: 7,
  activityTypes: ['PK', 'LD'],
  shortHaul: ['Y'],
  dispatchers: ['1196'],
  sortBy: { value: 'scheduled_date', order: 'asc' },
}

let tenantA: { id: string }
let tenantB: { id: string }

/** An app acting as `userId` in `tenantId`. */
function appAs(tenantId: string, userId: string | undefined) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('userId', userId)
    c.set('db', createTenantDb(db as unknown as PrismaClient, tenantId) as unknown as PrismaClient)
    await next()
  })
  app.route('/', servicesFiltersHandler)
  return app
}

function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

type Dto = {
  id: string
  name: string
  isPublic: boolean
  isDefault: boolean
  owner: { email: string }
}

async function save(app: Hono<AppEnv>, body: Record<string, unknown>): Promise<Dto> {
  const res = await app.request('/', json({ query: QUERY, ...body }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { data: Dto }).data
}

async function list(app: Hono<AppEnv>, scope: 'mine' | 'public'): Promise<Dto[]> {
  const res = await app.request(`/?scope=${scope}`)
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: Dto[] }).data
}

async function getDefault(app: Hono<AppEnv>): Promise<Dto | null> {
  return ((await (await app.request('/default')).json()) as { data: Dto | null }).data
}

async function wipe(ids: string[]) {
  await db.servicesFilter.deleteMany({ where: { tenantId: { in: ids } } })
  await db.tenantUser.deleteMany({ where: { tenantId: { in: ids } } })
}

afterAll(async () => {
  if (hasDb) {
    await wipe([tenantA?.id, tenantB?.id].filter(Boolean)).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('/services-filters (integration)', () => {
  let alice: Hono<AppEnv>
  let bob: Hono<AppEnv>
  let eve: Hono<AppEnv> // tenant B

  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantA = await upsert(SLUG_A)
    tenantB = await upsert(SLUG_B)
  })

  beforeEach(async () => {
    await wipe([tenantA.id, tenantB.id])
    const user = (tenantId: string, email: string) =>
      db.tenantUser.create({ data: { tenantId, email } }).then((u) => u.id)
    alice = appAs(tenantA.id, await user(tenantA.id, 'alice@a.test'))
    bob = appAs(tenantA.id, await user(tenantA.id, 'bob@a.test'))
    eve = appAs(tenantB.id, await user(tenantB.id, 'eve@b.test'))
  })

  it('keeps its default separate from the Availability default', async () => {
    const availabilityId = '6f1c2b8e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
    const aliceRow = await db.tenantUser.findFirstOrThrow({
      where: { email: 'alice@a.test', tenantId: tenantA.id },
    })
    await db.tenantUser.update({
      where: { id: aliceRow.id },
      data: { preferences: { operations: { defaultAvailabilityFilterId: availabilityId } } },
    })

    const saved = await save(alice, { name: 'Mine', isDefault: true })
    expect((await getDefault(alice))?.id).toBe(saved.id)

    const after = await db.tenantUser.findUniqueOrThrow({
      where: { id: aliceRow.id },
      select: { preferences: true },
    })
    expect(after.preferences).toMatchObject({
      operations: {
        defaultAvailabilityFilterId: availabilityId,
        defaultServicesFilterId: saved.id,
      },
    })
  })

  it('saves a filter and lists it under mine with its owner', async () => {
    const saved = await save(alice, { name: '  Northeast LD  ' })
    expect(saved).toMatchObject({ name: 'Northeast LD', isPublic: false, isDefault: false })

    const mine = await list(alice, 'mine')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ id: saved.id, owner: { email: 'alice@a.test' } })
    expect((mine[0] as unknown as { query: unknown }).query).toEqual(QUERY)
  })

  it('mine includes my public filters; public excludes everyone else’s private ones', async () => {
    await save(alice, { name: 'B private' })
    await save(alice, { name: 'A public', isPublic: true })
    await save(bob, { name: 'Bob private' })

    expect((await list(alice, 'mine')).map((f) => f.name)).toEqual(['A public', 'B private'])
    expect((await list(bob, 'public')).map((f) => f.name)).toEqual(['A public'])
    expect((await list(bob, 'mine')).map((f) => f.name)).toEqual(['Bob private'])
  })

  it('never leaks public filters across tenants', async () => {
    await save(alice, { name: 'A public', isPublic: true })
    expect(await list(eve, 'public')).toEqual([])
  })

  it('isDefault on save makes it my default', async () => {
    const saved = await save(alice, { name: 'Mine', isDefault: true })
    expect(saved.isDefault).toBe(true)
    expect((await getDefault(alice))?.id).toBe(saved.id)
    expect(await getDefault(bob)).toBeNull()
  })

  it('PUT /default accepts a visible public filter and clears with null', async () => {
    const pub = await save(alice, { name: 'Shared', isPublic: true })
    const res = await bob.request('/default', json({ filterId: pub.id }, 'PUT'))
    expect(res.status).toBe(200)
    expect((await getDefault(bob))?.id).toBe(pub.id)

    await bob.request('/default', json({ filterId: null }, 'PUT'))
    expect(await getDefault(bob)).toBeNull()
  })

  it('PUT /default rejects someone else’s private filter and another tenant’s filter', async () => {
    const priv = await save(alice, { name: 'Private' })
    expect((await bob.request('/default', json({ filterId: priv.id }, 'PUT'))).status).toBe(404)

    const pub = await save(alice, { name: 'Shared', isPublic: true })
    expect((await eve.request('/default', json({ filterId: pub.id }, 'PUT'))).status).toBe(404)
  })

  it('a default that stops being visible reads as null instead of erroring', async () => {
    const pub = await save(alice, { name: 'Shared', isPublic: true })
    await bob.request('/default', json({ filterId: pub.id }, 'PUT'))

    expect((await alice.request(`/${pub.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await getDefault(bob)).toBeNull()
  })

  it('only the owner can delete; deleting my default clears it', async () => {
    const saved = await save(alice, { name: 'Mine', isPublic: true, isDefault: true })

    expect((await bob.request(`/${saved.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await eve.request(`/${saved.id}`, { method: 'DELETE' })).status).toBe(404)
    expect(await list(alice, 'mine')).toHaveLength(1)

    expect((await alice.request(`/${saved.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await list(alice, 'mine')).toEqual([])
    const prefs = await db.tenantUser.findFirst({
      where: { email: 'alice@a.test', tenantId: tenantA.id },
      select: { preferences: true },
    })
    expect(prefs?.preferences).toMatchObject({ operations: { defaultServicesFilterId: null } })
  })

  it('rejects an invalid body', async () => {
    const bad = [
      { name: '', query: QUERY },
      { name: 'x', query: { ...QUERY, v: 2 } },
      { name: 'x', query: { ...QUERY, shortHaul: ['maybe'] } },
      { name: 'x', query: { ...QUERY, dateFromOffsetDays: 1.5 } },
      { name: 'x', query: { ...QUERY, dateToOffsetDays: null } },
      { name: 'x', query: { ...QUERY, sortBy: { value: 'constructor', order: 'asc' } } },
      // An Availability-shaped query must not be storable here.
      {
        name: 'x',
        query: {
          v: 1,
          driverName: '',
          zones: [],
          moveTypes: [],
          dateFromOffsetDays: null,
          dateToOffsetDays: null,
          sortOrder: null,
        },
      },
      { name: 'x', query: { ...QUERY, extra: true } },
      { name: 'x'.repeat(101), query: QUERY },
    ]
    for (const body of bad) {
      expect((await alice.request('/', json(body))).status).toBe(400)
    }
    expect((await alice.request('/', { method: 'POST', body: 'nope' })).status).toBe(400)
    expect((await alice.request('/default', json({ filterId: 'abc' }, 'PUT'))).status).toBe(400)
  })

  it('refuses a principal with no user profile', async () => {
    const m2m = appAs(tenantA.id, undefined)
    expect((await m2m.request('/')).status).toBe(403)
    expect((await m2m.request('/', json({ name: 'x', query: QUERY }))).status).toBe(403)
  })
})
