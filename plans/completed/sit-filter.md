# sit-filter — Trip Id link, SIT-Dest filter, operations role grant

Three independent changes to the Driver Planning (longhaul) surface. They share no
code, so they can land as three commits in one PR.

---

## 1. Trip Id renders as a blue underlined link (order details)

**Where:** `apps/tenant-web/src/features/driver-planning/containers/ShipmentDetail/index.tsx:205`

The Trip Id accessor is already a `<Link>`, but it carries no className, so it
inherits ambient text color and no underline — it does not read as a link. The
Order Number two fields above gets its appearance from
`clickableStyles.clickable` (`components/Clickable/Clickable.module.css`:
`color: -webkit-link; text-decoration: underline; cursor: pointer`), already
imported at the top of this same file (line 12).

**Change:** add `className={clickableStyles.clickable}` to the Trip Id `<Link>`.

**Target is correct as-is — do not "fix" the path.** `to={`/trip/${id}`}` looks
wrong against the route tree (there is no `/trip` route; it is
`/driver-planning/trips/$tripId`), but the `Link`here is the compat shim at`features/driver-planning/utils/router-compat.tsx`, whose `translatePath`explicitly maps`/trip/:id`→`/driver-planning/trips/:id`. Leave the path alone.

**Guard the null case.** `TripMaster_id` is nullable — an untripped shipment
currently renders an empty, invisible link to `/trip/null`. Unstyled that is
harmless; styled blue+underlined it becomes a visible dead link. Render a plain
`<span>`/empty when `TripMaster_id` is null, and only render the `<Link>` when
there is an id.

**Tests:** `ShipmentDetail/index.test.tsx` has no Trip Id assertion today. Add
one covering both branches — id present → anchor with the clickable class and the
translated href; id null → no anchor.

---

## 2. "SIT-Dest" yes/no filter on the planning screen

**Semantics (decided):** Yes = the shipment has a SIT-In activity with a recorded
**actual** date — a `LongDistanceDispatchActivity` row with
`ActivityType_code = 'SITIN'` and `actual_date IS NOT NULL`. No = it does not.

Explicitly **not** `whse_date`. That column feeds the SIT-In activity's _planned_
start/end (`longhaul/server/modules/activities/activity.service.ts:456-457`), so
it says a SIT-In was scheduled, not that one happened.

**"No" includes shipments with no SITIN activity at all.** `NOT EXISTS` is true
both for a shipment that never had a SIT-In and for one whose SIT-In is still
unactualized. That is the intended reading of "yes = there is in fact a SIT-In
actual date" — recording it here so it is a decision, not an accident.

### Client — `containers/Shipments/components/FilterTabs/index.tsx`

- Add to `FIELDS`: `{ label: 'SIT-Dest', property: 'sit_dest', type: 'sit-dest' }`
  (17th field).
- Render it with the existing yes/no `Select` pattern used by `Assigned`, reusing
  `ASSIGNED_LIST` (`utils/unassigned-list.ts` — `[{Yes},{No}]`). Prefer reusing
  that list over a new module; if a distinct label set is wanted later, split then.
- No `/reference-data` plumbing — the options are static. This is strictly
  simpler than #637, which had to extend the batched bootstrap.
- The FIELDS chunker was fixed in #637 to pin column count and distribute the
  remainder, so a 17th field reflows within the existing 5-column layout. Confirm
  visually; do not re-touch the chunker.

### API — `apps/api/src/handlers/longhaul-cloud/shipments-list.ts`

