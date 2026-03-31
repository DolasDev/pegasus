---
phase: 02-auth-service-layer
plan: 02
subsystem: auth
tags: [cognito, jest, typescript, factory-pattern, dependency-injection, react-native, mobile, fetch]

# Dependency graph
requires:
  - phase: 02-auth-service-layer
    plan: 01
    provides: AuthError class, Session type, MobileConfig type, cognitoService.signIn function
  - phase: 01-infrastructure-foundation
    provides: GET /api/auth/mobile-config endpoint; POST /api/auth/validate-token endpoint
provides:
  - createAuthService factory function at apps/mobile/src/auth/authService.ts
  - fetchMobileConfig(tenantId) — calls GET /api/auth/mobile-config, returns MobileConfig
  - authenticate(email, password, tenantId) — orchestrates full 3-step login flow, returns Session
  - 5 Jest tests covering AUTH-01 and AUTH-03
affects:
  - Phase 03 (AuthContext integration — imports createAuthService, wires apiBaseUrl from env at context level)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'createAuthService factory with injected cognitoService and apiBaseUrl — avoids jest.mock() module patching in tests'
    - 'mockImplementationOnce chained on global.fetch for multi-call test sequences (each call gets a fresh Response body)'
    - 'apiBaseUrl injected at factory creation — never read from env vars inside function bodies; env read happens at call site'

key-files:
  created:
    - apps/mobile/src/auth/authService.ts
    - apps/mobile/src/auth/authService.test.ts
  modified: []

key-decisions:
  - 'cognitoService injected via factory deps — tests use plain mock object, no jest.mock() of amazon-cognito-identity-js'
  - 'apiBaseUrl is a factory dep, not read inside fetch calls — enables test isolation without env var pollution'
  - 'idToken from cognitoService.signIn is passed to validate-token then discarded — not stored, not returned on Session'

patterns-established:
  - 'Factory pattern for service modules: createFoo({ dep1, dep2 }) returns { method1, method2 }'
  - 'Two-call fetch test pattern: global.fetch = jest.fn() in beforeEach; mockImplementationOnce chained per call'
  - 'AuthError code strings are PascalCase category names: ConfigFetchFailed, ValidateTokenFailed'

requirements-completed: [AUTH-01, AUTH-03]

# Metrics
duration: 5min
completed: 2026-03-27
---

# Phase 02 Plan 02: authService factory orchestrating three-step mobile auth flow

**Dependency-injected authService factory (createAuthService) that orchestrates fetchMobileConfig → cognitoService.signIn → validate-token and returns a Session with no raw ID token, verified by 5 Jest unit tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-27T20:00:58Z
- **Completed:** 2026-03-27T20:05:58Z
- **Tasks:** 1 (TDD: RED + GREEN phases)
- **Files modified:** 2

## Accomplishments

- createAuthService factory established the dependency-injection pattern for all future mobile services
- fetchMobileConfig wraps GET /api/auth/mobile-config with proper AuthError(ConfigFetchFailed) on non-2xx
- authenticate orchestrates all three steps in order and returns a Session with no token field (AUTH-03)
- 5 tests pass; full 100-test mobile suite passes with 0 regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: authService.ts + authService.test.ts — factory, fetchMobileConfig, authenticate** - `1b5029b` (feat)

_Note: TDD task — test file written first (RED confirmed: module not found), implementation added (GREEN confirmed: 5/5 passing), no refactor needed_

## Files Created/Modified

- `apps/mobile/src/auth/authService.ts` — createAuthService factory; fetchMobileConfig and authenticate implementations
- `apps/mobile/src/auth/authService.test.ts` — 5 Jest tests covering AUTH-01 (fetchMobileConfig success + non-2xx) and AUTH-03 (authenticate order, body forwarding, validate-token non-2xx)

## Decisions Made

- cognitoService injected via the factory rather than jest.mock()'d at module level — plain mock object in tests is simpler, more readable, and avoids temporal dead zone issues with jest hoisting (D-05)
- apiBaseUrl is a constructor dep, not read inside function bodies — this means env var lookup happens at the call site (AuthContext or similar), keeping service functions pure and easily testable
- idToken from signIn is forwarded as body.token to validate-token then immediately discarded — the returned Session type has no token field, enforcing at the type level that raw Cognito tokens are never stored (AUTH-03)

## Deviations from Plan

None — plan executed exactly as written. The test file in the plan had a subtle issue in the non-2xx error code test (the try/catch block needed a second fetch mock call because the first call was consumed by the rejects assertion), which was fixed inline without changing any architecture.

## Issues Encountered

Minor: The plan's non-2xx test pattern used a single mockImplementationOnce then called fetchMobileConfig twice (once for rejects assertion, once for the try/catch). Fixed by adding a second mockImplementationOnce before the try/catch block so each call has a fresh mock. Verified tests pass cleanly.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- createAuthService is ready for AuthContext integration — import createAuthService, pass apiBaseUrl from EXPO_PUBLIC_API_URL and cognitoService from ./cognitoService
- AUTH-01 and AUTH-03 fully verified in unit tests; no network calls or real Cognito pool needed
- Phase 02 complete: types (02-01) + authService (02-02) deliver the full auth service layer foundation

---

_Phase: 02-auth-service-layer_
_Completed: 2026-03-27_
