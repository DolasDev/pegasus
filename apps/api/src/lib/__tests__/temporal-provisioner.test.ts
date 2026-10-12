// ---------------------------------------------------------------------------
// Temporal namespace provisioner — tests against a stateful in-memory fake of
// Temporal Cloud and the real repository (live Postgres; skipped without
// DATABASE_URL). KMS is mocked with a reversible base64 codec.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { db } from '../../db'
import { createTenantTemporalNamespaceRepository } from '../../repositories/tenant-temporal-namespace.repository'
import { assertProvisionableName, CloudOpsOperationError } from '../temporal-cloud-ops'
import {
  keyExpiryGauges,
  runTemporalProvisioner,
  NO_TENANT_KEYS_DAYS,
  SWEEP_START_BUDGET_MS,
  type CloudOpsPort,
  type KeyMetric,
  type OwnKeyPort,
  type ProvisionerDeps,
} from '../temporal-provisioner'

vi.mock('../runtime-token-crypto', () => ({
  encryptRuntimeToken: vi.fn((plaintext: string) =>
    Promise.resolve(Buffer.from(plaintext, 'utf8').toString('base64')),
  ),
  decryptRuntimeToken: vi.fn((ciphertext: string) =>
    Promise.resolve(Buffer.from(ciphertext, 'base64').toString('utf8')),
  ),
}))

const hasDb = Boolean(process.env['DATABASE_URL'])
const TEST_TENANT_SLUG = 'test-tenant-temporal-provisioner'
const OTHER_TENANT_SLUG = 'test-tenant-temporal-provisioner-other'

// ---------------------------------------------------------------------------
// Fake Temporal Cloud
// ---------------------------------------------------------------------------

type FakeKey = {
  id: string
  ownerId: string
  token: string
  resourceVersion: string
  expiresAt: Date | null
}

/** The provisioner's own service account in the fake: what its key can see. */
const PROVISIONER_SA = 'sa-provisioner'

class FakeCloud implements CloudOpsPort {
  namespaces = new Map<string, { resourceVersion: string; state: string }>()
  serviceAccounts = new Map<string, { name: string; namespace: string }>()
  keys = new Map<string, FakeKey>()
  calls: string[] = []
  /** Cloud's clock, for its minimum-expiry rule. `deps()` ties it to the run's clock. */
  clock: () => Date = () => new Date('2026-10-05T12:00:00.000Z')
  private seq = 0
  /** Throw from the named method once, after doing its work if `afterEffect`. */
  failOnce = new Map<string, { afterEffect: boolean; error: Error }>()

  private maybeFail(method: string, phase: 'before' | 'after') {
    const f = this.failOnce.get(method)
    if (!f || f.afterEffect !== (phase === 'after')) return
    this.failOnce.delete(method)
    throw f.error
  }

  private next(prefix: string) {
    return `${prefix}-${++this.seq}`
  }

  /** A key on the provisioner's own account, as `create-provisioner.sh` makes it. */
  seedOwnKey(id: string, expiresAt: Date): FakeKey {
    const key: FakeKey = {
      id,
      ownerId: PROVISIONER_SA,
      token: `own-token-${id}`,
      resourceVersion: this.next('rv'),
      expiresAt,
    }
    this.keys.set(id, key)
    return key
  }

  async createNamespace(input: { name: string; asyncOperationId: string }) {
    this.calls.push('createNamespace')
    assertProvisionableName('test', input.name)
    this.maybeFail('createNamespace', 'before')
    const id = `${input.name}.acct`
    this.namespaces.set(id, { resourceVersion: this.next('rv'), state: 'RESOURCE_STATE_ACTIVE' })
    this.maybeFail('createNamespace', 'after')
    return { namespace: id, asyncOperationId: this.next('op') }
  }

  async getNamespace(namespace: string) {
    const ns = this.namespaces.get(namespace)
    if (!ns) return null
    return {
      namespace,
      resourceVersion: ns.resourceVersion,
      state: ns.state,
      grpcAddress: `${namespace}.tmprl.cloud:7233`,
    }
  }

  async deleteNamespace(input: { namespace: string; resourceVersion: string }) {
    this.calls.push('deleteNamespace')
    this.maybeFail('deleteNamespace', 'before')
    this.namespaces.delete(input.namespace)
    for (const [id, sa] of this.serviceAccounts) {
      if (sa.namespace === input.namespace) this.serviceAccounts.delete(id)
    }
    return { asyncOperationId: this.next('op') }
  }

  async createScopedServiceAccount(input: { name: string; namespace: string }) {
    this.calls.push('createScopedServiceAccount')
    this.maybeFail('createScopedServiceAccount', 'before')
    const id = this.next('sa')
    this.serviceAccounts.set(id, { name: input.name, namespace: input.namespace })
    this.maybeFail('createScopedServiceAccount', 'after')
    return { serviceAccountId: id, asyncOperationId: this.next('op') }
  }

  async findServiceAccountByName(name: string) {
    for (const [id, sa] of this.serviceAccounts) if (sa.name === name) return { id }
    return null
  }

