/**
 * Integration tests for the CompanyMembership repository (cloud identity I3).
 *
 * Run through `createTenantDb`: CompanyMembership is in TENANT_SCOPED_MODELS, so
 * isolation comes from the Prisma extension. The one-LINKED-user-per-employee
 * rule is a partial unique index a mocked client can't exercise — these tests
 * prove a plan that swaps two users' employees applies without colliding.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createCompanyRepository } from '../company.repository'
import { createCompanyMembershipRepository } from '../company-membership.repository'
import { planMembershipSync, type DirectoryEmployee } from '../../services/company-membership-sync'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG_A = 'test-membership-a'
const SLUG_B = 'test-membership-b'
const NOW = new Date('2026-10-05T12:00:00Z')

let tenantA: { id: string; name: string; slug: string }
let tenantB: { id: string; name: string; slug: string }

const scoped = (id: string) =>
  createTenantDb(db as unknown as PrismaClient, id) as unknown as PrismaClient

async function wipe(ids: string[]): Promise<void> {
  await db.companyMembership.deleteMany({ where: { tenantId: { in: ids } } })
  await db.tenantUser.deleteMany({ where: { tenantId: { in: ids } } })
  await db.company.deleteMany({ where: { tenantId: { in: ids } } })
  await db.site.deleteMany({ where: { tenantId: { in: ids } } })
}

const emp = (code: number, email: string): DirectoryEmployee => ({
  code,
  email,
  winUsername: `wun${code}`,
  active: true,
  dateTerminated: null,
})

/** Run one sync for tenant A's default company against the given directory. */
async function sync(companyId: string, directory: DirectoryEmployee[]) {
  const repo = createCompanyMembershipRepository(scoped(tenantA.id))
  const plan = planMembershipSync({
    directory,
    users: await repo.listSyncUsers(tenantA.id),
    existing: await repo.listExisting(companyId),
    now: NOW,
  })
  await repo.applyPlan(tenantA.id, companyId, plan, NOW)
  return plan
}

