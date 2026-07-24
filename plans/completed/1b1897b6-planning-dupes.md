# Fix: duplicate shipment rows (Planning) + duplicate date column (Trip Gantt)

## Bug 1 — same shipment appears twice in the Operations Planning list

**Root cause:** `apps/api/src/handlers/longhaul-cloud/shipments-list.ts` `buildBaseSql()` uses
three `LEFT JOIN`s that can fan out one shipment into N rows:

```
FROM v_longhaul_shipments_v2 S
LEFT JOIN sales AS ps            ON S.order_num = ps.order_num
LEFT JOIN v_longhaul_states os   ON S.shipper_state   = os.geo_code
LEFT JOIN v_longhaul_states ds   ON S.consignee_state = ds.geo_code
```

- `sales` has no uniqueness guarantee on `order_num` — `shipments-write.ts:72` only guards
  inserts with `IF NOT EXISTS`, nothing stops a second row existing.
- The two `v_longhaul_states` joins exist **only** to back the `origin_zone` / `destination_zone`
  filters (`os.zone` / `ds.zone`); they contribute no columns to the SELECT list. This is also
  the **only** site in the repo that joins `v_longhaul_states` on `geo_code` — every other join
  (`longhaul-trip-fetch.ts:66-67`, `trips-list.ts:122-123`, `driver-planning.ts:61`) uses the
  primary key `os.id`. `geo_code` is not a key, so it can match multiple rows.

The list is keyed by `order_num` downstream — `containers/Shipments/index.tsx:22`
`key={shipment.order_num}` — so two rows for one order is unambiguously wrong (it also produces
a React duplicate-key warning). Duplicates additionally burn rows against the 1001-row base cap
and the 1000-row `RESULT_LIMIT_EXCEEDED` guard.

**Fix (approved):**

1. `sales` → `OUTER APPLY (SELECT TOP 1 weight, lng_dis_comments, operations_id, operations_name
FROM sales WHERE order_num = S.order_num) ps` — at most one shadow row per shipment,
   identical output columns (`shadow_weight`, `shadow_comments`, `operations_id`,
   `operations_name`).
2. Zone filters → `EXISTS (SELECT 1 FROM v_longhaul_states os WHERE os.geo_code = S.shipper_state
AND os.zone IN (...))` (and the `ds`/`consignee_state` twin). Drop both `LEFT JOIN`s. Filter
   semantics are preserved: a shipment matches iff at least one state row for its code is in the
   selected zones — which is exactly what the fan-out join meant, minus the row multiplication.
3. JS backstop: dedupe `rawShipments` by `order_num` (first row wins, preserving ORDER BY) before
   enrichment, with a `logger.warn` recording the drop count so a residual view-level duplicate
   stays observable rather than silently swallowed.

## Bug 2 — adding a planned date duplicates the date column on the Trip Gantt

**Root cause:** `containers/Trip/utils/parse-activities.ts` builds the Gantt's column list as a
`Set` keyed by the **full ISO timestamp**:

```ts
const date = new Date(unformattedDate).toISOString()
days.add(date)
```

But the column header renders only the calendar day, in UTC —
`ActivityGantt.tsx:118` → `formatDateShort(day)` uses `{ month: '2-digit', day: '2-digit',
timeZone: 'UTC' }`. So two values on the same UTC day but with different times-of-day produce
**two Set entries that render the identical label** — a duplicated date column.

This is exactly what "adding a planned date" triggers. `getPegDates()` detects drift with
`sameDayCheck` (calendar-day granularity), then `parse-activities` pushes the _shipment's_
`plan_pack`/`plan_load`/`plan_del` value — which carries the shipment row's own time-of-day —
into `days` alongside the activity's `planned_start`. Same day, different time → duplicate column.
`syncActivityDates` (`ActivityGantt.tsx:71`) then writes that shipment-sourced value into the
activity's `planned_start`, so the duplicate persists after the save.

Two secondary defects fall out of the same keying mistake:

- `getOffset` (`ActivityGantt.tsx:33`) resolves a bar's column with
  `days.indexOf(new Date(targetDay).toISOString())` — an exact string match. A time-of-day
  mismatch misses and **silently returns 0**, parking the bar in the first column.
