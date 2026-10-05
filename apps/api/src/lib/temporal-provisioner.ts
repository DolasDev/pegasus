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
//   rotate      READY → READY. Mints a new key and keeps the old one alive
//               for a grace period (running runners keep working).
//   deprovision DEPROVISIONING → (row deleted). Deletes the keys and the
//               namespace (which takes its scoped service account with it).
//   retire-previous-keys  Scheduled sweep: deletes rotated-out keys whose
//               grace period has passed.
//
// Resumability: every provision step checks the state of Temporal Cloud and
// of the row before acting, so re-invoking after any failure — including a
// lost response from a create that did happen — converges without creating
// duplicates. `step` on the row records the last completed step.
//
// Token-once: Temporal Cloud returns an API key's token exactly once. It is
// stored (encrypted) immediately after the create call returns, before any
// other call that could fail. A key whose token never reached the row can't
// be recovered, so a resumed run deletes every key on the service account
// before minting a new one.
//
// Concurrency: each per-tenant action holds the row's lease for its whole
// run (`claimLease`), gated on the status that action expects. A run killed
// by the Lambda timeout leaves the lease to expire on its own.
//
// Never logs key material: logs carry tenantId, action, step and Cloud ids.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type { TenantTemporalNamespaceRepository } from '../repositories/tenant-temporal-namespace.repository'
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
  | 'listApiKeys'
  | 'deleteApiKey'
  | 'waitForOperation'
>

export type ProvisionerEvent =
  | { action: 'provision' | 'rotate' | 'deprovision'; tenantId: string }
  | { action: 'retire-previous-keys' }

export type ProvisionerResult =
  | { outcome: 'done' }
  | { outcome: 'failed' }
  | { outcome: 'skipped'; reason: 'no_row' | 'not_claimable' }

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
  logger: CloudOpsLogger
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

const REGION = 'aws-us-east-1'
const RETENTION_DAYS = 7
const KEY_TTL_MS = 365 * 24 * 60 * 60 * 1000
const KEY_GRACE_MS = 24 * 60 * 60 * 1000
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000
const NAMESPACE_POLL_MS = 5_000
/** About 90 s was seen in Phase 2; give up well after that. */
const READINESS_TIMEOUT_MS = 10 * 60 * 1000
const READINESS_POLL_MS = 10_000
/** Matches the Lambda's 15-minute timeout. */
const LEASE_MS = 15 * 60 * 1000
const MAX_ERROR_LENGTH = 1000

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

