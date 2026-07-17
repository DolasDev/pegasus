# Plan: tenant longhaul capability flag

## Goal

Give the tenant-web client an authoritative "this tenant has longhaul" signal so
the longhaul consumers stop _asking at all_ on tenants with no legacy DB —
closing the residual left by PR #458 (Users driver-linker) and PR #461
(Operations reference-data bootstrap), where the requests now fail quietly but
still fire once per mount.

## The signal (server truth)

`Tenant.mssqlConnectionString != null` is exactly the condition both endpoints
422 on (`apps/api/src/handlers/longhaul-cloud/drivers.ts:44`,
`apps/api/src/handlers/longhaul-cloud/reference-data.ts:100`). That is the
capability. `longhaulClient` is a _refinement within_ an already-longhaul tenant
(governs dispatchers/filterOptions), NOT the gate. Expose a coarse boolean, never
the connection string — no secret disclosure.

## Delivery mechanism — extend `GET /api/v1/me/permissions`

It is already the once-per-session, tenant-scoped, `staleTime: Infinity`
bootstrap that every gate reads through `usePermissions()`. Add a field:

```jsonc
// GET /api/v1/me/permissions
{ "roles": [...], "permissions": [...], "capabilities": { "longhaul": true } }
```

- **API** (`apps/api/src/handlers/me.ts`, `/permissions` handler): one
  `db.tenant.findUnique({ where: { id: c.get('tenantId') }, select: { mssqlConnectionString: true } })`,
  map to `capabilities: { longhaul: tenant?.mssqlConnectionString != null }`.
  `tenantId` is in context — `/me` mounts after `tenantMiddleware` (app.ts:357→361).
- **Client** (`apps/tenant-web/src/auth/permissions.ts`): add `capabilities` to
  `MePermissions`; expose it on `PermissionsApi` (e.g. `caps.longhaul`, or a
  `hasCapability('longhaul')` helper).

Rejected alternatives: a new `/me/capabilities` endpoint (extra round-trip + hook
for one bit); `/config.json` (static per-deploy — cannot carry a per-tenant flag).

Design extensibly (`capabilities: { longhaul }`) so `pegii` / `customerSource`
bits can join later without a shape change.

## Call sites to gate

1. **Users page** (`apps/tenant-web/src/routes/users.tsx`): gate BOTH the
   `LonghaulDriverLinker` render AND the `longhaulDriversQueryOptions` query on
   `caps.longhaul`. Supersedes the `hasDriverUsers` proxy from #458 (a driver on
   a non-longhaul tenant has nothing to map to). Request drops to ZERO on
   non-longhaul tenants.
2. **Operations nav** (`apps/tenant-web/src/components/AppShell.tsx`): add an
   optional `capability` field to `NAV_ITEMS`; extend the existing filter to
   `roles.some(...) && (item.capability == null || caps[item.capability])`. The
   Operations item gets `capability: 'longhaul'`.
3. **Operations route** (`apps/tenant-web/src/router.tsx` / `DriverPlanningLayout`)
   — DEFERRED. The `/driver-planning` route has no `beforeLoad` guard today (only
   nav-hiding), so deep-links are reachable, but the capability lives in the async
   `/me/permissions` query, not the synchronous `getSession()` that `requireRole`
   reads — so a sync `beforeLoad` can't see it. A component-level empty-state in
   `DriverPlanningLayout` when `!caps.longhaul` is the clean form, but post-#461
   the page already degrades to empty-no-error, so this is polish, not a bug.
   Leave out of this workstream; revisit only if deep-link noise proves to matter.

## Rollout / back-compat

Additive response field. The one hazard is deploy skew (new client, old API
without `capabilities`) briefly hiding a REAL tenant's Operations. Mitigation:
**client fails open on absence** — `capabilities?.longhaul ?? true` for
_visibility_ decisions, so unknown → show. Steady-state (both deployed) the flag
is authoritative. This lets it ship as ONE PR; no need to split API-first.

## Tests

- **API** (`apps/api`, DB-backed integration): `/me/permissions` returns
  `capabilities.longhaul === true` with a `mssqlConnectionString` set, `false`
  without.
- **Client** (`apps/tenant-web`, vitest):
  - `usePermissions` surfaces `capabilities` from the query payload.
  - AppShell hides the Operations nav item when `longhaul: false`, shows it when
    `true`, and shows it (fail-open) when the field is absent.
  - Users `LonghaulDriverLinker` hidden + query `enabled: false` when
    `longhaul: false`.
  - Confirm each new test fails against pre-change source (real regression tests,
    not tautologies).

## Effort / files

Small. Source: `apps/api/src/handlers/me.ts`,
`apps/tenant-web/src/auth/permissions.ts`, `apps/tenant-web/src/routes/users.tsx`,
`apps/tenant-web/src/components/AppShell.tsx` + their tests. No migration (column
exists), no Cedar change (tenant config, not a permission).

## Decisions locked

- Capability derived from `mssqlConnectionString != null` (coarse "has legacy DB").
- Delivered via `/me/permissions` under `capabilities: { longhaul }`.
- Field name: `capabilities` (not `features`).
- Client fails open when the field is absent.
- Route-level guard (#3) deferred — nav + Users gates deliver the value.

## Verification gate (before PR)

Typecheck + lint + prettier clean; full `apps/api` and `apps/tenant-web` suites
green; new tests proven to fail against reverted source. Land via merge queue in
one PR (plan + implementation together), watch branch CI, then main Deploy
(tenant-web + api both deploy) to prod.
