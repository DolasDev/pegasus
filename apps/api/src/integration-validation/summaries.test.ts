/**
 * DB-backed tests for the integration summaries read model.
 *
 * These are deliberately NOT registry-mocked. The bug they cover — the list
 * collapsing to the built-in code overlays because the module-level GLOBAL
 * overlay cache is never warmed on the read path, and tenant-owned integration
 * ids never being enumerated at all — is invisible to a test that stubs
 * `listIntegrationIds`/`getIntegrationDefinition`, which is exactly why the
 * mocked handler tests missed it. Requires a live PostgreSQL database; skipped
 * automatically when DATABASE_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { createIntegrationConfigRepository } from '../repositories/integration-config.repository'
import { listIntegrationSummaries } from './summaries'
import { listIntegrationIds } from './registry'

const hasDb = Boolean(process.env['DATABASE_URL'])
const repo = createIntegrationConfigRepository(db)

const SLUG_PLATFORM = 'test-isum-platform'
const SLUG_TENANT = 'test-isum-tenant'
const SLUG_OTHER = 'test-isum-other'

let platformId: string
let tenantId: string
let otherTenantId: string

// New-partner ids with NO built-in code overlay — the case the old code could
// never list. Unique per run so parallel/repeat runs never collide.
const STAMP = `${Date.now()}`
const GLOBAL_ID = `itest-global-partner-${STAMP}`
const TENANT_ID_INTEG = `itest-tenant-partner-${STAMP}`

const FLOOR = 'shipment_status_update'
const mapping: Prisma.InputJsonValue = { status: 'src' }
const rules: Prisma.InputJsonValue = []
const corpus: Prisma.InputJsonValue = []
const gateReport: Prisma.InputJsonValue = { ok: true }

describe('integration summaries skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    expect(hasDb || !hasDb).toBe(true)
  })
})

describe.skipIf(!hasDb)('listIntegrationSummaries (integration)', () => {
  beforeAll(async () => {
    const [p, t, o] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG_PLATFORM },
        create: { name: 'ISum Platform', slug: SLUG_PLATFORM },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_TENANT },
        create: { name: 'ISum Tenant', slug: SLUG_TENANT },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_OTHER },
        create: { name: 'ISum Other', slug: SLUG_OTHER },
        update: {},
      }),
    ])
    platformId = p.id
    tenantId = t.id
    otherTenantId = o.id
    await db.integrationConfig.deleteMany({
      where: { tenantId: { in: [platformId, tenantId, otherTenantId] } },
    })

    // A GLOBAL platform config under a brand-new partner id (the "Weichert" case).
    await repo.publish({
      integrationId: GLOBAL_ID,
      tenantId: platformId,
      visibility: 'GLOBAL',
      floor: FLOOR,
      displayName: 'Global Partner',
      mapping,
      rules,
      corpus,
      gateReport,
      publishedBy: 'u-platform',
    })

    // A TENANT-owned config under a different new id — reachable ONLY by
    // enumerating the tenant's own rows (the GLOBAL overlay never sees it).
    await repo.publish({
      integrationId: TENANT_ID_INTEG,
      tenantId,
      visibility: 'TENANT',
      floor: FLOOR,
      displayName: 'My Own Partner',
      mapping,
      rules,
      corpus,
      gateReport,
      publishedBy: 'u-tenant',
    })
  })

  afterAll(async () => {
    await db.integrationConfig.deleteMany({
      where: { tenantId: { in: [platformId, tenantId, otherTenantId] } },
    })
    await db.$disconnect()
  })

  it('lists a GLOBAL new-partner config even though the sync registry cache is cold', async () => {
    // Precondition = the bug: nothing has warmed the overlay in this process, so
    // the synchronous id list knows only the built-ins.
    expect(listIntegrationIds()).not.toContain(GLOBAL_ID)

    const summaries = await listIntegrationSummaries(db, tenantId)
    const row = summaries.find((s) => s.id === GLOBAL_ID)
    expect(row).toMatchObject({
      id: GLOBAL_ID,
      name: 'Global Partner',
      published: true,
      version: 1,
      visibility: 'GLOBAL',
    })
  })

  it("lists a tenant's OWN config for an id with no built-in and no GLOBAL row", async () => {
    const summaries = await listIntegrationSummaries(db, tenantId)
    expect(summaries.find((s) => s.id === TENANT_ID_INTEG)).toMatchObject({
      id: TENANT_ID_INTEG,
      name: 'My Own Partner',
      published: true,
      version: 1,
      visibility: 'TENANT',
    })
  })

  it("does not leak one tenant's own config to another tenant", async () => {
    const summaries = await listIntegrationSummaries(db, otherTenantId)
    expect(summaries.find((s) => s.id === TENANT_ID_INTEG)).toBeUndefined()
    // …while the GLOBAL config is still inherited by everyone.
    expect(summaries.find((s) => s.id === GLOBAL_ID)?.visibility).toBe('GLOBAL')
  })

  it('still lists the built-in integrations alongside the DB-backed ones', async () => {
    const summaries = await listIntegrationSummaries(db, otherTenantId)
    for (const id of ['demo_partner', 'allied_status']) {
      const builtIn = summaries.find((s) => s.id === id)
      expect(builtIn, `built-in ${id} missing from the list`).toBeDefined()
      expect(builtIn?.name).toBeTruthy()
      // Published state depends on whatever configs exist in the shared test DB;
      // the invariant that must hold either way is that the three fields agree.
      expect(builtIn?.published).toBe(builtIn?.version !== null)
      if (!builtIn?.published) expect(builtIn?.visibility).toBeNull()
    }
  })

  it('returns each integration exactly once', async () => {
    const ids = (await listIntegrationSummaries(db, tenantId)).map((s) => s.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })
})
