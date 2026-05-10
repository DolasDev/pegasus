// ---------------------------------------------------------------------------
// Cedar/AVP authorization engine.
//
// Two backends with the same input shape:
//   - 'avp'     : AWS Verified Permissions IsAuthorized / BatchIsAuthorized —
//                 used in deployed environments where the tenant has a
//                 provisioned policy store. We construct the principal +
//                 Group hierarchy ourselves from the request's
//                 already-validated `roleNames`, then call the no-token
//                 IsAuthorized API.
//   - 'offline' : @cedar-policy/cedar-wasm/nodejs — used by tests, local dev
//                 (SKIP_AUTH), and any tenant that has not yet been migrated
//                 to AVP. Evaluates the same .cedar policy text on the same
//                 schema so behaviour matches the deployed path.
//
// Why not IsAuthorizedWithToken: AVP's Cognito identity source treats
// `cognito:groups` as a special claim — it can ONLY be projected into
// principal parent entities (when groupConfiguration is set), and never
// onto the principal as a regular attribute. With groupConfiguration set
// AVP synthesises Group entities with user-pool-prefixed IDs that don't
// match our bare-named policy references, AND it forbids the caller from
// supplying corrective `entities` of the principal type or any registered
// Group type via IsAuthorizedWithToken. The clean alternative — the one
// AVP itself documents for RBAC-by-groups — is to call IsAuthorized
// directly, build the principal + Group entities ourselves, and skip
// AVP's token-derived projection entirely. The request has already been
// authenticated by the JWT verifier in middleware/jwt-auth.ts, so AVP's
// ID-token signature check would be redundant anyway. See
// dolas/agents/project/GOTCHAS.md AUTHZ_ERROR table for detail.
//
// Both backends build the same Cedar entity store: a User entity with
// Group parents (one per role name). Identical input → identical Cedar
// evaluation → identical decisions across local tests and deployed AVP.
//
// Cache: 60-second TTL keyed by (sub, sorted roleNames, action, resourceType,
// resourceId, policyStoreId). roleNames are part of the key because Cedar's
// decision is a function of the principal's group memberships — omitting them
// would let role changes (PATCH /api/v1/users/:id, PATCH /api/v1/api-clients/:id)
// serve stale cached decisions for up to TTL_MS, which is both a correctness
// gap (demotions don't take effect immediately) and a UX papercut (promotions
// look broken for ~1m). Authorisation calls in tight loops (e.g. /me/permissions
// fanning out across the catalog) still hit the cache after the first miss
// because the principal's role set is identical across that batch.
// ---------------------------------------------------------------------------

import {
  VerifiedPermissionsClient,
  IsAuthorizedCommand,
  BatchIsAuthorizedCommand,
} from '@aws-sdk/client-verifiedpermissions'
import type { BatchIsAuthorizedInputItem, EntityItem } from '@aws-sdk/client-verifiedpermissions'
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
  // Sort + join roleNames so order-only differences hit the same entry. Use
  // a delimiter that can't appear inside a Cedar group name (group names are
  // [A-Za-z0-9_]) to avoid ambiguity.
  const roles = [...input.principal.roleNames].sort().join(',')
  return [
    input.principal.sub,
    roles,
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
 * Build the entity store for an authorisation call: the principal plus one
 * Group entity per role membership. The principal is the child of each
 * Group (parents=[Group::"tenant_admin", …]). Same shape on both backends —
 * the AVP path passes this list via `entities`, the offline path hands it
 * to cedar-wasm directly.
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

/**
 * Map the offline (cedar-wasm) entity shape onto the shape AVP's
 * IsAuthorized API accepts. Mechanical translation: `__entity.type` → `entityType`,
 * `__entity.id` → `entityId`. Attributes stay empty (we don't use any).
 */
function buildAvpEntityList(principal: Principal): EntityItem[] {
  return [
    {
      identifier: { entityType: `${PEGASUS_NS}::User`, entityId: principal.sub },
      parents: principal.roleNames.map((g) => ({
        entityType: `${PEGASUS_NS}::Group`,
        entityId: g,
      })),
    },
    ...principal.roleNames.map((g) => ({
      identifier: { entityType: `${PEGASUS_NS}::Group`, entityId: g },
    })),
  ]
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
// AVP backend — IsAuthorized / BatchIsAuthorized (no-token)
// ---------------------------------------------------------------------------

let _avp: VerifiedPermissionsClient | null = null
function getAvp(): VerifiedPermissionsClient {
  return (_avp ??= new VerifiedPermissionsClient({}))
}

async function authorizeAvp(input: AuthorizeInput): Promise<Decision> {
  if (!input.policyStoreId) {
    throw new Error('AVP backend requires policyStoreId — none was provided')
  }

  const r = input.resource
  const resourceType = r?.type ?? input.action.resourceType
  const resourceId = r?.id ?? `__tenant__:${input.principal.tenantId}`

  const result = await getAvp().send(
    new IsAuthorizedCommand({
      policyStoreId: input.policyStoreId,
      principal: { entityType: `${PEGASUS_NS}::User`, entityId: input.principal.sub },
      action: { actionType: `${PEGASUS_NS}::Action`, actionId: input.action.id },
      resource: { entityType: `${PEGASUS_NS}::${resourceType}`, entityId: resourceId },
      entities: { entityList: buildAvpEntityList(input.principal) },
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
  _idToken: string | undefined,
  policyStoreId: string | undefined,
): Promise<string[]> {
  const backend = pickBackend(policyStoreId)

  if (backend === 'avp') {
    if (!policyStoreId) {
      throw new Error('AVP backend requires policyStoreId')
    }

    const principalId = { entityType: `${PEGASUS_NS}::User`, entityId: principal.sub }
    const requests: BatchIsAuthorizedInputItem[] = ALL_ACTIONS.map((a) => ({
      principal: principalId,
      action: { actionType: `${PEGASUS_NS}::Action`, actionId: a.id },
      resource: {
        entityType: `${PEGASUS_NS}::${a.resourceType}`,
        entityId: `__tenant__:${principal.tenantId}`,
      },
    }))

    const result = await getAvp().send(
      new BatchIsAuthorizedCommand({
        policyStoreId,
        entities: { entityList: buildAvpEntityList(principal) },
        requests,
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
    const decision = await authorize({ principal, action, policyStoreId })
    if (decision.allowed) allowed.push(action.permission)
  }
  return allowed
}
