# Unit 08 — redux/shipments: bugs / smells uncovered while writing tests

File under test: `apps/tenant-web/src/features/driver-planning/redux/shipments/index.ts`

These behaviors were locked in by tests as-is (no production code changed). They are
flagged here so the upcoming refactor can address them deliberately.

## 1. Reducers fire side-effects (network calls) directly — anti-pattern

`saveShipmentCoverage` and `patchShipmentShadow` are *reducers*, but their bodies call
`API.saveShipmentCoverage(...)` / `API.patchShipmentShadow(...)`. Redux Toolkit reducers
are required to be pure. Side-effects inside reducers cause:

- Time-travel debugging / replay produces real network traffic.
- Reducers cannot be unit-tested without mocking API.
- If the API call rejects, no error state is stored anywhere — failure is silent.
- Server returns nothing observable: no success confirmation, no rollback on failure.

**Suggested fix during refactor:** convert both to thunks, so the reducer only updates
state and the thunk calls the API and dispatches a failure action on rejection.

## 2. `saveShipmentCoverage` / `patchShipmentShadow` silently no-op when shipment row
   lacks the field

The reducers gate the in-place update on the existing shipment object having a
`packing_coverage` (or `pegasus_shadow`) key already:

```ts
if (state.shipmentList[shipmentIndexInList]?.packing_coverage) { ... }
```

If the shipment exists but the field is missing or falsy (e.g. `null`), the local state
is *not* updated, but the API call still fires. The UI then falls out of sync with the
server until the next `fetchShipments`. Likely should `??=` or initialize the field.

## 3. `saveShipmentCoverage` / `patchShipmentShadow` fire API even for unknown
   `order_num`

`findWithAttr` returns `-1` when not found. The reducer's `?.packing_coverage` check
correctly skips the array mutation (`state.shipmentList[-1]` is `undefined`), but the
API call below the `if` block still runs. Sending DTOs for shipments not in the
current list is almost certainly unintended.

## 4. `changeShipmentQuery` is a shallow merge — `filters` is replaced wholesale

Dispatching `changeShipmentQuery({ filters: { foo: 1 } })` replaces the entire
`filters` object instead of merging into it. Several call-sites in the codebase will
need to be audited to confirm they always spread the previous filters before
dispatching, or migrate to a deeper-merge helper.

## 5. `loadDefaultFilter` / `deleteShipmentFilter` swallow errors

Both thunks catch and `console.error` only. No `error` state is ever set. From the
user's perspective a failed load/delete looks like a successful no-op. Should at
minimum dispatch a failure action so the UI can surface it.

## 6. `loadDefaultFilter` parses `response.query` with `JSON.parse` — no schema check

If the server ever returns malformed JSON the thunk throws inside the try/catch and
silently no-ops (see #5). Consider zod-validating the parsed query.

## 7. `selectShipment` re-uses `fetchShipments` with `searchTerm: String(order_num)`

This is a fuzzy text search by order number rather than a direct
`fetchShipmentByOrderNum` lookup. If two shipments share the same order_num prefix
(e.g. searching `7` returns `7`, `70`, `71`, ...), `result[0]` may be the wrong row.
Refactor: add a dedicated single-shipment endpoint or filter by exact equality.

## 8. `error` field is typed `boolean | string` but only ever set to a string

The initial value is `false` and failure reducers always set a string. Recommend
narrowing to `string | null` and using `null` as the cleared state, so consumers can
do `if (error) {...}` safely without TS narrowing surprises.