This goes in the **WHERE builder** (round trip 1), not the post-enrichment loop.
`latest_activity` (#637) and `TripStatus_id` run post-enrichment because their
values are computed in JS and have no column to filter on. This predicate is not
like those: `ActivityType_code` and `actual_date` are real columns on
`LongDistanceDispatchActivity`, joinable straight to `order_num`.

- Add `sit_dest?: Array<{ value: string }>` to the filters type (~line 77, next
  to `assigned`).
- Add the clause next to the `f.assigned` block (~line 245), following that
  block's exact shape including the `?.length === 1` guard. `Assigned` already
  pushes a subquery (`driver_id IN (SELECT ... FROM v_longhaul_drivers ...)`), so
  an `EXISTS` beside it is the same shape, not a new pattern:

```ts
if (f.sit_dest?.length === 1) {
  const val = f.sit_dest[0]?.value ?? ''
  const sitIn =
    `SELECT 1 FROM LongDistanceDispatchActivity AS sit` +
    ` WHERE sit.order_num = ${S}.order_num` +
    ` AND sit.ActivityType_code = ${bag.bind(ACTIVITY_TYPE_CODE.SITIN)}` +
    ` AND sit.actual_date IS NOT NULL`
  if (val.includes('Yes')) where.push(`EXISTS (${sitIn})`)
  else if (val.includes('No')) where.push(`NOT EXISTS (${sitIn})`)
}
```

Import `ACTIVITY_TYPE_CODE` from `../../lib/longhaul-shipment-enrich` (already
exported; the handler's existing import block at line 44-52 pulls from that
module). Do not hardcode `'SITIN'`.

**Bind, never interpolate** — `bag.bind()` for the code literal, as every other
clause in this builder does. `${S}` is the shipment alias and is a trusted
constant, not user input.

**`IS NOT NULL` is the whole predicate — no `<> ''` hedge.** `actual_date` is a
TypeORM `@Column({ nullable: true }) actual_date: Date`
(`longhaul/server/modules/activities/model/activity.abstract.ts:36`), which maps
to a real MSSQL `datetime` — a type that cannot hold an empty string. This is a
base-table entity TypeORM actually manages, so it is more trustworthy than the
view-entity declarations that `packages/longhaul-contracts/src/shipment-view.ts`
warns about. Low risk, but if a live check is cheap, confirm `DATA_TYPE` for
`LongDistanceDispatchActivity.actual_date`; if it ever comes back `nvarchar`, add
the `<> ''` half on the Yes side and `= ''` on the No side.

**No `.trim()` needed on the code comparison.** MSSQL `=` ignores trailing spaces,
so the padded-nvarchar trap that silently dropped `import_export` codes (#628)
does not apply — that bug came from comparing in JS. Keeping this in SQL avoids it
entirely, which is one of the reasons this belongs in the WHERE builder.

### Tests

- `apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts` — Yes emits the
  `EXISTS` clause, No emits `NOT EXISTS`, absent/both-selected emits neither (the
  `length === 1` guard). Assert `'SITIN'` arrives as a bound **parameter**, not
  inlined in the SQL string.
- `FilterTabs/index.test.tsx` — the row renders with label `SIT-Dest`, and
  selecting Yes writes `{ sit_dest: [{ value: 'Yes', label: 'Yes' }] }` to the
  query. Mirror the `latest_activity` cases at lines 52-106, including the
  "properties contains" assertion.

---

## 3. LD Dispatch + Central Planning reach all operations screens

**Scope (decided):** all four gated screens — Planning, Trips, trip detail, and
the rejected-trip snapshot. Both roles already reach Availability and Shipments,
so this opens the Operations section fully to them.

Two roles, by `name` (not label): `long_distance_dispatch` ("LD Dispatch") and
`central_planning_dispatch` ("Central Planning") — see
`apps/api/src/authz/role-options.ts:76-89`.

### Gates to change

1. **`apps/tenant-web/src/router.tsx:381`** — `OPERATIONS_MANAGER_ROLES` feeds
   `requireRole(...)` on four routes (`planning`, `trips`, `trips/$tripId`,
   `trips/rejected/$rejectedId`, lines 392/399/406/417). Add both roles.
2. **`apps/tenant-web/src/components/AppShell.tsx:55`** — the same const gates
   the Planning/Trips nav children. Add both roles.

After the change AppShell's `OPERATIONS_MANAGER_ROLES` becomes **identical** to
the `OPERATIONS_PLANNING_ROLES` const directly above it (line 44). Collapse the
two into one const rather than leaving duplicate literals that will drift — the
per-child `roles` filter then becomes redundant and can be dropped, since every
role that can see the Operations section can now see every child. Keep the
router's own copy separate (it is a different module) but update its comment.

### Comments to rewrite (they currently assert the opposite)

- `AppShell.tsx:51-54` — "further restricted to the operations-manager persona…
  The dispatch roles keep Availability/Shipments but not these two children".
- `router.tsx:377-380` — "The broader dispatch roles that can see the Operations
  section still reach Availability/Shipments, but not these two screens".

Both are now false. Replace with a note that the dispatch roles were granted the
full Operations section, and keep the existing "server-side Cedar remains the
source of truth" caveat.

### Tests

- `apps/tenant-web/src/__tests__/AppShell.test.tsx:256` —
  `'hides Planning/Trips from central_planning_dispatch as well'` asserts the
  behavior being removed. Flip it to assert visibility, and add the
  `long_distance_dispatch` case alongside it.
- Keep the `operations_admin` case at line 206 green.
- `__tests__/role-guard.test.ts` needs no change (it tests `requireRole` itself,
  not this role list).

### No API change

Verified: the longhaul-cloud planning/trips handlers carry no role gate —
`grep operations_admin apps/api/src` returns only `role-options.ts` and two tests
noting that these personas carry **no permit entries**. `apps/e2e/tests/api/
authz-smoke.spec.ts` does not exercise the planning routes or either dispatch
role, so there is no post-merge authz-smoke pin to update in the same PR (the
trap from #632). Re-confirm with those two greps before concluding the item;
if either turns up a gate, it lands in this PR too.

---

## Verification

- `npm run typecheck` and `npm test` at the root.
- `apps/e2e` browser specs under `tests/browser/longhaul/` (planning, trips,
  trip-detail) — run them, since items 1 and 3 both move UI these specs drive.
- Manual: as a `central_planning_dispatch` user, confirm Planning/Trips appear in
  the nav, the routes load, the Trip Id on a shipment's order details is blue +
  underlined and navigates to the trip, and SIT-Dest = Yes/No partitions the
  shipment list.

## Landing

One PR, three commits, plan file committed alongside (`git mv` to
`plans/completed/` in the implementation commit per the archive rule), landed via
`gh pr merge --auto --squash` through the merge queue.

---

## As built

Landed as three commits on `feat/sit-filter`. Five deviations from the plan
above, all discovered during implementation:

1. **The role list became one shared const, not two widened literals.** The plan
   said to collapse AppShell's `OPERATIONS_MANAGER_ROLES` into
   `OPERATIONS_PLANNING_ROLES` and update router.tsx's own copy separately. That
   still leaves two lists in two modules that must agree. Both now import
   `OPERATIONS_ROLES` from `auth/role-guard.ts` (which router.tsx already
   imported for `requireRole`), so the nav and the route guards cannot drift.
   The per-child `roles` filter on Planning/Trips was dropped as redundant —
   those entries inherit the group's gate, as Availability/Shipments already do.

2. **The router-compat `Link` mock had to be fixed first.** It rendered a bare
   `<a>` and dropped every prop but `children`, so both new item-1 assertions —
   the styling and the href — would have passed without the component doing
   anything. It now forwards `className`/`data-*` and maps `to` onto `href`.

3. **"SIT-Dest" collided with an existing test.** `FilterTabs` had a
   document-wide `screen.queryByText(/SIT\s*[—-]/)` asserting the Last Activity
   options use bare abbreviations; the new field's label matched it. Scoped to
   the `latest_activity` row, which is what the assertion was always about.

4. **Two extra API tests to hold the coverage floor.** The `sit_dest` block's
   defensive paths (a value that is neither Yes nor No; an option with no
   `value`) were uncovered and dropped branch coverage below the 79.81 floor.
   Covering them raised it instead.

5. **API coverage floors moved**: statements 90.84 → 90.85, branches
   79.81 → 79.83 (vitest `autoUpdate`).

Verified: `npm run typecheck` (14/14) and `npm test` (15/15) green from the
worktree. Not run: the `apps/e2e` browser specs — they need a live API and a
seeded tenant, so items 1 and 3 still want the manual pass described above.