  async createApiKey(input: { ownerId: string; expiryTime: Date }) {
    this.calls.push('createApiKey')
    this.maybeFail('createApiKey', 'before')
    // Real Cloud refuses an expiry under 24 h (verified 2026-10-12).
    if (input.expiryTime.getTime() < this.clock().getTime() + 24 * 60 * 60 * 1000) {
      throw new Error('400 expiry must be after now+24h')
    }
    const key: FakeKey = {
      id: this.next('key'),
      ownerId: input.ownerId,
      token: `token-${this.seq}`,
      resourceVersion: this.next('rv'),
      expiresAt: input.expiryTime,
    }
    this.keys.set(key.id, key)
    this.maybeFail('createApiKey', 'after')
    return { keyId: key.id, token: key.token, asyncOperationId: this.next('op') }
  }

  async getApiKey(keyId: string) {
    const k = this.keys.get(keyId)
    return k ? { id: k.id, resourceVersion: k.resourceVersion } : null
  }

  async listApiKeys(ownerId: string) {
    return [...this.keys.values()]
      .filter((k) => k.ownerId === ownerId)
      .map((k) => ({ id: k.id, resourceVersion: k.resourceVersion }))
  }

  /** What the provisioner's own key sees: only its own account's keys. */
  async listOwnApiKeys() {
    this.calls.push('listOwnApiKeys')
    this.maybeFail('listOwnApiKeys', 'before')
    return [...this.keys.values()]
      .filter((k) => k.ownerId === PROVISIONER_SA)
      .map((k) => ({ id: k.id, ownerId: k.ownerId, expiresAt: k.expiresAt }))
  }

  async deleteApiKey(input: { keyId: string; resourceVersion: string }) {
    this.calls.push(`deleteApiKey:${input.keyId}`)
    this.maybeFail('deleteApiKey', 'before')
    this.keys.delete(input.keyId)
    return { asyncOperationId: this.next('op') }
  }

  async waitForOperation(id: string) {
    this.maybeFail('waitForOperation', 'before')
    return { id, state: 'STATE_FULFILLED', checkDurationMs: null, failureReason: '' }
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let tenantId: string
let namespace: string
const repo = createTenantTemporalNamespaceRepository(db)

/** The provisioner secret, as the Lambda's Secrets Manager adapter sees it. */
class FakeOwnSecret implements OwnKeyPort {
  keyId: string | null = null
  writes: Array<{ apiKey: string; keyId: string; expiresAt: Date }> = []
  /** False: a new token never authenticates (propagation that never lands). */
  tokensVerify = true
  verifyCalls = 0

  constructor(private readonly cloud: FakeCloud) {}

  async recordedKeyId() {
    return this.keyId
  }

  async verify(token: string, keyId: string) {
    this.verifyCalls++
    const key = this.cloud.keys.get(keyId)
    return this.tokensVerify && key !== undefined && key.token === token
  }

  async store(key: { apiKey: string; keyId: string; expiresAt: Date }) {
    this.writes.push(key)
    this.keyId = key.keyId
  }
}

function deps(
  cloud: FakeCloud,
  overrides: Partial<ProvisionerDeps> = {},
): ProvisionerDeps & {
  logged: unknown[]
  metrics: KeyMetric[]
} {
  const logged: unknown[] = []
  const metrics: KeyMetric[] = []
  const log = (...args: unknown[]) => void logged.push(args)
  let clock = new Date('2026-10-05T12:00:00.000Z').getTime()
  const d = {
    repo,
    cloud,
    env: 'test',
    checkReady: vi.fn(async () => true),
    ownKey: new FakeOwnSecret(cloud),
    platformKeyExpiresAt: async () => new Date('2028-06-04T16:10:23.000Z'),
    publishMetrics: async (m: KeyMetric[]) => void metrics.push(...m),
    logger: { info: log, warn: log, error: log },
    now: () => new Date(clock),
    sleep: async (ms: number) => {
      clock += ms
    },
    logged,
    metrics,
    ...overrides,
  }
  cloud.clock = d.now
  return d
}

/** A second tenant, for the sweeps that walk several rows. No row unless a test makes one. */
let otherTenantId: string
let otherNamespace: string

async function freshRow() {
  await db.tenantTemporalNamespace.deleteMany({
    where: { tenantId: { in: [tenantId, otherTenantId] } },
  })
  await repo.createProvisioning({
    tenantId,
    namespace,
    grpcAddress: `${namespace}.tmprl.cloud:7233`,
  })
}

describe.skipIf(!hasDb)('runTemporalProvisioner (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Temporal Provisioner)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    tenantId = tenant.id
    namespace = `pg-test-${tenantId.replace(/-/g, '').slice(0, 12)}.acct`
    const other = await db.tenant.upsert({
      where: { slug: OTHER_TENANT_SLUG },
      create: { name: 'Test Tenant (Temporal Provisioner, other)', slug: OTHER_TENANT_SLUG },
      update: {},
    })
    otherTenantId = other.id
    otherNamespace = `pg-test-${otherTenantId.replace(/-/g, '').slice(0, 12)}.acct`
  })

  beforeEach(freshRow)

