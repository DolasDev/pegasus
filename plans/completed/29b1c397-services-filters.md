# Saved filters for Operations → Services

**Status:** implemented · **Branch:** `feat/services-filters` · **Date:** 2026-10-21

## Goal

Let a dispatcher save the Services board's filter bar (date range, activity
type, short haul, dispatcher, sort) under a name, reload it, share it publicly,
and mark one as their default so the board opens with it. This is the same
Save / Load / Use-as-Default / Delete, My vs Public UX as Operations →
Availability (#836).

## Decision: mirror #836, don't generalize it

There will be a parallel `ServicesFilter` Postgres table and a
`/api/v1/services-filters` router. Adding a `screen` discriminator to
`availability_filters` would mean a migration on a live prod table and changes
to live routes, all for a rename nobody asked for. The parallel table carries
zero regression risk to Availability.

The default filter lives in `TenantUser.preferences.operations.defaultServicesFilterId`.
The same dangling-is-null rule applies.

## Saved query shape (v1, strict zod)

```ts
{
  v: 1,
  dateFromOffsetDays: number,   // required: the board always has both bounds
  dateToOffsetDays: number,
  activityTypes: string[],      // abbreviations (filterOptions.activityType values)
  shortHaul: ('Y'|'N')[],
  dispatchers: string[],        // dispatcher codes (operations_id values)
  sortBy: { value: <one of the 7 header keys>, order: 'asc'|'desc' } | null,
}
```

- **Dates are offsets in the saved form only.** This is a deliberate inversion
  of the slice's "absolute dates" stance. That stance protects a live board
  left open overnight. A saved preset holding absolute dates would be dead
  within a week.
- **Values only.** Labels are rehydrated on load from `filterOptions.activityType`,
  `dispatcherList` and `SHAUL_LIST`. An unknown code is kept as an option
  labelled with its code.
- **`office` is excluded.** It is unwired, and persisting it would store a lie.

## Steps

1. **Prisma:** add a `ServicesFilter` model (`services_filters`), with
   back-refs on Tenant and TenantUser. Add it to `TENANT_SCOPED_MODELS` and
   create the migration.
2. **Preferences:** add `operations.defaultServicesFilterId` to both the
   schema and the patch.
3. **API:** add `lib/services-filter-query.ts`, a repository,
   `handlers/services-filters.ts` mounted at `/services-filters`, and
   integration tests.
4. **tenant-web data:** add `api/queries/services-filters.ts`. Add a pure
   `services-filter-query.ts` with `toSavedQuery` and `fromSavedQuery`, and
   tests for each.
5. **tenant-web UI:**
   - Add Saved Filters and Save Filter buttons to ActivityFilters.
   - Add the dialogs, using `services-filter-*` test ids.
   - On load, gate the board's first fetch until the default-filter query
     settles (an error falls back to the built-in filters), then apply it once.
     This avoids a default-range fetch being followed by a saved-range fetch.
   - Add component tests.
6. **e2e:** stub `/services-filters/default` in `services-shipment-detail.spec.ts`
   so the spec doesn't pass on the error path by accident. Add a browser spec:
   the saved default applies on load, and saving posts the serialized state.
7. **Docs:** strengthen the PATTERNS.md "ported-screen saved filters" entry,
   which this is the second instance of.
8. **Ship:** merge through the queue and watch Deploy. The migration
   `services_filters` must show as applied in the Deploy log. A signed-in
   save → reload → delete on prod is left to Steve.

## Outcome

Implemented as planned. Deviations worth knowing:

- **The dialogs were extracted instead of copied.** The planned copy became
  `components/saved-filters/SavedFilterDialogs.tsx`, generic and namespaced by
  a `screen` prop. Availability's `SavedAvailabilityFilters.tsx` is now a thin
  wrapper that keeps the same exports and test ids. Its existing tests are the
  regression check.
- **Seeding is once per session.** The board's query lives in the global
  Redux store, so `activities.defaultSeeded` gates it. The route module mounts
  the board only after the default settles. A failed read, including a
  principal with no TenantUser, seeds the built-in query.
- **The sort enum is pinned to the handler.** `activities-list.ts` now exports
  `ACTIVITY_SORT_KEYS`, and a test pins the saved-sort enum to it.
- **Verification:**
  - API integration tests run against the worktree's Postgres, including a
    test that the Availability default survives a Services default write.
  - Unit and component tests cover the slice, the conversion, the module gate
    and the filter bar.
  - Two `@local-only` browser specs cover the default being the first query,
    and Save posting the serialized query. A mutation check confirmed the first
    spec fails when the gate is removed.
