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
import type {
  AttributeValue,
  BatchIsAuthorizedInputItem,
  EntityItem,
} from '@aws-sdk/client-verifiedpermissions'
import * as cedar from '@cedar-policy/cedar-wasm/nodejs'
import { ALL_ACTIONS, PEGASUS_NS } from '../authz/actions'
import { loadPolicyText, loadSchema } from '../authz/load'
import type { AuthorizeInput, Decision, Principal, ResourceRef } from './authz.types'

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
 * Translate a resource's ABAC attribute bag into AVP `AttributeValue`s.
 *   - string   → `{ string }`
 *   - string[] → `{ set: [{ string }, …] }`
 * Empty arrays are omitted entirely: AVP rejects empty sets, and the matching
 * Cedar policy guards every optional-attribute access with `has`, so an
 * omitted attribute simply evaluates to a deny — the correct outcome (an
 * unassigned move has no driver who should see it).
 */
function toAvpAttributes(attrs: Record<string, unknown>): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string') {
      out[key] = { string: value }
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue
      out[key] = { set: value.map((v) => ({ string: String(v) })) }
    }
    // Other shapes are intentionally unsupported — no current attribute uses them.
  }
  return out
}

/**
 * Build the entity store for an authorisation call: the principal plus one
 * Group entity per role membership. The principal is the child of each
 * Group (parents=[Group::"tenant_admin", …]). Same shape on both backends —
 * the AVP path passes this list via `entities`, the offline path hands it
 * to cedar-wasm directly.
 *
 * When `resource.attrs` is supplied the resource entity is appended too, so
 * per-record ABAC policies (e.g. driver `ReadMove`) can read its attributes.
 * Coarse callers pass no `attrs` — behaviour is then unchanged.
 */
function buildEntities(principal: Principal, resource?: ResourceRef): cedar.Entities {
  const groupParents = principal.roleNames.map((g) => ({
    __entity: { type: `${PEGASUS_NS}::Group`, id: g },
  }))

  const entities: cedar.Entities = [
    {
      uid: { __entity: { type: `${PEGASUS_NS}::User`, id: principal.sub } },
      attrs: principal.crewMemberId ? { crewMemberId: principal.crewMemberId } : {},
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

  if (resource?.attrs) {
    // Set-valued attributes are plain JSON arrays in cedar-wasm's entity form.
    entities.push({
      uid: { __entity: { type: `${PEGASUS_NS}::${resource.type}`, id: resource.id } },
      attrs: resource.attrs as Record<string, cedar.CedarValueJson>,
      parents: [],
    })
  }

  return entities
}

/**
 * Map the offline (cedar-wasm) entity shape onto the shape AVP's
 * IsAuthorized API accepts. Mechanical translation: `__entity.type` → `entityType`,
 * `__entity.id` → `entityId`. The principal carries `crewMemberId` when set,
 * and the resource entity is appended when `resource.attrs` is supplied.
 */
function buildAvpEntityList(principal: Principal, resource?: ResourceRef): EntityItem[] {
  const principalEntity: EntityItem = {
    identifier: { entityType: `${PEGASUS_NS}::User`, entityId: principal.sub },
    parents: principal.roleNames.map((g) => ({
      entityType: `${PEGASUS_NS}::Group`,
      entityId: g,
    })),
  }
  if (principal.crewMemberId) {
    principalEntity.attributes = { crewMemberId: { string: principal.crewMemberId } }
  }

  const entities: EntityItem[] = [
    principalEntity,
    ...principal.roleNames.map((g) => ({
      identifier: { entityType: `${PEGASUS_NS}::Group`, entityId: g },
    })),
  ]

  if (resource?.attrs) {
    entities.push({
      identifier: { entityType: `${PEGASUS_NS}::${resource.type}`, entityId: resource.id },
      attributes: toAvpAttributes(resource.attrs),
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
    entities: buildEntities(input.principal, input.resource),
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
      entities: { entityList: buildAvpEntityList(input.principal, input.resource) },
    }),
  )

  return { allowed: result.decision === 'ALLOW', source: 'avp' }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function authorize(input: AuthorizeInput): Promise<Decision> {
  const now = Date.now()

  // Per-record ABAC calls (resource.attrs present) bypass the cache: the cache
  // key does not capture resource.attrs, so caching them would serve a stale
  // allow/deny for up to the TTL after a crew reassignment — and would also
  // blow up key cardinality to users x resources. Coarse calls still cache.
  const cacheable = input.resource?.attrs === undefined
  const key = cacheKey(input)
  if (cacheable) {
    const hit = _cache.get(key)
    if (hit && hit.expiresAt > now) return hit.decision
  }

  const backend = pickBackend(input.policyStoreId)
  const decision = backend === 'avp' ? await authorizeAvp(input) : authorizeOffline(input)

  if (cacheable) _cache.set(key, { decision, expiresAt: now + CACHE_TTL_MS })
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

    // AVP caps BatchIsAuthorized at 30 requests per call (ValidationException
    // above that). The catalog crossed 30 when Order + Event actions landed,
    // so a single call now 400s and the endpoint 500s with INTERNAL_ERROR.
    // Chunk and fan out — chunks are mutually independent, so Promise.all
    // keeps the round-trip flat.
    const AVP_BATCH_LIMIT = 30
    const avp = getAvp()
    const entities = { entityList: buildAvpEntityList(principal) }
    const chunks: BatchIsAuthorizedInputItem[][] = []
    for (let i = 0; i < requests.length; i += AVP_BATCH_LIMIT) {
      chunks.push(requests.slice(i, i + AVP_BATCH_LIMIT))
    }
    const responses = await Promise.all(
      chunks.map((slice) =>
        avp.send(new BatchIsAuthorizedCommand({ policyStoreId, entities, requests: slice })),
      ),
    )
    const results = responses.flatMap((r) => r.results ?? [])

    const allowed: string[] = []
    for (const [i, r] of results.entries()) {
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
