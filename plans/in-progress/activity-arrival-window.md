# Arrival time spread on a trip activity

**Status:** in progress — API layer done, UI next, Step 0 gate still OPEN
**Branch:** to be created via `scripts/new-worktree.sh feat activity-arrival-window`
**Goal:** let an operations user enter a local-time arrival window (default 8:00–10:00)
on any activity from the trip Gantt popover, stored with an explicit IANA time zone so
future automation can turn it into a correct UTC send-time for customer SMS.

## Progress

- [x] Pure time-zone resolver + arrival-window value module (84 unit tests green)
- [x] Idempotent legacy-schema provisioning module
- [x] `POST /activities/:id` accepts, validates and writes the window (27 tests green)
- [x] Read path derives the anchor date, UTC instants, zone label and suggestion
- [x] `ACTIVITY_COLUMNS` carries the window through a full trip save
- [ ] **Step 0 trigger gate — BLOCKED on `aws sso login --sso-session dolas`**
- [x] tenant-web popover UI + tests (28 Gantt tests + 11 display-util tests green)
- [x] e2e round-trip — added to `tests/api/longhaul-qa.spec.ts`, NOT the browser spec:
      the repo deliberately moved activity write flows there
      (`plans/completed/longhaul-qa-mutating-triage.md`). It is also the only test that
      exercises lazy column provisioning against a real SQL Server.
- [x] `GOTCHAS.md` / `PATTERNS.md` entries
- [ ] Run the QA e2e round-trip (`npm run e2e:qa`) — needs the QA tenant + tunnel up

### Deviation from the approved design: the zone is required, not guessed

The design said the server would stamp `arrival_window_tz` from the ZIP when the client
omitted it. It does not. The write now demands all three fields or none.

**Why:** the resolver cannot be confident in the 14 split states, so a server-side stamp
would quietly pick a majority zone and defeat the very confirmation the UI exists to
collect — the failure mode being a customer texted an hour early. Reads hand every client
`arrival_window_tz_suggested` + `arrival_window_tz_confidence`, so supplying the zone costs
the caller nothing and makes the choice explicit and auditable. Also removes the need to
widen the handler's RT1 read.

## Why

Customer service coordinators call/text customers the day before every activity with an
estimated arrival spread. Ops collects those windows from drivers today and they live
nowhere — there is no time storage anywhere in the longhaul stack. Capturing them on the
activity is the precondition for automating the notification.

## Decisions (approved)

| Decision  | Choice                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Storage   | **New nullable columns on `LongDistanceDispatchActivity`** (legacy MSSQL)                                    |
| Time zone | **Auto-resolved from the activity's ZIP, ops can override**                                                  |
| Scope     | **Any activity**, ETA-bearing or not                                                                         |
| Default   | **Prefilled 08:00–10:00 constant, stored only on save** (no row ⇒ "not communicated", never an implied 8–10) |

### Derived decisions

