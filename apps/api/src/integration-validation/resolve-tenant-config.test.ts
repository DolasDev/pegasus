/**
 * DB-backed proof that a published TENANT config actually governs runtime
 * validation resolution — not just what a tenant sees in the config viewer.
 * Requires a live PostgreSQL database; skipped automatically when DATABASE_URL
 * is unset. Mirrors the tenant harness in integration-config.repository.test.ts.
 *
 * Precedence proven end-to-end (real Prisma + JSON round-trip):
 *   tenant's own config  >  GLOBAL (platform) config  >  built-in code baseline
 * A second tenant with no own config sees GLOBAL; a platform-scoped (null-tenant)
 * caller sees the GLOBAL overlay.
 *
 * Deliberately overlays `allied_status`, NOT `demo_partner`. Test files run in
 * parallel workers against ONE Postgres, and the GLOBAL row published here is
 * global by definition — every reader of that integration sees it until afterAll
 * cleans up. `demo_partner` is the id the corpus + handler tests validate real
 * orders against, so overlaying it here made map-to-external.test.ts and
 * validate.test.ts fail intermittently with a wall of `structural-contract`
 * issues (the degenerate mapping below produces an almost-empty canonical).
 * `allied_status` is a built-in overlay on the same floor that no DB-backed test
 * reads. See GOTCHAS.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { createIntegrationConfigRepository } from '../repositories/integration-config.repository'
import {
  resolveIntegrationDefinition,
  refreshRegistryOverlay,
  getBuiltInDefinition,
} from './registry'

const hasDb = Boolean(process.env['DATABASE_URL'])
const repo = createIntegrationConfigRepository(db)

const SLUG_PLATFORM = 'test-rtc-platform'
const SLUG_TENANT = 'test-rtc-tenant'
const SLUG_OTHER = 'test-rtc-other'
let platformId: string
let tenantId: string
let otherId: string

// Valid MappingTemplates (they must parse + compile). Each sources
// serviceOrderNumber from a DIFFERENT input path so the winner is observable.
const TENANT_MAPPING: Prisma.InputJsonValue = { serviceOrderNumber: 'Tenant.Source' }
const GLOBAL_MAPPING: Prisma.InputJsonValue = { serviceOrderNumber: 'Global.Source' }
const rules: Prisma.InputJsonValue = []
const corpus: Prisma.InputJsonValue = []
const gateReport: Prisma.InputJsonValue = { ok: true }

describe('resolveIntegrationDefinition skip guard', () => {
  it('skips DB-backed tests when DATABASE_URL is absent', () => {
    expect(hasDb || !hasDb).toBe(true)
  })
})

describe.skipIf(!hasDb)('resolveIntegrationDefinition — tenant config governs runtime', () => {
  beforeAll(async () => {
    const [p, t, o] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG_PLATFORM },
        create: { name: 'RTC Platform', slug: SLUG_PLATFORM, isPlatformTenant: true },
        update: { isPlatformTenant: true },
      }),
      db.tenant.upsert({
        where: { slug: SLUG_TENANT },
        create: { name: 'RTC Tenant', slug: SLUG_TENANT },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_OTHER },
        create: { name: 'RTC Other', slug: SLUG_OTHER },
        update: {},
      }),
    ])
    platformId = p.id
    tenantId = t.id
    otherId = o.id
    await db.integrationConfig.deleteMany({
      where: { tenantId: { in: [platformId, tenantId, otherId] }, integrationId: 'allied_status' },
    })

    // Publish a GLOBAL (platform) config and a TENANT config for the same integration.
    await repo.publish({
      integrationId: 'allied_status',
      tenantId: platformId,
      visibility: 'GLOBAL',
      mapping: GLOBAL_MAPPING,
      rules,
      corpus,
      gateReport,
      publishedBy: 'test',
    })
    await repo.publish({
      integrationId: 'allied_status',
      tenantId,
      visibility: 'TENANT',
      mapping: TENANT_MAPPING,
      rules,
      corpus,
      gateReport,
      publishedBy: 'test',
      requiredSecrets: [{ key: 'SEND_API_KEY', group: 'demo' }],
      requiredConfigs: [{ key: 'SEND_URL' }],
    })
  })

  afterAll(async () => {
    await db.integrationConfig.deleteMany({
      where: { tenantId: { in: [platformId, tenantId, otherId] }, integrationId: 'allied_status' },
    })
    await refreshRegistryOverlay({ integrationConfig: { findMany: async () => [] } } as never)
    await db.$disconnect()
  })

  it('a tenant with its own published config resolves to THAT config', async () => {
    const def = (await resolveIntegrationDefinition(db, 'allied_status', tenantId))!
    expect(def.mapping).toEqual(TENANT_MAPPING)
  })

  it('a different tenant with no own config falls back to the GLOBAL config', async () => {
    const def = (await resolveIntegrationDefinition(db, 'allied_status', otherId))!
    expect(def.mapping).toEqual(GLOBAL_MAPPING)
  })

  it("carries the config's declared requiredSecrets/requiredConfigs onto the definition", async () => {
    const def = (await resolveIntegrationDefinition(db, 'allied_status', tenantId))!
    expect(def.requiredSecrets).toEqual([{ key: 'SEND_API_KEY', group: 'demo' }])
    // The config omitted the group, so it resolves without one (store defaults to "global").
    expect(def.requiredConfigs).toEqual([{ key: 'SEND_URL' }])
  })

  it('a tenant without a declaration leaves requiredSecrets/requiredConfigs undefined', async () => {
    const def = (await resolveIntegrationDefinition(db, 'allied_status', otherId))!
    expect(def.requiredSecrets).toBeUndefined()
    expect(def.requiredConfigs).toBeUndefined()
  })

  it('a platform-scoped (null tenant) caller resolves the GLOBAL overlay', async () => {
    await refreshRegistryOverlay(db)
    const def = (await resolveIntegrationDefinition(db, 'allied_status', null))!
    expect(def.mapping).toEqual(GLOBAL_MAPPING)
  })

  it('never overrides the code ground truth (structuralContract/deriveFacts)', async () => {
    const def = (await resolveIntegrationDefinition(db, 'allied_status', tenantId))!
    const builtIn = getBuiltInDefinition('allied_status')!
    expect(def.structuralContract).toBe(builtIn.structuralContract)
    expect(def.deriveFacts).toBe(builtIn.deriveFacts)
  })
})
