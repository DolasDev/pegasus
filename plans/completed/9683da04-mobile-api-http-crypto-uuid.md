# Fix mobile data layer: api-http crypto.randomUUID throws in React Native

## Root cause (verified)

`@pegasus/api-http` `buildHeaders` sets `x-correlation-id` via `crypto.randomUUID()` on
**every** request. React Native (Hermes) has no global `crypto.randomUUID` (the app lists
`react-native-get-random-values` but never imports it, and nothing polyfills `randomUUID`),
so the call **throws before `globalThis.fetch` runs** → the request never leaves the phone.

Evidence: login works (auth uses raw `fetch`, not this client); web apps work (browsers have
`crypto.randomUUID`); **zero** `/api/v1/me/driver` (or any api-http) requests reach prod from
the device; prod data is correct (driver 17698 linked to steve@dolas.dev on the Nelson
Westerberg row, `cognito_sub` matches the prod pool). `trips.tsx:64` renders "No driver linked"
for any `driverId == null`, masking the thrown error. Breaks the ENTIRE mobile data layer
(trips, orders, push-token registration) — all go through this client.

## Scope

### 1. `packages/api-http/src/index.ts` (the actual fix)

- Replace `crypto.randomUUID()` with a small guarded helper:
  ```
  function randomCorrelationId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
    // Correlation ids are not security-sensitive → Math.random fallback is fine.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
  ```
  Use it in `buildHeaders`. Browsers keep using native `crypto.randomUUID` (unchanged);
  RN uses the fallback. Applies to both `fetch` and `fetchPaginated` header builders.

### 2. `apps/mobile/app/(drawer)/trips.tsx` (un-mask the error)

- Add an error branch BEFORE the "No driver linked" branch: when `error` is set and not
  loading, show an error state with a Retry button. Keep "No driver linked" only for the
  genuine resolved-but-unmapped case (`mappingResolved && driverId == null && !error`).

### 3. Tests

- `packages/api-http`: test that a request still succeeds and sends a valid
  `x-correlation-id` when `globalThis.crypto.randomUUID` is absent (delete/stub it), and
  that it uses the native one when present. (Match the package's existing test runner.)
- `apps/mobile`: extend the trips screen test so a `getDriverId` rejection shows the error
  state, not "No driver linked".

## Out of scope / follow-up

- Consider importing `react-native-get-random-values` at the entry if other libs need
  `crypto.getRandomValues` (the api-http fix removes the `randomUUID` dependency, so not
  required for this bug).
- The masking pattern may exist on other mobile screens — audit separately.

## Verify

- api-http unit tests green; mobile jest green.
- After merge: rebuild mobile (version code 10) via `mobile-release.yml` (env=prod), resubmit
  to Closed testing, and confirm a live `GET /api/v1/me/driver` **200** appears in the prod
  Lambda logs (`pegasus-prod-api-ApiLogGroup…`) when steve opens My Trips → trips load for
  driver 17698.
