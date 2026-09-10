# Dispatch Activities — a date-driven activity board under Operations

**Branch (to be created):** `feat/daily-dispatch` — worktree `../pegasus-daily-dispatch`
**Goal:** Add a fifth Operations screen, **Dispatch Activities**, visible to operations
admins only: a Planning-screen-styled list of _activities_ (not shipments) filterable by
activity date range, office (mocked/unwired), activity type, short haul, and dispatcher.

This is v1 of what may later become the dispatcher's main workstation. **Read-only** —
no editing, no "Pending Trips" column, no activity detail drawer.

---

## Context an agent needs to resume

- Operations is a sidebar **nav group** (`AppShell.tsx` → `OPERATIONS_CHILDREN`), not a
  tab bar. Its four children (Availability / Planning / Trips / Shipments) all inherit the
  group's `OPERATIONS_ROLES` gate. The per-child `roles` mechanism **still exists**
  (`NavChild.roles`, filtered at `AppShell.tsx:379`) even though no child uses it today —
  so gating one child is additive, not a mechanism revival.
- Routes are **code-defined** in `apps/tenant-web/src/router.tsx` (TanStack `createRoute`),
  not file-based, despite `src/routes/*.tsx` holding the page components.
- The Planning screen = `routes/PlanningModule.tsx` → `containers/Shipments` (`SearchDashboard`)
  - `containers/PendingTrips` + `containers/ShipmentDetail`, on legacy Redux
    (`features/driver-planning/redux/*`) and a legacy CSS-module look (`styles.css`,
    Open Sans, `Lane` + sticky header + card rows).
- Data path: component → `redux/<slice>` thunk → `utils/api/index.ts` (`API.*`) →
  `utils/api/routes.ts` (IPC-name → HTTP descriptor) → `/api/v1/onprem/longhaul/*`
  → cloud-direct handler in `apps/api/src/handlers/longhaul-cloud/`.
- Activities live in legacy MSSQL table `LongDistanceDispatchActivity`, joined to
  `Longhaul_ActivityType` on `ActivityType_code`. It carries `order_num`, so it joins
  straight to `v_longhaul_shipments_v2` — that join is where **dispatcher**
  (`s.operations_id`) and **short haul** (`s.haul_mode`) come from.
- `GET /activity-types` already exists (`activity-types.ts`) and the reference-data
  plumbing already loads dispatchers (`common.dispatcherList`).

---

## Decisions & assumptions (flagged — say so if any is wrong)

1. **"Operations admin only" = `['tenant_admin', 'operations_admin']`.** `tenant_admin` is
   the permit-all superuser persona; excluding it would hide the screen from the tenant's
   own admin. The three dispatch roles (`long_distance_dispatch`, `central_planning_dispatch`)
   do **not** see it.
2. **Gate is nav + route only.** No new Cedar action/persona grant in v1 — the API endpoint
   inherits the existing longhaul-cloud auth like every sibling `/onprem/longhaul/*` route.
   Rationale: authz-smoke only runs _after_ merge on this repo, so a bad grant ejects the PR
   from the merge queue. A real persona grant is a deliberate follow-up.
