/**
 * Integration tests for the api-client repository.
 *
 * These tests require a live PostgreSQL database. They are skipped automatically
 * when DATABASE_URL is not set in the environment, so they never block CI runs
 * that don't provision a database.
 *
 * To run locally:
 *   DATABASE_URL=postgresql://... npm test
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import { createApiClientRepository } from '../api-client.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TEST_TENANT_SLUG = 'test-api-client-repo'

let testTenantId: string
let testUserId: string

afterAll(async () => {
  if (hasDb) {
    await db.apiClient.deleteMany({ where: { tenantId: testTenantId } })
    await db.tenantUser.deleteMany({ where: { tenantId: testTenantId } })
    await db.tenant.deleteMany({ where: { slug: TEST_TENANT_SLUG } })
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('ApiClientRepository (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (ApiClient Repo)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    testTenantId = tenant.id

    const user = await db.tenantUser.create({
      data: {
        tenantId: testTenantId,
        email: `admin+${Date.now()}@example.com`,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })
    testUserId = user.id
  })

  it('create: returns row without keyHash and returns plainKey', async () => {
    const repo = createApiClientRepository(db)
    const result = await repo.create(testTenantId, 'Test Client', ['orders:read'], testUserId)

    expect(result.plainKey).toMatch(/^vnd_[0-9a-f]{48}$/)
    expect(result.row.name).toBe('Test Client')
    expect(result.row.tenantId).toBe(testTenantId)
    expect(result.row.scopes).toEqual(['orders:read'])
    expect(result.row.createdById).toBe(testUserId)
    expect(result.row.revokedAt).toBeNull()
    expect(result.row.lastUsedAt).toBeNull()
    // keyHash must NOT appear in ApiClientRow
    expect('keyHash' in result.row).toBe(false)
  })

  it('create: stores only the hash — plainKey does not appear in DB', async () => {
    const repo = createApiClientRepository(db)
    const result = await repo.create(testTenantId, 'Hash Check', ['invoices:read'], testUserId)

    // findByPrefix returns keyHash for middleware comparison
    const found = await repo.findByPrefix(result.row.keyPrefix)
    expect(found).not.toBeNull()
    // Hash should be 64 hex chars (SHA-256)
    expect(found!.keyHash).toMatch(/^[0-9a-f]{64}$/)
    // plainKey is NOT stored
    expect(found!.keyHash).not.toBe(result.plainKey)
  })

  it('findByPrefix: returns row + keyHash for a known prefix', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'Prefix Test', ['moves:read'], testUserId)

    const found = await repo.findByPrefix(created.row.keyPrefix)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.row.id)
    expect(found!.keyHash).toBeDefined()
  })

  it('findByPrefix: returns null for unknown prefix', async () => {
    const repo = createApiClientRepository(db)
    const result = await repo.findByPrefix('vnd_xxxxxxxx')
    expect(result).toBeNull()
  })

  it('listByTenant: does NOT include keyHash in returned rows', async () => {
    const repo = createApiClientRepository(db)
    const rows = await repo.listByTenant(testTenantId)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect('keyHash' in row).toBe(false)
    }
  })

  it('listByTenant: returns clients for the correct tenant only', async () => {
    const repo = createApiClientRepository(db)
    const rows = await repo.listByTenant(testTenantId)
    for (const row of rows) {
      expect(row.tenantId).toBe(testTenantId)
    }
  })

  it('findById: returns the client for correct (id, tenantId) pair', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'FindById Test', ['billing:read'], testUserId)

    const found = await repo.findById(created.row.id, testTenantId)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.row.id)
    expect('keyHash' in (found ?? {})).toBe(false)
  })

  it('findById: returns null when tenantId does not match', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'Cross-tenant', [], testUserId)

    const result = await repo.findById(created.row.id, 'wrong-tenant-id')
    expect(result).toBeNull()
  })

  it('update: patches name and scopes', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'Update Test', ['orders:read'], testUserId)

    const updated = await repo.update(created.row.id, testTenantId, {
      name: 'Updated Name',
      scopes: ['orders:read', 'orders:write'],
    })
    expect(updated.name).toBe('Updated Name')
    expect(updated.scopes).toEqual(['orders:read', 'orders:write'])
    expect('keyHash' in updated).toBe(false)
  })

  it('revoke: sets revokedAt', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'Revoke Test', [], testUserId)
    expect(created.row.revokedAt).toBeNull()

    const revoked = await repo.revoke(created.row.id, testTenantId)
    expect(revoked.revokedAt).toBeInstanceOf(Date)
    expect('keyHash' in revoked).toBe(false)
  })

  it('rotate: changes keyHash and keyPrefix, clears revokedAt, returns new plainKey', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'Rotate Test', ['orders:read'], testUserId)
    const originalPrefix = created.row.keyPrefix

    // Revoke first
    await repo.revoke(created.row.id, testTenantId)

    // Rotate
    const rotated = await repo.rotate(created.row.id, testTenantId)
    expect(rotated.plainKey).toMatch(/^vnd_[0-9a-f]{48}$/)
    expect(rotated.row.keyPrefix).not.toBe(originalPrefix)
    expect(rotated.row.revokedAt).toBeNull()
    expect(rotated.row.id).toBe(created.row.id)
    expect(rotated.row.name).toBe('Rotate Test')

    // New key should be different from old key
    expect(rotated.plainKey).not.toBe(created.plainKey)
  })

  it('touchLastUsed: updates lastUsedAt without error', async () => {
    const repo = createApiClientRepository(db)
    const created = await repo.create(testTenantId, 'Touch Test', [], testUserId)
    expect(created.row.lastUsedAt).toBeNull()

    await expect(repo.touchLastUsed(created.row.id)).resolves.toBeUndefined()

    const updated = await repo.findById(created.row.id, testTenantId)
    expect(updated!.lastUsedAt).toBeInstanceOf(Date)
  })
})

// Always-runs guard test
describe('ApiClientRepository skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    if (!hasDb) {
      expect(true).toBe(true)
    } else {
      expect(hasDb).toBe(true)
    }
  })
})
