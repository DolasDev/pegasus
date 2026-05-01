# Unit 10 — `tripPlanning` slice — Bugs / Observations

File under test: `apps/tenant-web/src/features/driver-planning/redux/pending-trips/index.ts`
(Slice key in store: `tripPlanning`. Folder name `pending-trips` is misleading.)

## Bugs and suspicious behavior found while writing tests

### 1. `setSelectedTripIndex`, `createNewTrip`, `resetPage` are silent aliases of `editTrip`

```ts
export const setSelectedTripIndex = tripPlanningSlice.actions.editTrip
export const createNewTrip = tripPlanningSlice.actions.editTrip
export const resetPage = tripPlanningSlice.actions.editTrip
```

These three exported action creators do **not** behave the way their names imply.
Every consumer that dispatches `setSelectedTripIndex(idx)` is actually dispatching
`editTrip(idx)`, which **shallow-merges the payload into `state.trip`**. So calling
`setSelectedTripIndex(2)` will spread the number `2` over the trip object (which is
mostly a no-op because numbers have no enumerable own properties), and `state.selectedTripIndex`
remains `undefined`. The slice does not actually expose a way to set
`selectedTripIndex` at the top level.

Likewise `resetPage()` will call `editTrip(undefined)` — `{ ...trip, ...undefined }`
returns `trip` unchanged, so the page is **not** reset.

`createNewTrip(payload)` will merge `payload` into the existing trip rather than
replacing it with a fresh blank trip. Anything from a previous trip (driver,
shipments, status, id) leaks into the "new" trip.

This is the single largest bug surface in the slice — it almost certainly explains
"why does the trip not reset when I click new trip / cancel" type complaints.

### 2. `selectedTripIndex` is part of the state shape but no reducer ever sets it

The state interface declares `selectedTripIndex?: any`, and `addShipmentToTrip`,
`removeShipmentFromTrip`, `removeActivity`, `setTrip` all read it. But no reducer
in this slice writes it. It will always be `undefined` unless some other slice
writes here (it doesn't, by inspection of `redux/store.ts`).

Consequence: the `shipmentToTrips` map is keyed by the string `"undefined"` for
every shipment ever added, which collapses any per-trip-index dedup logic to a
single bucket.

### 3. `addShipmentToTrip` dedup uses `state.trip.name` as a value but `name` may be `null`

`initialState.trip.name === null`, so the first shipment added before a trip is
named writes `state.shipmentToTrips[orderNum]["undefined"] = null`. The truthiness
guard `if (!state.shipmentToTrips[shipment.order_num][state.selectedTripIndex])`
then treats this `null` as "not present", so the same shipment can be re-added
repeatedly until the trip is named.

### 4. `removeShipmentFromTrip` will throw if the shipment has no entry in `shipmentToTrips`

Guard exists for the outer key: `if (state.shipmentToTrips[shipment.order_num])`.
But `state.trip.shipments[shipmentIndexToRemove]` is read **before** any guard,
so passing an out-of-range index throws on `shipment.order_num`. Probably fine
in practice, but it's an unguarded indexed read.

### 5. `removeActivity` deletes from `shipmentToTrips` without a guard

When the last activity is removed (`activities.length === 1`), the reducer does

```ts
delete state.shipmentToTrips[shipment.order_num][state.selectedTripIndex]
```

without checking that `shipmentToTrips[shipment.order_num]` exists. If a shipment
was added through some path that did not populate the map (e.g., the bug in #3
collapses `shipment.order_num` differently across renames), this throws
`Cannot read properties of undefined`.

Also, it pushes to `extraActivities` without checking that the array exists on the
shipment. If any caller hands the slice a shipment without `extraActivities`
preinitialized to `[]`, this throws on `.push`.

### 6. `editTrip` overwrites `state.trip` if payload is not an object

`editTrip` does `state.trip = { ...selectedTrip, ...action.payload }`. If
`action.payload` is `null`/`undefined`/a primitive, it's a silent no-op (which is
how alias #1 fails silently). If `action.payload` carries a `shipments` field, it
**replaces the array wholesale** with no validation, so `shipmentToTrips` can drift
out of sync with `state.trip.shipments`.

### 7. `saveTripSuccess` requires `state.trip` to be an object

`state.trip.id = action.payload.id` will throw if `state.trip` was ever set to
`null`/`undefined`. There's no public API to do that today, but the field is
typed `any`.

### 8. `setTrip` blindly trusts `action.payload.shipments` to be iterable

```ts
action.payload.shipments.forEach(...)
```

If `setTrip` is dispatched with a payload that has no `shipments` field (e.g.,
the API returns a partial trip), this throws. The thunk `saveTrip` does
`setTrip({ ...savedTrip, ...trip })` so as long as either has shipments it's
fine, but it's an undocumented invariant.

### 9. `swapOrder` does not validate `from`/`to`

`up: true` with `from: 0` produces `to: -1`, and `splice(-1, 0, ...)` inserts
**before the last** element rather than failing. Similarly `up: false` with
`from === shipments.length - 1` produces an out-of-range index that splice tolerates
silently. So clicking "up" on the first shipment moves it to the second-from-last
slot — not what anyone expects from "up arrow on top item".

This is reproducible in the test suite (see the `swapOrder edge cases` describe
block).

### 10. State interface uses `any` everywhere

`trip`, `unsavedTrip`, `shipmentToTrips` values, `selectedTripIndex`, `error` are
all typed `any`. Whole categories of the bugs above would have been caught by
TypeScript with even modest typing. Recommend introducing typed entities (`Trip`,
`Shipment`, `Activity`) before refactor.
