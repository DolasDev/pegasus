# Unit 10 — `tripPlanning` slice — Testability notes

File under test: `apps/tenant-web/src/features/driver-planning/redux/pending-trips/index.ts`

## Things that made testing harder than it should be

### 1. Folder name does not match slice name

Store key is `tripPlanning` (see `redux/store.ts`), but the source lives in
`redux/pending-trips/`. There is also a separate `redux/trips/` slice. A new
contributor opening the codebase will look for `redux/trip-planning/` first.
Consider renaming the folder to match the slice name when the refactor lands.

### 2. Action creators with misleading names

`setSelectedTripIndex`, `createNewTrip`, `resetPage` are stubs aliased to
`editTrip`. Tests had to assert their (broken) current behavior so they can be
unblocked when the refactor introduces real implementations. See
`unit-10-redux-trip-planning-bugs.md` item #1.

The refactor should add real reducers for these and replace the aliases. Until
then, callers of these action creators are silently buggy.

### 3. No selectors exported

The slice exports only reducers/thunks. All consumers currently reach into the
store with `useSelector(s => s.tripPlanning.trip)` etc. Adding selectors
(`selectTrip`, `selectUnsavedTrip`, `selectShipmentToTrips`, `selectLoading`,
`selectError`) would let us write proper memoised selector tests and make
consumer refactors safer.

### 4. `any` everywhere in payloads

Every reducer takes `PayloadAction<any>`. Tests cannot leverage the type system
to drive coverage; we have to construct synthetic objects manually. Introducing
real types (`Shipment`, `Activity`, `Trip`) would let test fixtures double as
type-level documentation of the state shape.

### 5. Thunks tightly couple to module-level singletons

`saveTrip`, `initializeTripPage`, `cancelTrip` import `API` and `logger` directly
from sibling modules. Vitest's `vi.mock` works fine, but a refactor that injected
these via thunk extras (`createAsyncThunk` with `extra`) or a typed dependency
container would let us test thunks without module-level mocking magic.

### 6. `initializeTripPage` swallows all errors

```ts
catch (e: any) {
  e.message = `error initilazing ${e.message}`
  logger.error(e)
}
```

There is no way to observe failure from a test except by spying on `logger.error`.
After refactor, surface a `setError` action so the UI (and tests) can observe
the failure.

(Also note the typo "initilazing" — preserved verbatim because tests assert it.)

### 7. `setTrip` is doing two jobs

It both initialises a trip (resets `shipmentToTrips`) and edits one (assigns
`unsavedTrip`). Splitting into `initializeTrip` (full reset) and `loadTrip`
(merge from API) would make the contract clearer and the tests simpler.

### 8. State shape mismatch with task spec

Task spec describes state as `{ trip, unsavedTrip, shipmentToTrips,
selectedTripIndex, loading, error }`. The slice does declare those fields, but
no reducer mutates `selectedTripIndex` and there are no `setLoading` /
`setError` / `clearError` reducers in the spec list — only the implicit
`saveTripRequest`/`Success`/`Failure` triplet. The refactor should align the
two: either add missing reducers or drop the dangling fields.
