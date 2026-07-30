# Filter dispatchers + planners on `active = 'Y'`

## Goal

The Operations module (tenant-web Driver Planning) populates its Planner/Dispatcher
dropdowns from `v_longhaul_salesman`. Inactive staff currently appear as selectable
options. Restrict both reads to `active = 'Y'`.

Confirmed by the user: the `active` column exists on `v_longhaul_salesman` for both
`nwi` and `qmm` tenants.

## Background

`v_longhaul_salesman` is read at **four** call sites across two logical lists:

| List        | Standalone endpoint                  | Batched bootstrap                         |
| ----------- | ------------------------------------ | ----------------------------------------- |
| Dispatchers | `dispatchers.ts:59`                  | `reference-data.ts:86` (recordsets[5])    |
| Planners    | `planners.ts:25-28` (`PLANNERS_SQL`) | `reference-data.ts:71-73` (recordsets[4]) |

The standalone endpoints serve refresh actions; the batch serves the Operations
bootstrap (AppGuard). **Both paths must apply the filter or the dropdown contents
change depending on how the screen was loaded** — the exact drift hazard that
`driver-filter.ts` was created to prevent for `v_longhaul_drivers`.

## Approach

Mirror the established `driver-filter.ts` pattern: one shared exported predicate,
consumed by every call site, so the four can't drift.

New file `apps/api/src/handlers/longhaul-cloud/salesman-filter.ts`:

```ts
/** SQL boolean predicate (no leading WHERE) restricting v_longhaul_salesman to
 *  active staff. Pass a prefix when the query qualifies the view. */
export function longhaulSalesmanActiveFilter(prefix = ''): string {
  const p = prefix ? `${prefix}.` : ''
  return `${p}active = 'Y'`
}
```

Casing note: `v_longhaul_salesman` columns are lowercase in this repo
(`first_name`, `roles`, `win_username`), unlike `v_longhaul_drivers` which is
uppercase (`ACTIVE`). MSSQL identifiers are case-insensitive under the default
collation, so this is cosmetic — but match the view's own convention.

### Operator-precedence guard (important)

`dispatcherQuery` is a per-tenant fragment from `longhaul-client-config.ts`:

- `nwi`: `(managed_by_id = 2021 OR roles like '%LO%')`
- `qmm`: `roles like ('%cpd%')`

NWI's fragment contains an `OR`. It is parenthesized today, so a naive
`active = 'Y' AND ${dispatcherQuery}` is _currently_ correct — but it is one
config edit away from becoming `active='Y' AND managed_by_id=2021 OR roles like
'%LO%'`, where `AND` binds tighter and inactive dispatchers silently return via
the `OR` branch. **Always wrap the fragment**: `... AND (${dispatcherQuery})`.

## Tasks

1. **Add `salesman-filter.ts`** with `longhaulSalesmanActiveFilter(prefix?)`, plus
   a unit test covering the no-prefix and prefixed forms.

2. **Update the four call sites** to compose the predicate:
   - `dispatchers.ts:59` →
     `SELECT * FROM v_longhaul_salesman WHERE ${longhaulSalesmanActiveFilter()} AND (${dispatcherQuery})`
   - `reference-data.ts:86` → same composition against `client.dispatcherQuery`
   - `planners.ts:25-28` → AND the predicate into `PLANNERS_SQL`, using the
     `[v_longhaul_salesman]` prefix the query already qualifies with
   - `reference-data.ts:71-73` → same as planners

3. **Update the existing SQL-assertion tests.** `dispatchers.test.ts:58-61,71-74`,
   `planners.test.ts`, and `reference-data.test.ts` assert exact SQL strings and
   will fail until updated — write the new expected strings first (TDD), then make
   them pass. Confirm the reference-data recordset **index map is unchanged**
   (statement count and order must not move — noted as "the main footgun" in that
   file's header).

4. **Run the gates**: `npm run typecheck`, `npm test` (apps/api integration tests
   need local Docker Postgres), `npm run lint`.

## Out of scope

- No frontend change. `TripDetail.tsx` renders whatever the API returns; filtering
  server-side is sufficient and keeps the two transports consistent.
- No change to `longhaul-client-config.ts` fragments themselves — the active
  predicate is client-independent and belongs outside the per-tenant config.
- Drivers (`driver-filter.ts`) already filter on `ACTIVE = 'Y'`; untouched.

## Risk / rollback

Low blast radius: two read-only endpoints plus their batched equivalents, no
writes, no schema change. Rollback is a revert.

**Accepted risk (user-confirmed):** applying the filter to _planners_ narrows a
list derived from `TripMaster.created_by_id` — i.e. the authors of historical
trips. A planner who has since been deactivated will drop out of that dropdown even
though past trips reference them. The user was shown this trade-off and chose to
include planners. If historical trip attribution renders blank anywhere as a
result, reverting task 2's planners half restores it independently of dispatchers.

## Verification

- Unit tests assert the exact composed SQL for both `nwi` and `qmm`.
- `reference-data.test.ts` continues to assert the recordset index map.
- Post-deploy: open Operations, confirm the Planner/Dispatcher dropdowns no longer
  offer known-inactive staff, and that a hard refresh (batch path) and an in-app
  refresh (standalone path) show the _same_ list.
