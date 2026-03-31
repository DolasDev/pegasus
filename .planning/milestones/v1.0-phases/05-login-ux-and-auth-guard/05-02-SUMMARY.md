---
phase: 05-login-ux-and-auth-guard
plan: 02
subsystem: auth
tags: [react-native, expo, expo-router, splash-screen, auth-guard, jest]

# Dependency graph
requires:
  - phase: 05-01
    provides: AuthContext.login() Promise<void>/throw interface used in _layout.tsx via useAuth()
  - phase: 03-authcontext-and-session
    provides: AuthContext with isAuthenticated and isLoading state consumed by _layout.tsx

provides:
  - Stack.Protected guard={isAuthenticated} replacing useEffect redirect guard in _layout.tsx
  - SplashScreen.preventAutoHideAsync() at module level preventing OS splash from hiding before auth resolves
  - SplashScreen.hideAsync() triggered by useEffect when isLoading flips false
  - _layout.test.tsx with 5 unit tests covering GUARD-01 splash/guard behavior
  - Extended expo-router jest mock with callable Stack function, Stack.Protected, and SplashScreen stubs

affects: [any future tests that render components importing from expo-router Stack]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Stack.Protected declarative auth guard replacing useEffect + router.replace redirect
    - SplashScreen.preventAutoHideAsync at module scope (not inside component) for correct cold-start behavior
    - Jest mock for namespace components: Stack as callable function with .Screen/.Protected sub-properties

key-files:
  created:
    - apps/mobile/app/_layout.test.tsx
  modified:
    - apps/mobile/app/_layout.tsx
    - apps/mobile/jest.setup.js

key-decisions:
  - 'Stack mock as callable function: jest.fn() with .Screen/.Protected properties attached — plain object mock breaks JSX rendering since React.createElement requires a function/class for composite components'
  - 'guard prop assertion via mock.calls[0]?.[0] instead of toHaveBeenCalledWith second arg: React 19 calls function components as Component(props, undefined) — expect.anything() does not match undefined'

patterns-established:
  - 'Namespace component mocking: const MockFn = jest.fn(render); MockFn.SubComponent = jest.fn(...) — required when component is both a JSX element and a namespace'

requirements-completed: [GUARD-01]

# Metrics
duration: 4min
completed: 2026-03-28
---

# Phase 05 Plan 02: Auth Guard with Stack.Protected and SplashScreen Summary

**_layout.tsx rewritten to use Stack.Protected + SplashScreen eliminating login flash on cold start, with 5 unit tests covering GUARD-01**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-28T12:25:40Z
- **Completed:** 2026-03-28T12:29:05Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Removed useEffect redirect guard, ActivityIndicator spinner, useRouter, useSegments, and StyleSheet from _layout.tsx
- SplashScreen.preventAutoHideAsync() called at module level; hideAsync() on useEffect when isLoading=false
- Stack.Protected with guard={isAuthenticated} wraps (tabs) and order screens declaratively
- Extended jest.setup.js expo-router mock to support Stack as callable function with .Screen/.Protected and SplashScreen stubs
- 5 new tests in _layout.test.tsx; all 131 mobile tests pass; TypeScript clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend jest.setup.js mock and rewrite _layout.tsx** - `130ed40` (feat)
2. **Task 2: Create _layout.test.tsx for GUARD-01** - `13d95bb` (feat)

_Note: Task 2 is a TDD task — implementation was done in Task 1, tests written in Task 2 (GREEN phase only since implementation preceded test file creation)._

## Files Created/Modified

- `apps/mobile/app/_layout.tsx` - Rewritten: SplashScreen guard + Stack.Protected, removed useEffect redirect
- `apps/mobile/app/_layout.test.tsx` - New: 5 tests for GUARD-01 (SplashScreen + Stack.Protected behavior)
- `apps/mobile/jest.setup.js` - Updated: Stack mock as callable function, Stack.Protected and SplashScreen stubs added

## Decisions Made

- Stack mock must be a callable `jest.fn()` with `.Screen` and `.Protected` attached — using a plain object `{ Screen: ..., Protected: ... }` breaks `<Stack>` JSX because React requires a function/class for composite components
- Guard prop assertions use `mock.calls[0]?.[0]` pattern instead of `toHaveBeenCalledWith(..., expect.anything())` — React 19 passes `undefined` as second arg to function components, and `expect.anything()` does not match `undefined`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stack mock required to be a callable function, not a plain object**

- **Found during:** Task 2 (creating _layout.test.tsx)
- **Issue:** jest.setup.js mock had `Stack: { Screen: ..., Protected: ... }` (plain object). Using `<Stack>` in JSX calls `React.createElement(Stack, ...)` which requires a function/class, not an object — throws "Element type is invalid: expected a string or class/function but got: object"
- **Fix:** Changed Stack mock to `const StackMock = jest.fn(({ children }) => React.createElement(React.Fragment, null, children)); StackMock.Screen = ...; StackMock.Protected = ...`
- **Files modified:** apps/mobile/jest.setup.js
- **Verification:** All 131 tests pass
- **Committed in:** `13d95bb` (Task 2 commit)

**2. [Rule 1 - Bug] React 19 component call passes undefined as second arg, breaking expect.anything() matcher**

- **Found during:** Task 2 (Stack.Protected guard prop tests)
- **Issue:** `toHaveBeenCalledWith(expect.objectContaining({ guard: false }), expect.anything())` failed because React 19 calls `Component(props, undefined)` and `expect.anything()` rejects undefined
- **Fix:** Changed assertions to `expect(Stack.Protected).toHaveBeenCalled()` + `mock.calls[0]?.[0]` prop inspection
- **Files modified:** apps/mobile/app/_layout.test.tsx
- **Verification:** Guard prop tests pass with correct guard values
- **Committed in:** `13d95bb` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bugs in mock/test pattern)
**Impact on plan:** Both fixes were required for the tests to work. No scope creep — only fixed the mock infrastructure needed by the plan's test file.

## Issues Encountered

- The plan's template for `toHaveBeenCalledWith(..., expect.anything())` does not work in React 19 because React calls function components with `(props, undefined)` — the second argument is always undefined. Adjusted to inspect `mock.calls` directly.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all implemented functionality is fully wired.

## Next Phase Readiness

- Phase 05 is complete: all 4 requirements (AUTH-04, AUTH-05, AUTH-06, GUARD-01) implemented and tested
- _layout.tsx has no useEffect redirect — Stack.Protected handles all routing declaratively
- Full mobile test suite green (131 tests); TypeScript clean
- Milestone v1.0 auth guard implementation complete

---

_Phase: 05-login-ux-and-auth-guard_
_Completed: 2026-03-28_

## Self-Check: PASSED

- FOUND: apps/mobile/app/_layout.tsx
- FOUND: apps/mobile/app/_layout.test.tsx
- FOUND: apps/mobile/jest.setup.js
- FOUND: .planning/phases/05-login-ux-and-auth-guard/05-02-SUMMARY.md
- FOUND: commit 130ed40 (Task 1)
- FOUND: commit 13d95bb (Task 2)
