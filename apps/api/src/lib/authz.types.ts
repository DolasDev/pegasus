// ---------------------------------------------------------------------------
// Cedar/AVP authorization — shared types.
//
// Kept separate from `authz.ts` so handler/middleware code can import the
// principal/resource shapes without dragging in the wasm or AVP SDK.
// ---------------------------------------------------------------------------

import type { ActionDef, ResourceType } from '../authz/actions'

export type { ActionDef }

/**
 * The authenticated subject for a tenant API request.
 *
 * `sub` is the bare Cognito `sub` claim. Entity IDs in Cedar are not prefixed
 * with the tenant ID because the policy store is already per-tenant — adding
 * a prefix would be redundant and would break the AVP IdentitySource path,
 * which uses the raw `sub` value as the entity ID.
 */
export interface Principal {
  /** Cognito user `sub` claim. Stable across email changes. */
  readonly sub: string
  /** Tenant UUID this principal authenticated against. */
  readonly tenantId: string
  /** Cedar role-group memberships (e.g. ['tenant_admin']). */
  readonly roleNames: readonly string[]
  /**
   * The `CrewMember.id` linked to this login, when one exists. Resolved by the
   * tenant middleware only for `driver` principals. Surfaces as the Cedar
   * `User.crewMemberId` attribute so per-record `ReadMove` policies can match
   * a driver against a move's assigned crew.
   */
  readonly crewMemberId?: string
}

/**
 * A reference to a resource being authorized.
 *
 * `id` defaults to a per-tenant catch-all when callers do not pass one
 * (most current call sites are coarse-grained "can I list users?" rather than
 * "can I read user X?"). Per-instance attribute checks land in a follow-up.
 */
export interface ResourceRef {
  readonly type: ResourceType
  readonly id: string
  /** Optional Cedar entity attributes — reserved for future ABAC rules. */
  readonly attrs?: Record<string, unknown>
}

export interface Decision {
  /** True iff Cedar/AVP returned ALLOW for the (principal, action, resource). */
  readonly allowed: boolean
  /** Decision source — useful for logging and tests. */
  readonly source: 'avp' | 'offline'
}

export interface AuthorizeInput {
  readonly principal: Principal
  readonly action: ActionDef
  readonly resource?: ResourceRef
  readonly context?: Record<string, unknown>
  /**
   * Cognito ID token forwarded verbatim to AVP IsAuthorizedWithToken. Required
   * for the `avp` backend path. Ignored by the offline backend.
   */
  readonly idToken?: string | undefined
  /**
   * AVP policy store ID for the principal's tenant. When undefined, the
   * offline (wasm) backend is used. Ignored by the offline backend.
   */
  readonly policyStoreId?: string | undefined
}
