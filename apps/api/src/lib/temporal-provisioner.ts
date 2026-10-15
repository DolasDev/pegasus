// ---------------------------------------------------------------------------
// Temporal namespace provisioner (Phase 3b) — the logic behind
// lambda-temporal-provisioner.ts, with every dependency injected so it is
// testable without Temporal Cloud.
//
// Actions
// ───────
//   provision   PROVISIONING → READY. Creates `pg-<env>-<12 hex>`, a
//               namespace-scoped Write service account and its API key;
//               stores the key KMS-encrypted; waits until the key is
//               authorized on the namespace.
//   rotate      unchanged status (any KEY_HOLDING_STATUSES). Mints a new key into the row's PENDING slot,
//               and promotes it to current only once it is authorized on the
//               namespace; the old key stays alive for a grace period
//               (running runners keep working). A rotation that never
//               verifies leaves the old key current: an unverified key is
//               never served.
//   deprovision DEPROVISIONING → (row deleted). Deletes the keys and the
//               namespace (which takes its scoped service account with it).
//   retire-previous-keys  Deletes rotated-out keys whose grace period has
//               passed. Kept for one release: the daily rule now sends
//               daily-maintenance, which runs this sweep first.
//   rotate-own-key  Rotates the provisioner's OWN Cloud Ops key when it is
//               within ROTATE_WITHIN_MS of expiry (or `force`).
//   daily-maintenance  The scheduled action. Each step is isolated (one
//               failing doesn't skip the rest): retire previous keys, discard
//               pending keys left by dead rotations, rotate the own key if
//               due, publish the key-expiry gauges, rotate tenant keys that
//               are due.
//
// Resumability: every provision step checks the state of Temporal Cloud and
// of the row before acting, so re-invoking after any failure — including a
// lost response from a create that did happen — converges without creating
// duplicates. `step` on the row records the last completed step.
//
// Token-once: Temporal Cloud returns an API key's token exactly once. It is
// stored (encrypted) immediately after the create call returns, before any
// other call that could fail. A key whose token never reached the row can't
// be recovered, and can't be found either: the provisioner may create, read
// and delete a tenant account's keys BY ID, but listing them is refused (403,
// verified 2026-10-13). Such an orphan is harmless (nobody holds its token)
// and is deleted with the namespace, which takes the account and its keys.
//
// Concurrency: each per-tenant action holds the row's lease for its whole
// run (`claimLease`), gated on the status that action expects. A run killed
// by the Lambda timeout leaves the lease to expire on its own.
//
// Never logs key material: logs carry tenantId, action, step and Cloud ids.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import {
  KEY_HOLDING_STATUSES,
  type TenantTemporalNamespaceRepository,
} from '../repositories/tenant-temporal-namespace.repository'
import {
  assertProvisionableName,
  type CloudOpsLogger,
  type TemporalCloudOpsClient,
} from './temporal-cloud-ops'

export type CloudOpsPort = Pick<
  TemporalCloudOpsClient,
  | 'createNamespace'
  | 'getNamespace'
  | 'deleteNamespace'
  | 'createScopedServiceAccount'
  | 'findServiceAccountByName'
  | 'createApiKey'
  | 'getApiKey'
  | 'listOwnApiKeys'
  | 'deleteApiKey'
  | 'waitForOperation'
>

export type ProvisionerEvent =
  | { action: 'provision' | 'rotate' | 'deprovision'; tenantId: string }
  | { action: 'retire-previous-keys' }
  | { action: 'daily-maintenance' }
  | { action: 'rotate-own-key'; force?: boolean }

export type ProvisionerResult =
  | { outcome: 'done' }
  | { outcome: 'failed' }
  | { outcome: 'skipped'; reason: 'no_row' | 'not_claimable' }

/** The provisioner's own credential, in `pegasus/<env>/temporal-provisioner`. */
export type OwnKeyPort = {
  /** The key id the last self-rotation recorded in the secret; null before the first one. */
  recordedKeyId: () => Promise<string | null>
  /** True once `token` authenticates to Cloud Ops (a fresh client) and sees key `keyId`. */
  verify: (token: string, keyId: string) => Promise<boolean>
  /** Writes the new key as the secret's current version. The only write of the secret. */
  store: (key: { apiKey: string; keyId: string; expiresAt: Date }) => Promise<void>
}