- **Wall-clock strings, never instants.** Columns are `varchar(5)` holding `HH:mm`, not
  MSSQL `time` — the mssql driver hands `time` back as a 1970 `Date`, and this codebase
  has already paid for Date coercion once (`longhaul-date-only.ts`, #619/#622). A string
  on the wire and in the column means no timezone math anywhere but one place.
- **The window has no date column of its own.** Its anchor is
  `estimated_date ?? planned_start`, resolved at read time. So an ETA date change carries
  the window with it — deliberate, and the popover shows the fully resolved
  "Fri 09/11 · 8:00–10:00 AM EDT" so it is never invisible.
- **UTC instants are derived on read, never stored.** DST rules change; `America/New_York`
  - `08:00` does not.
- **Validation is `end >= start` on the same day, and nothing else.** The last
  span-ordering guard added to this table broke 8 prod activities (#619 → #622). Do not
  add a guard relating the window to any date column.
- **All three or none — a window without a zone is unusable.** If the client omits
  `arrival_window_tz` and `resolveTimeZone` returns null (blank / unrecognized postal
  code), the write **400s** ("select a time zone") rather than storing times with a null
  zone. The popover makes the zone `<select>` required whenever
  `arrival_window_tz_suggested` comes back null.

## Step 0 — PRE-FLIGHT GATE (blocking, do this first)

`LongDistanceDispatchActivity` carries enabled triggers, including a DELETE trigger that
writes `LongDistanceDispatchActivityHistory`. Before any `ALTER TABLE`:

1. Read the trigger bodies against **prod** via the mssql-executor (recipe:
   `project_star_select_duplicate_column_arrays` memory / `mssql-executor-client`):
   ```
   SELECT OBJECT_NAME(parent_id) AS tbl, name, OBJECT_DEFINITION(object_id) AS body
   FROM sys.triggers WHERE parent_id = OBJECT_ID('LongDistanceDispatchActivity');
   ```
2. **If the DELETE trigger uses `INSERT INTO ...History SELECT * FROM deleted`** (no column
   list), adding columns to the parent table breaks every activity delete — and therefore
   every trip save that drops an activity. Two ways out, in order of preference:
   - add the same three columns to `LongDistanceDispatchActivityHistory` in the same
     ensure-SQL, in the same order; **or**
   - fall back to a Pegasus-owned sidecar table
     `pegasus_activity_arrival_window (activity_id int PK, ...)` in the same legacy DB,
     self-provisioned with `IF OBJECT_ID(...) IS NULL CREATE TABLE` and LEFT JOINed on
     read. Everything below is unchanged except the SQL shape.
3. Also confirm the legacy VB app INSERTs into this table with an explicit column list
   (an `INSERT ... VALUES` with no column list breaks on any added column).

**Do not proceed past this gate on assumption.** Record the finding in the plan.

## Schema

Three nullable columns, added idempotently. Follows
`apps/api/src/handlers/longhaul-cloud/driver-confirmed-availability-schema.ts` exactly.

```sql
IF COL_LENGTH('LongDistanceDispatchActivity','arrival_window_start') IS NULL
  ALTER TABLE LongDistanceDispatchActivity ADD arrival_window_start varchar(5) NULL;
IF COL_LENGTH('LongDistanceDispatchActivity','arrival_window_end') IS NULL
  ALTER TABLE LongDistanceDispatchActivity ADD arrival_window_end varchar(5) NULL;
IF COL_LENGTH('LongDistanceDispatchActivity','arrival_window_tz') IS NULL
  ALTER TABLE LongDistanceDispatchActivity ADD arrival_window_tz varchar(64) NULL;
```

- `arrival_window_start` / `_end` — local wall clock, `HH:mm`, 24h. Both-or-neither.
- `arrival_window_tz` — IANA id (`America/New_York`). Stamped server-side from the ZIP
  when the client omits it; the client sends it only when ops overrode the suggestion.

**GOTCHA (already cost this repo a bug once — `driver-planning.ts:145-151`):** SQL Server
resolves column references at _parse_ time, so the ensure-SQL must run in a **separate
`executeSql` call**, never concatenated into the same batch as a statement that names the
new columns. On a tenant whose table predates them that raises `Invalid column name`
before the ALTER ever commits.

## Files

### API — new

- `apps/api/src/lib/longhaul-arrival-window-schema.ts`
  `ENSURE_ARRIVAL_WINDOW_COLUMNS_SQL` + `ensureArrivalWindowColumns(connectionString)`,
  memoized per connection string in module scope (best-effort — the SQL is idempotent, so
  a cold Lambda container just re-runs it; correctness never depends on the memo).
- `apps/api/src/lib/longhaul-arrival-window.ts` — pure, no I/O:
  - `parseHhMm(v): string | null`
  - `validateArrivalWindow({start, end}): string | null` — returns an error message or
    null. Rules: both-or-neither, `HH:mm` shape, `end >= start`. Nothing else.
  - `resolveTimeZone({ zip, state })` → `{ timeZone, confidence, reason }` where
    confidence is `confident` (state is single-zone — auto-apply) / `likely` (state spans
    two zones — a human must confirm) / `unknown` (nothing usable — a human must pick)
  - `zoneOffsetMinutes(tz, utcDate)` — via `Intl.DateTimeFormat(..., { timeZone })`; no
    dependency, DST-correct.
  - `localWindowToUtc(dateOnly, 'HH:mm', tz): string` — the function that makes the data
    mean something to the SMS sender.
  - `enrichActivityArrivalWindow(activity)` — attaches `arrival_window_tz_suggested`,
    `arrival_window_start_utc`, `arrival_window_end_utc`, `arrival_window_date`, and
    `arrival_window_tz_label` (`EDT` vs `EST` depends on the anchor date, so the server
    derives it — the client must never compute a zone abbreviation).
- `apps/api/src/lib/longhaul-arrival-timezone-table.ts`
  `STATE_TO_ZONE` (50 + DC/PR) plus a `ZIP3_ZONE_EXCEPTIONS` map covering the split
  states: AK, AZ (Navajo), FL, ID, IN, KS, KY, MI, ND, NE, OR, SD, TN, TX (El Paso /
  Hudspeth). Hand-auditable and small; the ops override is the safety net for the rest.
  Returns null on a blank/unknown ZIP rather than guessing — which the write path turns
  into a 400, not a null zone.
  **Canada is in scope**: longhaul crosses the border (`v_longhaul_drivers.canada`), so
  `consignee_state` / `shipper_state` can be a province code and the postal code is
  `A1A 1A1` — which the ZIP3 path will never match. Map the provinces
  (`America/Toronto`, `Vancouver`, `Edmonton`, `Winnipeg`, `Regina`, `Halifax`,
  `St_Johns`) in `STATE_TO_ZONE` and include those zones in the override select. Without
  it every cross-border delivery falls into the 400 above.

### API — modified

- `apps/api/src/handlers/longhaul-cloud/activities-write.ts`
  - add the 3 fields to `PatchActivityBody` and `ACTIVITY_PATCH_COLUMNS`;
  - `validateArrivalWindow` → 400 on failure;
  - widen RT1 to `SELECT TripMaster_id, zip, state ...` so the tz can be stamped
    server-side when omitted;
  - call `ensureArrivalWindowColumns` **before** the UPDATE, as its own round trip, only
    when a window field is present in the patch.
- `apps/api/src/lib/longhaul-trip-save.ts` — add the 3 to `ACTIVITY_COLUMNS` so a full
  trip save round-trips them (an activity re-INSERT would otherwise drop the window).
- `apps/api/src/handlers/longhaul-cloud/trip-save.ts` — `ensureArrivalWindowColumns`
  before the atomic batch (separate call; never inside the batch), and **only when some
  DTO activity actually carries a window field** — same rule as activities-write, so a
  normal save doesn't pay a DDL-guard round trip.
- `apps/api/src/lib/longhaul-trip-fetch.ts` — `SELECT a.*` already returns the new columns
  once they exist, so no SQL change; map each activity through
  `enrichActivityArrivalWindow` after RT1. Must no-op cleanly when the columns are absent
  (tenant not yet provisioned ⇒ `undefined` ⇒ all derived fields null).

### tenant-web — modified

- `.../Trip/components/ActivityGantt/ActivityGantt.tsx`
  - new "Arrival Window" block in the popover, below Actual Date, shown for **every**
    activity (not gated on `isHasETA`), never in `readOnly` (already returns early);
  - two native `<input type="time">` — they yield `"HH:mm"` strings directly, no Date
    objects, no locale parsing. This is the whole reason not to reuse `DatePicker`;
  - "Add arrival window" prefills 08:00–10:00 into local popover state; nothing is
    persisted until `save`;
  - zone line: `America/New_York (auto from 07030)` + a "change" `<select>` of the US
    zones, writing `arrival_window_tz`;
  - a clear action sending both times + tz as `null`;
  - `saveActivity`'s `partialActivity` gains the 3 fields.
- `.../ActivityGantt.module.css` — styles for the new block.
- `.../driver-planning/utils/arrival-window.ts` (new) — display formatting only
  (`8:00–10:00 AM EDT`), consuming the server-derived fields. No timezone math client-side.
- Gantt bar `HoverToolTip` gains the window line when set.

## Tests

- `apps/api/src/lib/longhaul-arrival-window.test.ts` — DST spring-forward/fall-back
  boundaries, Arizona (no DST), split-state ZIPs (e.g. `32` FL Eastern vs `325` FL
  Central; `79` TX Central vs `798/799` Mountain), blank/short ZIP, `end == start`,
  `end < start` rejected, one-of-two rejected.
- `apps/api/src/handlers/longhaul-cloud/activities-write.test.ts` — ensure-SQL issued as
  its own `executeSql` call and only when a window field is present; tz stamped from the
  row's zip when omitted; client-sent tz wins; 400 shapes.
- `apps/api/src/handlers/longhaul-cloud/trip-detail.test.ts` — derived UTC fields on the
  read; clean no-op when the columns are absent.
- `.../ActivityGantt.test.tsx` — prefill is 08:00–10:00 and is NOT sent unless saved;
  clear sends nulls; block hidden in `readOnly`.
- `apps/e2e/tests/browser/longhaul/trip-detail.spec.ts` — enter a window, save, reload,
  read it back (the #441 lesson: assert the persisted read-back, not the optimistic UI).

## Risks / side effects

1. **DELETE trigger + history table** — Step 0. The one that can break trip saves.
2. **Per-tenant schema drift.** Reads must tolerate absent columns; only writes provision.
   QMM has no `v_longhaul_shipments_v2` at all, so assume nothing about tenant parity.
3. **`SELECT a.*` fan-out.** The 3 columns appear on every activity payload (trip detail,
   rejected-trip snapshots, shipments list, mobile). Additive and spread through
   `reshapeActivity` untouched — verified — but rejected-trip JSON snapshots will start
   carrying them, which is fine and desirable.
4. **No RBAC change.** This extends the existing `POST /onprem/longhaul/activities/:id`,
   which is auth-gated by `resolveLonghaulUser`. No new route, no new permission.
5. **A stale trip page can null out a fresh window.** A trip save posts the DTO the page
   loaded, so a window set in another session after that load is overwritten with null.
   This is exactly how `estimated_date` and `is_confirmed` already behave on this screen —
   consistent, not a new defect — but record it here so it isn't rediscovered as a bug.
6. **`longhaul-contracts` needs no change** — `LonghaulShipmentRow.activities` is
   `unknown[]` (verified), so there is no exact-key contract test to update, unlike
   `shipment-view.ts`'s own columns.
7. **OpenAPI coverage test does not apply** — it gates m2m **GET** routes on `m2mV1`; the
   `/onprem/longhaul/*` routes are on `v1`. No CI gate fires, which is exactly why the
   SDK follow-up below has to be tracked deliberately.

## Follow-ups (deliberately out of scope)

- **Automation (the actual point).** Emit `longhaul.activity.arrival_window.set` via
  `emitDomainEvent` so a workflow can drive the day-before SMS. Adding a name to
  `DOMAIN_EVENT_TYPES` is a public contract change; do it with the workflow that consumes
  it, not before. Note the emit is a Postgres write in an MSSQL handler — non-atomic by
  construction; the event carries ids only and the consumer refetches.
- **SDK / discovery surface** (CLAUDE.md rule): once automation reads windows, the SDK,
  MCP `pegasus://reference/*`, CLI `--help` and OpenAPI must expose them.
- **Tenant-configurable default** instead of the 08:00–10:00 constant.
- **Driver mobile app** — show the window on the shipment screen (`apps/mobile`).
- **Backfill** — none. Absent window means "not communicated"; that distinction is load-bearing.
