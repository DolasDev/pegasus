# unit-09 redux-trips — Testability notes

File under test: `apps/tenant-web/src/features/driver-planning/redux/trips/index.ts`.

## Scope mismatch with the unit brief

The unit-09 brief asks for tests of `saveTrip`, `cancelTrip`, and
`changeTripStatus` thunks in the `trips` slice. **None of those thunks
live in this slice.** They live in
`apps/tenant-web/src/features/driver-planning/redux/pending-trips/index.ts`
(see `saveTrip`, `cancelTrip`, `changeTripStatus` exports there). The
`trips` slice owns:

- Reducers: `selectTrip`, `fetchTripsStart`, `fetchTripsSuccess`,
  `fetchTripsFailure`, `changeTripsQuery`, `editTrip`.
- Thunks: `fetchTrips(query)`, `updateActivityForTrip(activityId, activity)`.

Tests in this unit cover only what the slice actually exposes
(`trips.test.ts` next to the slice). Reducer + thunk coverage is 100%
of statements, branches, functions, lines on the file.

The cross-slice thunks (`saveTrip` / `cancelTrip` / `changeTripStatus`)
should be tested under a separate `pending-trips` redux unit, not here.
Tests for those would belong in
`apps/tenant-web/src/features/driver-planning/redux/pending-trips/`.

## Design observations (no production change made)

The following are observations about the current code that constrain
testability, but **none required a refactor to land tests**:

1. `selectedTrip`, `tripList`, `query` and `error` are typed as `any`
   / `any[]`. Stronger types would let test assertions catch shape
   regressions automatically. Not blocking.
2. `editTrip` spreads onto `state.selectedTrip`, which may be `null`.
   The reducer currently produces `{ ...null, ...payload }` which JS
   evaluates to `{ ...payload }`. Tests document this behaviour rather
   than assert a guard, since adding a guard would be a production
   change.
3. `fetchTrips` swallows errors via `console.error` and dispatches
   `fetchTripsFailure(e.message)`. `e.message` is `undefined` if a
   non-Error is thrown, but every realistic call site rejects with an
   `Error`, so this isn't worth a test today.
4. `updateActivityForTrip` swallows errors silently — there's no
   loading flag, no error flag, no success action. The thunk is
   effectively fire-and-forget. This is testable but limits what we
   can assert; tests verify only that the API was called and the
   promise resolves.
5. The slice imports `API` from `../../utils/api`, which transitively
   imports a real `transport` layer that calls `fetch`. We mock the
   whole `../../utils/api` module at the top of the test to avoid
   that. This works fine — no production refactor needed.

No production code was changed for this unit.
