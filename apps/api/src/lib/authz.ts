// ---------------------------------------------------------------------------
// Cedar/AVP authorization engine.
//
// Two backends with the same input shape:
//   - 'avp'     : AWS Verified Permissions IsAuthorizedWithToken — used in
//                 deployed environments where the request carries a Cognito
//                 ID token and the tenant has a provisioned policy store.
//   - 'offline' : @cedar-policy/cedar-wasm/nodejs — used by tests, local dev
//                 (SKIP_AUTH), and any tenant that has not yet been migrated
//                 to AVP. Evaluates the same .cedar policy text on the same
//                 schema so behaviour matches the deployed path.
//
// Backend selection: `pickBackend(policyStoreId)` returns 'avp' when the
// tenant has a policy store ID and AUTHZ_OFFLINE/SKIP_AUTH are not set,
// otherwise 'offline'.
//
// Cache: 60-second TTL keyed by (sub, action, resourceType, resourceId,
// policyStoreId). Authorisation calls in tight loops (e.g. /me/permissions
// fanning out across the catalog) hit the cache after the first miss.
// ---------------------------------------------------------------------------

import {
  VerifiedPermissionsClient,
  IsAuthorizedWithTokenCommand,
  BatchIsAuthorizedWithTokenCommand,
} from '@aws-sdk/client-verifiedpermissions'
import type {
  BatchIsAuthorizedWithTokenInputItem,
  EntitiesDefinition,
} from '@aws-sdk/client-verifiedpermissions'
import * as cedar from '@cedar-policy/cedar-wasm/nodejs'
import { ALL_ACTIONS, PEGASUS_NS } from '../authz/actions'
import { loadPolicyText, loadSchema } from '../authz/load'
import type { AuthorizeInput, Decision, Principal } from './authz.types'

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export type Backend = 'avp' | 'offline'

export function pickBackend(policyStoreId: string | undefined): Backend {
  if (process.env['AUTHZ_OFFLINE'] === 'true') return 'offline'
  if (process.env['SKIP_AUTH'] === 'true') return 'offline'
  if (!policyStoreId) return 'offline'
  return 'avp'
}

// ---------------------------------------------------------------------------
// Cache (in-memory, per warm Lambda container)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000
const _cache = new Map<string, { decision: Decision; expiresAt: number }>()

function cacheKey(input: AuthorizeInput): string {
  const r = input.resource
  return [
    input.principal.sub,
    input.action.id,
    r?.type ?? '',
    r?.id ?? '',
    input.policyStoreId ?? '',
  ].join('|')
}

/** Test helper — exported so authz.test.ts can reset between cases. */
export function _clearAuthzCache(): void {
  _cache.clear()
}

// ---------------------------------------------------------------------------
// Offline backend — wasm against the same .cedar files used in production
// ---------------------------------------------------------------------------

/**
 * Build the entity store for an offline authorisation call: the principal
 * plus one Group entity per role membership. The principal is the child of
 * each Group (parents=[Group::"tenant_admin", …]).
 */
function buildEntities(principal: Principal): cedar.Entities {
  const groupParents = principal.roleNames.map((g) => ({
    __entity: { type: `${PEGASUS_NS}::Group`, id: g },
  }))

  const entities: cedar.Entities = [
    {
      uid: { __entity: { type: `${PEGASUS_NS}::User`, id: principal.sub } },
      attrs: {},
      parents: groupParents,
    },
  ]

  for (const groupName of principal.roleNames) {
    entities.push({
      uid: { __entity: { type: `${PEGASUS_NS}::Group`, id: groupName } },
      attrs: {},
      parents: [],
    })
  }

  return entities
}

function authorizeOffline(input: AuthorizeInput): Decision {
  const r = input.resource
  const resourceType = r?.type ?? input.action.resourceType
  const resourceId = r?.id ?? `__tenant__:${input.principal.tenantId}`

  const call: cedar.AuthorizationCall = {
    principal: { __entity: { type: `${PEGASUS_NS}::User`, id: input.principal.sub } },
    action: { __entity: { type: `${PEGASUS_NS}::Action`, id: input.action.id } },
    resource: { __entity: { type: `${PEGASUS_NS}::${resourceType}`, id: resourceId } },
    context: (input.context ?? {}) as cedar.Context,
    schema: loadSchema() as cedar.Schema,
    validateRequest: false,
    policies: { staticPolicies: loadPolicyText() },
    entities: buildEntities(input.principal),
  }

  const answer = cedar.isAuthorized(call)
  if (answer.type === 'failure') {
    // Fail-closed: a malformed policy or evaluation error becomes a deny.
    // The error itself is captured here (not silently swallowed) so
    // misconfigurations surface in tests.
    const detail = answer.errors.map((e) => e.message).join('; ')
    throw new Error(`Cedar authorization failed: ${detail}`)
  }

  return { allowed: answer.response.decision === 'allow', source: 'offline' }
}

// ---------------------------------------------------------------------------
// AVP backend — IsAuthorizedWithToken / BatchIsAuthorizedWithToken
// ---------------------------------------------------------------------------

let _avp: VerifiedPermissionsClient | null = null
function getAvp(): VerifiedPermissionsClient {
  return (_avp ??= new VerifiedPermissionsClient({}))
}

