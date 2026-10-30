# Office filter for Operations → Services

**Status:** completed · **Branch:** `feat/services-office-filter` · **Date:** 2026-10-30

## Goal

Make the Services board's **Office** control work. It is currently a disabled
placeholder with fake options (Chicago/Atlanta/Dallas). The placeholder was
justified by "there is no office/branch dimension anywhere in the legacy
schema". **That premise was wrong.**

## Evidence (prod, read-only via the MssqlExecutor, 2026-10-30)

- `v_longhaul_shipments_v2.branch` already exists and is already in the
  `LONGHAUL_SHIPMENT_VIEW_COLUMNS` manifest. It is `sales.branch`, the
  nvarchar(2) managing-branch code.
  - NW: 12 distinct codes; 41 NULLs out of about 199k rows.
  - QMM: 9 codes.
  - RVS: a single code, `01`.
- Every tenant has a canonical `branches` table with `branch_id` (the 2-char
  key), `branch_name` (padded on some rows), `branch_city`/`branch_state` and
  `branch_active` (Y/N). NW `09` (Virginia) is `N`.
- NW longhaul activities in the last 30 days: 1,275. All of them join to the
  view, and none has a NULL branch.
- `LocalDispatchJobs` carries `managing_branch_id` and `service_branch_id`.
  They differ on about half the rows (NW 1,132 of 2,093; QMM 1,184 of 2,096,
  over 90 days).
- Column types: `v_longhaul_shipments_v2.branch` is nvarchar(2) on all
  three tenants. `LocalDispatchJobs.service_branch_id` is nvarchar(2) on QMM
  and RVS and nvarchar(3) on NW. So string params are exact, and MSSQL ignores
  the trailing spaces.
- Legacy precedent (movemanager): the longhaul/CPnD Sales browse filters on
  `sales.branch` through `Branch(xx)`. Local Dispatch filters on
  `service_branch_id`.

## Decisions (Steve, 2026-10-30)

1. **Longhaul activities** match `s.branch` (the order's branch, through the
   existing `order_num` join).
2. **Local jobs** (`include=local`) match `j.service_branch_id`, the office
   sending the crew. This follows legacy Local Dispatch.
3. **No default to the user's own branch.** The filter starts empty, and the
   existing saved-filter default covers "my office".

## Changes

### API (`apps/api`)

- `handlers/longhaul-cloud/reference-data.ts`: add a client-independent
  statement, `SELECT branch_id, branch_name, branch_active FROM branches
ORDER BY branch_id`. It becomes `recordsets[6]`,
  and the per-client dispatchers/MoveType sets move to 7/8.
  - Update the index map comment. The handler reads by index, which is the
    footgun.
  - Reshape the rows to `filterOptions.office: [{ value: branch_id, label }]`.
    Values and labels are trimmed. The label is `"<id> — <name>"`, with
    " (inactive)" appended when `branch_active <> 'Y'`. Inactive branches stay
    in the list because historical orders reference them.
  - Like `activityType`, it populates even when there is no `longhaulClient`.
- `handlers/longhaul-cloud/activities-list.ts`: add `office?: Array<{value}>`
  to `ActivityFilters` and the predicate `s.branch IN (@p…)` with bound params.
  Replace the "NOTE the absence of office" comment.
- `lib/itinerary/services-board-local.ts`: add `office` to `LocalBoardFilters`
  and the predicate `j.service_branch_id IN (@p…)`.
- `lib/services-filter-query.ts`: add `offices: z.array(Code).max(100).optional()`.
  It stays `v: 1`: existing rows have no `offices`, and `.optional()` keeps
  them valid. Both ends treat a missing `offices` as `[]`. Update the header
  comment.
- Tests:
  - `activities-list.test.ts`: replace "sends nothing for office" with a test
    that office binds `s.branch IN`, plus a padded-value case.
  - The local-board SQL test asserts `service_branch_id IN`.
  - `reference-data` tests cover the index shift with and without a client, and
    the label shaping (trim, inactive suffix). The no-client case asserts that
    `filterOptions.office` still populates.
  - The `services-filter-query` test accepts `offices` and a legacy row
    without it.

### tenant-web (`apps/tenant-web/src/features/driver-planning`)

- `redux/activities/index.ts`: `buildActivityRequest` stops stripping
  `office`. Update the comments.
- `containers/Activities/use-services-reference-options.ts`: add
  `offices: filterOptions?.office ?? []`.
- `containers/Activities/components/ActivityFilters/index.tsx`:
  - Delete `OFFICE_PLACEHOLDER_OPTIONS` and `isDisabled`.
  - Wire the control like Dispatcher (`toOptions` relabel), with placeholder
    "All offices" and the `office` patch.
  - Count `office` in `activeCount`.
- `containers/Activities/services-filter-query.ts`: round-trip `offices` ↔
  `filters.office`, rehydrating labels from refs. Replace the literal
  `office: []` with `offices ?? []`.
- The common slice / types for `filterOptions.office`, if typed.
- Tests: update the existing office assertions in `activities.test.ts`,
  `ActivityFilters/index.test.tsx`, `services-filter-query.test.ts`,
  `Activities/index.test.tsx` and `ActivitiesModule.test.tsx`, which currently
  assert disabled/unsent. Fixtures use real string codes (`'03'`), per the
  #877 lesson.

### Not in scope

- The Planning (shipments) board and any other screen's office filter.
- Defaulting to the user's branch.
- SDK, OpenAPI and workflows: these are not integration/workflow routes, and
  `/onprem/longhaul/*` is not in the OpenAPI spec today (verify while
  implementing).

## Verification

- `npm run typecheck`, plus the api and tenant-web unit tests.
- Real-data check: run the generated SQL for NW through the executor with
  `office=['03']` and compare the count against a hand-written `s.branch='03'`
  count.
- After deploy: on NW prod, the board with Office = NJ shows only NJ orders,
  and with Local on, it shows jobs serviced by NJ.

## Docs / memory

- Correct the "no office dimension" claim in the memory note
  `project_daily_dispatch_activities_board` and in any `dolas/agents/project/*`
  file that repeats it.
- Add a GOTCHAS entry: local jobs have two branches; the Services board uses
  the service branch.

## Outcome (2026-10-30)

- API: unit tests pass (reference-data, activities-list, services-board-local,
  services-filter-query).
- tenant-web: 1044 of 1044 driver-planning tests pass. Typecheck is clean for
  api and tenant-web.
- Browser e2e: the Services specs (saved filters and shipment drawer) pass 5 of
  5 against a served e2e build. The saved-default fixture is a pre-`offices`
  row, which exercises back-compat.
- Prod data check (NW, read-only, 10-23 to 11-06):
  - With Office = `03` (NJ): 137 of 414 longhaul activities and 89 of 225
    local jobs.
  - The guarded `branches` statement yields exactly one recordset whether or
    not the table exists (verified with a missing-table probe), so the
    reference-data index map holds.
- Deviation from the plan: the `branches` statement is wrapped in
  `IF OBJECT_ID('branches') IS NOT NULL … ELSE <empty typed select>`. The QA
  tenants' DBs (QMM-QA, NW-test) were unreachable, so their table could not be
  confirmed, and one failing statement would fail the whole bootstrap.
- SDK/OpenAPI: no change. `/onprem/longhaul/*` and `/services-filters` are not
  in the OpenAPI spec, and neither is an integration/workflow surface.
