/**
 * Integration tests for the IntegrationConfig repository. Require a live
 * PostgreSQL database; skipped automatically when DATABASE_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { createIntegrationConfigRepository } from './integration-config.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])
const repo = createIntegrationConfigRepository(db)

const SLUG_P = 'test-icfg-platform'
const SLUG_T = 'test-icfg-tenant'
let platformId: string
let tenantId: string
const INTEG = `itest-${Date.now()}`
const INTEG_GLOBAL = `${INTEG}-global`

const mapping: Prisma.InputJsonValue = { status: 'src' }
const rules: Prisma.InputJsonValue = []
const corpus: Prisma.InputJsonValue = []
const gateReport: Prisma.InputJsonValue = { ok: true }

describe('IntegrationConfig repo skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    expect(hasDb || !hasDb).toBe(true)
  })
})

describe.skipIf(!hasDb)('createIntegrationConfigRepository (integration)', () => {
  beforeAll(async () => {
    const [p, t] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG_P },
        create: { name: 'ICfg Platform', slug: SLUG_P },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_T },
        create: { name: 'ICfg Tenant', slug: SLUG_T },
        update: {},
      }),
    ])
    platformId = p.id
    tenantId = t.id
    await db.integrationConfig.deleteMany({ where: { tenantId: { in: [platformId, tenantId] } } })
  })

  afterAll(async () => {
    await db.integrationConfig.deleteMany({ where: { tenantId: { in: [platformId, tenantId] } } })
    await db.$disconnect()
  })

  it('publish creates v1, and a second publish supersedes it as v2', async () => {
    const v1 = await repo.publish({
      integrationId: INTEG,
      tenantId,
      visibility: 'TENANT',
      mapping,
      rules,
      corpus,
      gateReport,
      publishedBy: 'u1',
    })
    expect(v1.version).toBe(1)
    expect(v1.status).toBe('PUBLISHED')

    const v2 = await repo.publish({
      integrationId: INTEG,
      tenantId,
      visibility: 'TENANT',
      mapping,
      rules,
      corpus,
      gateReport,
      publishedBy: 'u1',
    })
    expect(v2.version).toBe(2)

    const reloadedV1 = await repo.findVersion(INTEG, tenantId, 1)
    expect(reloadedV1?.status).toBe('SUPERSEDED')
  })

  it('findActiveForScope returns the latest PUBLISHED tenant row', async () => {
    const active = await repo.findActiveForScope(INTEG, tenantId)
    expect(active?.version).toBe(2)
    expect(active?.status).toBe('PUBLISHED')
  })

  it('findActiveForScope falls back to GLOBAL when the tenant has no own config', async () => {
    await repo.publish({
      integrationId: INTEG_GLOBAL,
      tenantId: platformId,
      visibility: 'GLOBAL',
      mapping,
      rules,
      corpus,
      gateReport,
      publishedBy: 'platform',
    })
    const active = await repo.findActiveForScope(INTEG_GLOBAL, tenantId)
    expect(active?.visibility).toBe('GLOBAL')
  })

  it('listVersions returns history newest-first', async () => {
    const versions = await repo.listVersions(INTEG, tenantId)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
  })

  it('listActiveGlobal returns only PUBLISHED GLOBAL rows', async () => {
    const globals = await repo.listActiveGlobal()
    expect(globals.every((g) => g.visibility === 'GLOBAL' && g.status === 'PUBLISHED')).toBe(true)
  })
})
