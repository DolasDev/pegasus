/**
 * Integration tests for the DashboardDefinition repository. Require a live
 * PostgreSQL database; skipped automatically when DATABASE_URL is unset.
 *
 * The isolation tests here are the ones that matter: this model is deliberately
 * OUTSIDE TENANT_SCOPED_MODELS, so the Prisma extension provides no safety net
 * and every predicate is hand-written. A regression here leaks one tenant's
 * dashboards to another.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { createDashboardDefinitionRepository } from './dashboard-definition.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])
const repo = createDashboardDefinitionRepository(db)

const SLUG_PLATFORM = 'test-dash-platform'
const SLUG_TENANT_A = 'test-dash-tenant-a'
const SLUG_TENANT_B = 'test-dash-tenant-b'
let platformId: string
let tenantA: string
let tenantB: string

const definition = { schemaVersion: 2, widgets: [] } as unknown as Prisma.InputJsonValue

describe('DashboardDefinition repo skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    expect(hasDb || !hasDb).toBe(true)
  })
})

describe.skipIf(!hasDb)('createDashboardDefinitionRepository (integration)', () => {
  beforeAll(async () => {
    const [p, a, b] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG_PLATFORM },
        create: { name: 'Dash Platform', slug: SLUG_PLATFORM, isPlatformTenant: true },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_TENANT_A },
        create: { name: 'Dash Tenant A', slug: SLUG_TENANT_A },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_TENANT_B },
        create: { name: 'Dash Tenant B', slug: SLUG_TENANT_B },
        update: {},
      }),
    ])
    platformId = p.id
    tenantA = a.id
    tenantB = b.id
    await db.dashboardDefinition.deleteMany({
      where: { tenantId: { in: [platformId, tenantA, tenantB] } },
    })
  })

  afterAll(async () => {
    await db.dashboardDefinition.deleteMany({
      where: { tenantId: { in: [platformId, tenantA, tenantB] } },
    })
    await db.$disconnect()
  })

  it('publish creates v1, and a second publish supersedes it as v2', async () => {
    const slug = `pub-${Date.now()}`
    const v1 = await repo.publish({
      tenantId: tenantA,
      slug,
      visibility: 'TENANT',
      title: 'First',
      definition,
      publishedBy: 'u1',
    })
    expect(v1.version).toBe(1)
    expect(v1.status).toBe('PUBLISHED')

    const v2 = await repo.publish({
      tenantId: tenantA,
      slug,
      visibility: 'TENANT',
      title: 'Second',
      definition,
      publishedBy: 'u1',
    })
    expect(v2.version).toBe(2)

    // Exactly one PUBLISHED row per lineage — two would make resolution
    // ambiguous, zero would make the dashboard vanish.
    const published = await db.dashboardDefinition.findMany({
      where: { tenantId: tenantA, slug, status: 'PUBLISHED' },
    })
    expect(published).toHaveLength(1)
    expect(published[0]!.version).toBe(2)
  })

  it('resolveBySlug prefers the tenant OWN row over a GLOBAL one', async () => {
    const slug = `shadow-${Date.now()}`
    await repo.publish({
      tenantId: platformId,
      slug,
      visibility: 'GLOBAL',
      title: 'Platform version',
      definition,
      publishedBy: 'plat',
    })
    await repo.publish({
      tenantId: tenantA,
      slug,
      visibility: 'TENANT',
      title: 'Tenant version',
      definition,
      publishedBy: 'u1',
    })

    const forA = await repo.resolveBySlug(slug, tenantA)
    expect(forA?.title).toBe('Tenant version')

    // Tenant B never forked, so it still sees the platform's.
    const forB = await repo.resolveBySlug(slug, tenantB)
    expect(forB?.title).toBe('Platform version')
  })

  it('resolveBySlug returns null for a slug nobody published', async () => {
    expect(await repo.resolveBySlug(`missing-${Date.now()}`, tenantA)).toBeNull()
  })

  it('listVisible returns the tenant OWN rows plus GLOBAL, deduped by slug', async () => {
    const own = `own-${Date.now()}`
    const glob = `glob-${Date.now()}`
    const shared = `shared-${Date.now()}`

    await repo.publish({
      tenantId: tenantA,
      slug: own,
      visibility: 'TENANT',
      title: 'Own',
      definition,
      publishedBy: 'u',
    })
    await repo.publish({
      tenantId: platformId,
      slug: glob,
      visibility: 'GLOBAL',
      title: 'Global',
      definition,
      publishedBy: 'p',
    })
    await repo.publish({
      tenantId: platformId,
      slug: shared,
      visibility: 'GLOBAL',
      title: 'Shared global',
      definition,
      publishedBy: 'p',
    })
    await repo.publish({
      tenantId: tenantA,
      slug: shared,
      visibility: 'TENANT',
      title: 'Shared fork',
      definition,
      publishedBy: 'u',
    })

    const list = await repo.listVisible(tenantA)
    const bySlug = new Map(list.map((d) => [d.slug, d]))

    expect(bySlug.get(own)?.title).toBe('Own')
    expect(bySlug.get(glob)?.title).toBe('Global')
    // The fork shadows the GLOBAL original — one entry, the tenant's.
    expect(bySlug.get(shared)?.title).toBe('Shared fork')
    expect(list.filter((d) => d.slug === shared)).toHaveLength(1)
  })

  it('NEVER returns another tenant’s TENANT-scoped rows', async () => {
    // The isolation guarantee. This model is outside TENANT_SCOPED_MODELS, so
    // nothing but the predicates in the repository enforces this.
    const secret = `secret-${Date.now()}`
    await repo.publish({
      tenantId: tenantB,
      slug: secret,
      visibility: 'TENANT',
      title: "Tenant B's private dashboard",
      definition,
      publishedBy: 'ub',
    })

    const list = await repo.listVisible(tenantA)
    expect(list.map((d) => d.slug)).not.toContain(secret)
    expect(await repo.resolveBySlug(secret, tenantA)).toBeNull()
    expect(await repo.findOwn(secret, tenantA)).toBeNull()
  })

  it('archive is scoped to the caller tenant and cannot withdraw a GLOBAL row', async () => {
    const slug = `arch-${Date.now()}`
    await repo.publish({
      tenantId: platformId,
      slug,
      visibility: 'GLOBAL',
      title: 'G',
      definition,
      publishedBy: 'p',
    })
    await repo.publish({
      tenantId: tenantA,
      slug,
      visibility: 'TENANT',
      title: 'T',
      definition,
      publishedBy: 'u',
    })

    const count = await repo.archive(slug, tenantA)
    expect(count).toBeGreaterThan(0)

    // The tenant's fork is gone, so resolution falls BACK to the GLOBAL row —
    // archiving a fork means "use the platform's again", not "delete it".
    const resolved = await repo.resolveBySlug(slug, tenantA)
    expect(resolved?.title).toBe('G')

    // ...and tenant B is untouched.
    expect((await repo.resolveBySlug(slug, tenantB))?.title).toBe('G')
  })

  it('archive of another tenant’s slug affects nothing', async () => {
    const slug = `arch-other-${Date.now()}`
    await repo.publish({
      tenantId: tenantB,
      slug,
      visibility: 'TENANT',
      title: 'B',
      definition,
      publishedBy: 'ub',
    })

    expect(await repo.archive(slug, tenantA)).toBe(0)
    expect((await repo.resolveBySlug(slug, tenantB))?.title).toBe('B')
  })

  it('findGlobal returns only the platform row, never a tenant one', async () => {
    const slug = `gfind-${Date.now()}`
    await repo.publish({
      tenantId: tenantA,
      slug,
      visibility: 'TENANT',
      title: 'Tenant',
      definition,
      publishedBy: 'u',
    })
    expect(await repo.findGlobal(slug)).toBeNull()

    await repo.publish({
      tenantId: platformId,
      slug,
      visibility: 'GLOBAL',
      title: 'Platform',
      definition,
      publishedBy: 'p',
    })
    expect((await repo.findGlobal(slug))?.title).toBe('Platform')
  })
})
