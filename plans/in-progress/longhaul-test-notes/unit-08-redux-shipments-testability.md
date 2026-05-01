# Unit 08 — redux/shipments: testability notes

File under test: `apps/tenant-web/src/features/driver-planning/redux/shipments/index.ts`

The slice was tested at 100% coverage with no production changes by mocking
`../../utils/api` at module scope and using `configureStore` with the shipments reducer.

## What worked well

- `vi.mock('../../utils/api', () => ({ API: { ... } }))` cleanly intercepts every API
  method called from both the reducers and the thunks.
- Each thunk only depends on `dispatch` (the second `state` param of `loadDefaultFilter`
  is unused), so a minimal store with only the shipments reducer is sufficient.

## Friction points (no code changes made)

1. **Side-effects inside reducers** — see bug note #1. Forces the reducer tests to mock
   the API too, even though they would otherwise be pure-state assertions. After the
   refactor moves the API calls into thunks, the reducer tests can drop the mock entirely.

2. **Default `query` uses `Date()` directly at module load** — the date offsets bake
   "today ± 30 days" into the initial state at import time. To test specific values we
   would need `vi.useFakeTimers()` set *before* the slice module is imported. Currently
   the tests work around this by only asserting on `Array.isArray` / length 2, not on
   actual date values. A pure helper (`buildDefaultQuery(now)`) would be easier to test
   deterministically.

3. **`AppDispatch` type from `../store`** — when tests dispatch a thunk, TS does not
   recognize the slice's `AppDispatch` from the per-test mini-store, so each
   `store.dispatch(thunk(...) as any)` is annotated. Not a bug per se, just a
   typing-ergonomics note. If the slice's thunks were migrated to `createAsyncThunk`,
   the dispatch return-type would be inferred correctly.

4. **`selectShipment` is exported but not in the docs list** — the task brief lists
   four thunks; `selectShipment`, `loadDefaultFilter`, and `deleteShipmentFilter` are
   also exported and shipped. Tests cover all of them. Worth confirming during refactor
   which are still in use.

## No refactor required to reach the coverage target

Achieved 100% statements / 100% branches / 100% functions / 100% lines on
`shipments/index.ts` without any production change.
