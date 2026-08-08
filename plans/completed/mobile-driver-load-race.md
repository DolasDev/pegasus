# Fix the "Couldn't load your driver" flash on mobile My Trips

**Branch:** `fix/mobile-driver-load-race`
**Goal:** The driver's first visit to My Trips after opening the app loads trips
directly — no bogus "Couldn't load your driver" error, and no "No driver linked"
onboarding copy flashing while a retry is in flight.

---

## Symptom (as reported)

1. Open the app → **My Trips** → "Couldn't load your driver".
2. Tap **Retry** → a message about the account not being linked to a driver.
3. A moment later the trips load fine.

## Root cause — two independent defects

### 1. The bearer token is bound _after_ the first request goes out

`apps/mobile/app/_layout.tsx:26-29` binds the API client's token inside a
`useEffect` keyed on `[session]`:

```ts
useEffect(() => {
  setTokenProvider(() => session?.token ?? null)
}, [session])
```

`TripsProvider` (`src/context/TripsContext.tsx:60-62`) fires `refresh()` from its
own mount effect. `TripsProvider` is a **descendant** of `RootLayoutNav` (root
layout → `Stack.Protected` → `(drawer)/_layout.tsx` → `TripsProvider`), and React
flushes effects child-before-parent within a commit.

So on the single commit where the session appears — cold-start restore _and_
fresh login — the order is:

1. `TripsProvider` mount effect → `TripsService.getDriverId()` → `GET /api/v1/me/driver`
   through the **stale** `() => null` provider ⇒ **no `Authorization` header** ⇒ 401.
2. _then_ `RootLayoutNav`'s `[session]` effect re-binds the real token.

`TripsContext` catches the throw, sets `error`, and `trips.tsx:66` renders
"Couldn't load your driver". Retry succeeds because by then the provider is
correct. This is deterministic on every cold start, not a flake.

### 2. Retry renders the "No driver linked" onboarding state while in flight

`trips.tsx:71` wires Retry to `handleRefresh`, which sets `isRefreshing = true`.
That makes the `loading && !isRefreshing` spinner branch (line 54) fall through.
`refresh()` clears `error` but leaves `driverId = null` and `mappingResolved = true`,
so line 79 matches and the screen shows **"No driver linked — Your account isn't
linked to a driver yet…"** for the duration of the request. That is the second
message the user saw. `isRefreshing` is only meaningful for pull-to-refresh, where
the list is already on screen.

---

## Plan

- [x] **1. Bind the token where the session is set, not in a layout effect.**
      In `src/context/AuthContext.tsx`, call `setTokenProvider(() => s?.token ?? null)`
      synchronously alongside every `setSession(...)` — cold-start restore, `login`,
      `loginWithSso`, `logout` — via a small local `applySession(s)` helper. Those run
      in async handlers _before_ the re-render that mounts the drawer, so no effect
      ordering is involved at all.
- [x] **2. Delete the now-redundant `[session]` effect** in `app/_layout.tsx`.
      Confirm nothing else depended on its ordering — in particular `registerForPush`,
      which currently relies on being declared after it (the fix strictly improves that).
- [x] **3. Retry takes the loading path.** In `app/(drawer)/trips.tsx`, have the
      error-state **Retry** and the no-driver **Refresh** buttons call `refresh()`
      directly (full-screen "Loading your trips…"), keeping `handleRefresh` /
      `isRefreshing` for pull-to-refresh only. Do not change `mappingResolved`
      semantics — the render-precedence fix is sufficient and safer.
- [x] **4. Tests.** - `src/context/AuthContext.test.tsx` — the token provider returns the session
      token immediately after restore and after `login`, with **no effect flush in
      between**. This is the regression test for defect 1. - `__tests__/app/(drawer)/trips.test.tsx` — `loading: true, error: null,
    driverId: null` renders the spinner, **not** "No driver linked". - `src/context/TripsContext.test.tsx` (new, small) — `refresh()` clears a prior
      error and a failed `getDriverId()` leaves `driverId` null with `error` set.
- [x] **5. Gates.** `npm run typecheck`, `npm run lint`, `npm test` (mobile at minimum).

## Files touched

| File                                                | Change                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `apps/mobile/src/context/AuthContext.tsx`           | bind token provider synchronously on every session transition |
| `apps/mobile/app/_layout.tsx`                       | drop the `[session]` `setTokenProvider` effect                |
| `apps/mobile/app/(drawer)/trips.tsx`                | Retry/Refresh use the full-screen loading path                |
| `apps/mobile/src/context/AuthContext.test.tsx`      | new assertions (regression for defect 1)                      |
| `apps/mobile/__tests__/app/(drawer)/trips.test.tsx` | new loading-state assertion                                   |
| `apps/mobile/src/context/TripsContext.test.tsx`     | **new** file                                                  |

## Explicitly out of scope

- No 401-retry / token-refresh logic in `@pegasus/api-http` — the root cause is a
  missing header, not an expired token, and a blanket retry would mask real 401s.
- No auto-retry loop in `TripsContext`.
- No change to the `/api/v1/me/driver` endpoint — the API side is fine.

## Risks / side effects

- `AuthContext` gains an import from `src/api/client`. No cycle: `client.ts` imports
  only `../config`.
- `_layout.test.tsx` may assert on the removed effect — check and update.
- Auth is a sensitive surface; the change only moves _when_ an already-correct token
  is published to the client, and `logout` still publishes `null`. Run
  `/security-review` at `/workstream-finish` since the diff touches auth.

## Outcome

Both defects fixed as planned; no deviations.

- `_layout.test.tsx` never referenced the removed effect — no update needed.
- Mobile has **no** `typecheck` or `lint` script, so Turbo skips it in CI; the gates
  that actually cover this diff are `jest` plus repo-wide `eslint`/`prettier`. Ran
  all three. (That mobile is outside `turbo run typecheck` is a pre-existing gap,
  left alone here.)
- The four new regression tests were verified to **fail against the pre-fix source**
  (source files reverted, tests re-run: 4 failed) and pass after — they are real
  guards, not tautologies. Full mobile suite: 185 passed / 22 suites.
- `AuthContext.test.tsx` mocks `../api/client` with a `requireActual` spread so
  `getApiClient` stays real for the `unregisterForPush` call inside `logout`.
