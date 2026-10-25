/**
 * Integration tests for the company crew list on /api/v1/labor — the
 * tenant's shared crews (/company/crews) and what being on it grants on the
 * /crews/:phone routes.
 *
 * Runs the real router against Postgres through `createTenantDb`, with Cedar
 * evaluated offline. Crews are platform-wide, so every number this file uses
 * is in the 404-555-03xx block and is wiped by that prefix.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { registerTestErrorHandler } from '../test-helpers'
import { laborHandler, LINK_RATE_LIMIT } from './labor'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG_A = 'test-labor-company-a'
const SLUG_B = 'test-labor-company-b'
const PREFIX = '+1404555030'
const num = (n: number) => `(404) 555-030${n}`
const e164 = (n: number) => `${PREFIX}${n}`

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

async function outcomeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { meta?: { outcome?: string } }).meta?.outcome
}

type CrewOut = {
  phone: string
  name: string
  nickname: string | null
  companyNickname: string | null
  displayName: string
  inMyList: boolean
  inCompanyList: boolean
  canRemoveFromCompany: boolean
  myRating: { stars: number } | null
  serviceAreas: Array<{ city: string; region: string }>
  packers?: Array<{ id: string; lastName: string }>
  distanceMiles?: number | null
}

const addMine = (who: string, n: number, name = `Crew ${n}`) =>
  appAs(who).request('/labor/crews', send({ phone: num(n), name }))
const addCompany = (who: string, body: object) =>
  appAs(who).request('/labor/company/crews', send(body))
const listCompany = async (who: string, q = '') =>
  data<CrewOut[]>(
    await appAs(who).request(`/labor/company/crews${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  )
const crewUrl = (n: number) => `/labor/crews/${encodeURIComponent(e164(n))}`
const companyUrl = (n: number) => `/labor/company/crews/${encodeURIComponent(e164(n))}`

async function wipe() {
  await db.crew.deleteMany({ where: { phone: { startsWith: PREFIX } } })
  for (const t of [tenantA, tenantB]) {
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

describe.skipIf(!hasDb)('/labor company list (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    await wipe()
    const mk = async (key: string, tenantId: string, roles: string[]) => {
      const row = await db.tenantUser.create({
        data: { tenantId, email: `${key}@labor-company.test`, roleNames: roles, status: 'ACTIVE' },
      })
      U[key] = { id: row.id, tenantId, roles }
    }
    await mk('ann', tenantA, ['driver'])
    await mk('bob', tenantA, ['driver'])
    await mk('ops', tenantA, ['long_distance_dispatch'])
    await mk('dee', tenantB, ['driver'])
    await mk('opsB', tenantB, ['operations_admin'])
  })

  it('lets a driver add a crew from their own book, once', async () => {
    await addMine('ann', 1, 'Juan Crew')
    const res = await addCompany('ann', { phone: num(1) })
    expect(res.status).toBe(201)
    expect(await outcomeOf(res)).toBe('addedFromMyList')
    expect(await outcomeOf(await addCompany('ann', { phone: num(1) }))).toBe('alreadyInList')

    // bob (same tenant) sees it; dee (tenant B) does not.
    const bobs = await listCompany('bob')
    expect(bobs).toHaveLength(1)
    expect(bobs[0]).toMatchObject({
      phone: e164(1),
      name: 'Juan Crew',
      inMyList: false,
      inCompanyList: true,
      canRemoveFromCompany: false,
      myRating: null,
    })
    expect(await listCompany('dee')).toEqual([])
    expect((await appAs('dee').request(crewUrl(1))).status).toBe(404)
  })

  it('refuses a driver adding a crew that is not in their book', async () => {
    const res = await addCompany('ann', { phone: num(2), name: 'New' })
    expect(res.status).toBe(422)
    expect(await codeOf(res)).toBe('CREW_NOT_IN_YOUR_LIST')
  })

  it('lets Operations create a crew straight onto the list, spending the add budget', async () => {
    const res = await addCompany('ops', { phone: num(2), name: 'Ops Crew', nickname: 'Best' })
    expect(res.status).toBe(201)
    expect(await outcomeOf(res)).toBe('added')
    const [crew] = await listCompany('ops')
    expect(crew).toMatchObject({
      name: 'Ops Crew',
      companyNickname: 'Best',
      displayName: 'Best',
      inMyList: false,
      canRemoveFromCompany: true,
    })
    expect(await db.crewLinkAdd.count({ where: { tenantUserId: U['ops']!.id } })).toBe(1)

    // A name is required to create one.
    expect(await codeOf(await addCompany('ops', { phone: num(3) }))).toBe('LABOR_FIELD_REQUIRED')
  })

  it("links Operations to another tenant's existing crew under its shared name", async () => {
    await addMine('dee', 4, 'Shared Name')
    const res = await addCompany('ops', { phone: num(4), name: 'Our Name' })
    expect(await outcomeOf(res)).toBe('linkedExisting')
    const crew = await data<CrewOut>(await appAs('ann').request(crewUrl(4)))
    expect(crew).toMatchObject({ name: 'Shared Name', companyNickname: 'Our Name' })
  })

  it('rate-limits Operations adds with the same budget as the book', async () => {
    await db.crewLinkAdd.createMany({
      data: Array.from({ length: LINK_RATE_LIMIT }, () => ({
        tenantUserId: U['ops']!.id,
        crewPhone: e164(9),
      })),
    })
    const res = await addCompany('ops', { phone: num(5), name: 'Too Many' })
    expect(res.status).toBe(429)
    expect(await codeOf(res)).toBe('LINK_RATE_LIMITED')
    await db.crewLinkAdd.deleteMany({ where: { tenantUserId: U['ops']!.id } })
  })

  it('lets any user edit a company crew — header, service areas, packers', async () => {
    await addCompany('ops', { phone: num(1), name: 'Crew One' })

    const patched = await appAs('ann').request(crewUrl(1), send({ name: 'Renamed' }, 'PATCH'))
    expect(patched.status).toBe(200)
    expect((await data<CrewOut>(patched)).name).toBe('Renamed')

    const areas = await appAs('ann').request(
      `${crewUrl(1)}/service-areas`,
      send({ serviceAreas: [{ city: 'Atlanta', region: 'GA' }] }, 'PUT'),
    )
    expect(areas.status).toBe(200)

    const packer = await appAs('ann').request(
      `${crewUrl(1)}/packers`,
      send({ firstName: 'Ana', lastName: 'Diaz', phone: '404-555-0000' }),
    )
    expect(packer.status).toBe(201)
    const { id } = await data<{ id: string }>(packer)
    expect(
      (
        await appAs('bob').request(
          `${crewUrl(1)}/packers/${id}`,
          send({ lastName: 'Ruiz' }, 'PATCH'),
        )
      ).status,
    ).toBe(200)
    expect(
      (await appAs('bob').request(`${crewUrl(1)}/packers/${id}`, { method: 'DELETE' })).status,
    ).toBe(204)

    const company = await appAs('ann').request(
      companyUrl(1),
      send({ nickname: 'Company Name' }, 'PATCH'),
    )
    expect((await data<CrewOut>(company)).companyNickname).toBe('Company Name')
  })

  it('keeps the private extras behind your own link', async () => {
    await addCompany('ops', { phone: num(1), name: 'Crew One' })
    const nick = await appAs('ann').request(crewUrl(1), send({ nickname: 'Mine' }, 'PATCH'))
    expect(nick.status).toBe(422)
    expect(await codeOf(nick)).toBe('CREW_NOT_IN_YOUR_LIST')
    expect(
      (await appAs('ann').request(`${crewUrl(1)}/rating`, send({ stars: 4 }, 'PUT'))).status,
    ).toBe(404)
    // DELETE /crews/:phone is "remove from MY list" — not from the company's.
    expect((await appAs('ann').request(crewUrl(1), { method: 'DELETE' })).status).toBe(404)

    // "Add to my list" is the ordinary add, and then the extras work.
    await addMine('ann', 1)
    const mine = await data<CrewOut>(await appAs('ann').request(crewUrl(1)))
    expect(mine).toMatchObject({ inMyList: true, inCompanyList: true })
    const mineList = await data<CrewOut[]>(await appAs('ann').request('/labor/crews'))
    expect(mineList.map((c) => [c.phone, c.inCompanyList])).toEqual([[e164(1), true]])
  })

  it('lets only Operations remove a crew, and never deletes the crew', async () => {
    await addMine('ann', 1)
    await addCompany('ann', { phone: num(1) })

    const denied = await appAs('ann').request(companyUrl(1), { method: 'DELETE' })
    expect(denied.status).toBe(403)
    expect(await codeOf(denied)).toBe('OPERATIONS_ONLY')

    // Operations at another tenant can't reach this tenant's list.
    expect((await appAs('opsB').request(companyUrl(1), { method: 'DELETE' })).status).toBe(404)

    expect((await appAs('ops').request(companyUrl(1), { method: 'DELETE' })).status).toBe(204)
    expect(await listCompany('ann')).toEqual([])
    // ann's own link — and the crew — stay.
    expect((await appAs('ann').request(crewUrl(1))).status).toBe(200)
    expect((await appAs('bob').request(crewUrl(1))).status).toBe(404)
  })

  it('searches the company list like the book', async () => {
    await addCompany('ops', { phone: num(1), name: 'Atlanta Movers' })
    await addCompany('ops', { phone: num(2), name: 'Denver Packers' })
    await appAs('ops').request(
      `${crewUrl(1)}/service-areas`,
      send({ serviceAreas: [{ city: 'Atlanta', region: 'GA' }] }, 'PUT'),
    )
    await appAs('ops').request(
      `${crewUrl(2)}/service-areas`,
      send({ serviceAreas: [{ city: 'Denver', region: 'CO' }] }, 'PUT'),
    )

    expect((await listCompany('ann')).map((c) => c.name)).toEqual([
      'Atlanta Movers',
      'Denver Packers',
    ])
    expect((await listCompany('ann', 'denver p')).map((c) => c.name)).toEqual(['Denver Packers'])
    expect((await listCompany('ann', 'GA')).map((c) => c.name)).toEqual(['Atlanta Movers'])
    const near = await listCompany('ann', '80202')
    expect(near[0]!.name).toBe('Denver Packers')
    expect(near[0]!.distanceMiles).toBeTypeOf('number')
  })

  it('treats clearing a private nickname I never had as a no-op', async () => {
    await addCompany('ops', { phone: num(1), name: 'Crew One' })
    const res = await appAs('ann').request(
      crewUrl(1),
      send({ name: 'Renamed', nickname: null }, 'PATCH'),
    )
    expect(res.status).toBe(200)
    expect((await data<CrewOut>(res)).name).toBe('Renamed')
  })

  it('keeps a company crew when the user who added it is deleted', async () => {
    await addCompany('ops', { phone: num(1), name: 'Crew One' })
    await db.crewLinkAdd.deleteMany({ where: { tenantUserId: U['ops']!.id } })
    await db.tenantUser.delete({ where: { id: U['ops']!.id } })
    expect((await listCompany('ann')).map((c) => c.phone)).toEqual([e164(1)])
  })

  it('does not charge the add budget for an add that linked nothing', async () => {
    await addCompany('ops', { phone: num(1), name: 'Crew One' })
    await addCompany('ops', { phone: num(1), name: 'Crew One' })
    expect(await db.crewLinkAdd.count({ where: { tenantUserId: U['ops']!.id } })).toBe(1)
  })

  it('refuses PATCH on a crew not on the company list', async () => {
    await addMine('ann', 1)
    const res = await appAs('ann').request(companyUrl(1), send({ nickname: 'x' }, 'PATCH'))
    expect(res.status).toBe(404)
  })
})
