/**
 * Integration tests for the fetch read-through cache repository — the shared
 * tier behind POST /integrations/:id/fetch/:operation (vanline-source-binding
 * C4/C5).
 *
 * The handler tests cover the tier LOGIC against a fake repo; these pin the
 * parts only a real database can prove: that the four-column unique key really
 * upserts instead of duplicating, that the freshness predicate is evaluated in
 * SQL against `fetchedAt` (not `updatedAt`), and that two tenants asking the
 * identical question do not share a row.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '../../db'
import {
  createIntegrationFetchCacheRepository,
  type FetchCacheKey,
} from '../integration-fetch-cache.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TEST_TENANT_SLUG = 'test-integration-fetch-cache-repo'
const OTHER_TENANT_SLUG = 'test-integration-fetch-cache-other'
let testTenantId: string
let otherTenantId: string
let key: FetchCacheKey

const HASH = 'a'.repeat(64)

/** A stored result, with only the fields a caller usually varies spelled out. */
function result(
  overrides: Partial<
    Parameters<ReturnType<typeof createIntegrationFetchCacheRepository>['upsert']>[1]
  > = {},
) {
  return {
    records: [{ orderNumber: '123' }] as unknown[],
    recordCount: 1,
    pages: 1,
    attempts: 1,
    status: 200,
    truncated: false,
    fetchedAt: new Date(),
    ...overrides,
  }
}

afterAll(async () => {
  if (hasDb) {
    await db.integrationFetchCache
      .deleteMany({ where: { tenantId: { in: [testTenantId, otherTenantId] } } })
      .catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('IntegrationFetchCacheRepository (integration)', () => {
  const repo = createIntegrationFetchCacheRepository(db)

  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Fetch Cache Repo)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    testTenantId = tenant.id
    const other = await db.tenant.upsert({
      where: { slug: OTHER_TENANT_SLUG },
      create: { name: 'Other Tenant (Fetch Cache Repo)', slug: OTHER_TENANT_SLUG },
      update: {},
    })
    otherTenantId = other.id
    key = {
      tenantId: testTenantId,
      integrationId: 'atlas_settlement',
      operation: 'settlements',
      requestHash: HASH,
    }
  })

  beforeEach(async () => {
    await db.integrationFetchCache.deleteMany({
      where: { tenantId: { in: [testTenantId, otherTenantId] } },
    })
  })

  it('returns null when nothing is cached', async () => {
    expect(await repo.find(key)).toBeNull()
  })

  it('round-trips a stored result with all of its provenance', async () => {
    const fetchedAt = new Date(Date.now() - 5_000)
    await repo.upsert(key, result({ fetchedAt, pages: 3, attempts: 4, truncated: true }))
    const row = await repo.find(key)
    expect(row).not.toBeNull()
    expect(row!.records).toEqual([{ orderNumber: '123' }])
    expect(row!.recordCount).toBe(1)
    expect(row!.pages).toBe(3)
    expect(row!.attempts).toBe(4)
    expect(row!.status).toBe(200)
    // A cached truncated read must stay recognizable as incomplete — otherwise
    // a partial record set silently becomes "all there is" for a whole TTL.
    expect(row!.truncated).toBe(true)
    expect(row!.fetchedAt.getTime()).toBe(fetchedAt.getTime())
  })

  it('stores an empty record set — "nothing settled" is a real answer, not a miss', async () => {
    await repo.upsert(key, result({ records: [], recordCount: 0 }))
    const row = await repo.find(key)
    expect(row).not.toBeNull()
    expect(row!.records).toEqual([])
    expect(row!.recordCount).toBe(0)
  })

  it('upsert REPLACES rather than duplicating — the four-column unique key holds', async () => {
    await repo.upsert(key, result({ records: [{ v: 'old' }] }))
    await repo.upsert(key, result({ records: [{ v: 'new' }] }))
    const rows = await db.integrationFetchCache.findMany({ where: { tenantId: testTenantId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.records).toEqual([{ v: 'new' }])
  })

  it('keys on requestHash — a changed descriptor gets its own row, never the old one', async () => {
    await repo.upsert(key, result({ records: [{ v: 'under-hash-a' }] }))
    const otherHash = { ...key, requestHash: 'b'.repeat(64) }
    expect(await repo.find(otherHash)).toBeNull()
    await repo.upsert(otherHash, result({ records: [{ v: 'under-hash-b' }] }))
    expect((await repo.find(key))!.records).toEqual([{ v: 'under-hash-a' }])
    expect((await repo.find(otherHash))!.records).toEqual([{ v: 'under-hash-b' }])
  })

  it('keys on operation — two capabilities on one integration do not collide', async () => {
    await repo.upsert(key, result({ records: [{ v: 'settlements' }] }))
    const documents = { ...key, operation: 'documents' }
    expect(await repo.find(documents)).toBeNull()
  })

  it('never serves one tenant the row another tenant cached', async () => {
    // The identical question, asked by two tenants with their own credentials.
    await repo.upsert(key, result({ records: [{ v: 'ours' }] }))
    const theirs = { ...key, tenantId: otherTenantId }
    expect(await repo.find(theirs)).toBeNull()
    await repo.upsert(theirs, result({ records: [{ v: 'theirs' }] }))
    expect((await repo.find(key))!.records).toEqual([{ v: 'ours' }])
    expect((await repo.find(theirs))!.records).toEqual([{ v: 'theirs' }])
  })

  it('returns a STALE row rather than hiding it — the handler judges age', async () => {
    // Freshness is deliberately not filtered here: a filtered read collapses "no
    // row" and "stale row" into one null, and the prior fetchedAt is what makes a
    // concurrent duplicate fetch detectable without single-flight (C5).
    const fetchedAt = new Date(Date.now() - 86_400_000)
    await repo.upsert(key, result({ fetchedAt }))
    const row = await repo.find(key)
    expect(row).not.toBeNull()
    expect(row!.fetchedAt.getTime()).toBe(fetchedAt.getTime())
  })

  it('persists fetchedAt independently of updatedAt', async () => {
    // The whole C4 point: `updatedAt` says when WE wrote a row, `fetchedAt` says
    // when it was true at the partner. A cache measuring the former would call a
    // two-minute-old answer fresh because it had just been written.
    await repo.upsert(key, result({ fetchedAt: new Date(Date.now() - 120_000) }))
    const stored = await db.integrationFetchCache.findFirstOrThrow({
      where: { tenantId: testTenantId },
    })
    expect(stored.updatedAt.getTime()).toBeGreaterThan(stored.fetchedAt.getTime())
  })
})