- `addDays` uses `setDate` (local time), so a multi-day activity spanning a DST boundary shifts
  the UTC time-of-day by an hour and emits a duplicate/misordered column for the same day.

**Fix:**

1. `parse-activities.ts` — normalize every day key to **UTC midnight** before adding to the Set
   (`Date.UTC(y, m, d)` → `toISOString()`), matching the `timeZone: 'UTC'` header label. One Set
   entry per rendered column, by construction.
2. Return `days` already sorted chronologically with the `null` ("Unknown") entry last, and drop
   the mutating `days.sort()` at the call site (`containers/Trip/index.tsx:285`).
3. `ActivityGantt.getOffset` — apply the same UTC-day normalization before `indexOf`, so bars and
   ETA markers land in the right column instead of falling back to 0.

## Bug 2b — dead join duplicating a trip's shipments (approved, same screen)

`apps/api/src/lib/longhaul-trip-fetch.ts:96` `buildShipmentBundleSql()`:

```sql
SELECT s.*
FROM v_longhaul_shipments_v2 s
LEFT JOIN sales ps ON s.order_num = ps.order_num   -- selects NOTHING from ps
WHERE s.order_num IN (...)
```

The join contributes no columns and can only duplicate a trip's shipments (and therefore its
Gantt activity rows). Remove it.

## Tests (TDD — write failing first)

- `apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts`
  - base SQL contains no `LEFT JOIN sales` / `LEFT JOIN v_longhaul_states`; uses `OUTER APPLY`
    and `EXISTS` instead.
  - origin_zone / destination_zone filters still bind their values and still filter.
  - a base recordset with two rows sharing an `order_num` yields ONE entry in `data`,
    `meta.count` 1, and logs a warning.
- `apps/api/src/lib/longhaul-trip-fetch.test.ts` — shipment bundle SQL has no `sales` join.
- `containers/Trip/utils/parse-activities.test.ts`
  - two activities on the same UTC day with different times → ONE day entry.
  - a pegged planned date on the same UTC day as `planned_start` adds no extra column.
  - `days` come back sorted ascending with `null` last.
- `containers/Trip/components/ActivityGantt/ActivityGantt.test.tsx`
  - a single date-header per calendar day for time-of-day-varying activities.
  - a bar whose `planned_start` differs only in time-of-day resolves to its real column, not 0.

## Gate

`npm run typecheck && npm test` (api integration tests need the worktree's Postgres —
run `db:migrate` + `db:generate` after the worktree is provisioned).

---

## Outcome — both bugs fixed, full gate green

Diagnosis above confirmed; all three changes shipped as described. Every new test was
run against the unfixed source first (`git stash` of the source files only): 9 of the
frontend tests and 7 of the API tests failed red, then passed after restoring the fix.

**Gate:** `npm run typecheck` ✓, `npm test` ✓ (14/14 tasks), `npm run lint` ✓.
`apps/api/vitest.config.ts` coverage floors ratcheted up (lines 91.62→91.64,
branches 78.68→78.70, statements 90.21→90.22) — committed, as floors only rise.

**Not verified against live data.** The legacy MSSQL these queries run against is
on-prem behind the tenant tunnel and is not reachable from this session, so the SQL
changes are covered by shape assertions on the generated query text plus the JS-level
dedupe, not by an execution against a real `sales` / `v_longhaul_states`. The
duplicate-row report is consistent with either fan-out; both are closed regardless of
which one the tenant actually hit, and `dedupeByOrderNum` logs a warning if a
duplicate still arrives from the view itself.

**Gantt fix note.** The `parseActivities` peg-date test passes on the _old_ code when
the test host runs in UTC (`sameDayCheck` is local-time, so the mismatch that pushes
the duplicate day only fires off-UTC). The TZ-independent proof is the
"collapses same-day activities that differ only in time-of-day" case, which fails red
on the old code in any zone. Browsers run in the user's local zone, where the
local-vs-UTC split made the original bug worse.

Gotchas recorded in `dolas/agents/project/GOTCHAS.md` (geo_code is not a key of
v_longhaul_states; Gantt columns key by UTC day).
