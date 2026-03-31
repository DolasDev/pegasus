---
phase: 07-fix-session-expiry-and-stale-tests
plan: 01
subsystem: auth
tags: [jwt, react-native, session, expiry, testing]

# Dependency graph
requires:
  - phase: 06-fix-mobile-token-validation
    provides: authService.ts with { idToken } body on validate-token calls
provides:
  - SESSION-04: correct expiresAt seconds-to-milliseconds conversion in AuthContext AppState listener
  - BREAK-03: real Cognito sessions (seconds-scale expiresAt) survive app resume without forced logout
  - MISSING-01: authService.test.ts asserts body.idToken matching Phase 06 production code
affects: [v1.0-milestone-completion, mobile-auth-tests]

# Tech tracking
tech-stack:
  added: []
  patterns: [JWT exp in seconds — always multiply by 1000 before comparing with Date.now()]

key-files:
  created: []
  modified:
    - apps/mobile/src/context/AuthContext.tsx
    - apps/mobile/src/context/AuthContext.test.tsx
    - apps/mobile/src/auth/authService.test.ts

key-decisions:
  - 'Option B for SESSION-04 fix: multiply expiresAt by 1000 at comparison site — no API change, no web package impact'
  - 'Expired test fixtures use Math.floor(Date.now() / 1000) - 1 to remain seconds-scale after the * 1000 multiplication'

patterns-established:
  - 'JWT exp comparison pattern: session.expiresAt * 1000 < Date.now() — always convert seconds to ms at comparison site'

requirements-completed: [SESSION-04]

# Metrics
duration: 2min
completed: 2026-03-31
---

# Phase 07 Plan 01: Fix Session Expiry and Stale Tests Summary

**Fixed JWT seconds/milliseconds unit mismatch in AuthContext (BREAK-03/SESSION-04) and updated stale body.token assertion to body.idToken in authService tests (MISSING-01)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-31T16:53:00Z
- **Completed:** 2026-03-31T16:55:14Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Fixed AuthContext.tsx:56 so real Cognito sessions (seconds-scale expiresAt ~1.7e9) no longer trigger immediate forced logout on every app resume
- Updated all 5 expiresAt fixtures in AuthContext.test.tsx to seconds-scale so SESSION-04 tests correctly exercise the fixed comparison code path
- Updated authService.test.ts:143-144 to assert `body.idToken` (matching Phase 06 production code) instead of stale `body.token`
- All 131 mobile tests pass, including all 3 SESSION-04 expiry detection tests and "passes idToken from signIn to validate-token body"

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix AuthContext.tsx:56 — multiply expiresAt by 1000 at comparison site** - `ea75f10` (fix)
2. **Task 2: Fix AuthContext.test.tsx — update all 5 expiresAt fixtures to seconds-scale** - `a49d4ac` (fix)
3. **Task 3: Fix authService.test.ts:143-144 — update stale body.token assertion to body.idToken** - `92cc2f4` (fix)

## Files Created/Modified

- `apps/mobile/src/context/AuthContext.tsx` - Line 56: `session.expiresAt < Date.now()` changed to `session.expiresAt * 1000 < Date.now()` with explanatory comment
- `apps/mobile/src/context/AuthContext.test.tsx` - All 5 expiresAt fixtures converted from millisecond-scale to seconds-scale (`Math.floor(Date.now() / 1000) + 3600` / `Math.floor(Date.now() / 1000) - 1`)
- `apps/mobile/src/auth/authService.test.ts` - Lines 143-144: type assertion `{ token: string }` and `body.token` updated to `{ idToken: string }` and `body.idToken`

## Decisions Made

- Option B selected for SESSION-04 fix (multiply at comparison site, not at API response): no API shape change required, no web package impact. The API and web already use seconds correctly.
- Expired fixtures must use seconds-scale (`Math.floor(Date.now() / 1000) - 1`) not the old millisecond-scale (`Date.now() - 1000`). With the new `* 1000` multiplication, a milliseconds-scale "expired" value would become a timestamp far in the future, making the test pass for the wrong reason.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The full `turbo run test` run showed one pre-existing API integration test failure in `packages/api` related to a Prisma `deleteMany` cleanup with `undefined` in an array. This failure is:
- Pre-existing (existed on the same commit hash before this plan's changes)
- Only triggered when a real database is available (integration tests)
- Entirely unrelated to the mobile files modified in this plan
- The `@pegasus/api` unit test suite (40 test suites, 632 tests) passes when no database is present

The mobile test suite is fully green: 14 suites, 131 tests, 0 failures.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SESSION-04 is satisfied: the last unsatisfied requirement blocking v1.0 milestone
- MISSING-01 resolved: authService.test.ts now matches Phase 06 production code
- BREAK-03 closed: real Cognito drivers will not be force-logged-out on every app resume
- v1.0 milestone gap closures complete: BREAK-03, MISSING-01, FLOW-BREAK-03 all resolved
- No blockers for v1.0 milestone completion

---

_Phase: 07-fix-session-expiry-and-stale-tests_
_Completed: 2026-03-31_
