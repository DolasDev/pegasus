---
phase: 06-fix-mobile-token-validation
plan: 02
subsystem: testing
tags: [vitest, jose, jwt, cognito, auth, unit-tests]

# Dependency graph
requires:
  - phase: 06-fix-mobile-token-validation/06-01
    provides: validate-token handler with audience array + ssoProvider on Session type

provides:
  - Full unit test coverage for POST /api/auth/validate-token (9 test cases)
  - jose mock via vi.hoisted + vi.mock pattern preserving real errors export

affects:
  - Any future changes to validate-token handler behavior

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vi.hoisted + vi.mock('jose') factory for intercepting jwtVerify before module resolution
    - errors.JWTExpired constructed with four args (message, payload, claim, reason) — jose v5 signature

key-files:
  created: []
  modified:
    - packages/api/src/handlers/auth.test.ts

key-decisions:
  - 'jose mock uses ...actual spread to preserve real errors export — allows instanceof errors.JWTExpired checks in test case 4'
  - 'errors.JWTExpired constructed via new errors.JWTExpired(msg, {}, exp, check_failed) — four-arg constructor works in jose v5'
  - 'mockJwtVerify declared via vi.hoisted() — guarantees reference exists before authHandler module resolves'

patterns-established:
  - 'Async module mock with importOriginal: vi.mock(module, async (importOriginal) => { const actual = await importOriginal<typeof import(module)>(); return { ...actual, override } })'

requirements-completed: [AUTH-03]

# Metrics
duration: 2min
completed: 2026-03-31
---

# Phase 06 Plan 02: validate-token unit test suite (9 cases) Summary

**9-case Vitest unit suite for POST /api/auth/validate-token covering all happy paths and error branches via jose mock using vi.hoisted + vi.mock pattern**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-31T14:22:56Z
- **Completed:** 2026-03-31T14:24:13Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added jose mock (vi.hoisted + vi.mock factory) to auth.test.ts — intercepts jwtVerify and createRemoteJWKSet before authHandler import resolves; preserves real errors export for instanceof checks
- Appended `describe('POST /api/auth/validate-token')` block with 9 test cases covering: tenant client token (full session shape), mobile token with ssoProvider, audience mismatch 401, JWTExpired 401, wrong token_use 401, missing sub/email 401, missing custom claims 403, missing env vars 500, invalid JWT 401
- All 32 tests pass (23 pre-existing + 9 new) with no DATABASE_URL required

## Task Commits

Each task was committed atomically:

1. **Task 1: Add jose mock** - `58f56a8` (chore)
2. **Task 2: Append validate-token describe block** - `5f6f43d` (test)

## Files Created/Modified

- `packages/api/src/handlers/auth.test.ts` - Added jose mock block + 9-case validate-token describe block (188 new lines)

## Decisions Made

- Used `errors.JWTExpired('token expired', {}, 'exp', 'check_failed')` four-arg constructor — jose v5 extends JWTClaimValidationFailed which requires all four args; this compiled cleanly without needing the Object.setPrototypeOf fallback
- Kept the jose mock's `...actual` spread so real `errors` class hierarchy is preserved — allows test case 4 to construct a genuine JWTExpired instance that passes instanceof check in the handler

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 06 is now complete: validate-token handler fixed (Plan 01) + full test coverage added (Plan 02)
- AUTH-03 requirement fully validated: handler accepts both tenant-client and mobile-client audience tokens, returns ssoProvider in session claims
- No blockers for milestone completion

---

_Phase: 06-fix-mobile-token-validation_
_Completed: 2026-03-31_
