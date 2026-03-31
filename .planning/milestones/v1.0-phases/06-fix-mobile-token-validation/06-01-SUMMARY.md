---
phase: 06-fix-mobile-token-validation
plan: 01
subsystem: auth
tags: [cognito, jwt, jose, mobile, react-native, typescript]

# Dependency graph
requires:
  - phase: 05-login-ux-and-auth-guard
    provides: authService with authenticate(), AuthContext with login() throw pattern
provides:
  - BREAK-01 fix: validate-token request body sends { idToken } not { token: idToken }
  - BREAK-02 fix: validate-token audience array accepts both tenant and mobile Cognito client IDs
  - COGNITO_MOBILE_CLIENT_ID env guard on validate-token handler
  - Session type includes ssoProvider field matching actual API response
affects: [06-fix-mobile-token-validation-plan-02, testing, mobile-auth-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Audience array pattern for jose jwtVerify supporting multiple Cognito app clients
    - Env guard pattern: read env var, check falsy before use (D-02 risk mitigation)

key-files:
  created: []
  modified:
    - apps/mobile/src/auth/authService.ts
    - packages/api/src/handlers/auth.ts
    - apps/mobile/src/auth/types.ts
    - apps/mobile/src/auth/authService.test.ts
    - apps/mobile/src/context/AuthContext.test.tsx

key-decisions:
  - 'audience array [tenantClientId, mobileClientId] in jwtVerify: jose v5 accepts token if aud matches any element in array'
  - 'COGNITO_MOBILE_CLIENT_ID added to env guard on validate-token — empty string guard before jwtVerify call (D-02)'
  - 'ssoProvider: string | null on Session type — aligns type with actual API response already returning this field'

patterns-established:
  - 'jose audience array: pass string[] to accept tokens from multiple Cognito app clients in same handler'
  - 'Env guard ordering: read all required env vars first, then check all in one if-block before any use'

requirements-completed: [AUTH-03]

# Metrics
duration: 3min
completed: 2026-03-31
---

# Phase 6 Plan 1: Source Code Fixes Summary

**Three targeted auth fixes: validate-token request body field name (BREAK-01), jose audience array for mobile Cognito client (BREAK-02), and Session type extended with ssoProvider field**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-31T14:17:17Z
- **Completed:** 2026-03-31T14:20:31Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- BREAK-01 committed: `authService.ts` now sends `{ idToken }` instead of `{ token: idToken }` to validate-token, matching the Zod schema requirement
- BREAK-02 fixed: validate-token handler passes `audience: [tenantClientId, mobileClientId]` to jwtVerify so mobile Cognito ID tokens are accepted
- COGNITO_MOBILE_CLIENT_ID added to env guard — misconfigured Lambda returns 500 with clear error before reaching jwtVerify
- Session type extended with `ssoProvider: string | null` to match actual API response shape; five test mockSession objects updated to compile

## Task Commits

Each task was committed atomically:

1. **Task 1: Stage and commit BREAK-01 working-tree fix** - `23d79a0` (fix)
2. **Task 2: Add mobileClientId env guard and audience array** - `b66c3e8` (fix)
3. **Task 3: Add ssoProvider to Session type and fix downstream mocks** - `8205cc5` (fix)

## Files Created/Modified

- `apps/mobile/src/auth/authService.ts` - Fixed validate-token request body: `{ idToken }` not `{ token: idToken }` (BREAK-01)
- `packages/api/src/handlers/auth.ts` - Added mobileClientId env guard + audience array `[tenantClientId, mobileClientId]` (BREAK-02)
- `apps/mobile/src/auth/types.ts` - Added `ssoProvider: string | null` to Session type (D-05)
- `apps/mobile/src/auth/authService.test.ts` - Added `ssoProvider: null` to mockSession
- `apps/mobile/src/context/AuthContext.test.tsx` - Added `ssoProvider: null` to five Session literal objects

## Decisions Made

- jose v5 `JWTVerifyOptions.audience` accepts `string | string[]` — passing an array means any token whose `aud` matches either element is accepted; web tokens match tenantClientId, mobile tokens match mobileClientId
- Env guard checks `!mobileClientId` before the array is constructed — empty string from `?? ''` fallback never reaches jwtVerify (D-02)
- `ssoProvider` is `string | null` (not optional `?`) — matches the API's explicit `null` return for non-SSO tenants rather than field absence

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Additional Session mock objects in AuthContext.test.tsx required ssoProvider**

- **Found during:** Task 3 (Add ssoProvider to Session type and fix downstream mocks)
- **Issue:** Plan identified two test mockSession objects to update (lines 20-26 in both test files) but TypeScript revealed four additional inline Session literals in AuthContext.test.tsx (lines 147, 189, 214, 235 — the checkSession and AppState expiry tests) also missing the new field
- **Fix:** Added `ssoProvider: null` to all four additional inline Session objects
- **Files modified:** apps/mobile/src/context/AuthContext.test.tsx
- **Verification:** `tsc --noEmit -p apps/mobile/tsconfig.json` exits 0
- **Committed in:** `8205cc5` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug: incomplete scope in plan)
**Impact on plan:** Necessary for TypeScript compilation. Plan listed only the first two mockSession objects; the type change rippled to four more inline objects in the same test file. No scope creep.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All source fixes committed and TypeScript-clean
- Plan 2 (tests) can now be written against stable types: Session includes ssoProvider, validate-token accepts mobile audience
- The validate-token endpoint will correctly accept mobile Cognito ID tokens once COGNITO_MOBILE_CLIENT_ID is set in the Lambda environment

---

_Phase: 06-fix-mobile-token-validation_
_Completed: 2026-03-31_
