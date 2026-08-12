// ---------------------------------------------------------------------------
// usePermissions — hook for permission-aware UI gating.
//
// Fetches GET /api/v1/me/permissions once per session via TanStack Query and
// exposes membership tests (`has`, `allOf`, `anyOf`). Buttons that the API
// would 403 should render hidden or disabled rather than rejecting after a
// round-trip.
//
// Cache lifetime — the answer is `staleTime: Infinity` because Cedar
// permissions are pre-token-cached server-side and the policy stores only
// change on deploy. If a tenant admin updates a user's roles in the same
// session, that user's session token is unchanged so /me/permissions wouldn't
// reflect the new role until next login anyway.
//
// The /me/permissions endpoint does NOT use the `{ data }` envelope (it
// returns `{ roles, permissions }` at the top level), so this module bypasses
// `apiFetch` and uses globalThis.fetch directly.
// ---------------------------------------------------------------------------

import { useQuery, queryOptions } from '@tanstack/react-query'
import { ApiError } from '@pegasus/api-http'
import { getConfig } from '@/config'
import { getSession } from '@/auth/session'

/**
 * Tenant-configuration capability flags. Distinct from `permissions` (Cedar
 * per-principal grants) — these gate whole features that depend on how the
 * TENANT is configured, regardless of the user's role. Optional on the wire so
 * a new client tolerates an older API that hasn't shipped the field yet (see
 * `hasCapability` — absence fails open).
 */
export type Capabilities = {
  /** Tenant has a legacy MSSQL configured — longhaul/Operations is available. */
  longhaul?: boolean
  /** The reporting surface is enabled on this deployment. */
  reporting?: boolean
}

export type MePermissions = {
  /** Cedar role-group memberships for the current principal. */
  roles: string[]
  /** Flat list of `resource:verb` permission strings the principal has. */
  permissions: string[]
  /** Tenant capability flags. Absent on older API deploys. */
  capabilities?: Capabilities
}

async function fetchMePermissions(): Promise<MePermissions> {
  const token = getSession()?.token
  const res = await fetch(`${getConfig().apiUrl}/api/v1/me/permissions`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const json = (await res.json()) as MePermissions | { error: string; code: string }

  if (!res.ok || 'error' in json) {
    const err = 'error' in json ? json : { error: 'Failed to load permissions', code: 'UNKNOWN' }
    throw new ApiError(err.error, err.code, res.status)
  }

  return json
}

export const mePermissionsQueryOptions = queryOptions({
  queryKey: ['me', 'permissions'] as const,
  queryFn: fetchMePermissions,
  staleTime: Infinity,
})

export type PermissionsApi = {
  /** True while the query is loading and we don't yet have an answer. Treat
   *  controls as disabled (not hidden) while loading to avoid layout shift. */
  isLoading: boolean
  /** Whether the principal has the given permission string. */
  has: (permission: string) => boolean
  /** True only if every supplied permission is present. */
  allOf: (permissions: readonly string[]) => boolean
  /** True if any of the supplied permissions is present. */
  anyOf: (permissions: readonly string[]) => boolean
  /** Raw permission set (memoised — safe to read in render). */
  permissions: ReadonlySet<string>
  /** The principal's Cedar role-group memberships. */
  roles: readonly string[]
  /**
   * Whether the tenant has the given capability. Fails OPEN: an absent flag
   * (older API during a rolled deploy, or the query still loading) returns
   * `true` so a real tenant's feature is never transiently hidden. Only an
   * explicit `false` from the server gates a feature off.
   */
  hasCapability: (capability: keyof Capabilities) => boolean
}

/**
 * React hook that returns a permission-set helper for the current session.
 *
 * Usage:
 *   const perms = usePermissions()
 *   if (!perms.has('user:invite')) return null
 */
export function usePermissions(): PermissionsApi {
  const { data, isLoading } = useQuery(mePermissionsQueryOptions)

  const set = new Set<string>(data?.permissions ?? [])
  const roles = data?.roles ?? []
  const capabilities = data?.capabilities

  return {
    isLoading,
    has: (p: string) => set.has(p),
    allOf: (perms: readonly string[]) => perms.every((p) => set.has(p)),
    anyOf: (perms: readonly string[]) => perms.some((p) => set.has(p)),
    permissions: set,
    roles,
    // Fail open: only an explicit `false` gates a feature off. Absent/loading
    // → true, so a rollout skew or in-flight query never hides a real feature.
    hasCapability: (capability) => capabilities?.[capability] !== false,
  }
}
