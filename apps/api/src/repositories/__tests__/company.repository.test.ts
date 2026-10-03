/**
 * Integration tests for the Company/Site repository and the backfill migration.
 *
 * Run through `createTenantDb`: Site and Company are in TENANT_SCOPED_MODELS, so
 * isolation comes from the Prisma extension (including inside the repository's
 * interactive transactions), not from `where` clauses. The invariants under test
 * are enforced by partial unique indexes a mocked client can't exercise.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createCompanyRepository, isUniqueViolation } from '../company.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SLUG_A = 'test-company-a'
const SLUG_B = 'test-company-b'
const SLUG_BACKFILL = 'test-company-backfill'

let tenantA: { id: string; name: string; slug: string }
let tenantB: { id: string; name: string; slug: string }
let tenantBackfillId: string

const scoped = (id: string) =>
  createTenantDb(db as unknown as PrismaClient, id) as unknown as PrismaClient

async function wipe(ids: string[]): Promise<void> {
  await db.company.deleteMany({ where: { tenantId: { in: ids } } })
  await db.site.deleteMany({ where: { tenantId: { in: ids } } })
}

/** The backfill statements from the migration itself, so the test can't drift from it. */
function backfillStatements(): string[] {
  const dir = join(__dirname, '..', '..', '..', 'prisma', 'migrations')
  const migration = readdirSync(dir).find((d) => d.endsWith('_add_sites_companies'))!
  const sql = readFileSync(join(dir, migration, 'migration.sql'), 'utf8')
  return sql
    .slice(sql.indexOf('INSERT INTO "sites"'))
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('INSERT'))
}

afterAll(async () => {
  if (hasDb) {
    await wipe([tenantA?.id, tenantB?.id, tenantBackfillId].filter(Boolean)).catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('CompanyRepository (integration)', () => {
  beforeAll(async () => {
    const upsert = (slug: string, name: string) =>
      db.tenant.upsert({ where: { slug }, create: { name, slug }, update: {} })
    tenantA = await upsert(SLUG_A, 'Test Company Tenant A')
    tenantB = await upsert(SLUG_B, 'Test Company Tenant B')
    const backfill = await db.tenant.upsert({
      where: { slug: SLUG_BACKFILL },
      create: {
        name: 'Test Backfill',
        slug: SLUG_BACKFILL,
        pegiiApiBaseUrl: 'http://10.200.9.1:65274',
      },
      update: { pegiiApiBaseUrl: 'http://10.200.9.1:65274' },
    })
    tenantBackfillId = backfill.id
  })

  beforeEach(async () => {
    await wipe([tenantA.id, tenantB.id, tenantBackfillId])
  })

  it('ensureDefaultTarget creates a Primary site + default company once', async () => {
    const repo = createCompanyRepository(scoped(tenantA.id))

    const first = await repo.ensureDefaultTarget(tenantA)
    const again = await repo.ensureDefaultTarget(tenantA)

    expect(first.site.name).toBe('Primary')
    expect(first.company).toMatchObject({
      code: 'TEST-COMPANY-A',
      displayName: 'Test Company Tenant A',
      dataSourceKey: null,
      isDefault: true,
    })
    expect(again.company.id).toBe(first.company.id)
    expect(await repo.listCompanies()).toHaveLength(1)
  })

  it('ensureDefaultTarget is race-safe under concurrent first calls', async () => {
    const repo = createCompanyRepository(scoped(tenantA.id))

    const results = await Promise.all(
      Array.from({ length: 5 }, () => repo.ensureDefaultTarget(tenantA)),
    )

    expect(new Set(results.map((r) => r.company.id)).size).toBe(1)
    expect(await repo.listSites()).toHaveLength(1)
  })

  it('moves the default atomically when a new default company is created or patched', async () => {
    const repo = createCompanyRepository(scoped(tenantA.id))
    const { site, company: us } = await repo.ensureDefaultTarget(tenantA)

    const ca = await repo.createCompany({
      tenantId: tenantA.id,
      siteId: site.id,
      code: 'QMM-CA',
      displayName: 'QMM Canada',
      dataSourceKey: 'QMM_CA',
      isDefault: true,
    })
    expect((await repo.getDefaultTarget())!.company.id).toBe(ca.id)

    await repo.updateCompany(us.id, { isDefault: true })
    const companies = await repo.listCompanies()
    expect(companies.filter((c) => c.isDefault).map((c) => c.id)).toEqual([us.id])
  })

  it('the database refuses a second default company or a second default-DB company per site', async () => {
    const { site } = await createCompanyRepository(scoped(tenantA.id)).ensureDefaultTarget(tenantA)

    const secondDefault = db.company.create({
      data: {
        tenantId: tenantA.id,
        siteId: site.id,
        code: 'X',
        displayName: 'X',
        dataSourceKey: 'K',
        isDefault: true,
      },
    })
    await expect(secondDefault).rejects.toSatisfy(isUniqueViolation)

    const secondNullKey = db.company.create({
      data: {
        tenantId: tenantA.id,
        siteId: site.id,
        code: 'Y',
        displayName: 'Y',
        dataSourceKey: null,
      },
    })
    await expect(secondNullKey).rejects.toSatisfy(isUniqueViolation)
  })

  it('isolates tenants, including inside the repository transactions', async () => {
    const repoA = createCompanyRepository(scoped(tenantA.id))
    const repoB = createCompanyRepository(scoped(tenantB.id))
    const a = await repoA.ensureDefaultTarget(tenantA)
    await repoB.ensureDefaultTarget(tenantB)

    expect((await repoB.listCompanies()).map((c) => c.tenantId)).toEqual([tenantB.id])
    expect(await repoB.findCompany(a.company.id)).toBeNull()
    expect(await repoB.findSite(a.site.id)).toBeNull()
    expect(await repoB.updateCompany(a.company.id, { displayName: 'hijacked' })).toBeNull()
    expect(await repoB.updateSite(a.site.id, { cloudAuthEnabled: true })).toBeNull()
    expect((await repoA.findSite(a.site.id))!.cloudAuthEnabled).toBe(false)
    expect((await repoA.updateSite(a.site.id, { cloudAuthEnabled: true }))!.cloudAuthEnabled).toBe(
      true,
    )
    expect((await repoA.findCompany(a.company.id))!.displayName).toBe('Test Company Tenant A')

    // Moving B's default must not touch A's default flag.
    const bSite = (await repoB.listSites())[0]!
    await repoB.createCompany({
      tenantId: tenantB.id,
      siteId: bSite.id,
      code: 'B2',
      displayName: 'B2',
      dataSourceKey: 'B2',
      isDefault: true,
    })
    expect((await repoA.getDefaultTarget())!.company.id).toBe(a.company.id)
  })

  it('the migration backfill is idempotent and only touches pegII-wired tenants', async () => {
    const statements = backfillStatements()
    expect(statements).toHaveLength(2)

    for (let i = 0; i < 2; i++) {
      for (const sql of statements) await db.$executeRawUnsafe(sql)
    }

    const sites = await db.site.findMany({ where: { tenantId: tenantBackfillId } })
    const companies = await db.company.findMany({ where: { tenantId: tenantBackfillId } })
    expect(sites.map((s) => s.name)).toEqual(['Primary'])
    expect(companies).toHaveLength(1)
    expect(companies[0]).toMatchObject({
      code: 'TEST-COMPANY-BACKFILL',
      dataSourceKey: null,
      isDefault: true,
      siteId: sites[0]!.id,
    })
    // A tenant with no pegII wiring is left alone.
    expect(await db.site.count({ where: { tenantId: tenantA.id } })).toBe(0)
  })
})
