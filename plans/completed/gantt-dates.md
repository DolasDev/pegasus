# Fix: Gantt duplicate dates — date-only write contract, trip-fetch dedupe, header year

## Evidence (NWI prod, verified 2026-08-11)

Ran the **real** `parseActivities` over all 58,592 activity rows / 12,405 trips pulled from prod.

**Trip 16426 reproduces under the pre-#534 (legacy) keying**, which keyed columns by the full ISO
timestamp instead of the UTC day:

```
08/16  <-  2026-08-16T00:00:00.000Z  &  2026-08-16T05:00:00.000Z
08/21  <-  2026-08-21T00:00:00.000Z  &  2026-08-21T05:00:00.000Z
```

`05:00:00Z` is midnight US-Eastern. Every date sourced from the legacy DB is **naive midnight**;
the tenant-web date pickers save `date.toISOString()` off a local-time `Date`, so a picked day is
persisted five hours off. #534's `toUtcDayKey` hides the collision in the Gantt but the stored
value is still wrong for every other consumer (legacy VB app, reports, exports).

**41 activity rows currently carry a non-midnight time** — 36 `estimated_date`, 9
`planned_start`, 9 `planned_end`, 3 `actual_date`; 40 at `05:00:00`, one at `22:00:00`. They are
recent and ongoing (trips 16645, 16642, 16606, 16595, 16579, 16575, updated Aug 10–11).

Under legacy keying 23/12,405 trips show duplicate labels: **13 are pure time-of-day collisions**
(this bug) and **10 are wrong-year data** (separate, below).

The `22:00:00` row matters for the fix: it is a client east of UTC, where `toISOString()` of local
midnight lands on the **previous** UTC day. So the API cannot simply truncate in UTC — the client
must send an unambiguous calendar day.

## Fix 1 — date-only write contract (root cause)

Three UI sites send `toISOString()`:

- `ActivityGantt.tsx:218` (`estimated_date`), `:283` (`actual_date`)
- `PendingTrips/components/EditActivity/index.tsx:34-35` (`start_date` / `end_date` →
  `planned_start` / `planned_end`) — these are the 9 non-midnight planned rows.

**tenant-web:** send the picked **local calendar day** as `YYYY-MM-DD`, never `toISOString()`.
Add a shared `toDateOnly(date)` helper next to `toUtcDayKey` in `utils/date.ts`.

**apps/api (authoritative — covers trip-save and any SDK caller too):** normalize the date-only
columns `estimated_date`, `actual_date`, `planned_start`, `planned_end` before they reach MSSQL,
in `activities-write.ts` and `longhaul-trip-save.ts`:

- `YYYY-MM-DD` → `YYYY-MM-DD 00:00:00` (exact, no timezone math)
- full ISO → truncate to its UTC calendar day (legacy-client compat; correct for US offsets),
  and `logger.warn` so residual non-date-only writes stay visible.

## Fix 2 — reject inverted spans

`planned_end < planned_start` is rejected (400) in `activities-write.ts` and trip-save. 7 rows in
prod have spans of exactly −364/−365/−728 days (same MM/DD, wrong year) — e.g. id 9911
`2021-08-19 → 2020-08-19`, id 55057 `2024-01-24 → 2023-01-24`, id 91212 `2026-01-05 → 2025-01-06`.
This guard alone would have blocked the 1969/2000/2001 sentinel years.

## Fix 3 — `dedupeByOrderNum` on the trip fetch

`v_longhaul_shipments_v2` returns **617 rows for 307 order_nums**. #534 added `dedupeByOrderNum`
to `shipments-list.ts` but `lib/longhaul-trip-fetch.ts` RT2 never got it, and `assembleShipments`
maps 1:1 over whatever the view returns — so the trip screen renders duplicate shipment entries.
Affected orders sit on live trips: 16646, 16498, 16442, 16385, 16317, 16304, 16285, 16280, 16277,
15870, … Reuse the existing helper; it already warns when it fires, which also gives telemetry on
how often the 307 bad orders are hit.

## Fix 4 — year in the Gantt header, not visible

Per instruction the visible label stays `MM/DD`. Carry the full date **in the DOM only**:
`title` (hover) + `data-day` (the ISO day key) on `ActivityHeader`. Costs nothing visually, makes
a wrong-year column diagnosable without a DB query.

## Status

Fixes 1–4 and all tests SHIPPED in this PR. The data cleanup below is **NOT** done —
it writes to the tenant's prod legacy MSSQL through triggers that cascade into `sales`,
so it is presented row-by-row for approval and run separately. The code fixes stop the
bleeding (no new bad rows); the cleanup repairs the existing ones.

## Data cleanup (prod MSSQL — requires explicit approval before running)

1. **41 non-midnight rows** → `CAST(CAST(col AS DATE) AS DATETIME)` for the four columns. Safe:
   every one is `05:00`/`22:00` on the intended day for US clients. The single `22:00:00` row is
   reviewed by hand first — truncating it in UTC would move it a day.
2. **Wrong-year rows** on the 10 trips (14878, 13384, 12532, 12308, 8653, 4068, 2985, 2468, 2235, 1626) — each correct value derived from the shipment's pegged dates, not guessed. All 10 trips
   are Finalized. Presented row-by-row for approval; **no blind UPDATE**.

`LongDistanceDispatchActivity` has enabled AFTER INSERT/UPDATE/DELETE triggers that write through
to `sales`. UPDATEs must be run in a transaction, row-scoped by `id`, verified with a SELECT
before COMMIT.

## Tests (red first)

- `date.test.ts` — `toDateOnly` across timezones incl. east-of-UTC.
- `activities-write.test.ts` — `05:00Z` and `22:00Z` inputs normalize to midnight; `YYYY-MM-DD`
  passes through; inverted span → 400.
- `longhaul-trip-fetch.test.ts` — a duplicated `order_num` from the view yields one shipment.
- `ActivityGantt.test.tsx` — header exposes `title`/`data-day` with the year, visible text is
  still `MM/DD`.
- `parse-activities.test.ts` — regression pinning trip 16426's real rows to 18 distinct columns.
