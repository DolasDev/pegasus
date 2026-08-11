# Shorthaul move-type filter on the driver Availability screen

## Goal

Add a **Shorthaul** filter to the Availability screen (`/driver-planning`, View A),
alongside the existing **Local** and **Long Dist.** move-type filters. Backed by
`v_longhaul_drivers.is_shorthaul_driver = 'Y'`.

## Context

`#556` (`abf46935`) added the Local / Long-Distance filters. This change is a
file-for-file clone of that commit's shape, adding a third flag.

Established facts (verified against the code, not assumed):

- The two existing flags are **selected and mapped only** — there is no SQL
  predicate for move type. The single `WHERE` on `PLANNING_SQL` is
  `availabilityDriverFilter('d')` (active + non-placeholder IDs), which is
  unrelated and stays untouched.
- **All move-type filtering is client-side**, in the `visible` `useMemo` in
  `AvailabilityViewA.tsx`. The endpoint takes no query params.
- There is **no shared DTO** — `DriverPlanningRow` is declared independently in
  the api handler and in the tenant-web query file. Both need the new field.
- View B has no move-type filters and gets none here (precedent from #556).

### Column name

The sibling columns are abbreviated (`is_local_drv`, `is_long_dist_drv`), so
`is_shorthaul_driver` breaks the view's convention. Prod verification was not
possible this session (expired SSO token); **the user explicitly confirmed
`is_shorthaul_driver` verbatim**. Recorded because the failure mode is loud: this
is an explicit `SELECT` column, so a wrong name errors `PLANNING_SQL` and 500s the
whole Availability screen. The api unit test only asserts the SQL _string_
contains the column, so it cannot catch a wrong name.

## Changes

1. **`apps/api/src/handlers/longhaul-cloud/driver-planning.ts`**
   - `PLANNING_SQL`: add `d.is_shorthaul_driver AS is_shorthaul_driver`.
   - Row type: add `is_shorthaul_driver: string | null`.
   - Response mapping: `isShorthaul: toYnBool(row.is_shorthaul_driver)` — reuse
     the existing `toYnBool`, no new helper.
   - `DriverPlanningRow` (api-side): add `isShorthaul: boolean`.

2. **`apps/api/src/handlers/longhaul-cloud/driver-planning.test.ts`**
   - Extend the existing Y/N mapping test: assert the SQL contains
     `d.is_shorthaul_driver`, and that `'Y'` / `'y'` / `'N'` / `null` map to the
     right booleans.

3. **`apps/tenant-web/src/api/queries/driver-planning.ts`**
   - `DriverPlanningRow`: add `isShorthaul: boolean` with a matching doc comment.

4. **`apps/tenant-web/src/features/driver-planning/availability/AvailabilityViewA.tsx`**
   - Third `useState<MoveTypeFilter>('any')` — `shorthaulFilter`.
   - Third line in the `visible` `useMemo`:
     `if (!moveTypeMatches(d.isShorthaul, shorthaulFilter)) return false`.
   - Third `<select data-testid="shorthaul-filter">` in the toolbar, labelled
     **Shorthaul**, same Any/Yes/No options and styling as its siblings.

5. **`apps/tenant-web/src/routes/driver-planning.index.test.tsx`**
   - Mirror the existing five-test block for the new filter (Any / Yes / No, plus
     a combined case with the other filters).
   - Update the shared row fixtures with `isShorthaul`.

6. **`vitest.config.ts` coverage floors** — expect `autoUpdate` churn in both
   `apps/api` and `apps/tenant-web`. Floors only ever rise; if the merge queue
   ejects the PR because a parallel merge moved them, rebase and re-pin rather
   than re-queueing.

## Out of scope (deliberate)

- No query param / Zod schema / API contract change — filtering stays client-side.
- No e2e coverage. The existing Local/Long-Dist. filters have zero e2e coverage;
  matching that precedent rather than expanding scope unasked.
- No SDK / MCP / OpenAPI surface — this is not the integrations/workflows boundary.
- No change to `driver-filter.ts`, `availabilityDriverFilter`, or the placeholder
  ID range.

## Verification — all green

- `npm run typecheck` (14/14 packages) and `npm run lint` at the root: clean.
- `apps/api`: 224 test files / 2937 tests pass.
- `apps/tenant-web`: 126 test files / 1274 tests pass.
- No `vitest.config.ts` coverage-floor churn in either package.
- **Browser-verified** against the real SPA (`vite --mode e2e`, API stubbed at the
  network layer): the toolbar renders `Local` / `Long Dist.` / `Shorthaul`, and
  6/6 roster assertions pass — default Any shows all four drivers,
  `Shorthaul=Yes` → `[3, 4]`, `Shorthaul=No` → `[1, 2]`,
  `Local=Yes AND Shorthaul=Yes` → `[3]`, and resetting to Any restores all four.

## Follow-up

`apps/e2e/.env.test` is deliberately **not** committed — the worktree rewrites its
Postgres port (5473 → 5490), which is local-only churn.