export type KeyClass = 'provisioner' | 'tenant' | 'platform'

export const TEMPORAL_KEY_DAYS_TO_EXPIRY_METRIC = 'TemporalKeyDaysToExpiry'
export const TEMPORAL_KEY_ROTATION_FAILED_METRIC = 'TemporalKeyRotationFailed'

export type KeyMetric =
  | { name: typeof TEMPORAL_KEY_DAYS_TO_EXPIRY_METRIC; keyClass: KeyClass; value: number }
  | { name: typeof TEMPORAL_KEY_ROTATION_FAILED_METRIC; value: number }

export type ProvisionerDeps = {
  repo: TenantTemporalNamespaceRepository
  cloud: CloudOpsPort
  /** Deploy env; the only env whose namespace names may be touched. */
  env: string
  /**
   * True once `apiKey` is authorized on `namespace` at `grpcAddress`
   * (gRPC DescribeNamespace). False or a throw means "not yet".
   */
  checkReady: (target: {
    namespace: string
    grpcAddress: string
    apiKey: string
  }) => Promise<boolean>
  ownKey: OwnKeyPort
  /**
   * Expiry of the platform key (`pegasus/<env>/temporal-cloud`), from the
   * secret's `expiresAt` TAG — metadata only, never the secret value. Null
   * when the tag is missing or invalid.
   */
  platformKeyExpiresAt: () => Promise<Date | null>
  publishMetrics: (metrics: KeyMetric[]) => Promise<void>
  logger: CloudOpsLogger
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

const DAY_MS = 24 * 60 * 60 * 1000
const REGION = 'aws-us-east-1'
const RETENTION_DAYS = 7
const KEY_TTL_MS = 365 * DAY_MS
const KEY_GRACE_MS = DAY_MS
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000
const NAMESPACE_POLL_MS = 5_000
/** About 90 s was seen in Phase 2; give up well after that. */
const READINESS_TIMEOUT_MS = 10 * 60 * 1000
const READINESS_POLL_MS = 10_000
/** Matches the Lambda's 15-minute timeout. */
const LEASE_MS = 15 * 60 * 1000
const MAX_ERROR_LENGTH = 1000

/**
 * Keys (tenant and own) are rotated once they are this close to expiry. The
 * expiry alarms fire at 30 days, so the daily run gets 15 tries before anyone
 * is paged.
 */
export const ROTATE_WITHIN_MS = 45 * DAY_MS
/** How long a new own key may take to authenticate (propagation). */
const OWN_KEY_VERIFY_TIMEOUT_MS = 5 * 60 * 1000
const OWN_KEY_VERIFY_POLL_MS = 15_000
/**
 * Tenant rotations per daily run, at most. Each takes ~2 minutes when it
 * works, up to 15 when it doesn't; the next day picks up the rest.
 */
export const SWEEP_MAX_ROTATIONS = 20
/**
 * No tenant rotation STARTS after this much of the daily run has gone. The
 * Lambda timeout can't be caught, so the steps that must always run (own
 * key, gauges) run first, and the sweep stops starting work early. A rotation
 * cut off by the timeout is safe: its key is still pending, and the next run
 * discards it.
 */
export const SWEEP_START_BUDGET_MS = 5 * 60 * 1000
/** The tenant gauge with no key-holding rows: nothing can expire, so stay green. */
export const NO_TENANT_KEYS_DAYS = 365

export const PROVISION_STEPS = [
  'namespace_created',
  'service_account_created',
  'api_key_stored',
  'ready',
] as const

const FAILED_NAMESPACE_STATES = new Set([
  'RESOURCE_STATE_ACTIVATION_FAILED',
  'RESOURCE_STATE_UPDATE_FAILED',
  'RESOURCE_STATE_DELETE_FAILED',
  'RESOURCE_STATE_SUSPENDED',
  'RESOURCE_STATE_EXPIRED',
])

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return msg.slice(0, MAX_ERROR_LENGTH)
}

