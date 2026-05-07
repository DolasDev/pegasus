// ---------------------------------------------------------------------------
// AVP per-tenant policy-store provisioning.
//
// Called from POST /api/admin/tenants before opening the DB transaction.
// If anything after CreatePolicyStore fails we attempt a best-effort
// DeletePolicyStore so the AVP account doesn't leak orphan stores.
//
// Why runtime (not CDK custom resource): tenant lifecycle is owned by the API
// (create / suspend / offboard). Putting policy-store provisioning here keeps
// the lifecycle in one place and lets us evolve the schema without a CDK
// deploy per change.
// ---------------------------------------------------------------------------

import {
  VerifiedPermissionsClient,
  CreatePolicyStoreCommand,
  PutSchemaCommand,
  CreatePolicyCommand,
  CreateIdentitySourceCommand,
  DeletePolicyStoreCommand,
} from '@aws-sdk/client-verifiedpermissions'
import { loadPolicies, loadSchemaJson } from '../authz/load'
import { PEGASUS_NS } from '../authz/actions'
import { createLogger } from './logger'

const logger = createLogger('pegasus-authz-provision')

let _avp: VerifiedPermissionsClient | null = null
function getAvp(): VerifiedPermissionsClient {
  return (_avp ??= new VerifiedPermissionsClient({}))
}

export interface ProvisionInput {
  /** Tenant slug — used in the policy-store description so AVP listings are searchable. */
  readonly tenantSlug: string
  /**
   * Cognito User Pool ARN. Required to attach the pool as the AVP
   * IdentitySource so deployed traffic can use IsAuthorizedWithToken.
   */
  readonly userPoolArn: string
  /** Tenant app client ID — added to the IdentitySource clientIds list. */
  readonly tenantAppClientId: string
}

export interface ProvisionResult {
  readonly policyStoreId: string
}

/**
 * Retry helper for AVP eventual-consistency. CreatePolicyStore returns a
 * policyStoreId before the store is universally addressable, so the next
 * write (PutSchema, CreatePolicy, CreateIdentitySource) commonly sees
 * `ResourceNotFoundException: Policy Store does not exist.` for a few
 * hundred milliseconds. Backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
 * (~3.1s total before the final attempt). Other AccessDenied / validation
 * errors propagate immediately — no point burning the timeout on those.
 */
async function withConsistencyRetry<T>(fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const name = (err as { name?: string }).name
      if (name !== 'ResourceNotFoundException' || attempt === maxAttempts) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)))
    }
  }
  throw lastErr
}

export async function provisionTenantPolicyStore(input: ProvisionInput): Promise<ProvisionResult> {
  const avp = getAvp()

  // 1) Create the policy store. STRICT validation mode so any future schema
  //    bug surfaces here (rather than at runtime IsAuthorizedWithToken).
  const created = await avp.send(
    new CreatePolicyStoreCommand({
      validationSettings: { mode: 'STRICT' },
      description: `pegasus tenant: ${input.tenantSlug}`,
    }),
  )
  const policyStoreId = created.policyStoreId
  if (!policyStoreId) {
    throw new Error('CreatePolicyStore returned no policyStoreId')
  }

  try {
    // 2) Push the Cedar schema. Wrapped in withConsistencyRetry because
    //    PutSchema racing CreatePolicyStore is the most common AVP
    //    eventual-consistency miss.
    await withConsistencyRetry(() =>
      avp.send(
        new PutSchemaCommand({
          policyStoreId,
          definition: { cedarJson: loadSchemaJson() },
        }),
      ),
    )

    // 3) Push every .cedar policy file. Run in parallel — policy creation
    //    is independent and provisioning latency matters at tenant-create time.
    //    Retry-wrapped per-call: typically PutSchema's wait already covered
    //    the consistency window, but defending against partial visibility
    //    is cheap.
    await Promise.all(
      loadPolicies().map((p) =>
        withConsistencyRetry(() =>
          avp.send(
            new CreatePolicyCommand({
              policyStoreId,
              definition: {
                static: { description: p.name, statement: p.statement },
              },
            }),
          ),
        ),
      ),
    )

    // 4) Wire up the Cognito User Pool as the identity source so deployed
    //    traffic can use IsAuthorizedWithToken without us building a Cedar
    //    entity store from claims.
    //
    //    `groupConfiguration.groupEntityType` is what makes AVP synthesize
    //    `principal in Pegasus::Group::"X"` memberships from the
    //    `cognito:groups` claim — required for every persona policy to
    //    evaluate. Without it AVP sees the principal as a bare User with no
    //    parents and every group-gated permit evaluates to false (empty
    //    /me/permissions, blanket 403 on requirePermission-guarded routes).
    //    The pre-token Lambda emits the role names into `cognito:groups` so
    //    this mapping closes the loop end-to-end.
    await withConsistencyRetry(() =>
      avp.send(
        new CreateIdentitySourceCommand({
          policyStoreId,
          principalEntityType: 'Pegasus::User',
          configuration: {
            cognitoUserPoolConfiguration: {
              userPoolArn: input.userPoolArn,
              clientIds: [input.tenantAppClientId],
              groupConfiguration: {
                groupEntityType: `${PEGASUS_NS}::Group`,
              },
            },
          },
        }),
      ),
    )
  } catch (err) {
    logger.error('AVP provisioning failed mid-flight, deleting policy store', {
      policyStoreId,
      tenantSlug: input.tenantSlug,
      error: err instanceof Error ? err.message : String(err),
    })
    // Best-effort cleanup so we don't leak orphan stores in AVP. Swallow
    // delete failures — the original error is what the caller needs.
    try {
      await avp.send(new DeletePolicyStoreCommand({ policyStoreId }))
    } catch (cleanupErr) {
      logger.error('Failed to clean up partially-provisioned AVP store', {
        policyStoreId,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      })
    }
    throw err
  }

  return { policyStoreId }
}