3. **The activity's date = `estimated_date`.** Range filter is
   `a.estimated_date BETWEEN @from AND @to`; the card also _displays_ `actual_date`.
   Deliberately **not** an overlap predicate on `planned_start`/`planned_end`: on this data
   `planned_end < planned_start` is legitimate (#619/#622), so an overlap test misfires.
   Swapping to `COALESCE(a.actual_date, a.estimated_date)` is a one-line change if the
   dispatcher's mental model turns out to be "when it happened, else when it's due".
4. **Real from/to date inputs — a deliberate divergence from the Planning screen.** Planning's
   `FilterTabs` date controls send _day offsets from today_ (`daysBetween`). For a board whose
   whole point is "work today's / this week's activities", absolute dates are correct. Same
   `<Select>` look for every other control.
5. **Default range = today → today + 7 days**, applied on first load. Without a default the
   unfiltered board would blow the 1000-row cap immediately.
6. **Office is mocked and unwired.** There is no office/branch concept anywhere in the API,
   the legacy views, or tenant-web — confirmed by grep. It renders as a disabled `Select`
   with a placeholder and an explicit comment; it sends nothing to the API.

---

## Checklist

### API — `apps/api`

- [x] `src/handlers/longhaul-cloud/activities-list.ts` — new `longhaulActivitiesListHandler`,
      modeled on `shipments-list.ts`:
  - same `ParamBag` bound-parameter pattern; same `MSSQL_NOT_CONFIGURED` 422 preflight;
    same `{ data, meta: { count } }` envelope; same row cap → 400 `RESULT_LIMIT_EXCEEDED`.
  - Base SQL: `FROM LongDistanceDispatchActivity a`
    `LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code`
    `LEFT JOIN v_longhaul_drivers drv ON a.assigned_driver_id = drv.driver_id`
    `LEFT JOIN v_longhaul_shipments_v2 s ON a.order_num = s.order_num`.
  - **Explicit column list, never `a.*` + aliases** — an alias reusing a projected column
    name makes mssql return arrays (#575).
  - Plain `SELECT`, no `FOR JSON` — sidesteps the `INCLUDE_NULL_VALUES` null-omission trap
    (#629/#634) entirely.
  - Filters, all in SQL: `estimated_date` range · `a.ActivityType_code IN` ·
    `s.haul_mode IN` (short haul) · `s.operations_id IN` (dispatcher).
  - Reads only. The table's enabled triggers only bite writes with a bare `OUTPUT`.
- [x] `src/app.ts` — mount `v1.get('/onprem/longhaul/activities', longhaulActivitiesListHandler)`
      **ahead of** the `/onprem/longhaul/*` wildcard proxy, beside the other cloud-direct GETs.
- [x] `src/handlers/longhaul-cloud/activities-list.test.ts` — SQL-shape + per-filter unit
      tests mirroring `shipments-list.test.ts` (executor mocked): each filter emits its
      clause and binds its params; no filter emits none; the row cap 400s; the 422 preflight.

### Frontend — `apps/tenant-web`

- [x] `src/features/driver-planning/utils/api/routes.ts` — `case 'fetchActivities'` →
      `GET /activities?filters=<encoded json>`, mirroring `fetchShipments`.
- [x] `src/features/driver-planning/utils/api/index.ts` — `fetchActivities` on the `API` surface.
- [x] `src/features/driver-planning/redux/activities/index.ts` — slice + thunk mirroring
      `redux/shipments`: `activityList`, `query` (seeded with the default date range),
      `loading`, `error`; `fetchActivities`, `changeActivityQuery`.
- [x] `src/features/driver-planning/redux/store.ts` — register the slice.
- [x] `src/features/driver-planning/containers/Activities/index.tsx` — `ActivitiesDashboard`:
      `Lane` + sticky header (`Activities (n)`) + the filter row + sortable column headers +
      card list + the "No activities found" empty state. Reuses the Planning look via a
      copied `Activities.module.css` (based on `Shipments.module.css`).
- [x] `src/features/driver-planning/containers/Activities/components/ActivityFilters/index.tsx`
      — Date From · Date To (native date inputs) · Office (**disabled**, `data-testid=
  "activities-filter-office"`, comment marking it unwired) · Activity Type (multi, from
      `/activity-types`) · Short Haul (multi, `SHAUL_LIST` — same options as Planning) ·
      Dispatcher (multi, from `common.dispatcherList`) · Reset.
- [x] `src/features/driver-planning/containers/Activities/components/ActivityCard/index.tsx`
      — one row per activity: estimated date, actual date, type (abbreviation + name),
      order #, shipper → consignee, city/state, driver, dispatcher, status.
- [x] `src/features/driver-planning/routes/ActivitiesModule.tsx` — single-column module.
      **No** `PendingTrips`, **no** `ShipmentDetail`, **no** `PromptWrapper`/nav blocker
      (nothing is editable yet, so there is nothing to warn about losing).
- [x] `src/router.tsx` — lazy `ActivitiesModule`; route `/driver-planning/activities` under
      the driver-planning layout with `beforeLoad: requireRole('tenant_admin', 'operations_admin')`.
- [x] `src/components/AppShell.tsx` — add
      `{ to: '/driver-planning/activities', label: 'Dispatch Activities', exact: false,
  roles: DISPATCH_ACTIVITIES_ROLES }` to `OPERATIONS_CHILDREN`, and update the stale
      block comment above it that claims no child carries `roles`.
- [x] `src/auth/role-guard.ts` — export `DISPATCH_ACTIVITIES_ROLES` so the nav entry and the
      route guard read one list (the same reason `OPERATIONS_ROLES` lives there).

### Tests

- [x] `containers/Activities/index.test.tsx` — renders the header + count, renders cards from
      a mocked store, renders the empty state, and the Office control is present _and disabled_.
- [x] Filter-control coverage — **folded into `containers/Activities/index.test.tsx`**
      rather than its own file: the controls are only meaningful against a real store,
      which that suite already builds. A dedicated
      `components/ActivityCard/index.test.tsx` was added instead, covering the
      formatting rules (title-casing, `.trim()`, dash fallbacks, actual-date-drives-
      complete) that are the card's actual risk surface.
- [x] `redux/activities/activities.test.ts` — reducers + thunk success/failure.
- [x] `utils/api/routes.test.ts` — `fetchActivities` builds the expected path + query string.
- [x] `__tests__/AppShell.test.tsx` — `operations_admin` and `tenant_admin` see the child;
      `long_distance_dispatch` and `central_planning_dispatch` see the other four but **not**
      Dispatch Activities.
- [x] `__tests__/role-guard.test.ts` — the new role list admits/denies as above.

### Close-out

- [x] `npm run typecheck && npm test` green in the worktree.
- [x] Docs: nothing non-obvious surfaced that isn't already recorded — the two traps
      this handler steps around (#575 wildcard-alias arrays, #629 `FOR JSON` null
      omission) are already in GOTCHAS, and the handler comments cite them.
- [x] `git mv plans/in-progress/daily-dispatch.md plans/completed/<short-hash>-daily-dispatch.md`
      in the implementation commit, **before** opening the PR.

---

## Risks & side effects

- **Hot files.** `router.tsx` and `AppShell.tsx` are named merge magnets in the team workflow
  — they merge cleanly but break semantically. If another stream is touching either, serialize:
  land that one, then rebase this branch on `origin/main` before continuing.
- **Row cap.** Activities are far more numerous than shipments (multiple per order). The
  default 7-day window plus the cap keeps this safe, but a dispatcher widening the range to a
  quarter will legitimately hit `RESULT_LIMIT_EXCEEDED`. The UI must surface that as
  "narrow your date range", not as a generic failure.
- **Tenants without a legacy DB.** The whole Operations group is already hidden behind the
  `longhaul` capability, so no new exposure — but the handler still needs its own
  `MSSQL_NOT_CONFIGURED` 422 preflight, same as its siblings.
- **QMM.** `v_longhaul_shipments_v2` was historically missing on PegQMM. The join to it means
  this screen inherits that dependency; it fails the same way Planning already does there.
- **Padded legacy codes.** `haul_mode` / `import_export`-style nvarchar columns carry trailing
  spaces. Filtering in SQL (`IN`) is safe — MSSQL ignores trailing spaces on comparison — but
  any JS-side comparison of these values needs `.trim()` (#628, zone-code padding).
- **Not in scope:** Pending Trips, editing an activity, an activity detail drawer, a real
  office dimension, saved filter sets, and any Cedar/persona change.

---

## Outcome

Landed as planned. Notes worth carrying forward:

- **`consignee_name1` is the destination STREET, not a name** (#569). The first draft
  of the projection used it as the consignee's name. `packages/longhaul-contracts`
  exists precisely to catch that, so the shipment half of the SELECT is now typed
  `LonghaulShipmentViewColumn` — a wrong column name is a compile error, not a blank
  cell. The dispatcher's surname is `last_name` on the view (the legacy entity called
  it `OpsLastName`, which is what #570 was).
- **The activity-type filter matches the ABBREVIATION, not `ActivityType_code`.** The
  control is populated from `filterOptions.activityType`, which
  `reference-data.ts` → `toActivityTypeOptions` builds by de-duplicating
  `Longhaul_ActivityType.abbreviation`. Filtering on the code would have returned zero
  rows for every type whose code differs from its abbreviation — a filter that looks
  live and finds nothing. Planning's "Last Activity" filter matches the same token.
- **The date upper bound is `< DATEADD(day, 1, @to)`, not `<= @to`.** `estimated_date`
  is a calendar day stored in a DATETIME. #534 normalizes writes to naive midnight, but
  rows written before it (tenant-web pickers persisting `toISOString()` off a local
  Date) still carry times like `05:00:00`, and `<=` compares against that day's
  midnight. On a board whose entire job is "show me this date", dropping them is the
  worst way to be wrong.
- **`db-access-guard` caught the new handler**, as designed: every longhaul-cloud
  handler reads `Tenant.mssqlConnectionString` off the base (unscoped) Prisma client
  and must be allowlisted with a justification. Added.
- **The board fetches on mount** — `useDebounce` returns its initial value immediately —
  so `loading` is true on first paint and the empty state only appears after the first
  response settles. Tests that assert the empty state have to await it.
- **`apps/api/vitest.config.ts` coverage floors moved up** (autoUpdate). That belongs in
  the commit; stale floors eject a PR from the merge queue.
- **Not committed:** `apps/e2e/.env.test` (holds this worktree's isolated Postgres port)
  and `package-lock.json` (an `apps/mobile` nested-entry churn from provisioning's
  `npm install`, unrelated to this change).
