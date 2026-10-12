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

  async function readyWithKey(key = { apiKeyId: 'key-1', token: 'secret-token-1' }) {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.storeKey(tenantId, { ...key, expiresAt: new Date('2027-10-05T00:00:00.000Z') })
  }

  it('storePendingKey parks an encrypted key that is never served', async () => {
    await readyWithKey()
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-2', token: 'secret-token-2' })

    const raw = await db.tenantTemporalNamespace.findUnique({ where: { tenantId } })
    expect(raw!.pendingApiKeyId).toBe('key-2')
    expect(raw!.pendingApiKeyCiphertext).not.toBe('secret-token-2')
    // The served key is still the current one.
    expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe('secret-token-1')
    expect(await repo.getDecryptedPendingKey(tenantId)).toEqual({
      namespace: NAMESPACE,
      grpcAddress: GRPC,
      apiKeyId: 'key-2',
      apiKey: 'secret-token-2',
    })
    const row = await repo.findByTenant(tenantId)
    expect(row!.pendingApiKeyId).toBe('key-2')
    expect(row).not.toHaveProperty('pendingApiKeyCiphertext')
    expect(await repo.getDecryptedPendingKey(otherTenantId)).toBeNull()
  })

  it('promotePendingKey makes the pending key current and keeps the old one as previous', async () => {
    await readyWithKey()
    await repo.setLastError(tenantId, 'an earlier rotation failed')
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-2', token: 'secret-token-2' })
    const expiresAt = new Date('2027-10-06T00:00:00.000Z')
    const retireAt = new Date('2026-10-06T00:00:00.000Z')

    await repo.promotePendingKey(tenantId, {
      expectedPendingApiKeyId: 'key-2',
      expiresAt,
      retireAt,
    })

    let row = await repo.findByTenant(tenantId)
    expect(row).toMatchObject({
      apiKeyId: 'key-2',
      apiKeyExpiresAt: expiresAt,
      previousApiKeyId: 'key-1',
      previousKeyRetireAt: retireAt,
      pendingApiKeyId: null,
      lastError: null,
    })
    expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe('secret-token-2')
    expect(await repo.getDecryptedPendingKey(tenantId)).toBeNull()

    await repo.clearPreviousKey(tenantId)
    row = await repo.findByTenant(tenantId)
    expect(row!.previousApiKeyId).toBeNull()
    expect(row!.previousKeyRetireAt).toBeNull()
  })

  it('promotePendingKey refuses while a previous key is still pending retirement', async () => {
    await readyWithKey()
    const times = {
      expiresAt: new Date('2027-10-06T00:00:00.000Z'),
      retireAt: new Date('2026-10-06T00:00:00.000Z'),
    }
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-2', token: 't2' })
    await repo.promotePendingKey(tenantId, { ...times, expectedPendingApiKeyId: 'key-2' })
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-3', token: 't3' })
    // Overwriting previousApiKeyId would orphan key-1 in Temporal Cloud.
    await expect(
      repo.promotePendingKey(tenantId, { ...times, expectedPendingApiKeyId: 'key-3' }),
    ).rejects.toThrow(/previous key/)
    const row = await repo.findByTenant(tenantId)
    expect(row!.apiKeyId).toBe('key-2')
    expect(row!.pendingApiKeyId).toBe('key-3')
  })

  it('promotePendingKey refuses a pending key other than the one expected', async () => {
    await readyWithKey()
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-2', token: 't2' })
    await expect(
      repo.promotePendingKey(tenantId, {
        expectedPendingApiKeyId: 'key-9',
        expiresAt: new Date('2027-10-06T00:00:00.000Z'),
        retireAt: new Date('2026-10-06T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/not key-9/)
    expect((await repo.findByTenant(tenantId))!.apiKeyId).toBe('key-1')
  })

  it('clearPendingKey drops the pending key; findWithPendingKey lists rows holding one', async () => {
    await readyWithKey()
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-2', token: 't2' })
    expect((await repo.findWithPendingKey()).map((r) => r.tenantId)).toContain(tenantId)

    await repo.clearPendingKey(tenantId)
    expect((await repo.findByTenant(tenantId))!.pendingApiKeyId).toBeNull()
    expect(await repo.getDecryptedPendingKey(tenantId)).toBeNull()
    expect((await repo.findWithPendingKey()).map((r) => r.tenantId)).not.toContain(tenantId)
  })

  // The sweep queries below are global, and other test files run against the
  // same database in parallel (the provisioner suite's clock is 2026). The
  // rows here are dated far from that clock and carry a lease that is live
  // in 2026, so neither suite's sweep picks up the other's rows.
  it('findDueForRotation lists READY rows expiring before the cutoff, soonest first', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.createProvisioning({
      tenantId: otherTenantId,
      namespace: 'pg-test-000000000002.chgel',
      grpcAddress: GRPC,
    })
    const lease = new Date('2029-12-31T00:00:00.000Z')
    for (const [id, expiry] of [
      [tenantId, '2030-01-20T00:00:00.000Z'],
      [otherTenantId, '2030-01-10T00:00:00.000Z'],
    ] as const) {
      await repo.storeKey(id, { apiKeyId: `k-${id}`, token: 't', expiresAt: new Date(expiry) })
      await repo.markReady(id)
      await db.tenantTemporalNamespace.update({
        where: { tenantId: id },
        data: { leaseExpiresAt: lease },
      })
    }
    const now = new Date('2030-01-01T00:00:00.000Z')
    const due = async (cutoff: string, at = now) =>
      (await repo.findDueForRotation({ cutoff: new Date(cutoff), now: at }, 50))
        .map((r) => r.tenantId)
        .filter((id) => id === tenantId || id === otherTenantId)

    // Soonest first.
    expect(await due('2030-02-01')).toEqual([otherTenantId, tenantId])
    // ...except that a row whose last attempt failed goes last.
    await repo.setLastError(otherTenantId, 'rotate failed')
    expect(await due('2030-02-01')).toEqual([tenantId, otherTenantId])
    // The cutoff excludes the later one.
    expect(await due('2030-01-15')).toEqual([otherTenantId])
    // A live lease excludes a row.
    expect(await due('2030-02-01', new Date('2029-12-30T00:00:00.000Z'))).toEqual([])
    // A previous key still recorded excludes a row (it can't be promoted over).
    await db.tenantTemporalNamespace.update({
      where: { tenantId: otherTenantId },
      data: { previousApiKeyId: 'old' },
    })
    expect(await due('2030-02-01')).toEqual([tenantId])
    // Not READY excludes a row.
    await repo.markFailed(tenantId, 'boom')
    expect(await due('2030-02-01')).toEqual([])
  })

  it('earliestReadyKeyExpiry is the soonest expiry across READY rows', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    // Earlier than any other suite's row; leased, so no sweep acts on it.
    const expiresAt = new Date('2000-01-01T00:00:00.000Z')
    await repo.storeKey(tenantId, { apiKeyId: 'key-1', token: 't', expiresAt })
    await db.tenantTemporalNamespace.update({
      where: { tenantId },
      data: { leaseExpiresAt: new Date('2100-01-01T00:00:00.000Z') },
    })
    // Not READY yet: not counted.
    const before = await repo.earliestReadyKeyExpiry()
    expect(before === null || before > expiresAt).toBe(true)

    await repo.markReady(tenantId)
    expect(await repo.earliestReadyKeyExpiry()).toEqual(expiresAt)
  })

  it('claimLease holds the row for one action at a time, gated on status', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    const t0 = new Date('2026-10-05T12:00:00.000Z')
    const until = new Date('2026-10-05T12:15:00.000Z')

    // Wrong status: no lease.
    expect(await repo.claimLease(tenantId, ['READY'], { now: t0, until })).toBe(false)

    expect(await repo.claimLease(tenantId, ['PROVISIONING'], { now: t0, until })).toBe(true)
    expect((await repo.findByTenant(tenantId))!.leaseExpiresAt).toEqual(until)

    // Held: a second claim before expiry fails.
    const t1 = new Date('2026-10-05T12:10:00.000Z')
    expect(await repo.claimLease(tenantId, ['PROVISIONING'], { now: t1, until })).toBe(false)

    // Expired (a Lambda killed by its timeout): claimable again.
    const t2 = new Date('2026-10-05T12:16:00.000Z')
    const until2 = new Date('2026-10-05T12:31:00.000Z')
    expect(await repo.claimLease(tenantId, ['PROVISIONING'], { now: t2, until: until2 })).toBe(true)

    await repo.releaseLease(tenantId)
    expect((await repo.findByTenant(tenantId))!.leaseExpiresAt).toBeNull()
    expect(await repo.claimLease(tenantId, ['PROVISIONING'], { now: t1, until })).toBe(true)
  })

  it('setLastError records an error without changing status', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.markReady(tenantId)
    await repo.setLastError(tenantId, 'rotate failed')
    const row = await repo.findByTenant(tenantId)
    expect(row!.status).toBe('READY')
    expect(row!.lastError).toBe('rotate failed')
  })

  it('markStep can record the gRPC address Cloud reports', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.markStep(tenantId, 'namespace_created', { grpcAddress: 'other:7233' })
    expect((await repo.findByTenant(tenantId))!.grpcAddress).toBe('other:7233')
  })

  it('findWithRetirablePreviousKey lists rows whose previous key is past its retire time', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.storeKey(tenantId, {
      apiKeyId: 'key-1',
      token: 't1',
      expiresAt: new Date('2027-10-05T00:00:00.000Z'),
    })
    await repo.storePendingKey(tenantId, { apiKeyId: 'key-2', token: 't2' })
    await repo.promotePendingKey(tenantId, {
      expectedPendingApiKeyId: 'key-2',
      expiresAt: new Date('2027-10-06T00:00:00.000Z'),
      retireAt: new Date('2026-10-06T00:00:00.000Z'),
    })

    const before = await repo.findWithRetirablePreviousKey(new Date('2026-10-05T23:59:00.000Z'))
    expect(before.map((r) => r.tenantId)).not.toContain(tenantId)
    const after = await repo.findWithRetirablePreviousKey(new Date('2026-10-06T00:00:01.000Z'))
    expect(after.map((r) => r.tenantId)).toContain(tenantId)
  })

  it('remove deletes the row', async () => {
    await repo.createProvisioning({ tenantId, namespace: NAMESPACE, grpcAddress: GRPC })
    await repo.remove(tenantId)
    expect(await repo.findByTenant(tenantId)).toBeNull()
  })
})
