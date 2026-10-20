/**
 * Integration tests for /api/v1/labor (driver labor-crew book).
 *
 * Runs the real router against Postgres through `createTenantDb` — the scoped
 * client tenantMiddleware installs — with Cedar evaluated offline. The geo
 * reference tables come from the `geo_places_data` migration, so distance
 * ranking is exercised against real ZIP / city / FSA centroids.
 *
 * Crews are platform-wide (no tenant column), so every number this file uses
 * is in the 404-555-01xx block and is wiped by that prefix.
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

const SLUG_A = 'test-labor-a'
const SLUG_B = 'test-labor-b'
const PREFIX = '+1404555010'
/** A test crew number: 404-555-010n. */
const num = (n: number) => `(404) 555-010${n}`
const e164 = (n: number) => `${PREFIX}${n}`

let tenantA: string
let tenantB: string
const U: Record<string, { id: string; tenantId: string }> = {}

function appAs(who: string, opts: { apiClient?: boolean } = {}) {
  const u = U[who]!
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', u.tenantId)
    c.set('userId', u.id)
    c.set('correlationId', 'corr-test')
    c.set('principal', { sub: `sub-${who}`, tenantId: u.tenantId, roleNames: ['driver'] })
    if (opts.apiClient) c.set('apiClient', { id: 'ac-1' } as never)
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

type CrewOut = {
  phone: string
  name: string
  nickname: string | null
  displayName: string
  serviceAreas: Array<{ city: string; region: string; geocoded: boolean }>
  myRating: { stars: number; comment: string | null } | null
  averageRating: { average: number; count: number } | null
  packerCount: number
  packers?: Array<{ id: string; lastName: string; cidIssuedOn: string | null }>
  distanceMiles?: number | null
}

const addCrew = (who: string, n: number, name = `Crew ${n}`, extra: object = {}) =>
  appAs(who).request('/labor/crews', send({ phone: num(n), name, ...extra }))

const crewUrl = (n: number) => `/labor/crews/${encodeURIComponent(e164(n))}`

async function wipe() {
  await db.crew.deleteMany({ where: { phone: { startsWith: PREFIX } } })
  for (const t of [tenantA, tenantB]) {
    await db.crewLink.deleteMany({ where: { tenantId: t } })
    await db.tenantUser.deleteMany({ where: { tenantId: t } })
  }
}

afterAll(async () => {
  if (!hasDb) return
  await wipe().catch(() => undefined)
  await db.$disconnect()
})

describe.skipIf(!hasDb)('/labor (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    await wipe()
    const mk = async (key: string, tenantId: string) => {
      const row = await db.tenantUser.create({
        data: { tenantId, email: `${key}@labor.test`, roleNames: ['driver'], status: 'ACTIVE' },
      })
      U[key] = { id: row.id, tenantId }
    }
    await mk('ann', tenantA)
    await mk('bob', tenantA)
    await mk('cat', tenantA)
    await mk('dee', tenantB)
  })

  it('refuses API clients', async () => {
    const res = await appAs('ann', { apiClient: true }).request('/labor/crews')
    expect(res.status).toBe(403)
    expect(await codeOf(res)).toBe('LABOR_HUMANS_ONLY')
  })

  it('adds a crew, normalising the phone, and lists it', async () => {
    const res = await addCrew('ann', 1, 'Juan Crew', { email: 'J@X.com' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: CrewOut; meta: { outcome: string } }
    expect(body.meta.outcome).toBe('added')
    expect(body.data).toMatchObject({ phone: e164(1), name: 'Juan Crew', packerCount: 0 })

    const again = await addCrew('ann', 1, 'Whatever')
    expect(again.status).toBe(200)
    expect(((await again.json()) as { meta: { outcome: string } }).meta.outcome).toBe(
      'alreadyInList',
    )

    const list = await data<CrewOut[]>(await appAs('ann').request('/labor/crews'))
    expect(list.map((c) => c.phone)).toEqual([e164(1)])
  })

  it('rejects an invalid phone or a blank name', async () => {
    const bad = await appAs('ann').request('/labor/crews', send({ phone: '555-12', name: 'x' }))
    expect(bad.status).toBe(400)
    expect(await codeOf(bad)).toBe('INVALID_PHONE_NUMBER')
    const blank = await addCrew('ann', 1, ' ')
    expect(await codeOf(blank)).toBe('LABOR_FIELD_REQUIRED')
  })

  it('isolates crews by link — across tenants too — and shares the crew once linked', async () => {
    await addCrew('ann', 1, 'Juan Crew')
    await appAs('ann').request(
      `${crewUrl(1)}/packers`,
      send({ firstName: 'Ana', lastName: 'Diaz', phone: '404-555-0000' }),
    )
    await appAs('ann').request(`${crewUrl(1)}/rating`, send({ stars: 5, comment: 'great' }, 'PUT'))

    // Not linked → 404, including from another tenant.
    expect((await appAs('bob').request(crewUrl(1))).status).toBe(404)
    expect((await appAs('dee').request(crewUrl(1))).status).toBe(404)
    expect(await data<CrewOut[]>(await appAs('dee').request('/labor/crews'))).toEqual([])

    // dee (tenant B) adds the same number under her own contact name.
    const linked = await addCrew('dee', 1, 'Johnny')
    expect(((await linked.json()) as { meta: { outcome: string } }).meta.outcome).toBe(
      'linkedExisting',
    )
    const seen = await data<CrewOut>(await appAs('dee').request(crewUrl(1)))
    expect(seen.name).toBe('Juan Crew') // the shared name stands
    expect(seen.nickname).toBe('Johnny') // hers is private
    expect(seen.displayName).toBe('Johnny')
    expect(seen.packers!.map((p) => p.lastName)).toEqual(['Diaz']) // shared packers
    expect(seen.myRating).toBeNull() // ann's rating is not hers
    expect(seen.averageRating).toBeNull() // and one rater is never shown

    const annView = await data<CrewOut>(await appAs('ann').request(crewUrl(1)))
    expect(annView.nickname).toBeNull()
    expect(annView.myRating).toMatchObject({ stars: 5, comment: 'great' })
  })

  it('shows the anonymous average only from three raters', async () => {
    for (const who of ['ann', 'bob', 'cat']) await addCrew(who, 2)
    const rate = (who: string, stars: number) =>
      appAs(who).request(`${crewUrl(2)}/rating`, send({ stars }, 'PUT'))

    await rate('ann', 5)
    await rate('bob', 3)
    expect((await data<CrewOut>(await appAs('ann').request(crewUrl(2)))).averageRating).toBeNull()
    await rate('cat', 4)
    const view = await data<CrewOut>(await appAs('ann').request(crewUrl(2)))
    expect(view.averageRating).toEqual({ average: 4, count: 3 })
    expect(view.myRating?.stars).toBe(5)

    expect(await codeOf(await rate('ann', 6))).toBe('INVALID_RATING')

    // Clearing my rating drops it from the aggregate.
    await appAs('cat').request(`${crewUrl(2)}/rating`, { method: 'DELETE' })
    expect((await data<CrewOut>(await appAs('ann').request(crewUrl(2)))).averageRating).toBeNull()
  })

  it('edits shared fields and my nickname', async () => {
    await addCrew('ann', 1, 'Juan Crew')
    await addCrew('bob', 1)
    const res = await appAs('bob').request(
      crewUrl(1),
      send({ name: 'Juan & Sons', nickname: 'JS' }, 'PATCH'),
    )
    expect(res.status).toBe(200)
    const ann = await data<CrewOut>(await appAs('ann').request(crewUrl(1)))
    expect(ann.name).toBe('Juan & Sons')
    expect(ann.nickname).toBeNull()
    const crew = await db.crew.findUniqueOrThrow({ where: { phone: e164(1) } })
    expect(crew.updatedByUserId).toBe(U['bob']!.id)
  })

  it('removing a crew drops only my link; the crew stays for others', async () => {
    await addCrew('ann', 1)
    await addCrew('bob', 1)
    await appAs('ann').request(`${crewUrl(1)}/rating`, send({ stars: 2 }, 'PUT'))
    const res = await appAs('ann').request(crewUrl(1), { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect((await appAs('ann').request(crewUrl(1))).status).toBe(404)
    expect((await appAs('bob').request(crewUrl(1))).status).toBe(200)
    expect(await db.crewRating.count({ where: { link: { crewPhone: e164(1) } } })).toBe(0)
  })

  describe('packers', () => {
    beforeEach(async () => {
      await addCrew('ann', 1)
    })
    const addPacker = (body: object) => appAs('ann').request(`${crewUrl(1)}/packers`, send(body))

    it('validates the required fields and the CID date', async () => {
      expect(await codeOf(await addPacker({ firstName: 'A', lastName: 'B' }))).toBe(
        'PACKER_CONTACT_REQUIRED',
      )
      expect(
        await codeOf(await addPacker({ firstName: 'A', lastName: 'B', cidNumber: 'X1' })),
      ).toBe('PACKER_CID_DATE_REQUIRED')
      const ok = await addPacker({
        firstName: 'A',
        lastName: 'B',
        cidNumber: 'x1',
        cidIssuedOn: '2024-03-01',
      })
      expect(ok.status).toBe(201)
      expect(await data(ok)).toMatchObject({ cidNumber: 'X1', cidIssuedOn: '2024-03-01' })
    })

    it('rejects a duplicate by last name + CID or last name + email, but not phone-only', async () => {
      await addPacker({
        firstName: 'Ana',
        lastName: 'Diaz',
        cidNumber: 'C1',
        cidIssuedOn: '2024-01-01',
      })
      const dupCid = await addPacker({
        firstName: 'Anita',
        lastName: 'DIAZ',
        cidNumber: 'c1',
        cidIssuedOn: '2024-01-01',
      })
      expect(dupCid.status).toBe(409)
      expect(await codeOf(dupCid)).toBe('PACKER_DUPLICATE')

      await addPacker({ firstName: 'Ed', lastName: 'Lee', email: 'ed@x.com' })
      expect((await addPacker({ firstName: 'E', lastName: 'Lee', email: 'ED@x.com' })).status).toBe(
        409,
      )

      // Same CID, different last name, is a different person.
      expect(
        (
          await addPacker({
            firstName: 'Bo',
            lastName: 'Ng',
            cidNumber: 'C1',
            cidIssuedOn: '2024-01-01',
          })
        ).status,
      ).toBe(201)
      // Phone-only packers have no identity key.
      expect((await addPacker({ firstName: 'P', lastName: 'Q', phone: '4045550001' })).status).toBe(
        201,
      )
      expect((await addPacker({ firstName: 'P', lastName: 'Q', phone: '4045550001' })).status).toBe(
        201,
      )
    })

    it('patches with merge semantics and deletes', async () => {
      const created = await data<{ id: string }>(
        await addPacker({ firstName: 'Ana', lastName: 'Diaz', phone: '4045550001' }),
      )
      const url = `${crewUrl(1)}/packers/${created.id}`
      // Adding a CID without its date is refused…
      expect(
        await codeOf(await appAs('ann').request(url, send({ cidNumber: 'Z9' }, 'PATCH'))),
      ).toBe('PACKER_CID_DATE_REQUIRED')
      // …with it, accepted, and the phone is kept.
      const patched = await appAs('ann').request(
        url,
        send({ cidNumber: 'Z9', cidIssuedOn: '2025-05-05' }, 'PATCH'),
      )
      expect(await data(patched)).toMatchObject({ cidNumber: 'Z9', phone: '+14045550001' })

      expect((await appAs('ann').request(url, { method: 'DELETE' })).status).toBe(204)
      expect((await appAs('ann').request(url, { method: 'DELETE' })).status).toBe(404)
    })

    it('needs a link to the crew', async () => {
      const res = await appAs('bob').request(
        `${crewUrl(1)}/packers`,
        send({ firstName: 'A', lastName: 'B', phone: '4045550001' }),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      const app = appAs('ann')
      const areas = (n: number, serviceAreas: object[]) =>
        app.request(`${crewUrl(n)}/service-areas`, send({ serviceAreas }, 'PUT'))
      await addCrew('ann', 1, 'Atlanta Movers')
      await areas(1, [{ city: 'Atlanta', region: 'GA' }])
      await addCrew('ann', 2, 'Macon Movers')
      await areas(2, [{ city: 'Macon', region: 'GA' }])
      await addCrew('ann', 3, 'Toronto Movers')
      await areas(3, [{ city: 'Toronto', region: 'ON' }])
      await addCrew('ann', 4, 'Nowhere Crew')
      await areas(4, [{ city: 'Notarealplace', region: 'GA' }])
      await addCrew('ann', 5, 'Bare Crew')
    })

    const search = async (q: string) => {
      const res = await appAs('ann').request(`/labor/crews?q=${encodeURIComponent(q)}`)
      return (await res.json()) as {
        data: CrewOut[]
        meta: { location: { label: string } | null; locationNotFound?: boolean }
      }
    }
    const names = (r: { data: CrewOut[] }) => r.data.map((c) => c.name)

    it('stores whether each service area was geocoded', async () => {
      const crew = await data<CrewOut>(await appAs('ann').request(crewUrl(4)))
      expect(crew.serviceAreas).toEqual([
        expect.objectContaining({ city: 'Notarealplace', geocoded: false }),
      ])
    })

    it('lists A–Z with no query', async () => {
      expect(names(await search(''))).toEqual([
        'Atlanta Movers',
        'Bare Crew',
        'Macon Movers',
        'Nowhere Crew',
        'Toronto Movers',
      ])
    })

    it('ranks nearest first from a ZIP', async () => {
      const r = await search('31201') // Macon
      expect(names(r).slice(0, 3)).toEqual(['Macon Movers', 'Atlanta Movers', 'Toronto Movers'])
      expect(r.data.at(-1)!.distanceMiles).toBeNull()
      expect(r.meta.location?.label).toContain('31201')
    })

    it('ranks nearest first from "City, ST" and from a bare city name', async () => {
      expect(names(await search('Atlanta, GA')).slice(0, 2)).toEqual([
        'Atlanta Movers',
        'Macon Movers',
      ])
      // No crew is named after Savannah, so the text is tried as a city.
      const fromSavannah = await search('savannah')
      expect(names(fromSavannah).slice(0, 2)).toEqual(['Macon Movers', 'Atlanta Movers'])
      expect(fromSavannah.meta.location?.label).toBe('Savannah, GA')
    })

    it('ranks nearest first from a Canadian FSA', async () => {
      expect(names(await search('M5V 2T6'))[0]).toBe('Toronto Movers')
    })

    it('filters by state or province', async () => {
      expect(names(await search('GA'))).toEqual(['Atlanta Movers', 'Macon Movers', 'Nowhere Crew'])
      expect(names(await search('on'))).toEqual(['Toronto Movers'])
    })

    it('matches name text before trying it as a city', async () => {
      expect(names(await search('atlanta mov'))).toEqual(['Atlanta Movers'])
      expect(names(await search('5550102'))).toEqual(['Macon Movers'])
    })

    it('says when a location is unknown', async () => {
      const r = await search('00000')
      expect(r.data).toEqual([])
      expect(r.meta.locationNotFound).toBe(true)
    })
  })

  it('imports phone contacts with a per-row outcome', async () => {
    await addCrew('bob', 2, 'Bob’s name')
    await addCrew('ann', 3)
    const res = await appAs('ann').request(
      '/labor/crews/import',
      send({
        crews: [
          { phone: num(1), name: 'New One' },
          { phone: num(2), name: 'Ann’s name' },
          { phone: num(3), name: 'Mine' },
          { phone: 'nope', name: 'Bad' },
          { phone: '+1 (404) 555-0101', name: 'Dup in batch' },
        ],
      }),
    )
    expect(res.status).toBe(200)
    expect((await data<Array<{ outcome: string }>>(res)).map((r) => r.outcome)).toEqual([
      'added',
      'linkedExisting',
      'alreadyInList',
      'invalid',
      'alreadyInList',
    ])
    const two = await data<CrewOut>(await appAs('ann').request(crewUrl(2)))
    expect(two).toMatchObject({ name: 'Bob’s name', nickname: 'Ann’s name' })
  })

  it('rate-limits new crews per user per day', async () => {
    const since = new Date()
    await db.crew.createMany({
      data: Array.from({ length: LINK_RATE_LIMIT }, (_, i) => ({
        phone: `${PREFIX}9${String(i).padStart(3, '0')}`,
        name: `Bulk ${i}`,
        createdByUserId: U['ann']!.id,
        updatedByUserId: U['ann']!.id,
      })),
    })
    await db.crewLink.createMany({
      data: Array.from({ length: LINK_RATE_LIMIT }, (_, i) => ({
        tenantUserId: U['ann']!.id,
        tenantId: tenantA,
        crewPhone: `${PREFIX}9${String(i).padStart(3, '0')}`,
        createdAt: since,
      })),
    })
    const res = await addCrew('ann', 1)
    expect(res.status).toBe(429)
    expect(await codeOf(res)).toBe('LINK_RATE_LIMITED')
    // Someone else is unaffected.
    expect((await addCrew('bob', 1)).status).toBe(201)
  })

  it('suggests cities for the service-area editor', async () => {
    const res = await appAs('ann').request('/labor/places?q=atlan')
    const places = await data<Array<{ city: string; region: string; country: string }>>(res)
    expect(places[0]).toEqual({ city: 'Atlanta', region: 'GA', country: 'US' })
    const scoped = await data<Array<{ region: string }>>(
      await appAs('ann').request('/labor/places?q=london,%20on'),
    )
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((p) => p.region === 'ON')).toBe(true)
    expect(await data(await appAs('ann').request('/labor/places?q=a'))).toEqual([])
  })

  it('exports my list with packers and my rating', async () => {
    await addCrew('ann', 1, 'Juan Crew', { nickname: 'Juan' })
    await appAs('ann').request(
      `${crewUrl(1)}/packers`,
      send({ firstName: 'Ana', lastName: 'Diaz', phone: '4045550001' }),
    )
    await appAs('ann').request(`${crewUrl(1)}/rating`, send({ stars: 4, comment: 'ok' }, 'PUT'))
    const rows = await data<Array<Record<string, unknown>>>(
      await appAs('ann').request('/labor/export'),
    )
    expect(rows).toEqual([
      expect.objectContaining({
        phone: e164(1),
        name: 'Juan Crew',
        nickname: 'Juan',
        myStars: 4,
        myComment: 'ok',
        packers: [expect.objectContaining({ firstName: 'Ana', phone: '+14045550001' })],
      }),
    ])
  })
})
