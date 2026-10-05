// ---------------------------------------------------------------------------
// TenantTemporalNamespace repository — integration tests against a live
// Postgres (skipped without DATABASE_URL).
//
// KMS is mocked with a reversible base64 codec, as in
// tenant-broker-credential.test.ts — the unit under test is the storage
// logic, not AWS KMS.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { db } from '../../db'
import { createTenantTemporalNamespaceRepository } from '../tenant-temporal-namespace.repository'

vi.mock('../../lib/runtime-token-crypto', () => ({
  encryptRuntimeToken: vi.fn((plaintext: string) =>
    Promise.resolve(Buffer.from(plaintext, 'utf8').toString('base64')),
  ),
  decryptRuntimeToken: vi.fn((ciphertext: string) =>
    Promise.resolve(Buffer.from(ciphertext, 'base64').toString('utf8')),
  ),
}))

const hasDb = Boolean(process.env['DATABASE_URL'])

const TEST_TENANT_SLUG = 'test-tenant-temporal-namespace'
const OTHER_TENANT_SLUG = 'test-tenant-temporal-namespace-other'
const NAMESPACE = 'pg-test-000000000001.chgel'
const GRPC = 'pg-test-000000000001.chgel.tmprl.cloud:7233'
let tenantId: string
let otherTenantId: string

