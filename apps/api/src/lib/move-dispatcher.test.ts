/**
 * The move's dispatcher (task queue Phase 3a D4): `sales.operations_id` →
 * a LINKED, active, human TenantUser in the order's company.
 *
 * The legacy read is injected; the membership lookup runs on Postgres.
 * Skipped without DATABASE_URL (except the pure parsing cases).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../db'
import { createTenantDb } from './prisma'
import { createCompanyRepository } from '../repositories/company.repository'
import { resolveMoveDispatcher, toEmployeeCode } from './move-dispatcher'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG_A = 'test-move-dispatcher-a'
const SLUG_B = 'test-move-dispatcher-b'

describe('toEmployeeCode', () => {
  it.each([
    [1196, 1196],
    ['1196', 1196],
    [' 1196 ', 1196],
    [0, null],
    ['0', null],
    ['', null],
    [null, null],
    [undefined, null],
    ['ABC', null],
    [-5, null],
    [12.5, null],
  ])('%j → %j', (raw, code) => {
    expect(toEmployeeCode(raw)).toBe(code)
  })
})

describe.skipIf(!hasDb)('resolveMoveDispatcher', () => {
  let tenantA = ''
  let tenantB = ''
  let companyA = ''
  let companyB = ''
  let dispatcher = ''

  const scoped = (id: string) =>
    createTenantDb(db as unknown as PrismaClient, id) as unknown as PrismaClient

  async function wipe(): Promise<void> {
    const ids = [tenantA, tenantB].filter(Boolean)
    await db.companyMembership.deleteMany({ where: { tenantId: { in: ids } } })
    await db.tenantUser.deleteMany({ where: { tenantId: { in: ids } } })
    await db.company.deleteMany({ where: { tenantId: { in: ids } } })
    await db.site.deleteMany({ where: { tenantId: { in: ids } } })
  }

  const link = (tenantId: string, companyId: string, tenantUserId: string, employeeCode: number) =>
    db.companyMembership.create({
      data: {
        tenantId,
        companyId,
        tenantUserId,
        employeeCode,
        status: 'LINKED',
        matchedBy: 'EMAIL',
        lastSyncedAt: new Date(),
      },
    })

  const resolve = (operationsId: unknown, over: { tenantId?: string; companyId?: string } = {}) =>
    resolveMoveDispatcher({
      db: scoped(over.tenantId ?? tenantA),
      tenantId: over.tenantId ?? tenantA,
      companyId: over.companyId ?? companyA,
      orderNum: 490317,
      readOperationsId: vi.fn().mockResolvedValue(operationsId),
    })

  beforeAll(async () => {
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    const [a, b] = await Promise.all([upsert(SLUG_A), upsert(SLUG_B)])
    tenantA = a.id
    tenantB = b.id
  })

  beforeEach(async () => {
    await wipe()
    const a = await db.tenant.findUniqueOrThrow({ where: { id: tenantA } })
    const b = await db.tenant.findUniqueOrThrow({ where: { id: tenantB } })
    companyA = (await createCompanyRepository(scoped(tenantA)).ensureDefaultTarget(a)).company.id
    companyB = (await createCompanyRepository(scoped(tenantB)).ensureDefaultTarget(b)).company.id
    dispatcher = (await db.tenantUser.create({ data: { tenantId: tenantA, email: 'disp@a.test' } }))
      .id
  })

  afterAll(async () => {
    await wipe().catch(() => undefined)
    await db.$disconnect()
  })

  it('finds the linked user for the order’s operations_id', async () => {
    await link(tenantA, companyA, dispatcher, 1196)

    expect(await resolve('1196')).toEqual({
      found: true,
      employeeCode: 1196,
      tenantUserId: dispatcher,
    })
  })

  it('no dispatcher on the order (no row, empty, 0) is found: false', async () => {
    expect(await resolve(null)).toEqual({ found: false })
    expect(await resolve('')).toEqual({ found: false })
    expect(await resolve(0)).toEqual({ found: false })
  })

  it('a dispatcher with no linked cloud user has tenantUserId null', async () => {
    expect(await resolve(1196)).toEqual({ found: true, employeeCode: 1196, tenantUserId: null })
  })

  it('ignores INACTIVE links, deactivated users and service accounts', async () => {
    const gone = await db.tenantUser.create({
      data: { tenantId: tenantA, email: 'gone@a.test', status: 'DEACTIVATED' },
    })
    const svc = await db.tenantUser.create({
      data: { tenantId: tenantA, email: 'svc@a.test', isServiceAccount: true },
    })
    await link(tenantA, companyA, gone.id, 2001)
    await link(tenantA, companyA, svc.id, 2002)
    await link(tenantA, companyA, dispatcher, 2003)
    await db.companyMembership.updateMany({
      where: { tenantId: tenantA, employeeCode: 2003 },
      data: { status: 'INACTIVE' },
    })

    expect((await resolve(2001)) as { tenantUserId: string | null }).toMatchObject({
      tenantUserId: null,
    })
    expect(await resolve(2002)).toMatchObject({ tenantUserId: null })
    expect(await resolve(2003)).toMatchObject({ tenantUserId: null })
  })

  it("a code linked in another company or tenant is not this order's dispatcher", async () => {
    const userB = await db.tenantUser.create({ data: { tenantId: tenantB, email: 'b@b.test' } })
    await link(tenantB, companyB, userB.id, 1196)

    expect(await resolve(1196)).toMatchObject({ tenantUserId: null })
    // Even naming the other tenant's company from tenant A finds nobody.
    expect(await resolve(1196, { companyId: companyB })).toMatchObject({ tenantUserId: null })
  })
})