export async function runTemporalProvisioner(
  event: ProvisionerEvent,
  deps: ProvisionerDeps,
): Promise<ProvisionerResult> {
  const { repo, cloud, env, logger: log } = deps
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  // One nonce per run: Temporal treats async_operation_id as an idempotency
  // key, so a retried step must not reuse the id of an earlier failed one.
  const nonce = randomBytes(6).toString('hex')
  const opId = (tenantId: string, what: string) => `${tenantId}-${what}-${nonce}`
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

  /**
   * Deletes the rotated-out key, but only after confirming the CURRENT key
   * is authorized: if a rotation's new key never worked, the previous key
   * is the only one that does, and deleting it would cut every runner off.
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
      log.info('temporal_provisioner.skipped', {
        tenantId,
        action: event.action,
        reason: 'not_claimable',
      })
      return { outcome: 'skipped', reason: 'not_claimable' }
    }
    try {
      await body()
      log.info('temporal_provisioner.done', { tenantId, action: event.action })
      return { outcome: 'done' }
    } catch (err) {
      const message = errorMessage(err)
      log.error('temporal_provisioner.failed', { tenantId, action: event.action, error: message })
      await onError(message)
      return { outcome: 'failed' }
    } finally {
      await repo.releaseLease(tenantId)
    }
  }

  // -------------------------------------------------------------------------
  // retire-previous-keys
  // -------------------------------------------------------------------------

  if (event.action === 'retire-previous-keys') {
    const rows = await repo.findWithRetirablePreviousKey(now())
    for (const row of rows) {
      await withLease(
        row.tenantId,
        ['READY', 'FAILED'],
        () => retirePreviousKey(row.tenantId, row.previousApiKeyId!),
        (message) => repo.setLastError(row.tenantId, message),
      )
    }
    return { outcome: 'done' }
  }

  const { tenantId } = event
  const initial = await repo.findByTenant(tenantId)
  if (!initial) {
    log.info('temporal_provisioner.skipped', { tenantId, action: event.action, reason: 'no_row' })
    return { outcome: 'skipped', reason: 'no_row' }
  }
  const namespace = initial.namespace
  const name = namespace.split('.')[0]!
  const serviceAccountName = `${name}-writer`

  // -------------------------------------------------------------------------
  // provision
  // -------------------------------------------------------------------------

  if (event.action === 'provision') {
    return withLease(
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

        // 3. API key — stored before anything else can fail.
        if (row.apiKeyId === null) {
          // Any key already on the account was minted by a run whose token
          // never reached the row: unrecoverable, so delete it.
          for (const orphan of await cloud.listApiKeys(serviceAccountId)) {
            await deleteKeyIfExists(tenantId, orphan.id)
          }
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
        const start = now().getTime()
        for (;;) {
          let ready = false
          try {
            ready = await deps.checkReady({ namespace, grpcAddress, apiKey: stored.apiKey })
          } catch (err) {
            log.info('temporal_provisioner.not_ready_yet', { tenantId, error: errorMessage(err) })
          }
          if (ready) break
          if (now().getTime() - start + READINESS_POLL_MS > READINESS_TIMEOUT_MS) {
            throw new Error(
              `key not authorized on ${namespace} after ${READINESS_TIMEOUT_MS / 1000}s`,
            )
          }
          await sleep(READINESS_POLL_MS)
        }
        await repo.markStep(tenantId, 'ready')
        await repo.markReady(tenantId)
      },
      (message) => repo.markFailed(tenantId, message),
    )
  }

  // -------------------------------------------------------------------------
  // rotate
  // -------------------------------------------------------------------------

  if (event.action === 'rotate') {
    return withLease(
      tenantId,
      ['READY'],
      async () => {
        assertProvisionableName(env, namespace)
        const row = (await repo.findByTenant(tenantId))!
        if (!row.cloudServiceAccountId) throw new Error('READY row has no service account')
        if (row.previousApiKeyId !== null) {
          if (row.previousKeyRetireAt && row.previousKeyRetireAt > now()) {
            throw new Error(
              `previous key ${row.previousApiKeyId} is still in its grace period until ${row.previousKeyRetireAt.toISOString()}`,
            )
          }
          await retirePreviousKey(tenantId, row.previousApiKeyId)
        }
        const expiresAt = new Date(now().getTime() + KEY_TTL_MS)
        const key = await cloud.createApiKey({
          ownerId: row.cloudServiceAccountId,
          displayName: `${name}-key`,
          expiryTime: expiresAt,
          asyncOperationId: opId(tenantId, 'rotate-key'),
        })
        await repo.rotateKey(tenantId, {
          apiKeyId: key.keyId,
          token: key.token,
          expiresAt,
          retireAt: new Date(now().getTime() + KEY_GRACE_MS),
        })
        log.info('temporal_provisioner.key_rotated', {
          audit: true,
          tenantId,
          apiKeyId: key.keyId,
          previousApiKeyId: row.apiKeyId,
        })
        await wait(key.asyncOperationId)
      },
      // The old key still works: a failed rotate leaves the row READY.
      (message) => repo.setLastError(tenantId, message),
    )
  }

  // -------------------------------------------------------------------------
  // deprovision
  // -------------------------------------------------------------------------

  return withLease(
    tenantId,
    ['DEPROVISIONING'],
    async () => {
      assertProvisionableName(env, namespace)
      const row = (await repo.findByTenant(tenantId))!
      const serviceAccountId =
        row.cloudServiceAccountId ?? (await cloud.findServiceAccountByName(serviceAccountName))?.id
      if (serviceAccountId) {
        for (const key of await cloud.listApiKeys(serviceAccountId)) {
          await deleteKeyIfExists(tenantId, key.id)
        }
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
