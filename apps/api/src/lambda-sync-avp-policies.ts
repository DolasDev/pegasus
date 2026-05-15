// ---------------------------------------------------------------------------
// Deploy-time Lambda — reconciles every tenant's AVP policy store onto the
// current `.cedar` files.
//
// Invoked by the SyncAvpPoliciesTrigger custom resource in
// packages/infra/lib/stacks/api-stack.ts on every CDK deploy. The Trigger
// runs *after* the API Lambda is updated so the .cedar files baked into
// this asset match what the runtime will read.
//
// Fail-loud: if any tenant fails to reconcile, the handler throws and the
// Trigger fails the CFN deploy. A stale tenant policy store is a quiet
// authorisation outage — better to block the deploy and force a human to
// look than to ship green and discover the broken tenant in pager traffic.
// ---------------------------------------------------------------------------

import { syncAllTenantPolicies } from './lib/authz-sync'
import { createLogger } from './lib/logger'

const logger = createLogger('pegasus-sync-avp-policies')

export async function handler(): Promise<{
  tenantsAttempted: number
  tenantsSucceeded: number
}> {
  const result = await syncAllTenantPolicies()

  logger.info('Reconciliation finished', {
    tenantsAttempted: result.tenantsAttempted,
    tenantsSucceeded: result.tenantsSucceeded,
    tenantsFailed: result.tenantsFailed,
  })

  if (result.tenantsFailed > 0) {
    const summary = result.failures.map((f) => `${f.policyStoreId}: ${f.error}`).join('; ')
    throw new Error(
      `AVP policy reconciliation failed for ${result.tenantsFailed}/${result.tenantsAttempted} tenant(s): ${summary}`,
    )
  }

  return {
    tenantsAttempted: result.tenantsAttempted,
    tenantsSucceeded: result.tenantsSucceeded,
  }
}
