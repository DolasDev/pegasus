# Saved filters for Operations → Availability

**Status:** implemented · **Branch:** `feat/availability-filters` · **Date:** 2026-10-12

## Goal

Let a dispatcher save the Availability screen's filter bar (driver name, zones,
move types, ready-date From/To, ready-date sort) under a name, reload it later,
share it publicly, and mark one as their default so the page opens with it —
the same Save / Load / Use-as-Default / Delete, My vs Public UX that Planning's
shipment filters have (`FilterTabs/SaveFilterModal.tsx`, `FilterModal.tsx`).

## Decision: storage is Postgres, not the legacy `longhaul_shipment_filter` table

"Like Planning" is a UX contract, not a storage one. Planning's rows live in the
tenant's SQL Server (`longhaul_shipment_filter`, keyed by legacy salesman code).
Reusing that table is wrong for this feature:

- It has no kind/screen column — availability rows would show up in Planning's
  filter modal. Adding one means lazy DDL on every tenant's SQL Server, which is
  unproven here (see the arrival-window lazy `ALTER TABLE` note).
- Postgres gets a real Prisma migration (deploy.yml already runs migrations when
  `prisma/migrations` changes), runs in the worktree's own DB, and is covered by
  the API integration-test layer.
- It keys on `TenantUser`, which every caller has — no `LONGHAUL_USER_NOT_MAPPED`
  failure mode just to save a filter.

The **default** pointer goes in the existing `TenantUser.preferences` JSON
(`lib/user-preferences.ts`, zod-parsed with defaults) — a code change, no
migration. A dangling default (filter deleted by someone else, or un-published)
falls back silently to the built-in defaults, exactly like `defaultDashboardSlug`.

Planning's handlers and table are **not touched**.

## Scope

- **View A only** (the default Availability view). View B has no move-type
  filter, so a View A filter can't round-trip there; it keeps its local-only
  filters. Called out here rather than skipped silently.
- Out of scope: per-column visibility, saving edits, Planning changes.

## Saved query shape (v1, versioned)

```ts
{
  v: 1,
  driverName: string,                       // '' = no filter
  zones: string[],                          // zone CODES, never labels
  moveTypes: ('local'|'longDistance'|'shorthaul')[],
  dateFromOffsetDays: number | null,        // null = open bound
  dateToOffsetDays: number | null,
  sortOrder: 'asc' | 'desc' | null,
}
```

Dates are stored as integer day offsets from today (Planning's convention) so a
saved "±3 months" doesn't rot. Conversion absolute ⇄ offset is a pure client
module with unit tests; the API zod-validates the shape strictly (bounded
arrays, enum move types, integer offsets within ±3650) instead of Planning's
`z.record(unknown)`. Zone labels are rehydrated from `zoneList` on load; an
unknown code is kept as a code-only option (still filters correctly).

## Steps

### 1. Prisma model + migration (`apps/api`)

`AvailabilityFilter` in `public`: `id` uuid, `tenantId`, `ownerId` → TenantUser
(cascade delete), `name` (≤100), `query` Json, `isPublic` bool, `createdAt`,
`updatedAt`. Indexes `(tenantId, ownerId)`, `(tenantId, isPublic)`.
`npm run db:migrate` to generate the migration in the worktree DB.

### 2. Preferences (`lib/user-preferences.ts`)

Add `operations.defaultAvailabilityFilterId: uuid | null` to the schema + patch
shape. Unit test the parse/merge.

### 3. API router `handlers/availability-filters.ts`, mounted `v1.route('/availability-filters', …)`

Tenant auth only (same as `/onprem/longhaul/driver-planning`, which has no
permission gate); ownership enforced in the handler. All queries tenant-scoped.

| Route                                         | Behavior                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /?scope=mine\|public`                    | mine = all I own (private + public); public = all public in tenant. Each row has `owner: { id, email }`, `isDefault`. Ordered by name. |
| `GET /default`                                | my default if it still resolves to a filter I can see, else `null`                                                                     |
| `POST /` `{name, query, isPublic, isDefault}` | create; optionally set as my default → 201                                                                                             |
| `PUT /default` `{filterId: uuid \| null}`     | set/clear my default; 404 if not visible to me                                                                                         |
| `DELETE /:id`                                 | owner only (404 otherwise — no cross-user/tenant deletes, unlike Planning's DELETE); clears my own default if it pointed here          |

Integration tests (vitest + local Postgres): tenant isolation, private filter
invisible to others, non-owner delete → 404, default visibility, dangling
default → null, validation 400s.

### 4. Tenant-web data layer

`api/queries/availability-filters.ts`: TanStack query options + mutations
(list per scope, default, save, set default, delete) with cache invalidation.
`features/driver-planning/availability/availability-filter-query.ts`: pure
`toSavedQuery(state)` / `fromSavedQuery(query, zoneList)` with offset math +
tests (incl. open bounds and the round trip).

### 5. Tenant-web UI (View A)

- Lift View A's five filter `useState`s into one `AvailabilityFilterState` so
  apply/serialize is a single call.
- Add **Saved Filters** and **Save Filter** buttons to the filter bar.
- `SaveAvailabilityFilterDialog` (name, Make Default, Make Public) and
  `AvailabilityFiltersDialog` (My Filters / Public Filters tabs, Created By,
  ★ on the default, Load / Use as Default / Delete-on-My-tab), built with the
  app's `components/ui` dialog/tabs/button rather than Planning's legacy CSS
  modules.
- Default on load: the page shows its loading state until both drivers and the
  default-filter query settle, then initializes once — no flash from built-in
  defaults to the saved filter. If the default query errors, fall back to the
  built-in defaults.
- Component tests: save posts the serialized state; load applies it; default
  applied on mount; delete only offered on My Filters.

### 6. Verify locally

`npm run typecheck`, `npm test` (api integration against worktree Postgres,
tenant-web unit), lint, and drive the page in the dev server to save / load /
default / delete.

### 7. Ship

`/workstream-finish` path: plan moved to `plans/completed/`, one PR, merge
queue, watch main's Deploy (api + tenant-web + migration). **Live-in-prod check:**
the migration step ran and applied `20261012194111_availability_filters` (Deploy
log), and the served tenant-web bundle contains `save-availability-filter`; then
Steve does one real save → reload (default applies) → delete on prod, since I
can't sign in there. (An unauthenticated 401 proves nothing: `tenantMiddleware`
rejects every `/api/v1/*` path before route matching, including nonexistent ones.)

## Docs to update

`dolas/agents/project/PATTERNS.md` (cloud-side saved filters for ported screens
live in Postgres + preferences default, not legacy MSSQL) if the pattern holds.

## Outcome

Implemented as planned. Deviations worth knowing:

- Slug/branch is `availability-filters`: the planned slug's derived Postgres port
  (5450) was held by another live worktree's container.
- `TENANT_SCOPED_MODELS` gained `AvailabilityFilter` (the schema-sync test in
  `prisma-tenant-isolation.test.ts` requires every `tenantId` model to be listed).
- The `operations` preferences section has no `.default({})`, so existing
  hydrated preference shapes are unchanged until a user first sets a default.
- Delete is two-step in the dialog (Delete → Confirm Delete); Planning deletes on
  one click.
- Not driven in a local browser: the local stack has no legacy MSSQL driver data
  and `SKIP_AUTH`'s synthetic user isn't a real `TenantUser`. Covered by API
  integration tests (real Postgres) + View A component tests; verified live on
  prod after deploy.
