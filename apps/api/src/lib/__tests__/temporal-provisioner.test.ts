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
  runTemporalProvisioner,
  type CloudOpsPort,
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

// ---------------------------------------------------------------------------
// Fake Temporal Cloud
// ---------------------------------------------------------------------------

type FakeKey = { id: string; ownerId: string; token: string; resourceVersion: string }

class FakeCloud implements CloudOpsPort {
  namespaces = new Map<string, { resourceVersion: string; state: string }>()
  serviceAccounts = new Map<string, { name: string; namespace: string }>()
  keys = new Map<string, FakeKey>()
  calls: string[] = []
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

  async createApiKey(input: { ownerId: string }) {
    this.calls.push('createApiKey')
    this.maybeFail('createApiKey', 'before')
    const key: FakeKey = {
      id: this.next('key'),
      ownerId: input.ownerId,
      token: `token-${this.seq}`,
      resourceVersion: this.next('rv'),
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

function deps(
  cloud: FakeCloud,
  overrides: Partial<ProvisionerDeps> = {},
): ProvisionerDeps & {
  logged: unknown[]
} {
  const logged: unknown[] = []
  const log = (...args: unknown[]) => void logged.push(args)
  let clock = new Date('2026-10-05T12:00:00.000Z').getTime()
  return {
    repo,
    cloud,
    env: 'test',
    checkReady: vi.fn(async () => true),
    logger: { info: log, warn: log, error: log },
    now: () => new Date(clock),
    sleep: async (ms: number) => {
      clock += ms
    },
    logged,
    ...overrides,
  }
}

async function freshRow() {
  await db.tenantTemporalNamespace.deleteMany({ where: { tenantId } })
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
  })

  beforeEach(freshRow)

  afterAll(async () => {
    await db.tenantTemporalNamespace.deleteMany({ where: { tenantId } })
    await db.tenant.deleteMany({ where: { slug: TEST_TENANT_SLUG } })
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
})