describe.skipIf(!hasDb)('TenantTemporalNamespace repository (integration)', () => {
  const repo = createTenantTemporalNamespaceRepository(db)

  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Temporal Namespace)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    tenantId = tenant.id
    const other = await db.tenant.upsert({
      where: { slug: OTHER_TENANT_SLUG },
      create: { name: 'Test Tenant (Temporal Namespace, other)', slug: OTHER_TENANT_SLUG },
      update: {},
    })
    otherTenantId = other.id
  })

  beforeEach(async () => {
    await db.tenantTemporalNamespace.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    })
  })

  afterAll(async () => {
    // FK is RESTRICT — namespace rows first, then the tenants.
    await db.tenantTemporalNamespace.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    })
    await db.tenant.deleteMany({ where: { slug: { in: [TEST_TENANT_SLUG, OTHER_TENANT_SLUG] } } })
    await db.$disconnect()
  })

  it('findByTenant returns null for a tenant with no row', async () => {
    expect(await repo.findByTenant(tenantId)).toBeNull()
  })

  it('createProvisioning creates a PROVISIONING row with no key material', async () => {
    const result = await repo.createProvisioning({
      tenantId,
      namespace: NAMESPACE,
      grpcAddress: GRPC,
    })
    expect(result.outcome).toBe('created')
    expect(result.row).toMatchObject({
      tenantId,
      namespace: NAMESPACE,
      grpcAddress: GRPC,
      status: 'PROVISIONING',
      step: null,
      apiKeyId: null,
      lastError: null,
    })
    // The default projection never carries the ciphertext.
    expect(result.row).not.toHaveProperty('apiKeyCiphertext')
    expect(await repo.findByTenant(tenantId)).toEqual(result.row)
  })

  it('createProvisioning returns the existing row on a unique-tenant race', async () => {
    const first = await repo.createProvisioning({
      tenantId,
      namespace: NAMESPACE,
      grpcAddress: GRPC,
    })
    const second = await repo.createProvisioning({
      tenantId,
      namespace: NAMESPACE,
      grpcAddress: GRPC,
    })
    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('exists')
    expect(second.row.id).toBe(first.row.id)
    expect(await db.tenantTemporalNamespace.count({ where: { tenantId } })).toBe(1)
  })

  it('createProvisioning does not swallow a namespace collision with another tenant', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await expect(
      repo.createProvisioning({ tenantId: otherTenantId, namespace: NAMESPACE, grpcAddress: GRPC }),
    ).rejects.toThrow()
  })

  it('markStep / markReady / markFailed move the row through its states', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })

    await repo.markStep(tenantId, 'namespace_created')
    expect((await repo.findByTenant(tenantId))!.step).toBe('namespace_created')

    await repo.markStep(tenantId, 'service_account_created', { cloudServiceAccountId: 'sa-1' })
    let row = await repo.findByTenant(tenantId)
    expect(row!.step).toBe('service_account_created')
    expect(row!.cloudServiceAccountId).toBe('sa-1')

    await repo.markFailed(tenantId, 'boom')
    row = await repo.findByTenant(tenantId)
    expect(row!.status).toBe('FAILED')
    expect(row!.lastError).toBe('boom')
    // A failure keeps the step, so a re-invoke resumes after it.
    expect(row!.step).toBe('service_account_created')

    await repo.markReady(tenantId)
    row = await repo.findByTenant(tenantId)
    expect(row!.status).toBe('READY')
    expect(row!.lastError).toBeNull()
  })

  it('transition is a compare-and-set on status', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.markFailed(tenantId, 'boom')

    expect(await repo.transition(tenantId, ['READY'], 'DEPROVISIONING')).toBe(false)
    expect((await repo.findByTenant(tenantId))!.status).toBe('FAILED')

    expect(await repo.transition(tenantId, ['FAILED'], 'PROVISIONING')).toBe(true)
    const row = await repo.findByTenant(tenantId)
    expect(row!.status).toBe('PROVISIONING')
    expect(row!.lastError).toBeNull()

    expect(await repo.transition(otherTenantId, ['PROVISIONING'], 'READY')).toBe(false)
  })

  it('storeKey encrypts the token, and getDecryptedKey round-trips it', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    const expiresAt = new Date('2027-10-05T00:00:00.000Z')

    await repo.storeKey(tenantId, { apiKeyId: 'key-1', token: 'secret-token-1', expiresAt })

    const raw = await db.tenantTemporalNamespace.findUnique({ where: { tenantId } })
    expect(raw!.apiKeyCiphertext).not.toBe('secret-token-1')
    expect(raw!.apiKeyId).toBe('key-1')
    expect(raw!.apiKeyExpiresAt).toEqual(expiresAt)

    expect(await repo.getDecryptedKey(tenantId)).toEqual({
      namespace: NAMESPACE,
      grpcAddress: GRPC,
      apiKeyId: 'key-1',
      apiKey: 'secret-token-1',
    })
    expect(await repo.findByTenant(tenantId)).not.toHaveProperty('apiKeyCiphertext')
  })

  it('getDecryptedKey is null with no row or no stored key, and never crosses tenants', async () => {
    expect(await repo.getDecryptedKey(tenantId)).toBeNull()
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    expect(await repo.getDecryptedKey(tenantId)).toBeNull()
    await repo.storeKey(tenantId, {
      apiKeyId: 'key-1',
      token: 'secret-token-1',
      expiresAt: new Date('2027-10-05T00:00:00.000Z'),
    })
    expect(await repo.getDecryptedKey(otherTenantId)).toBeNull()
  })

  it('rotateKey keeps the replaced key as previous until it is cleared', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.storeKey(tenantId, {
      apiKeyId: 'key-1',
      token: 'secret-token-1',
      expiresAt: new Date('2027-10-05T00:00:00.000Z'),
    })
    const retireAt = new Date('2026-10-06T00:00:00.000Z')

    await repo.rotateKey(tenantId, {
      apiKeyId: 'key-2',
      token: 'secret-token-2',
      expiresAt: new Date('2027-10-06T00:00:00.000Z'),
      retireAt,
    })

    let row = await repo.findByTenant(tenantId)
    expect(row!.apiKeyId).toBe('key-2')
    expect(row!.previousApiKeyId).toBe('key-1')
    expect(row!.previousKeyRetireAt).toEqual(retireAt)
    expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe('secret-token-2')

    await repo.clearPreviousKey(tenantId)
    row = await repo.findByTenant(tenantId)
    expect(row!.previousApiKeyId).toBeNull()
    expect(row!.previousKeyRetireAt).toBeNull()
  })

  it('rotateKey refuses while a previous key is still pending retirement', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.storeKey(tenantId, {
      apiKeyId: 'key-1',
      token: 't1',
      expiresAt: new Date('2027-10-05T00:00:00.000Z'),
    })
    const input = {
      expiresAt: new Date('2027-10-06T00:00:00.000Z'),
      retireAt: new Date('2026-10-06T00:00:00.000Z'),
    }
    await repo.rotateKey(tenantId, { ...input, apiKeyId: 'key-2', token: 't2' })
    // Overwriting previousApiKeyId would orphan key-1 in Temporal Cloud.
    await expect(
      repo.rotateKey(tenantId, { ...input, apiKeyId: 'key-3', token: 't3' }),
    ).rejects.toThrow(/previous key/)
    expect((await repo.findByTenant(tenantId))!.apiKeyId).toBe('key-2')
  })

  it('remove deletes the row', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.remove(tenantId)
    expect(await repo.findByTenant(tenantId)).toBeNull()
  })
})
