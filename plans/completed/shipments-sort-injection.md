# Close the SQL injection in the shipments-list ORDER BY

## The hole

`apps/api/src/handlers/longhaul-cloud/shipments-list.ts` interpolates a
caller-controlled string straight into `ORDER BY`:

```ts
const col = query.sortBy.value
const dir = query.sortBy.order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
orderBy = `${S}.${col} ${dir}, ${S}.shipper_name ASC`
```

`query` is `JSON.parse(c.req.query('filters')) as ShipmentQuery` — the `as` is a
compile-time cast that erases at runtime, so `sortBy.value` is an arbitrary
attacker string. `dir` is safe (ternary); `col` is not. Live route:
`v1.get('/onprem/longhaul/shipments', longhaulShipmentsListHandler)`, executed
against the tenant's legacy MSSQL.

Its sibling `activities-list.ts` already carries the fix and says so in a comment:
_"an ORDER BY identifier cannot be parameterized, so the map is the only thing
standing between `sortBy` and SQL injection."_ One handler got it; this one did not.

## The fix

Mirror `activities-list.ts`: whitelist the sort key through a
`SORTABLE_COLUMNS` map, fall back to the existing default ordering on a miss.

Type the map's values as `LonghaulShipmentViewColumn` (from
`packages/longhaul-contracts/src/shipment-view.ts`) so a typo is a compile error
rather than a silently blank sort — the same guard `ShipmentsTable`'s `property`
annotation already gives the frontend.

### Whitelist contents — derived, not guessed

Union of every key the two UI surfaces actually emit:

- **Card view** (`containers/Shipments/index.tsx` `headers`): `shipper_state`,
  `consignee_state`, `total_est_wt`, `pack_date2`, `load_date2`, `del_date2`,
  `shaul`, `company`, `driver_name`
- **Table view** (`containers/ShipmentsTable/index.tsx` `tableConfig`):
  `shipper_name`, `shipper_city`, `shipper_state`, `consignee_city`,
  `consignee_state`, `total_est_wt`, `pack_date2`, `load_date2`, `del_date2`

All 12, plus the default `plan_load`, were verified present in the 91-column
`LONGHAUL_SHIPMENT_VIEW_COLUMNS` manifest. So the whitelist is complete: no sort
that works today starts falling back.

### Two incidental bugs the same change closes

1. The guard is `if (query.sortBy?.order)` — it keys off `order`, not `value`. A
   caller sending `order` with no `value` produces `${S}.undefined` and a SQL
   error. Gating on the whitelist lookup fixes that.
2. `query.sortBy.order.toUpperCase()` assumes `order` is a string; a JSON number
   or object throws. Reading it defensively removes the 500.

## Behavior choice

An unknown column falls back to the default ordering **silently**, matching
`activities-list.ts`. Rejecting with a 400 would be defensible but would diverge
from the sibling handler and could break a client sending a stale column name.
Noted here so the choice is deliberate.

## Also found while fixing it

A plain object literal inherits from `Object.prototype`, so a bare `MAP[value]`
lookup returns a **truthy function** for `constructor`, `toString`, `valueOf` and
`hasOwnProperty`. Those sail past an `if (col)` guard. The interpolated text is a
fixed function source rather than attacker content, so it is a 500 and a whitelist
bypass rather than arbitrary injection — but it is closed here with `Object.hasOwn`
plus a `typeof === 'string'` check, and covered by a test.

**The two sibling handlers share the bare-index pattern** and are worth the same
one-line hardening, deliberately left out of this PR to keep it to one concern:

- `activities-list.ts:255` — `SORTABLE_COLUMNS[query.sortBy.value]`
- `trips-list.ts:279` — `SORTABLE_COLUMNS[sortBy.value]`

Swept every other interpolated `ORDER BY` in `apps/api`: `shipment-filters.ts`
hardcodes `f.name ASC`, and `reference-data.ts:126` interpolates
`client.moveTypesWhere`, which is server-side tenant config and not caller input.
No other caller-controlled ORDER BY exists.

## Verification

- New tests in `shipments-list.test.ts`, mirroring the pair that already exists in
  `activities-list.test.ts`: a whitelisted column produces the expected ORDER BY,
  and `'s.id; DROP TABLE TripMaster--'` falls back to the default and never
  reaches the SQL.
- Tests written to fail against the current code first (TDD), then pass.
- `turbo typecheck lint test` green.
