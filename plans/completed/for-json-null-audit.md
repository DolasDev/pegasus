# audit: remaining `FOR JSON` null-omission sites + fix `updated_by_id`

Follow-up to #629, which fixed the coverage payload only.

## Part 1 — Audit of the `activity` and `type` payloads

### The keys are dropped, at scale

Every column in both tables is nullable except the identity/timestamp columns.
Prod NWI, across 58,836 `LongDistanceDispatchActivity` rows joined exactly as
`buildEnrichmentSql` joins them:

| dropped key      | rows affected |
| ---------------- | ------------- |
| `estimated_date` | 29,619        |
| `driver_name`    | 14,484        |
| `actual_date`    | 1,348         |
| `TripMaster_id`  | 102           |
| `is_confirmed`   | 0             |
| `is_committed`   | 0             |
| unmatched `at.*` | 0             |

### But every consumer is null/undefined-agnostic — LATENT, not active

I traced each one rather than assuming:

- `buildShipmentActivities` untripped filter uses **loose** `a['TripMaster_id'] == null`
  (`longhaul-build-activities.ts:93`) — the 102 null-trip rows behave identically.
- `getTripInfo`'s comparators look null-sensitive (`compareTimes` does `a === null`)
  but their inputs are normalized by `toTime()`, which returns `number | null` and
  never `undefined`. Selection is otherwise truthiness-based (`!a.actual_date`).
- `estimated_date ?? planned_start` — `??` treats null and undefined identically.
- Gate flags `isCanEditDates` / `isHasETA` are read with truthiness only
  (`activity.activityType?.isCanEditDates`), and their type already admits `null`.
- **Write path is safe**: `pickReal` skips only `undefined`, so a dropped key means
  the column is omitted from the INSERT/UPDATE. I checked `sys.default_constraints` —
  the only non-null defaults on these tables are `created_at`/`updated_at`
  (`getdate()`), which the writers set explicitly. So an omitted nullable column
  lands as NULL: **the same value it replaced.**
- No spread-merge hazard: the only `{...activity}` merges
  (`trip-planning/index.ts:88`, `ActivityGantt.tsx:75`) operate on trip-detail-sourced
  activities, which already carry explicit nulls.

**Verdict: no observable bug today.** This is a landmine, not a live defect.

### Why fix it anyway

The same table is read two ways and disagrees. `trip-detail` reads activities via a
plain `SELECT *` (`longhaul-trip-fetch.ts`) and **does** return explicit nulls, so one
activity object has different key presence depending on which route loaded it. #629
proved what happens the moment someone writes `=== null` against that shape — and the
contract types (`actual_date?: string | null`) invite exactly that.

Adding `INCLUDE_NULL_VALUES` converges the list payload on what trip-detail already
delivers. It is not a new input shape for any consumer.

### Third site found: TripNotes

`trips-list.ts:117` has the same `FOR JSON PATH` over `SELECT n.* FROM TripNotes`,
with the same asymmetry — `longhaul-trip-fetch.ts:83` reads TripNotes with a plain
`SELECT *`. Its write path uses explicit column lists (not `Object.keys`), so there is
no second-order write bug, but the read inconsistency is identical.

## Part 2 — `updated_by_id` is confirmed wrong

`Coverage/index.tsx` builds `updated_by_id: packing_coverage ? user.updated_by_id : null`.

`user` is the `GET /users/me` payload, which spreads a `v_longhaul_salesman` row.
That view's columns are `id, code, first_name, last_name, title, email_address,
win_username, roles, active, managed_by_id` — **there is no `updated_by_id`.** The
expression is always `undefined` → dropped by `JSON.stringify` → skipped by
`pickColumns` → the column is never written.

Prod confirms it has never once worked:

| metric                                               | rows   |
| ---------------------------------------------------- | ------ |
| total coverage rows                                  | 13,806 |
| `updated_by_id IS NULL`                              | 13,806 |
| demonstrably updated (`updated_date > created_date`) | 3,851  |
| ...of those, still no author                         | 3,851  |

Fix: use `user.code`, matching `created_by_id`'s own fallback in the same object and
the established pattern at `trip-planning/index.ts:208` (`trip.updated_by_id = user.code`).

**The `Coverage.test.tsx` fixture is what hid this** — its `sampleUser` carries
`updated_by_id: 'U1'`, a field that does not exist in production. Replacing it is part
of the fix.

## Plan

1. `shipments-list.ts` — add `INCLUDE_NULL_VALUES` to the **activity** and **type**
   `FOR JSON PATH` payloads.
2. `trips-list.ts` — same for the **TripNotes** payload.
3. `Coverage/index.tsx` — `updated_by_id: ... ? user.code : null`.
4. Tests:
   - **Red-first**: SQL assertions for all three `INCLUDE_NULL_VALUES` additions; a
     `Coverage.test.tsx` case asserting `payload.updated_by_id === user.code` on the
     has-prior-coverage path, with the bogus fixture field removed.
   - **Pins**: an activity payload with explicit-null `actual_date`/`TripMaster_id`
     still classifying as untripped/unfinished; a notes payload with a null column.
5. `npm run typecheck` / `npm test` / `npm run lint`, then verify the three deployed
   queries against prod read-only.

## Explicitly out of scope

- **No backfill is possible** for the 13,806 rows with a null `updated_by_id` — the
  authorship was never recorded and cannot be reconstructed.
- **Server-side audit stamping.** Resolving `updated_by_id` from `resolveLonghaulUser`
  server-side would be more robust than trusting the request body, but
  `_write-template.ts` documents body-carried audit columns as the deliberate design
  for these handlers. Noted as future hardening; not changed here.