  afterAll(async () => {
    await db.tenantTemporalNamespace.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    })
    await db.tenant.deleteMany({ where: { slug: { in: [TEST_TENANT_SLUG, OTHER_TENANT_SLUG] } } })
    await db.$disconnect()
  })

  // -------------------------------------------------------------------------
  // provision
  // -------------------------------------------------------------------------

  describe('provision', () => {
    it('creates the namespace, a scoped account and a key, stores it, and goes READY', async () => {
      const cloud = new FakeCloud()
      const d = deps(cloud)
      const out = await runTemporalProvisioner({ action: 'provision', tenantId }, d)

      expect(out).toEqual({ outcome: 'done' })
      expect(cloud.namespaces.has(namespace)).toBe(true)
      expect(cloud.serviceAccounts.size).toBe(1)
      expect(cloud.keys.size).toBe(1)

      const row = await repo.findByTenant(tenantId)
      expect(row).toMatchObject({
        status: 'READY',
        step: 'ready',
        lastError: null,
        leaseExpiresAt: null,
      })
      const [saId] = [...cloud.serviceAccounts.keys()]
      expect(row!.cloudServiceAccountId).toBe(saId)
      const [key] = [...cloud.keys.values()]
      expect(row!.apiKeyId).toBe(key!.id)
      expect(row!.apiKeyExpiresAt!.toISOString()).toBe('2027-10-05T12:00:00.000Z')
      expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe(key!.token)

      // Readiness was checked with the namespace's own key.
      expect(d.checkReady).toHaveBeenCalledWith({
        namespace,
        grpcAddress: `${namespace}.tmprl.cloud:7233`,
        apiKey: key!.token,
      })
    })

    it('is a no-op on an already READY row', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      cloud.calls = []
      const out = await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      expect(out).toEqual({ outcome: 'skipped', reason: 'not_claimable' })
      expect(cloud.calls).toEqual([])
    })

    it('skips when there is no row', async () => {
      await db.tenantTemporalNamespace.deleteMany({ where: { tenantId } })
      const out = await runTemporalProvisioner(
        { action: 'provision', tenantId },
        deps(new FakeCloud()),
      )
      expect(out).toEqual({ outcome: 'skipped', reason: 'no_row' })
    })

    it('skips while another run holds the lease', async () => {
      const d = deps(new FakeCloud())
      await repo.claimLease(tenantId, ['PROVISIONING'], {
        now: d.now!(),
        until: new Date(d.now!().getTime() + 60_000),
      })
      const out = await runTemporalProvisioner({ action: 'provision', tenantId }, d)
      expect(out).toEqual({ outcome: 'skipped', reason: 'not_claimable' })
    })

    it.each([
      ['createNamespace', false],
      ['createNamespace', true],
      ['createScopedServiceAccount', false],
      ['createScopedServiceAccount', true],
      ['createApiKey', false],
    ] as const)(
      'resumes after %s fails (afterEffect=%s) without duplicating resources',
      async (method, afterEffect) => {
        const cloud = new FakeCloud()
        cloud.failOnce.set(method, { afterEffect, error: new Error(`${method} exploded`) })

        const first = await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
        expect(first).toEqual({ outcome: 'failed' })
        let row = await repo.findByTenant(tenantId)
        expect(row!.status).toBe('FAILED')
        expect(row!.lastError).toContain(`${method} exploded`)
        expect(row!.leaseExpiresAt).toBeNull()

        // The admin route moves FAILED back to PROVISIONING before re-invoking.
        expect(await repo.transition(tenantId, ['FAILED'], 'PROVISIONING')).toBe(true)
        const second = await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
        expect(second).toEqual({ outcome: 'done' })

        row = await repo.findByTenant(tenantId)
        expect(row!.status).toBe('READY')
        expect(cloud.namespaces.size).toBe(1)
        expect(cloud.serviceAccounts.size).toBe(1)
        expect(cloud.keys.size).toBe(1)
        expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe(
          [...cloud.keys.values()][0]!.token,
        )
      },
    )

    it('token-once: a key minted by a run that never stored it is deleted and re-minted', async () => {
      const cloud = new FakeCloud()
      // createApiKey succeeds in Cloud, but its response (with the token) is lost.
      cloud.failOnce.set('createApiKey', { afterEffect: true, error: new Error('socket hang up') })

      expect(await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))).toEqual({
        outcome: 'failed',
      })
      const [orphan] = [...cloud.keys.values()]
      expect(orphan).toBeDefined()
      expect(await repo.getDecryptedKey(tenantId)).toBeNull()

      await repo.transition(tenantId, ['FAILED'], 'PROVISIONING')
      expect(await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))).toEqual({
        outcome: 'done',
      })

      expect(cloud.calls).toContain(`deleteApiKey:${orphan!.id}`)
      expect(cloud.keys.has(orphan!.id)).toBe(false)
      expect(cloud.keys.size).toBe(1)
    })

    it('stores the token before waiting on the key operation', async () => {
      const cloud = new FakeCloud()
      const original = cloud.waitForOperation.bind(cloud)
      let storedBeforeKeyWait: boolean | null = null
      let waits = 0
      cloud.waitForOperation = async (id: string) => {
        waits++
        // Third wait = the key's operation (namespace, service account, key).
        if (waits === 3) storedBeforeKeyWait = (await repo.getDecryptedKey(tenantId)) !== null
        return original(id)
      }
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      expect(storedBeforeKeyWait).toBe(true)
    })

    it('fails when the key never becomes authorized within the readiness window', async () => {
      const cloud = new FakeCloud()
      const d = deps(cloud, { checkReady: vi.fn(async () => false) })
      expect(await runTemporalProvisioner({ action: 'provision', tenantId }, d)).toEqual({
        outcome: 'failed',
      })
      const row = await repo.findByTenant(tenantId)
      expect(row!.status).toBe('FAILED')
      expect(row!.lastError).toMatch(/not authorized/)
      // The key is stored, so a resume only re-checks readiness.
      expect(row!.step).toBe('api_key_stored')
      expect((d.checkReady as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1)
    })

    it('a readiness probe that throws is retried, not fatal', async () => {
      const cloud = new FakeCloud()
      const checkReady = vi
        .fn()
        .mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true)
      const out = await runTemporalProvisioner(
        { action: 'provision', tenantId },
        deps(cloud, { checkReady }),
      )
      expect(out).toEqual({ outcome: 'done' })
      expect(checkReady).toHaveBeenCalledTimes(3)
    })

    it('refuses a row whose namespace is not provisionable, touching nothing', async () => {
      await db.tenantTemporalNamespace.update({
        where: { tenantId },
        data: { namespace: 'pegasus-test.acct' },
      })
      const cloud = new FakeCloud()
      expect(await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))).toEqual({
        outcome: 'failed',
      })
      expect(cloud.calls).toEqual([])
      expect((await repo.findByTenant(tenantId))!.lastError).toMatch(/not a provisionable/)
    })

    it('fails when Cloud returns a namespace id other than the row', async () => {
      const cloud = new FakeCloud()
      cloud.createNamespace = async (input) => ({
        namespace: `${input.name}.otheracct`,
        asyncOperationId: 'op',
      })
      expect(await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))).toEqual({
        outcome: 'failed',
      })
      expect((await repo.findByTenant(tenantId))!.lastError).toMatch(/otheracct/)
    })

    it('never logs a token', async () => {
      const cloud = new FakeCloud()
      const d = deps(cloud)
      await runTemporalProvisioner({ action: 'provision', tenantId }, d)
      const text = JSON.stringify(d.logged)
      for (const key of cloud.keys.values()) expect(text).not.toContain(key.token)
      expect(d.logged.length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // rotate
  // -------------------------------------------------------------------------

  describe('rotate', () => {
    async function provisioned() {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      const row = await repo.findByTenant(tenantId)
      return { cloud, oldKeyId: row!.apiKeyId! }
    }

    it('mints a new key, keeps the old one alive for the grace period', async () => {
      const { cloud, oldKeyId } = await provisioned()
      const out = await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      expect(out).toEqual({ outcome: 'done' })

      const row = await repo.findByTenant(tenantId)
      expect(row!.status).toBe('READY')
      expect(row!.apiKeyId).not.toBe(oldKeyId)
      expect(row!.previousApiKeyId).toBe(oldKeyId)
      expect(row!.previousKeyRetireAt!.toISOString()).toBe('2026-10-06T12:00:00.000Z')
      // Both keys still exist in Cloud: running runners keep working.
      expect(cloud.keys.has(oldKeyId)).toBe(true)
      expect(cloud.keys.has(row!.apiKeyId!)).toBe(true)
      expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe(
        cloud.keys.get(row!.apiKeyId!)!.token,
      )
    })

    it('refuses while the previous key is still inside its grace period', async () => {
      const { cloud } = await provisioned()
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      const before = await repo.findByTenant(tenantId)

      const out = await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      expect(out).toEqual({ outcome: 'failed' })
      const row = await repo.findByTenant(tenantId)
      // A failed rotate leaves the namespace READY and the keys untouched.
      expect(row!.status).toBe('READY')
      expect(row!.apiKeyId).toBe(before!.apiKeyId)
      expect(row!.lastError).toMatch(/grace/)
      expect(cloud.keys.size).toBe(2)
    })

    it('retires an expired previous key first, then rotates', async () => {
      const { cloud, oldKeyId } = await provisioned()
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      const mid = await repo.findByTenant(tenantId)

      const later = deps(cloud, { now: () => new Date('2026-10-07T00:00:00.000Z') })
      expect(await runTemporalProvisioner({ action: 'rotate', tenantId }, later)).toEqual({
        outcome: 'done',
      })
      const row = await repo.findByTenant(tenantId)
      expect(cloud.keys.has(oldKeyId)).toBe(false)
      expect(row!.previousApiKeyId).toBe(mid!.apiKeyId)
      expect(cloud.keys.size).toBe(2)
    })

    it('keeps an expired previous key when the current key is not authorized', async () => {
      const { cloud, oldKeyId } = await provisioned()
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      const mid = await repo.findByTenant(tenantId)

      const later = deps(cloud, {
        now: () => new Date('2026-10-07T00:00:00.000Z'),
        checkReady: vi.fn(async () => false),
      })
      expect(await runTemporalProvisioner({ action: 'rotate', tenantId }, later)).toEqual({
        outcome: 'failed',
      })
      const row = await repo.findByTenant(tenantId)
      // The old key may be the only one that works: it stays, and so does the row.
      expect(cloud.keys.has(oldKeyId)).toBe(true)
      expect(row!.status).toBe('READY')
      expect(row!.apiKeyId).toBe(mid!.apiKeyId)
      expect(row!.previousApiKeyId).toBe(oldKeyId)
      expect(row!.lastError).toMatch(/current key not authorized/)
    })

    it('is refused on a row that is not READY', async () => {
      const cloud = new FakeCloud()
      const out = await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      expect(out).toEqual({ outcome: 'skipped', reason: 'not_claimable' })
      expect(cloud.calls).toEqual([])
    })

    it('never serves the new key before it is authorized', async () => {
      const { cloud, oldKeyId } = await provisioned()
      const oldToken = cloud.keys.get(oldKeyId)!.token
      const servedDuringCheck: string[] = []
      const checkReady = vi.fn(async () => {
        servedDuringCheck.push((await repo.getDecryptedKey(tenantId))!.apiKey)
        return true
      })
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud, { checkReady }))

      const row = await repo.findByTenant(tenantId)
      // Readiness ran on the NEW key while the broker still served the old one.
      expect(checkReady).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: cloud.keys.get(row!.apiKeyId!)!.token }),
      )
      expect(servedDuringCheck).toEqual([oldToken])
      expect(row!.pendingApiKeyId).toBeNull()
    })

    it('a key that never verifies leaves the old key current and the row READY', async () => {
      const { cloud, oldKeyId } = await provisioned()
      const d = deps(cloud, { checkReady: vi.fn(async () => false) })
      expect(await runTemporalProvisioner({ action: 'rotate', tenantId }, d)).toEqual({
        outcome: 'failed',
      })

      const row = await repo.findByTenant(tenantId)
      expect(row).toMatchObject({ status: 'READY', apiKeyId: oldKeyId, previousApiKeyId: null })
      expect(row!.lastError).toMatch(/not authorized/)
      expect((await repo.getDecryptedKey(tenantId))!.apiKey).toBe(cloud.keys.get(oldKeyId)!.token)
      // The unverified key is parked for the next run to discard.
      expect(row!.pendingApiKeyId).not.toBeNull()
      expect(cloud.keys.has(row!.pendingApiKeyId!)).toBe(true)
      expect(d.metrics).toEqual([{ name: 'TemporalKeyRotationFailed', value: 1 }])
    })

    it('the next rotate discards the stale pending key, then rotates', async () => {
      const { cloud, oldKeyId } = await provisioned()
      await runTemporalProvisioner(
        { action: 'rotate', tenantId },
        deps(cloud, { checkReady: vi.fn(async () => false) }),
      )
      const stale = (await repo.findByTenant(tenantId))!.pendingApiKeyId!

      expect(await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))).toEqual({
        outcome: 'done',
      })
      const row = await repo.findByTenant(tenantId)
      expect(cloud.keys.has(stale)).toBe(false)
      expect(row!.apiKeyId).not.toBe(stale)
      expect(row!.previousApiKeyId).toBe(oldKeyId)
      expect(row!.pendingApiKeyId).toBeNull()
      expect(cloud.keys.size).toBe(2)
    })

    it('token-once: a key minted by a rotate that never stored it is deleted next time', async () => {
      const { cloud, oldKeyId } = await provisioned()
      cloud.failOnce.set('createApiKey', { afterEffect: true, error: new Error('socket hang up') })
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      const orphan = [...cloud.keys.keys()].find((id) => id !== oldKeyId)!
      expect((await repo.findByTenant(tenantId))!.pendingApiKeyId).toBeNull()

      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      expect(cloud.keys.has(orphan)).toBe(false)
      expect(cloud.keys.has(oldKeyId)).toBe(true)
      expect(cloud.keys.size).toBe(2)
    })

    it('never logs a token', async () => {
      const { cloud } = await provisioned()
      const d = deps(cloud)
      await runTemporalProvisioner({ action: 'rotate', tenantId }, d)
      const text = JSON.stringify(d.logged)
      for (const key of cloud.keys.values()) expect(text).not.toContain(key.token)
    })
  })

  // -------------------------------------------------------------------------
  // retire-previous-keys (scheduled sweep)
  // -------------------------------------------------------------------------

  describe('retire-previous-keys', () => {
    it('deletes previous keys past their retire time, and leaves the rest', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      const oldKeyId = (await repo.findByTenant(tenantId))!.apiKeyId!
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))

      // Inside the grace period: nothing happens.
      await runTemporalProvisioner({ action: 'retire-previous-keys' }, deps(cloud))
      expect(cloud.keys.has(oldKeyId)).toBe(true)

      const later = deps(cloud, { now: () => new Date('2026-10-07T00:00:00.000Z') })
      await runTemporalProvisioner({ action: 'retire-previous-keys' }, later)
      expect(cloud.keys.has(oldKeyId)).toBe(false)
      const row = await repo.findByTenant(tenantId)
      expect(row!.previousApiKeyId).toBeNull()
      expect(row!.previousKeyRetireAt).toBeNull()
      expect(row!.status).toBe('READY')
    })

    it('keeps the previous key when the current key is not authorized', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      const oldKeyId = (await repo.findByTenant(tenantId))!.apiKeyId!
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))

      const checkReady = vi.fn(async () => false)
      const later = deps(cloud, { now: () => new Date('2026-10-07T00:00:00.000Z'), checkReady })
      await runTemporalProvisioner({ action: 'retire-previous-keys' }, later)

      const row = await repo.findByTenant(tenantId)
      expect(cloud.keys.has(oldKeyId)).toBe(true)
      expect(row!.previousApiKeyId).toBe(oldKeyId)
      expect(row!.lastError).toMatch(/current key not authorized/)
      // Checked with the CURRENT key, not the one being retired.
      expect(checkReady).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: cloud.keys.get(row!.apiKeyId!)!.token }),
      )
    })

    it('treats an already-deleted previous key as retired', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      const oldKeyId = (await repo.findByTenant(tenantId))!.apiKeyId!
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      cloud.keys.delete(oldKeyId)

      const later = deps(cloud, { now: () => new Date('2026-10-07T00:00:00.000Z') })
      await runTemporalProvisioner({ action: 'retire-previous-keys' }, later)
      expect((await repo.findByTenant(tenantId))!.previousApiKeyId).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // deprovision
  // -------------------------------------------------------------------------

  describe('deprovision', () => {
    it('deletes the keys and the namespace, then the row', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))
      // The admin route moves READY/FAILED → DEPROVISIONING before invoking.
      await repo.transition(tenantId, ['READY', 'FAILED'], 'DEPROVISIONING')

      const out = await runTemporalProvisioner({ action: 'deprovision', tenantId }, deps(cloud))
      expect(out).toEqual({ outcome: 'done' })
      expect(cloud.keys.size).toBe(0)
      expect(cloud.namespaces.size).toBe(0)
      expect(cloud.serviceAccounts.size).toBe(0)
      expect(await repo.findByTenant(tenantId)).toBeNull()
    })

    it('is refused unless the row is DEPROVISIONING', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      cloud.calls = []
      const out = await runTemporalProvisioner({ action: 'deprovision', tenantId }, deps(cloud))
      expect(out).toEqual({ outcome: 'skipped', reason: 'not_claimable' })
      expect(cloud.calls).toEqual([])
      expect(cloud.namespaces.size).toBe(1)
    })

    it('cleans up a namespace whose provisioning failed half-way', async () => {
      const cloud = new FakeCloud()
      cloud.failOnce.set('createScopedServiceAccount', {
        afterEffect: true,
        error: new Error('lost response'),
      })
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      expect((await repo.findByTenant(tenantId))!.status).toBe('FAILED')

      await repo.transition(tenantId, ['READY', 'FAILED'], 'DEPROVISIONING')
      expect(
        await runTemporalProvisioner({ action: 'deprovision', tenantId }, deps(cloud)),
      ).toEqual({
        outcome: 'done',
      })
      expect(cloud.namespaces.size).toBe(0)
      expect(cloud.serviceAccounts.size).toBe(0)
    })

    it('marks FAILED (retryable) when a Cloud call fails', async () => {
      const cloud = new FakeCloud()
      await runTemporalProvisioner({ action: 'provision', tenantId }, deps(cloud))
      await repo.transition(tenantId, ['READY'], 'DEPROVISIONING')
      cloud.failOnce.set('waitForOperation', {
        afterEffect: false,
        error: new CloudOpsOperationError('operation ended STATE_FAILED'),
      })
      expect(
        await runTemporalProvisioner({ action: 'deprovision', tenantId }, deps(cloud)),
      ).toEqual({
        outcome: 'failed',
      })
      const row = await repo.findByTenant(tenantId)
      expect(row!.status).toBe('FAILED')
      expect(row!.leaseExpiresAt).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // rotate-own-key
  // -------------------------------------------------------------------------

  describe('rotate-own-key', () => {
    // The harness clock is 2026-10-05T12:00Z; rotation starts 45 days out.
    const FAR = new Date('2027-10-11T20:27:57.000Z')
    const SOON = new Date('2026-11-01T00:00:00.000Z')

    function own(d: ReturnType<typeof deps>) {
      return d.ownKey as FakeOwnSecret
    }

    it('does nothing while the key is not due', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-1', FAR)
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'rotate-own-key' }, d)).toEqual({
        outcome: 'done',
      })
      expect(cloud.calls).toEqual(['listOwnApiKeys'])
      expect(own(d).writes).toEqual([])
    })

    it('when due: mints a 1-year key, verifies it, stores it, and keeps the old key', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-1', SOON)
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'rotate-own-key' }, d)).toEqual({
        outcome: 'done',
      })

      const [write] = own(d).writes
      const minted = cloud.keys.get(write!.keyId)!
      expect(minted.ownerId).toBe('sa-provisioner')
      expect(write).toEqual({
        apiKey: minted.token,
        keyId: minted.id,
        expiresAt: new Date('2027-10-05T12:00:00.000Z'),
      })
      // Never deletes: the old key expires on its own.
      expect(cloud.keys.has('own-1')).toBe(true)
      expect(cloud.calls.filter((c) => c.startsWith('deleteApiKey'))).toEqual([])
    })

    it('a new key that never authenticates leaves the secret untouched', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-1', SOON)
      const d = deps(cloud)
      own(d).tokensVerify = false
      expect(await runTemporalProvisioner({ action: 'rotate-own-key' }, d)).toEqual({
        outcome: 'failed',
      })
      expect(own(d).writes).toEqual([])
      expect(own(d).verifyCalls).toBeGreaterThan(1)
      expect(cloud.keys.has('own-1')).toBe(true)
      expect(JSON.stringify(d.logged)).toMatch(/did not authenticate/)
    })

    it('force rotates a key that is not due', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-1', FAR)
      const d = deps(cloud)
      await runTemporalProvisioner({ action: 'rotate-own-key', force: true }, d)
      expect(own(d).writes).toHaveLength(1)
    })

    it('judges the key the secret recorded, not another key on the account', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-old', SOON)
      cloud.seedOwnKey('own-new', FAR)
      const d = deps(cloud)
      own(d).keyId = 'own-new'
      await runTemporalProvisioner({ action: 'rotate-own-key' }, d)
      expect(own(d).writes).toEqual([])
    })

    it('with several keys and none recorded, assumes the soonest-expiring one', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-a', FAR)
      cloud.seedOwnKey('own-b', SOON)
      const d = deps(cloud)
      await runTemporalProvisioner({ action: 'rotate-own-key' }, d)
      expect(own(d).writes).toHaveLength(1)
      expect(JSON.stringify(d.logged)).toMatch(/own_key_ambiguous/)
    })

    it('refuses when its listing shows another service account (its role changed)', async () => {
      const cloud = new FakeCloud()
      cloud.listOwnApiKeys = async () => [
        { id: 'own-1', ownerId: 'sa-provisioner', expiresAt: SOON },
        { id: 'x-1', ownerId: 'sa-someone-else', expiresAt: SOON },
      ]
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'rotate-own-key' }, d)).toEqual({
        outcome: 'failed',
      })
      expect(cloud.calls).not.toContain('createApiKey')
      expect(own(d).writes).toEqual([])
    })

    it('never logs a token', async () => {
      const cloud = new FakeCloud()
      const old = cloud.seedOwnKey('own-1', SOON)
      const d = deps(cloud)
      await runTemporalProvisioner({ action: 'rotate-own-key' }, d)
      const text = JSON.stringify(d.logged)
      expect(text).not.toContain(old.token)
      expect(text).not.toContain(own(d).writes[0]!.apiKey)
    })
  })

  // -------------------------------------------------------------------------
  // daily-maintenance
  // -------------------------------------------------------------------------

  describe('daily-maintenance', () => {
    const NOW = new Date('2026-10-05T12:00:00.000Z')
    const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

    function maintenanceCloud() {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-1', new Date('2027-10-11T20:27:57.000Z'))
      return cloud
    }

    async function readyTenant(cloud: FakeCloud, id: string, ns: string, expiresAt: Date) {
      if (!(await repo.findByTenant(id))) {
        await repo.createProvisioning({ tenantId: id, namespace: ns, grpcAddress: `${ns}:7233` })
      }
      await runTemporalProvisioner({ action: 'provision', tenantId: id }, deps(cloud))
      await db.tenantTemporalNamespace.update({
        where: { tenantId: id },
        data: { apiKeyExpiresAt: expiresAt },
      })
      return (await repo.findByTenant(id))!.apiKeyId!
    }

    function gauge(d: ReturnType<typeof deps>, keyClass: string) {
      return d.metrics.find(
        (m) => m.name === 'TemporalKeyDaysToExpiry' && 'keyClass' in m && m.keyClass === keyClass,
      )?.value
    }

    function failures(d: ReturnType<typeof deps>) {
      return d.metrics
        .filter((m) => m.name === 'TemporalKeyRotationFailed')
        .reduce((sum, m) => sum + m.value, 0)
    }

    it('publishes a gauge per key class and a zero failure count', async () => {
      const cloud = maintenanceCloud()
      await readyTenant(cloud, tenantId, namespace, inDays(200))
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'daily-maintenance' }, d)).toEqual({
        outcome: 'done',
      })
      expect(gauge(d, 'provisioner')).toBe(371)
      expect(gauge(d, 'platform')).toBe(608)
      // A global minimum: other suites' rows share this database.
      expect(gauge(d, 'tenant')).toBeLessThanOrEqual(200)
      expect(failures(d)).toBe(0)
      expect(d.metrics.filter((m) => m.name === 'TemporalKeyRotationFailed')).toHaveLength(1)
    })

    it('a missing or unreadable platform tag publishes 0 (the alarm fires)', async () => {
      for (const platformKeyExpiresAt of [
        async () => null,
        async () => {
          throw new Error('AccessDenied')
        },
      ]) {
        const d = deps(maintenanceCloud(), { platformKeyExpiresAt })
        await runTemporalProvisioner({ action: 'daily-maintenance' }, d)
        expect(gauge(d, 'platform')).toBe(0)
      }
    })

    it('an own-key step that fails omits its gauge, counts, and the rest still runs', async () => {
      const cloud = maintenanceCloud()
      cloud.failOnce.set('listOwnApiKeys', { afterEffect: false, error: new Error('401') })
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'daily-maintenance' }, d)).toEqual({
        outcome: 'failed',
      })
      expect(gauge(d, 'provisioner')).toBeUndefined()
      expect(gauge(d, 'platform')).toBe(608)
      expect(gauge(d, 'tenant')).toBeTypeOf('number')
      expect(failures(d)).toBe(1)
    })

    it('rotates the own key when due, and reports the new expiry', async () => {
      const cloud = new FakeCloud()
      cloud.seedOwnKey('own-1', inDays(20))
      const d = deps(cloud)
      await runTemporalProvisioner({ action: 'daily-maintenance' }, d)
      expect((d.ownKey as FakeOwnSecret).writes).toHaveLength(1)
      expect(gauge(d, 'provisioner')).toBe(365)
    })

    it('rotates tenant keys within 45 days of expiry, and leaves the rest', async () => {
      const cloud = maintenanceCloud()
      const dueKey = await readyTenant(cloud, tenantId, namespace, inDays(40))
      const laterKey = await readyTenant(cloud, otherTenantId, otherNamespace, inDays(60))
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'daily-maintenance' }, d)).toEqual({
        outcome: 'done',
      })

      const due = await repo.findByTenant(tenantId)
      expect(due!.apiKeyId).not.toBe(dueKey)
      expect(due!.previousApiKeyId).toBe(dueKey)
      expect(due!.apiKeyExpiresAt).toEqual(new Date('2027-10-05T12:00:00.000Z'))
      expect((await repo.findByTenant(otherTenantId))!.apiKeyId).toBe(laterKey)
    })

    it('one tenant rotation failing does not stop the next, and is counted', async () => {
      const cloud = maintenanceCloud()
      const firstKey = await readyTenant(cloud, tenantId, namespace, inDays(10))
      const secondKey = await readyTenant(cloud, otherTenantId, otherNamespace, inDays(20))
      // The first rotation's mint fails; the second goes ahead.
      cloud.failOnce.set('createApiKey', { afterEffect: false, error: new Error('503') })
      const d = deps(cloud)
      expect(await runTemporalProvisioner({ action: 'daily-maintenance' }, d)).toEqual({
        outcome: 'failed',
      })

      const first = await repo.findByTenant(tenantId)
      expect(first!.apiKeyId).toBe(firstKey)
      expect(first!.lastError).toMatch(/503/)
      expect((await repo.findByTenant(otherTenantId))!.previousApiKeyId).toBe(secondKey)
      expect(failures(d)).toBe(1)
    })

    it('a row that keeps failing goes last, so it cannot starve the others', async () => {
      const cloud = maintenanceCloud()
      const firstKey = await readyTenant(cloud, tenantId, namespace, inDays(10))
      const secondKey = await readyTenant(cloud, otherTenantId, otherNamespace, inDays(20))
      // The first tenant's NEW key never verifies (its current key does), so
      // its rotation spends the whole readiness window — the sweep's budget.
      const firstToken = cloud.keys.get(firstKey)!.token
      const checkReady = vi.fn(
        async (t: { namespace: string; apiKey: string }) =>
          t.namespace !== namespace || t.apiKey === firstToken,
      )
      await runTemporalProvisioner({ action: 'daily-maintenance' }, deps(cloud, { checkReady }))
      expect((await repo.findByTenant(tenantId))!.lastError).toMatch(/not authorized/)
      // Day 1: the budget went on the failing row.
      expect((await repo.findByTenant(otherTenantId))!.apiKeyId).toBe(secondKey)

      // Day 2: the failed row is tried after the healthy one.
      await runTemporalProvisioner({ action: 'daily-maintenance' }, deps(cloud, { checkReady }))
      expect((await repo.findByTenant(otherTenantId))!.previousApiKeyId).toBe(secondKey)
      expect((await repo.findByTenant(tenantId))!.apiKeyId).toBe(firstKey)
    })

    it('starts no tenant rotation once its time budget is spent', async () => {
      const cloud = maintenanceCloud()
      await readyTenant(cloud, tenantId, namespace, inDays(10))
      const secondKey = await readyTenant(cloud, otherTenantId, otherNamespace, inDays(20))
      // The first rotation's readiness takes longer than the whole budget.
      const polls = Math.ceil(SWEEP_START_BUDGET_MS / 10_000) + 1
      let calls = 0
      const checkReady = vi.fn(async () => ++calls > polls)
      const d = deps(cloud, { checkReady })
      await runTemporalProvisioner({ action: 'daily-maintenance' }, d)

      expect((await repo.findByTenant(tenantId))!.previousApiKeyId).not.toBeNull()
      expect((await repo.findByTenant(otherTenantId))!.apiKeyId).toBe(secondKey)
      expect(JSON.stringify(d.logged)).toMatch(/rotation_sweep_deferred/)
    })

    it('discards a pending key left by a rotation that never verified', async () => {
      const cloud = maintenanceCloud()
      const current = await readyTenant(cloud, tenantId, namespace, inDays(200))
      await runTemporalProvisioner(
        { action: 'rotate', tenantId },
        deps(cloud, { checkReady: vi.fn(async () => false) }),
      )
      const stale = (await repo.findByTenant(tenantId))!.pendingApiKeyId!

      await runTemporalProvisioner({ action: 'daily-maintenance' }, deps(cloud))
      const row = await repo.findByTenant(tenantId)
      expect(row!.pendingApiKeyId).toBeNull()
      expect(row!.apiKeyId).toBe(current)
      expect(cloud.keys.has(stale)).toBe(false)
    })

    it('retires previous keys past their grace period', async () => {
      const cloud = maintenanceCloud()
      const oldKey = await readyTenant(cloud, tenantId, namespace, inDays(200))
      await runTemporalProvisioner({ action: 'rotate', tenantId }, deps(cloud))

      const later = deps(cloud, { now: () => new Date('2026-10-07T00:00:00.000Z') })
      await runTemporalProvisioner({ action: 'daily-maintenance' }, later)
      expect(cloud.keys.has(oldKey)).toBe(false)
      expect((await repo.findByTenant(tenantId))!.previousApiKeyId).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// keyExpiryGauges (pure)
// ---------------------------------------------------------------------------

describe('keyExpiryGauges', () => {
  const now = new Date('2026-10-05T12:00:00.000Z')

  it('reports whole days to each expiry, floored at 0', () => {
    expect(
      keyExpiryGauges({
        now,
        provisioner: new Date('2026-10-15T11:00:00.000Z'),
        tenant: new Date('2026-10-01T00:00:00.000Z'),
        platform: new Date('2026-11-04T12:00:00.000Z'),
      }),
    ).toEqual([
      { keyClass: 'provisioner', days: 9 },
      { keyClass: 'tenant', days: 0 },
      { keyClass: 'platform', days: 30 },
    ])
  })

  it('no READY tenant rows is the green sentinel; no platform tag is 0', () => {
    expect(keyExpiryGauges({ now, provisioner: undefined, tenant: null, platform: null })).toEqual([
      { keyClass: 'tenant', days: NO_TENANT_KEYS_DAYS },
      { keyClass: 'platform', days: 0 },
    ])
  })
})