/** Whole days from `now` to `expiresAt`, floored at 0. */
function daysUntil(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS))
}

/**
 * The `TemporalKeyDaysToExpiry` gauges. `provisioner` undefined (its expiry
 * couldn't be read) emits nothing, so the alarm's missing-data rule fires.
 * No key-holding tenant rows (KEY_HOLDING_STATUSES) emits NO_TENANT_KEYS_DAYS. A missing platform tag
 * emits 0: the alarm fires until someone records the expiry.
 */
export function keyExpiryGauges(input: {
  now: Date
  provisioner: Date | undefined
  tenant: Date | null
  platform: Date | null
}): Array<{ keyClass: KeyClass; days: number }> {
  const out: Array<{ keyClass: KeyClass; days: number }> = []
  if (input.provisioner) {
    out.push({ keyClass: 'provisioner', days: daysUntil(input.provisioner, input.now) })
  }
  out.push({
    keyClass: 'tenant',
    days: input.tenant ? daysUntil(input.tenant, input.now) : NO_TENANT_KEYS_DAYS,
  })
  out.push({
    keyClass: 'platform',
    days: input.platform ? daysUntil(input.platform, input.now) : 0,
  })
  return out
}

export async function runTemporalProvisioner(
  event: ProvisionerEvent,
  deps: ProvisionerDeps,
): Promise<ProvisionerResult> {
  const { repo, cloud, env, logger: log } = deps
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  // Temporal treats async_operation_id as an idempotency key: reusing one for
  // a different operation is a 409. So every OPERATION gets its own id — a
  // nonce per run (a retried run never reuses an earlier run's ids) plus a
  // counter within the run (one run can delete several keys of one tenant).
  const nonce = randomBytes(6).toString('hex')
  let opSeq = 0
  const opId = (tenantId: string, what: string) => `${tenantId}-${what}-${nonce}-${++opSeq}`
  const wait = (id: string) => cloud.waitForOperation(id, { timeoutMs: OPERATION_TIMEOUT_MS })

  async function deleteKeyIfExists(tenantId: string, keyId: string): Promise<void> {
    const key = await cloud.getApiKey(keyId)
    if (!key) return
    const del = await cloud.deleteApiKey({
      keyId,
      resourceVersion: key.resourceVersion,
      asyncOperationId: opId(tenantId, 'delete-key'),
    })
    await wait(del.asyncOperationId)
    log.info('temporal_provisioner.key_deleted', { audit: true, tenantId, apiKeyId: keyId })
  }

  /** Polls `checkReady` until the key is authorized; throws after READINESS_TIMEOUT_MS. */
  async function waitUntilAuthorized(
    tenantId: string,
    target: { namespace: string; grpcAddress: string; apiKey: string },
  ): Promise<void> {
    const start = now().getTime()
    for (;;) {
      let ready = false
      try {
        ready = await deps.checkReady(target)
      } catch (err) {
        log.info('temporal_provisioner.not_ready_yet', { tenantId, error: errorMessage(err) })
      }
      if (ready) return
      if (now().getTime() - start + READINESS_POLL_MS > READINESS_TIMEOUT_MS) {
        throw new Error(
          `key not authorized on ${target.namespace} after ${READINESS_TIMEOUT_MS / 1000}s`,
        )
      }
      await sleep(READINESS_POLL_MS)
    }
  }

  /**
   * Deletes the rotated-out key, but only after confirming the CURRENT key
   * is authorized: if the current key doesn't work, the previous key may be
   * the only one that does, and deleting it would cut every runner off.
   */
  async function retirePreviousKey(tenantId: string, previousApiKeyId: string): Promise<void> {
    const current = await repo.getDecryptedKey(tenantId)
    let ready = false
    if (current) {
      try {
        ready = await deps.checkReady({
          namespace: current.namespace,
          grpcAddress: current.grpcAddress,
          apiKey: current.apiKey,
        })
      } catch (err) {
        log.warn('temporal_provisioner.current_key_check_failed', {
          tenantId,
          error: errorMessage(err),
        })
      }
    }
    if (!ready) {
      throw new Error(`current key not authorized; previous key ${previousApiKeyId} kept`)
    }
    await deleteKeyIfExists(tenantId, previousApiKeyId)
    await repo.clearPreviousKey(tenantId)
  }

  async function waitNamespaceActive(namespace: string) {
    const start = now().getTime()
    for (;;) {
      const ns = await cloud.getNamespace(namespace)
      if (ns?.state === 'RESOURCE_STATE_ACTIVE') return ns
      if (ns && FAILED_NAMESPACE_STATES.has(ns.state)) {
        throw new Error(`namespace ${namespace} is ${ns.state}`)
      }
      if (now().getTime() - start + NAMESPACE_POLL_MS > OPERATION_TIMEOUT_MS) {
        throw new Error(
          `namespace ${namespace} not active in time (state ${ns?.state ?? 'missing'})`,
        )
      }
      await sleep(NAMESPACE_POLL_MS)
    }
  }

  async function withLease(
    action: string,
    tenantId: string,
    statuses: Parameters<TenantTemporalNamespaceRepository['claimLease']>[1],
    body: () => Promise<void>,
    onError: (message: string) => Promise<void>,
  ): Promise<ProvisionerResult> {
    const t = now()
    const claimed = await repo.claimLease(tenantId, statuses, {
      now: t,
      until: new Date(t.getTime() + LEASE_MS),
    })
    if (!claimed) {
      log.info('temporal_provisioner.skipped', { tenantId, action, reason: 'not_claimable' })
      return { outcome: 'skipped', reason: 'not_claimable' }
    }
    try {
      await body()
      log.info('temporal_provisioner.done', { tenantId, action })
      return { outcome: 'done' }
    } catch (err) {
      const message = errorMessage(err)
      log.error('temporal_provisioner.failed', { tenantId, action, error: message })
      await onError(message)
      return { outcome: 'failed' }
    } finally {
      await repo.releaseLease(tenantId)
    }
  }

  // -------------------------------------------------------------------------
  // provision
  // -------------------------------------------------------------------------

  async function provisionTenant(tenantId: string, namespace: string): Promise<ProvisionerResult> {
    const name = namespace.split('.')[0]!
    const serviceAccountName = `${name}-writer`
    return withLease(
      'provision',
      tenantId,
      ['PROVISIONING'],
      async () => {
        assertProvisionableName(env, namespace)
        // Re-read under the lease: another run may have advanced the row.
        const row = (await repo.findByTenant(tenantId))!
        const done = (step: (typeof PROVISION_STEPS)[number]) =>
          row.step !== null &&
          PROVISION_STEPS.indexOf(row.step as (typeof PROVISION_STEPS)[number]) >=
            PROVISION_STEPS.indexOf(step)
        let grpcAddress = row.grpcAddress

        // 1. Namespace.
        if (!done('namespace_created')) {
          if (!(await cloud.getNamespace(namespace))) {
            const created = await cloud.createNamespace({
              name,
              retentionDays: RETENTION_DAYS,
              region: REGION,
              asyncOperationId: opId(tenantId, 'create-namespace'),
            })
            if (created.namespace !== namespace) {
              throw new Error(`Cloud created namespace ${created.namespace}, expected ${namespace}`)
            }
            log.info('temporal_provisioner.namespace_created', { audit: true, tenantId, namespace })
            await wait(created.asyncOperationId)
          }
          const ns = await waitNamespaceActive(namespace)
          if (ns.grpcAddress) grpcAddress = ns.grpcAddress
          await repo.markStep(tenantId, 'namespace_created', { grpcAddress })
        }

        // 2. Namespace-scoped Write service account.
        let serviceAccountId = row.cloudServiceAccountId
        if (!serviceAccountId) {
          const existing = await cloud.findServiceAccountByName(serviceAccountName)
          if (existing) {
            serviceAccountId = existing.id
          } else {
            const created = await cloud.createScopedServiceAccount({
              name: serviceAccountName,
              namespace,
              description: `Write access to ${namespace} only (Pegasus tenant ${tenantId})`,
              asyncOperationId: opId(tenantId, 'create-service-account'),
            })
            serviceAccountId = created.serviceAccountId
            log.info('temporal_provisioner.service_account_created', {
              audit: true,
              tenantId,
              serviceAccountId,
            })
            await wait(created.asyncOperationId)
          }
          await repo.markStep(tenantId, 'service_account_created', {
            cloudServiceAccountId: serviceAccountId,
          })
        }

        // 3. API key — stored before anything else can fail. A key minted by
        //    an earlier run whose token never reached the row is an orphan:
        //    nobody holds its token, and the provisioner can't list the
        //    account's keys to find it (403), so it stays until deprovision
        //    deletes the namespace, which takes the account and its keys.
        if (row.apiKeyId === null) {
          const expiresAt = new Date(now().getTime() + KEY_TTL_MS)
          const key = await cloud.createApiKey({
            ownerId: serviceAccountId,
            displayName: `${name}-key`,
            expiryTime: expiresAt,
            asyncOperationId: opId(tenantId, 'create-key'),
          })
          await repo.storeKey(tenantId, { apiKeyId: key.keyId, token: key.token, expiresAt })
          log.info('temporal_provisioner.key_created', {
            audit: true,
            tenantId,
            apiKeyId: key.keyId,
          })
          await wait(key.asyncOperationId)
          await repo.markStep(tenantId, 'api_key_stored')
        }

        // 4. Readiness: the stored key, through the API's own decrypt path.
        const stored = await repo.getDecryptedKey(tenantId)
        if (!stored) throw new Error('no stored key after the key step')
        await waitUntilAuthorized(tenantId, { namespace, grpcAddress, apiKey: stored.apiKey })
        await repo.markStep(tenantId, 'ready')
        await repo.markReady(tenantId)
      },
      (message) => repo.markFailed(tenantId, message),
    )
  }

  // -------------------------------------------------------------------------
  // rotate
  // -------------------------------------------------------------------------

  async function rotateTenant(tenantId: string, namespace: string): Promise<ProvisionerResult> {
    const name = namespace.split('.')[0]!
    return withLease(
      'rotate',
      tenantId,
      // Every status that holds a served key keeps rotating — a cut-over
      // (ACTIVE) tenant above all. Rotation never changes the status.
      [...KEY_HOLDING_STATUSES],
      async () => {
        assertProvisionableName(env, namespace)
        const row = (await repo.findByTenant(tenantId))!
        const serviceAccountId = row.cloudServiceAccountId
        if (!serviceAccountId) throw new Error(`${row.status} row has no service account`)

        // 1. Discard the pending key a dead rotation left behind (by id: the
        //    provisioner can't list the account's keys). A key whose token
        //    never reached the row is an orphan until deprovision.
        if (row.pendingApiKeyId !== null) {
          await deleteKeyIfExists(tenantId, row.pendingApiKeyId)
          await repo.clearPendingKey(tenantId)
          log.info('temporal_provisioner.pending_key_discarded', {
            audit: true,
            tenantId,
            apiKeyId: row.pendingApiKeyId,
          })
        }

        // 2. Only one rotated-out key at a time.
        if (row.previousApiKeyId !== null) {
          if (row.previousKeyRetireAt && row.previousKeyRetireAt > now()) {
            throw new Error(
              `previous key ${row.previousApiKeyId} is still in its grace period until ${row.previousKeyRetireAt.toISOString()}`,
            )
          }
          await retirePreviousKey(tenantId, row.previousApiKeyId)
        }

        // 3. Mint into the pending slot, stored before anything else can fail.
        const expiresAt = new Date(now().getTime() + KEY_TTL_MS)
        const key = await cloud.createApiKey({
          ownerId: serviceAccountId,
          displayName: `${name}-key`,
          expiryTime: expiresAt,
          asyncOperationId: opId(tenantId, 'rotate-key'),
        })
        await repo.storePendingKey(tenantId, { apiKeyId: key.keyId, token: key.token })
        log.info('temporal_provisioner.pending_key_created', {
          audit: true,
          tenantId,
          apiKeyId: key.keyId,
        })
        await wait(key.asyncOperationId)

        // 4. Serve it only once it works. On a timeout the old key stays
        //    current and the pending key is left for the next run to discard.
        const pending = await repo.getDecryptedPendingKey(tenantId)
        if (!pending) throw new Error('no pending key after the mint step')
        await waitUntilAuthorized(tenantId, {
          namespace,
          grpcAddress: pending.grpcAddress,
          apiKey: pending.apiKey,
        })
        await repo.promotePendingKey(tenantId, {
          expectedPendingApiKeyId: key.keyId,
          expiresAt,
          retireAt: new Date(now().getTime() + KEY_GRACE_MS),
        })
        log.info('temporal_provisioner.key_rotated', {
          audit: true,
          tenantId,
          apiKeyId: key.keyId,
          previousApiKeyId: row.apiKeyId,
        })
      },
      // The old key still works: a failed rotate leaves the row (and its status) intact.
      (message) => repo.setLastError(tenantId, message),
    )
  }

  // -------------------------------------------------------------------------
  // deprovision
  // -------------------------------------------------------------------------

  async function deprovisionTenant(
    tenantId: string,
    namespace: string,
  ): Promise<ProvisionerResult> {
    return withLease(
      'deprovision',
      tenantId,
      ['DEPROVISIONING'],
      async () => {
        assertProvisionableName(env, namespace)
        const row = (await repo.findByTenant(tenantId))!
        // The keys the row knows of, by id. Deleting the namespace then takes
        // its scoped service account with it, and any orphan key on it
        // (verified: both read 404 afterwards).
        for (const keyId of [row.apiKeyId, row.previousApiKeyId, row.pendingApiKeyId]) {
          if (keyId !== null) await deleteKeyIfExists(tenantId, keyId)
        }
        const ns = await cloud.getNamespace(namespace)
        if (ns) {
          const del = await cloud.deleteNamespace({
            namespace,
            resourceVersion: ns.resourceVersion,
            asyncOperationId: opId(tenantId, 'delete-namespace'),
          })
          log.info('temporal_provisioner.namespace_deleted', { audit: true, tenantId, namespace })
          await wait(del.asyncOperationId)
        }
        await repo.remove(tenantId)
      },
      (message) => repo.markFailed(tenantId, message),
    )
  }

  // -------------------------------------------------------------------------
  // Sweeps (each returns how many rows failed)
  // -------------------------------------------------------------------------

  async function retirePreviousKeysSweep(): Promise<number> {
    let failed = 0
    for (const row of await repo.findWithRetirablePreviousKey(now())) {
      const out = await withLease(
        'retire-previous-key',
        row.tenantId,
        [...KEY_HOLDING_STATUSES, 'FAILED'],
        () => retirePreviousKey(row.tenantId, row.previousApiKeyId!),
        (message) => repo.setLastError(row.tenantId, message),
      )
      if (out.outcome === 'failed') failed++
    }
    return failed
  }

  /**
   * Pending keys left by rotations that died or timed out. A rotation in
   * flight holds the lease, so its pending key is skipped here.
   */
  async function discardPendingKeysSweep(): Promise<number> {
    let failed = 0
    for (const row of await repo.findWithPendingKey()) {
      const out = await withLease(
        'discard-pending-key',
        row.tenantId,
        [...KEY_HOLDING_STATUSES, 'FAILED'],
        async () => {
          const current = (await repo.findByTenant(row.tenantId))!
          if (current.pendingApiKeyId === null) return
          await deleteKeyIfExists(row.tenantId, current.pendingApiKeyId)
          await repo.clearPendingKey(row.tenantId)
          log.info('temporal_provisioner.pending_key_discarded', {
            audit: true,
            tenantId: row.tenantId,
            apiKeyId: current.pendingApiKeyId,
          })
        },
        (message) => repo.setLastError(row.tenantId, message),
      )
      if (out.outcome === 'failed') failed++
    }
    return failed
  }

  async function rotateDueTenantKeysSweep(startedAt: number): Promise<number> {
    const t = now()
    const rows = await repo.findDueForRotation(
      { cutoff: new Date(t.getTime() + ROTATE_WITHIN_MS), now: t },
      SWEEP_MAX_ROTATIONS,
    )
    let failed = 0
    for (const [i, row] of rows.entries()) {
      if (now().getTime() - startedAt > SWEEP_START_BUDGET_MS) {
        log.info('temporal_provisioner.rotation_sweep_deferred', { remaining: rows.length - i })
        break
      }
      const out = await rotateTenant(row.tenantId, row.namespace)
      if (out.outcome === 'failed') failed++
    }
    return failed
  }

  // -------------------------------------------------------------------------
  // Own key
  // -------------------------------------------------------------------------

  /**
   * Rotates the provisioner's own Cloud Ops key when it is due (or `force`),
   * and returns the expiry of the key the secret now holds.
   *
   * Never deletes a key: the old key expires on its own within
   * ROTATE_WITHIN_MS, and AWSPREVIOUS still holds its token. That removes the
   * one dangerous failure (deleting the only working key). The secret is
   * written only after the new token is proven to authenticate.
   */
  async function rotateOwnKeyIfDue(force: boolean): Promise<{ expiresAt: Date | null }> {
    const keys = await cloud.listOwnApiKeys()
    const owners = new Set(keys.map((k) => k.ownerId))
    const ownerId = keys[0]?.ownerId
    if (!ownerId || owners.size !== 1) {
      // A provisioner key sees only its own account's keys (verified
      // 2026-10-12). Anything else means its role changed: touch nothing.
      throw new Error(
        `own-key listing should show the keys of exactly one service account, saw ${owners.size}`,
      )
    }

    const recorded = await deps.ownKey.recordedKeyId()
    let current = recorded ? keys.find((k) => k.id === recorded) : undefined
    if (!current) {
      if (keys.length > 1) {
        // Until the first self-rotation records the key id, the key in use
        // is ambiguous. Assume the soonest-expiring one: at worst that
        // rotates early, where the latest could hide the real expiry.
        log.warn('temporal_provisioner.own_key_ambiguous', {
          recordedKeyId: recorded,
          keyIds: keys.map((k) => k.id),
        })
      }
      current = [...keys].sort(
        (a, b) =>
          (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
      )[0]!
    }

    const due =
      current.expiresAt !== null && current.expiresAt.getTime() - now().getTime() < ROTATE_WITHIN_MS
    if (!due && !force) return { expiresAt: current.expiresAt }

    const expiresAt = new Date(now().getTime() + KEY_TTL_MS)
    const key = await cloud.createApiKey({
      ownerId,
      displayName: `pegasus-${env}-provisioner-key-${now().toISOString().slice(0, 10)}`,
      expiryTime: expiresAt,
      asyncOperationId: opId('provisioner', 'rotate-own-key'),
    })
    log.info('temporal_provisioner.own_key_created', {
      audit: true,
      apiKeyId: key.keyId,
      previousApiKeyId: current.id,
    })
    await wait(key.asyncOperationId)

    const start = now().getTime()
    for (;;) {
      let ok = false
      try {
        ok = await deps.ownKey.verify(key.token, key.keyId)
      } catch (err) {
        log.info('temporal_provisioner.own_key_not_ready_yet', { error: errorMessage(err) })
      }
      if (ok) break
      if (now().getTime() - start + OWN_KEY_VERIFY_POLL_MS > OWN_KEY_VERIFY_TIMEOUT_MS) {
        // The secret is untouched, so the old key stays in use. The new key's
        // token dies with this run; it expires unused.
        throw new Error(
          `new own key ${key.keyId} did not authenticate within ${OWN_KEY_VERIFY_TIMEOUT_MS / 1000}s; secret unchanged`,
        )
      }
      await sleep(OWN_KEY_VERIFY_POLL_MS)
    }

    await deps.ownKey.store({ apiKey: key.token, keyId: key.keyId, expiresAt })
    log.info('temporal_provisioner.own_key_rotated', {
      audit: true,
      apiKeyId: key.keyId,
      previousApiKeyId: current.id,
      expiresAt: expiresAt.toISOString(),
    })
    return { expiresAt }
  }

  // -------------------------------------------------------------------------
  // daily-maintenance
  // -------------------------------------------------------------------------

  async function dailyMaintenance(): Promise<ProvisionerResult> {
    const startedAt = now().getTime()
    let failures = 0

    /** Runs one step in isolation; returns its value, or undefined if it threw. */
    async function step<T>(name: string, body: () => Promise<T>): Promise<T | undefined> {
      try {
        return await body()
      } catch (err) {
        failures++
        log.error('temporal_provisioner.maintenance_step_failed', {
          step: name,
          error: errorMessage(err),
        })
        return undefined
      }
    }

    failures += (await step('retire-previous-keys', retirePreviousKeysSweep)) ?? 0
    failures += (await step('discard-pending-keys', discardPendingKeysSweep)) ?? 0
    const own = await step('rotate-own-key', () => rotateOwnKeyIfDue(false))

    // Gauges before the tenant sweep, so a sweep cut off by the Lambda
    // timeout can't cost the day's datapoints. A due tenant key is still
    // above the 30-day alarm threshold here (rotation starts at 45).
    await step('publish-gauges', async () => {
      const t = now()
      let platform: Date | null = null
      try {
        platform = await deps.platformKeyExpiresAt()
      } catch (err) {
        log.warn('temporal_provisioner.platform_expiry_unreadable', { error: errorMessage(err) })
      }
      const gauges = keyExpiryGauges({
        now: t,
        provisioner: own?.expiresAt ?? undefined,
        tenant: await repo.earliestReadyKeyExpiry(),
        platform,
      })
      await deps.publishMetrics([
        ...gauges.map((g): KeyMetric => ({
          name: TEMPORAL_KEY_DAYS_TO_EXPIRY_METRIC,
          keyClass: g.keyClass,
          value: g.days,
        })),
        { name: TEMPORAL_KEY_ROTATION_FAILED_METRIC, value: failures },
      ])
      log.info('temporal_provisioner.key_gauges', { gauges, failures })
    })

    const sweepFailures = await step('rotate-tenant-keys', () =>
      rotateDueTenantKeysSweep(startedAt),
    )
    failures += sweepFailures ?? 0
    // Summed per day by the alarm, so this adds to the datapoint above.
    if (sweepFailures !== undefined && sweepFailures > 0) {
      await step('publish-sweep-failures', () =>
        deps.publishMetrics([{ name: TEMPORAL_KEY_ROTATION_FAILED_METRIC, value: sweepFailures }]),
      )
    }

    log.info('temporal_provisioner.maintenance_done', { failures })
    return failures > 0 ? { outcome: 'failed' } : { outcome: 'done' }
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  if (event.action === 'daily-maintenance') return dailyMaintenance()

  if (event.action === 'retire-previous-keys') {
    await retirePreviousKeysSweep()
    return { outcome: 'done' }
  }

  if (event.action === 'rotate-own-key') {
    try {
      await rotateOwnKeyIfDue(event.force === true)
      return { outcome: 'done' }
    } catch (err) {
      log.error('temporal_provisioner.failed', { action: event.action, error: errorMessage(err) })
      return { outcome: 'failed' }
    }
  }

  const { tenantId } = event
  const initial = await repo.findByTenant(tenantId)
  if (!initial) {
    log.info('temporal_provisioner.skipped', { tenantId, action: event.action, reason: 'no_row' })
    return { outcome: 'skipped', reason: 'no_row' }
  }

  if (event.action === 'provision') return provisionTenant(tenantId, initial.namespace)
  if (event.action === 'deprovision') return deprovisionTenant(tenantId, initial.namespace)

  const out = await rotateTenant(tenantId, initial.namespace)
  if (out.outcome === 'failed') {
    try {
      await deps.publishMetrics([{ name: TEMPORAL_KEY_ROTATION_FAILED_METRIC, value: 1 }])
    } catch (err) {
      log.warn('temporal_provisioner.metric_publish_failed', { error: errorMessage(err) })
    }
  }
  return out
}
