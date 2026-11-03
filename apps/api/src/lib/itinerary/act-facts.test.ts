/**
 * Act facts against real Postgres through the tenant-scoped client
 * (`createTenantDb`): record → attach, newest wins per basis, a null clears,
 * and one tenant never sees another's facts for the same item key.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is unset. `assertionFrom` (pure) is tested regardless.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../prisma'
import { assertionFrom, attachAssertions, recordFact } from './act-facts'
import type { ItineraryItem } from './types'

const hasDb = Boolean(process.env['DATABASE_URL'])

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    key: 'local-job-token:7001:PACK',
    source: { kind: 'local-job-token', jobId: 7001, token: 'PACK' },
    orderNum: 493175,
    shipperName: null,
    actCode: 'PACK',
    actName: 'Pack',
    known: true,
    kind: 'act',
    side: 'origin',
    place: null,
    placeNote: null,
    day: '2026-11-03',
    plannedStart: '2026-11-03',
    plannedEnd: null,
    estimated: null,
    actual: null,
    arrivalWindow: null,
    committed: false,
    confirmed: false,
    sequence: 10,
    tripId: null,
    tripStatus: null,
    drivers: { longhaul: [], local: [3097] },
    assertion: null,
    ...over,
  }
}

const row = (basis: string, day: string | null, at: string, over = {}) => ({
  itemKey: 'k',
  basis,
  day: day === null ? null : new Date(`${day}T00:00:00Z`),
  windowStart: null,
  windowEnd: null,
  assertedById: 'u1',
  assertedAt: new Date(at),
  ...over,
})

describe('assertionFrom', () => {
  it('takes the newest row per basis (rows arrive newest first)', () => {
    expect(
      assertionFrom([
        row('ETA', '2026-11-05', '2026-11-03T12:00:00Z', {
          windowStart: '08:00',
          windowEnd: '10:00',
        }),
        row('DONE', '2026-11-03', '2026-11-03T11:00:00Z', { assertedById: 'u2' }),
        row('ETA', '2026-11-04', '2026-11-03T10:00:00Z'),
      ]),
    ).toEqual({
      eta: { day: '2026-11-05', window: { start: '08:00', end: '10:00' } },
      done: '2026-11-03',
      assertedAt: '2026-11-03T12:00:00.000Z',
      byUserId: 'u1',
    })
  })

  it('a newest null row clears that basis; nothing current is null', () => {
    expect(
      assertionFrom([
        row('ETA', null, '2026-11-03T12:00:00Z'),
        row('ETA', '2026-11-04', '2026-11-03T10:00:00Z'),
      ]),
    ).toBeNull()
    expect(
      assertionFrom([
        row('DONE', null, '2026-11-03T12:00:00Z'),
        row('ETA', '2026-11-04', '2026-11-03T10:00:00Z'),
      ]),
    ).toMatchObject({ eta: { day: '2026-11-04', window: null }, done: null })
  })
})

describe.skipIf(!hasDb)('act facts (integration)', () => {
  let tenantA: string
  let tenantB: string
  let userA: string
  let A: PrismaClient
  let B: PrismaClient

  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantA = (await upsert('test-act-facts-a')).id
    tenantB = (await upsert('test-act-facts-b')).id
    await db.tenantUser.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    userA = (
      await db.tenantUser.create({
        data: { tenantId: tenantA, email: 'driver@act-facts.test', roleNames: ['driver'] },
      })
    ).id
    A = createTenantDb(db as unknown as PrismaClient, tenantA) as unknown as PrismaClient
    B = createTenantDb(db as unknown as PrismaClient, tenantB) as unknown as PrismaClient
  })

  beforeEach(async () => {
    await db.itineraryActFact.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
  })

  afterAll(async () => {
    await db.itineraryActFact.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await db.tenantUser.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await db.$disconnect()
  })

  const record = (
    client: PrismaClient,
    tenantId: string,
    basis: 'ETA' | 'DONE',
    day: string | null,
    window: { start: string; end: string } | null = null,
  ) =>
    recordFact(client, {
      tenantId,
      item: item(),
      basis,
      day,
      window,
      userId: tenantId === tenantA ? userA : null,
      capturedBy: 'driver-app',
    })

  it('attaches the newest ETA and done, keeps legacy dates, and stores the item denormalized', async () => {
    await record(A, tenantA, 'ETA', '2026-11-04')
    await record(A, tenantA, 'ETA', '2026-11-05', { start: '08:00', end: '10:00' })
    await record(A, tenantA, 'DONE', '2026-11-03')

    const [out] = await attachAssertions(A, [item()])
    expect(out?.day).toBe('2026-11-03')
    expect(out?.actual).toBeNull()
    expect(out?.assertion).toMatchObject({
      eta: { day: '2026-11-05', window: { start: '08:00', end: '10:00' } },
      done: '2026-11-03',
      byUserId: userA,
    })
    const stored = await db.itineraryActFact.findFirst({ where: { tenantId: tenantA } })
    expect(stored).toMatchObject({
      itemKey: 'local-job-token:7001:PACK',
      sourceKind: 'local-job-token',
      orderNum: 493175,
      actCode: 'PACK',
      capturedBy: 'driver-app',
    })
  })

  it('a null clears', async () => {
    await record(A, tenantA, 'DONE', '2026-11-03')
    await new Promise((r) => setTimeout(r, 5))
    await record(A, tenantA, 'DONE', null)
    const [out] = await attachAssertions(A, [item()])
    expect(out?.assertion).toBeNull()
  })

  it("never shows one tenant's facts to another for the same item key", async () => {
    await record(A, tenantA, 'DONE', '2026-11-03')
    const [inB] = await attachAssertions(B, [item()])
    expect(inB?.assertion).toBeNull()
    const [inA] = await attachAssertions(A, [item()])
    expect(inA?.assertion?.done).toBe('2026-11-03')
  })
})