afterAll(async () => {
  if (hasDb) {
    await wipe([tenantA?.id, tenantB?.id].filter(Boolean)).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('CompanyMembershipRepository (integration)', () => {
  let companyA: string
  let userAlice: string
  let userBob: string

  beforeAll(async () => {
    const upsert = (slug: string, name: string) =>
      db.tenant.upsert({ where: { slug }, create: { name, slug }, update: {} })
    tenantA = await upsert(SLUG_A, 'Membership A')
    tenantB = await upsert(SLUG_B, 'Membership B')
  })

  beforeEach(async () => {
    await wipe([tenantA.id, tenantB.id])
    companyA = (await createCompanyRepository(scoped(tenantA.id)).ensureDefaultTarget(tenantA))
      .company.id
    userAlice = (
      await db.tenantUser.create({ data: { tenantId: tenantA.id, email: 'alice@a.test' } })
    ).id
    userBob = (await db.tenantUser.create({ data: { tenantId: tenantA.id, email: 'bob@a.test' } }))
      .id
    // Never considered: a service account and a deactivated user.
    await db.tenantUser.create({
      data: { tenantId: tenantA.id, email: 'alice@a.test.svc', isServiceAccount: true },
    })
    await db.tenantUser.create({
      data: { tenantId: tenantA.id, email: 'carol@a.test', status: 'DEACTIVATED' },
    })
  })

  it('lists only human, non-deactivated users of the tenant', async () => {
    const users = await createCompanyMembershipRepository(scoped(tenantA.id)).listSyncUsers(
      tenantA.id,
    )
    expect(users.map((u) => u.email)).toEqual(['alice@a.test', 'bob@a.test'])
  })

  it('links, re-runs idempotently, and exposes the link for token attribution', async () => {
    await sync(companyA, [emp(100, 'alice@a.test')])
    const again = await sync(companyA, [emp(100, 'alice@a.test')])

    expect(again).toMatchObject({ linked: 1, newlyLinked: 0 })
    const repo = createCompanyMembershipRepository(scoped(tenantA.id))
    expect(await repo.findLinked(companyA, userAlice)).toEqual({
      employeeCode: 100,
      legacyWindowsUsername: 'wun100',
    })
    expect(await db.companyMembership.count({ where: { companyId: companyA } })).toBe(1)
  })

  it('applies a swap of two users between employees without tripping the partial index', async () => {
    await sync(companyA, [emp(100, 'alice@a.test'), emp(200, 'bob@a.test')])
    await sync(companyA, [emp(100, 'bob@a.test'), emp(200, 'alice@a.test')])

    const repo = createCompanyMembershipRepository(scoped(tenantA.id))
    expect((await repo.findLinked(companyA, userAlice))?.employeeCode).toBe(200)
    expect((await repo.findLinked(companyA, userBob))?.employeeCode).toBe(100)
  })

  it('keeps a deactivated link as INACTIVE, and a new user can take the employee over', async () => {
    await sync(companyA, [emp(100, 'alice@a.test')])
    // Alice's email moves off employee 100; Bob's lands on it.
    await sync(companyA, [emp(100, 'bob@a.test')])

    const rows = await db.companyMembership.findMany({
      where: { companyId: companyA },
      orderBy: { status: 'asc' },
      select: { tenantUserId: true, employeeCode: true, status: true },
    })
    expect(rows).toEqual([
      { tenantUserId: userBob, employeeCode: 100, status: 'LINKED' },
      { tenantUserId: userAlice, employeeCode: 100, status: 'INACTIVE' },
    ])
  })

  it('the database refuses two LINKED users on one employee', async () => {
    const base = {
      tenantId: tenantA.id,
      companyId: companyA,
      employeeCode: 100,
      status: 'LINKED' as const,
      matchedBy: 'EMAIL' as const,
      lastSyncedAt: NOW,
    }
    await db.companyMembership.create({ data: { ...base, tenantUserId: userAlice } })
    await expect(
      db.companyMembership.create({ data: { ...base, tenantUserId: userBob } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it("isolates tenants: another tenant's client can't see or resolve a membership", async () => {
    await sync(companyA, [emp(100, 'alice@a.test')])

    const fromB = createCompanyMembershipRepository(scoped(tenantB.id))
    expect(await fromB.findLinked(companyA, userAlice)).toBeNull()
    expect(await fromB.listExisting(companyA)).toEqual([])
  })

  it('the admin view lists members with emails and the users without a LINKED row', async () => {
    await sync(companyA, [emp(100, 'alice@a.test')])

    const view = await createCompanyMembershipRepository(scoped(tenantA.id)).listForCompany(
      tenantA.id,
      companyA,
    )
    expect(view.members).toEqual([
      expect.objectContaining({ email: 'alice@a.test', employeeCode: 100, status: 'LINKED' }),
    ])
    expect(view.unmatched.map((u) => u.email)).toEqual(['bob@a.test'])
  })

  // Cloud identity I4: the desktop company picker reads the caller's OWN LINKED rows.
  it('listLinkedForUser returns only LINKED rows, keyed by company, tenant-scoped', async () => {
    await sync(companyA, [emp(100, 'alice@a.test')])
    const repoA = createCompanyMembershipRepository(scoped(tenantA.id))

    const alice = await repoA.listLinkedForUser(userAlice)
    expect([...alice.entries()]).toEqual([
      [companyA, { employeeCode: 100, legacyWindowsUsername: 'wun100' }],
    ])
    expect((await repoA.listLinkedForUser(userBob)).size).toBe(0)

    // Alice's employee is terminated: the INACTIVE row grants nothing.
    await sync(companyA, [{ ...emp(100, 'alice@a.test'), active: false }])
    expect((await repoA.listLinkedForUser(userAlice)).size).toBe(0)

    await sync(companyA, [emp(100, 'alice@a.test')])
    const fromB = createCompanyMembershipRepository(scoped(tenantB.id))
    expect((await fromB.listLinkedForUser(userAlice)).size).toBe(0)
  })
})