/**
 * Build the AVP `entities` argument so the principal's Group memberships
 * resolve against the bare role names our policies reference
 * (`tenant_admin`, `dispatcher`, …).
 *
 * Why this is non-obvious: AVP's Cognito identity source synthesises both
 * the principal and (when groupConfiguration is set) every Group entity it
 * derives from `cognito:groups` with a user-pool-prefixed ID
 * (`Pegasus::Group::"<userPoolId>|tenant_admin"`). Our Cedar policies use
 * bare names, so the prefixed Group parents AVP creates don't match.
 *
 * AVP forbids passing the principal entity in `entities` for
 * IsAuthorizedWithToken (the principal must come from the token), but it
 * accepts non-principal entities and merges them with the token-derived
 * hierarchy. So instead of trying to retag the principal we re-parent the
 * prefixed Group AVP synthesised under a bare-named Group — Cedar's `in`
 * is transitive, so `principal in Pegasus::Group::"tenant_admin"` matches
 * via prefixed Group → bare Group → policy reference. Verified against
 * staging via `is-authorized` direct call before this refactor.
 *
 * Requires `Group.memberOfTypes = ["Group"]` in the Cedar schema so
 * Group→Group parenthood is allowed; that change ships alongside this
 * function and propagates to existing stores via PutSchema migration.
 *
 * Without this, every group-gated permit evaluates to false → empty
 * /me/permissions and blanket 403 on every requirePermission-guarded route.
 */
function buildAvpEntities(principal: Principal): NonNullable<EntitiesDefinition['entityList']> {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''
  const out: NonNullable<EntitiesDefinition['entityList']> = []

  for (const role of principal.roleNames) {
    // Bare-named Group entity (matches policy references like
    // `Pegasus::Group::"tenant_admin"`).
    out.push({
      identifier: { entityType: `${PEGASUS_NS}::Group`, entityId: role },
    })
    // Prefixed-Group entity (matching what AVP auto-synthesises) reparented
    // under the bare Group so policy matching works via Cedar's transitive
    // `in`. Skip when COGNITO_USER_POOL_ID is empty — that's the offline /
    // SKIP_AUTH path, which doesn't reach here anyway via pickBackend.
    if (userPoolId) {
      out.push({
        identifier: {
          entityType: `${PEGASUS_NS}::Group`,
          entityId: `${userPoolId}|${role}`,
        },
        parents: [{ entityType: `${PEGASUS_NS}::Group`, entityId: role }],
      })
    }
  }

  return out
}

async function authorizeAvp(input: AuthorizeInput): Promise<Decision> {
  if (!input.idToken) {
    throw new Error('AVP backend requires idToken — none was provided')
  }
  if (!input.policyStoreId) {
    throw new Error('AVP backend requires policyStoreId — none was provided')
  }

  const r = input.resource
  const resourceType = r?.type ?? input.action.resourceType
  const resourceId = r?.id ?? `__tenant__:${input.principal.tenantId}`

  const result = await getAvp().send(
    new IsAuthorizedWithTokenCommand({
      policyStoreId: input.policyStoreId,
      identityToken: input.idToken,
      action: { actionType: `${PEGASUS_NS}::Action`, actionId: input.action.id },
      resource: { entityType: `${PEGASUS_NS}::${resourceType}`, entityId: resourceId },
      entities: { entityList: buildAvpEntities(input.principal) },
    }),
  )

  return { allowed: result.decision === 'ALLOW', source: 'avp' }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function authorize(input: AuthorizeInput): Promise<Decision> {
  const key = cacheKey(input)
  const now = Date.now()
  const hit = _cache.get(key)
  if (hit && hit.expiresAt > now) return hit.decision

  const backend = pickBackend(input.policyStoreId)
  const decision = backend === 'avp' ? await authorizeAvp(input) : authorizeOffline(input)

  _cache.set(key, { decision, expiresAt: now + CACHE_TTL_MS })
  return decision
}

/**
 * Returns the public-facing permission string for every action the principal
 * is allowed to perform. Used by GET /api/v1/me/permissions.
 *
 * The AVP path issues a single Batch call to keep the round-trip cost flat;
 * the offline path iterates because the wasm has no batch entrypoint.
 */
export async function listAllowedPermissions(
  principal: Principal,
  idToken: string | undefined,
  policyStoreId: string | undefined,
): Promise<string[]> {
  const backend = pickBackend(policyStoreId)

  if (backend === 'avp') {
    if (!idToken || !policyStoreId) {
      throw new Error('AVP backend requires both idToken and policyStoreId')
    }

    const requests: BatchIsAuthorizedWithTokenInputItem[] = ALL_ACTIONS.map((a) => ({
      action: { actionType: `${PEGASUS_NS}::Action`, actionId: a.id },
      resource: {
        entityType: `${PEGASUS_NS}::${a.resourceType}`,
        entityId: `__tenant__:${principal.tenantId}`,
      },
    }))

    const result = await getAvp().send(
      new BatchIsAuthorizedWithTokenCommand({
        policyStoreId,
        identityToken: idToken,
        requests,
        entities: { entityList: buildAvpEntities(principal) },
      }),
    )

    const allowed: string[] = []
    for (const [i, r] of (result.results ?? []).entries()) {
      const action = ALL_ACTIONS[i]
      if (action && r.decision === 'ALLOW') allowed.push(action.permission)
    }
    return allowed
  }

  // Offline — iterate. The cache flattens the cost on repeat calls within TTL.
  const allowed: string[] = []
  for (const action of ALL_ACTIONS) {
    const decision = await authorize({ principal, action, idToken, policyStoreId })
    if (decision.allowed) allowed.push(action.permission)
  }
  return allowed
}
