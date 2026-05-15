// ---------------------------------------------------------------------------
// AVP per-tenant policy-store reconciliation.
//
// Runs at deploy time (via the SyncAvpPoliciesTrigger in api-stack.ts) to
// converge every existing tenant's AVP policy store onto the current set of
// `.cedar` files. Without this, policy-file changes in the repo would only
// land for tenants provisioned AFTER the change — anything pre-existing
// would silently keep its stale policies, and a removed or renamed group
// would leave existing users with no matching permit clause (the bug that
// surfaced in CI for the legacy-role catalog replacement).
//
// Algorithm per tenant:
//   1. ListPolicies (static only — we don't use TEMPLATE_LINKED).
//   2. DeletePolicy for each existing static policy.
//   3. CreatePolicy from every `.cedar` file via loadPolicies().
//
// AVP has no atomic "replace" primitive, so step 2 → step 3 leaves a brief
// window where the tenant has *no* policies; concurrent IsAuthorized calls
// during that window will deny. Deploys happen during low-traffic windows
// and the gap is sub-second per tenant in practice. If that ever becomes a
// problem the future fix is to additively create new policies, switch all
// callers, then delete the old set — but that needs deterministic policy
// IDs which AVP doesn't expose for static policies, so we'd need to encode
// the policy name into the description and dedupe. Out of scope today.
// ---------------------------------------------------------------------------

import {
  VerifiedPermissionsClient,
  ListPoliciesCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
} from '@aws-sdk/client-verifiedpermissions'
import type { PolicyItem } from '@aws-sdk/client-verifiedpermissions'
import { loadPolicies } from '../authz/load'
import { db } from '../db'
import { createLogger } from './logger'

const logger = createLogger('pegasus-authz-sync')

let _avp: VerifiedPermissionsClient | null = null
function getAvp(): VerifiedPermissionsClient {
  return (_avp ??= new VerifiedPermissionsClient({}))
}

/** Test seam — lets the unit suite swap in a mocked AVP client. */
export function _setAvpClientForTesting(client: VerifiedPermissionsClient | null): void {
  _avp = client
}

export interface SyncTenantResult {
  readonly policyStoreId: string
  readonly deleted: number
  readonly created: number
}

/**
 * Lists every static policy in the store. Paginates if AVP returns a
 * continuation token (the catalog is small today but the API is paginated).
 */
async function listAllStaticPolicies(policyStoreId: string): Promise<readonly PolicyItem[]> {
  const out: PolicyItem[] = []
  let nextToken: string | undefined
  do {
    const res = await getAvp().send(
      new ListPoliciesCommand({
        policyStoreId,
        filter: { policyType: 'STATIC' },
        nextToken,
      }),
    )
    if (res.policies) out.push(...res.policies)
    nextToken = res.nextToken
  } while (nextToken)
  return out
}

/** Wraps an AVP SDK error so the per-tenant aggregate identifies which AVP
 *  call (and which policy file, when relevant) caused the failure. AWS SDK
 *  error messages are typically generic ("Invalid input") without naming the
 *  offending call. AVP's ValidationException additionally carries a
 *  `fieldList` of {path, message} pairs telling us exactly which field of
 *  the request was rejected — surfaced here because "Invalid input" alone
 *  hides the root cause behind a uniform aggregate. */
function annotate(err: unknown, context: string): Error {
  const name = (err as { name?: string }).name ?? 'Error'
  const message = err instanceof Error ? err.message : String(err)
  const fieldList = (err as { fieldList?: Array<{ path?: string; message?: string }> }).fieldList
  const fieldDetail =
    fieldList && fieldList.length > 0
      ? ` fields=[${fieldList.map((f) => `${f.path ?? '?'}:${f.message ?? '?'}`).join(' | ')}]`
      : ''
  return new Error(`${context}: ${name}: ${message}${fieldDetail}`)
}

/**
 * Reconciles one tenant's AVP policy store to the current `.cedar` files.
 * Deletes every existing static policy, then recreates from disk. Idempotent.
 */
export async function syncTenantPolicies(policyStoreId: string): Promise<SyncTenantResult> {
  const avp = getAvp()

  let existing: readonly PolicyItem[]
  try {
    existing = await listAllStaticPolicies(policyStoreId)
  } catch (err) {
    throw annotate(err, 'ListPolicies')
  }

  // Delete sequentially to stay well under AVP's per-store throttle. The
  // catalog is ~15 policies; ~15 × 50ms ≈ 0.75s — fine for a deploy hook.
  for (const p of existing) {
    if (!p.policyId) continue
    try {
      await avp.send(new DeletePolicyCommand({ policyStoreId, policyId: p.policyId }))
    } catch (err) {
      throw annotate(err, `DeletePolicy(${p.policyId})`)
    }
  }

  // Recreate from current files. Parallel — these calls are independent and
  // we want the gap-without-policies window to close as fast as possible.
  const files = loadPolicies()
  await Promise.all(
    files.map(async (f) => {
      try {
        await avp.send(
          new CreatePolicyCommand({
            policyStoreId,
            definition: { static: { description: f.name, statement: f.statement } },
          }),
        )
      } catch (err) {
        throw annotate(err, `CreatePolicy(${f.name})`)
      }
    }),
  )

  return { policyStoreId, deleted: existing.length, created: files.length }
}

export interface SyncAllResult {
  readonly tenantsAttempted: number
  readonly tenantsSucceeded: number
  readonly tenantsFailed: number
  readonly failures: ReadonlyArray<{ readonly policyStoreId: string; readonly error: string }>
}

/**
 * Reconciles every tenant with a non-null `policyStoreId`. Per-tenant
 * failures are collected and reported in the result rather than thrown
 * mid-flight — the deploy Trigger inspects the aggregate and fails the
 * deploy if any tenant came back broken.
 *
 * Concurrency: 4-wide pool. Higher fanout risks AVP throttling at scale;
 * lower wastes deploy time. Adjust if the tenant count grows past ~200.
 */
export async function syncAllTenantPolicies(): Promise<SyncAllResult> {
  const tenants = await db.tenant.findMany({
    where: { policyStoreId: { not: null } },
    select: { id: true, slug: true, policyStoreId: true },
  })

  logger.info('Beginning AVP policy reconciliation', { tenantCount: tenants.length })

  const failures: Array<{ policyStoreId: string; error: string }> = []
  let succeeded = 0
  const CONCURRENCY = 4

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < tenants.length) {
      const i = cursor++
      const t = tenants[i]
      if (!t?.policyStoreId) continue
      try {
        const res = await syncTenantPolicies(t.policyStoreId)
        succeeded++
        logger.info('Tenant policies synced', {
          tenantId: t.id,
          tenantSlug: t.slug,
          policyStoreId: res.policyStoreId,
          deleted: res.deleted,
          created: res.created,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failures.push({ policyStoreId: t.policyStoreId, error: message })
        logger.error('Tenant policy sync failed', {
          tenantId: t.id,
          tenantSlug: t.slug,
          policyStoreId: t.policyStoreId,
          error: message,
        })
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return {
    tenantsAttempted: tenants.length,
    tenantsSucceeded: succeeded,
    tenantsFailed: failures.length,
    failures,
  }
}
