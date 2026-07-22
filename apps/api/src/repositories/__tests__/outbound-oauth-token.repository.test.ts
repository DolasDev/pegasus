/**
 * Integration tests for the outbound OAuth token repository — the shared (L2)
 * tier of the outbound token cache (sdk-feedback 0027).
 *
 * The unit tests in services/outbound-oauth cover the tier logic against a fake
 * repo; these pin the parts only a real database can prove: that the composite
 * unique key really upserts instead of duplicating, that the freshness predicate
 * is evaluated in SQL, and that deleting a missing row is a no-op rather than a
 * throw.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '../../db'
import {
  createOutboundOAuthTokenRepository,
  type OutboundTokenKey,
} from '../outbound-oauth-token.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TEST_TENANT_SLUG = 'test-outbound-oauth-repo'
let testTenantId: string
let key: OutboundTokenKey

const TOKEN_URL = 'https://partner.example.com/oauth2/accessrequest'

afterAll(async () => {
  if (hasDb) {
    await db.outboundOAuthToken
      .deleteMany({ where: { tenantId: testTenantId } })
      .catch(() => undefined)
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('OutboundOAuthTokenRepository (integration)', () => {
  const repo = createOutboundOAuthTokenRepository(db)

  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Outbound OAuth Repo)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    testTenantId = tenant.id
    key = { tenantId: testTenantId, integrationId: 'sirva_ade_shipment', tokenUrl: TOKEN_URL }
  })

  beforeEach(async () => {
    await db.outboundOAuthToken.deleteMany({ where: { tenantId: testTenantId } })
  })

  it('returns null when nothing is cached', async () => {
    expect(await repo.findFresh(key, new Date())).toBeNull()
  })

  it('round-trips a token and finds it while it is still fresh', async () => {
    const expiresAt = new Date(Date.now() + 600_000)
    await repo.upsert(key, 'cipher-1', expiresAt)
    const row = await repo.findFresh(key, new Date())
    expect(row?.tokenCiphertext).toBe('cipher-1')
    expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime())
  })

  it('hides a token that expires before the skew horizon', async () => {
    // Expires in 30s; the caller asks for one valid at now+60s (the skew).
    await repo.upsert(key, 'cipher-soon', new Date(Date.now() + 30_000))
    expect(await repo.findFresh(key, new Date(Date.now() + 60_000))).toBeNull()
  })

  it('upsert REPLACES rather than duplicating — the unique key holds', async () => {
    await repo.upsert(key, 'cipher-old', new Date(Date.now() + 600_000))
    await repo.upsert(key, 'cipher-new', new Date(Date.now() + 900_000))
    const rows = await db.outboundOAuthToken.findMany({ where: { tenantId: testTenantId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tokenCiphertext).toBe('cipher-new')
  })

  it('scopes by tokenUrl so test and prod endpoints never share a token', async () => {
    await repo.upsert(key, 'cipher-prod', new Date(Date.now() + 600_000))
    const testEndpoint = { ...key, tokenUrl: 'https://test.example.com/oauth2/accessrequest' }
    expect(await repo.findFresh(testEndpoint, new Date())).toBeNull()
    await repo.upsert(testEndpoint, 'cipher-test', new Date(Date.now() + 600_000))
    expect((await repo.findFresh(key, new Date()))?.tokenCiphertext).toBe('cipher-prod')
    expect((await repo.findFresh(testEndpoint, new Date()))?.tokenCiphertext).toBe('cipher-test')
  })

  it('deleteKey removes the row and is a no-op when already gone', async () => {
    await repo.upsert(key, 'cipher-1', new Date(Date.now() + 600_000))
    expect(await repo.deleteKey(key)).toBe(1)
    expect(await repo.findFresh(key, new Date())).toBeNull()
    // A concurrent 401 on another container must not blow up here.
    expect(await repo.deleteKey(key)).toBe(0)
  })
})
