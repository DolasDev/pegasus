---
phase: 05-login-ux-and-auth-guard
plan: 01
subsystem: auth
tags: [react-native, expo, cognito, auth-context, inline-errors, password-toggle]

# Dependency graph
requires:
  - phase: 04-tenant-resolution-flow
    provides: login.tsx with two-step flow and useAuth().login() call site
  - phase: 03-authcontext-and-session
    provides: AuthContext with login() Promise<boolean> interface

provides:
  - AuthContext.login() returning Promise<void> and throwing AuthError on failure
  - Password SHOW/HIDE toggle in login screen
  - Inline passwordError state replacing all Alert.alert calls
  - Input locking (editable={!isLoading}) and button disabling during auth
  - Error message mapping for NotAuthorizedException, LimitExceededException and others

affects: [05-02-auth-guard, any future auth screens using useAuth().login()]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - throw-on-failure pattern for async auth operations (Promise<void> + throw)
    - inline error state pattern replacing Alert.alert for form validation
    - password visibility toggle using showPassword state + secureTextEntry={!showPassword}

key-files:
  created: []
  modified:
    - apps/mobile/src/context/AuthContext.tsx
    - apps/mobile/src/context/AuthContext.test.tsx
    - apps/mobile/app/(auth)/login.tsx
    - apps/mobile/app/(auth)/login.test.tsx

key-decisions:
  - 'Promise<void> throw-on-failure: login() throws AuthError instead of returning false — enables try/catch inline error mapping at call site'
  - 'Inline errors over Alert.alert: passwordError state renders below password input — matches AUTH-05 UX requirement for polished driver experience'
  - 'SHOW/HIDE toggle not disabled during loading: toggle remains pressable during auth in-flight (not a security risk, improves UX)'

patterns-established:
  - 'Throw-on-failure: async auth functions return void and throw typed errors rather than returning boolean success flags'
  - 'Inline form errors: setPasswordError() state + conditional Text render replaces Alert.alert for all validation and auth failure paths'
  - 'Error code mapping: messages Record<string, string> with fallback via ?? operator for unknown codes'

requirements-completed: [AUTH-04, AUTH-05, AUTH-06]

# Metrics
duration: 2min
completed: 2026-03-28
---

# Phase 05 Plan 01: Login UX and AuthContext Hardening Summary

**AuthContext.login() changed from Promise<boolean> to Promise<void>/throw, with SHOW/HIDE password toggle and inline error messages replacing all Alert.alert calls**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-28T12:21:02Z
- **Completed:** 2026-03-28T12:23:36Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- AuthContext.login() interface and implementation updated to Promise<void>: throws AuthError on failure instead of returning false
- Password SHOW/HIDE toggle added to login screen with secureTextEntry toggle
- All Alert.alert calls removed; inline passwordError state renders below password input
- Input locking and button disabling during auth (AUTH-06) already existed; handleLogin rewritten with proper try/catch/finally
- 9 new tests added (AUTH-04, AUTH-05, AUTH-06); all 33 affected tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: AuthContext.login() Promise<void> throw-on-failure** - `6313b70` (feat)
2. **Task 2: login.tsx password toggle, inline errors, input locking** - `02f3420` (feat)

_Note: TDD tasks — tests updated first, then implementation._

## Files Created/Modified

- `apps/mobile/src/context/AuthContext.tsx` - login() returns Promise<void>, throws error in catch block
- `apps/mobile/src/context/AuthContext.test.tsx` - Tests updated: resolves.toBeUndefined(), rejects.toMatchObject(), AuthError import
- `apps/mobile/app/(auth)/login.tsx` - Added showPassword/passwordError state, SHOW/HIDE toggle, try/catch handleLogin, AuthError import, removed Alert
- `apps/mobile/app/(auth)/login.test.tsx` - 9 new tests for AUTH-04/05/06; updated existing tests for Promise<void>

## Decisions Made

- `Promise<void>` throw-on-failure chosen over returning `{ success, error }` — idiomatic TypeScript, enables natural try/catch at call site
- SHOW/HIDE toggle kept pressable during loading — toggle is local UI state, not an auth action; disabling it would be overly restrictive

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all implemented functionality is fully wired.

## Next Phase Readiness

- AuthContext.login() now throws AuthError on failure — plan 05-02 (auth guard) can rely on this interface
- All 33 tests pass; TypeScript clean
- Ready for plan 05-02: auth routing guard implementation

---

_Phase: 05-login-ux-and-auth-guard_
_Completed: 2026-03-28_

## Self-Check: PASSED

- FOUND: apps/mobile/src/context/AuthContext.tsx
- FOUND: apps/mobile/app/(auth)/login.tsx
- FOUND: .planning/phases/05-login-ux-and-auth-guard/05-01-SUMMARY.md
- FOUND: commit 6313b70 (Task 1)
- FOUND: commit 02f3420 (Task 2)
