---
phase: 04-tenant-resolution-flow
plan: 02
subsystem: auth
tags: [react-native, expo-router, two-step-login, tenant-resolution, state-machine]

# Dependency graph
requires:
  - phase: 04-01
    provides: authService.resolveTenants, authService.selectTenant, tenant-picker screen, authService named export from _layout.tsx
provides:
  - Two-step LoginScreen (email step + password step) with full tenant resolution UX
  - Tests for TENANT-01 through TENANT-05 requirements in login.test.tsx
  - URL-param handoff from tenant-picker to login password step (D-08)
affects:
  - 04-03 (Cognito SRP auth — password step calls authContext.login with real tenantId)
  - 05-error-handling (inline error UX pattern established here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Two-step state machine in React Native screen using useState (step email/password)
    - URL param handoff pattern for cross-screen state (step=password + tenantId + tenantName + email)
    - Inline error text instead of Alert.alert for validation feedback (TENANT-04)

key-files:
  created: []
  modified:
    - apps/mobile/app/(auth)/login.tsx
    - apps/mobile/app/(auth)/login.test.tsx

key-decisions:
  - 'router.push (not replace) to tenant-picker — hardware back returns to email step for free (TENANT-06)'
  - 'tenant-picker uses router.replace back to login with step=password params (D-08) — avoids duplicate email step on back'
  - 'Inline error text for empty/unresolved email (not Alert.alert) — consistent with mobile UX pattern'
  - 'initialStep/initialEmail/initialTenantId/initialTenantName derived from URL params at mount — no useEffect needed'

patterns-established:
  - 'Two-step form state machine: type LoginStep = email | password, useState<LoginStep>'
  - 'Cross-screen param handoff via useLocalSearchParams with typed generic'
  - 'authService imported directly from ../_layout (named export) — no React context needed for services'

requirements-completed: [TENANT-01, TENANT-02, TENANT-04, TENANT-05, TENANT-06]

# Metrics
duration: 4min
completed: 2026-03-28
---

# Phase 04 Plan 02: Two-Step LoginScreen Summary

**Two-step email-first login UX with tenant resolution state machine: email step calls resolveTenants, auto-selects single tenant or navigates to picker, password step shows company name and calls AuthContext.login with tenantId**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T23:58:13Z
- **Completed:** 2026-03-28T00:01:48Z
- **Tasks:** 1 (TDD: red + green)
- **Files modified:** 2

## Accomplishments

- Rewrote LoginScreen from single-step to two-step state machine (`step: 'email' | 'password'`)
- Email step calls `authService.resolveTenants`, handles 0/1/many tenant results correctly
- Password step displays tenant company name above input, calls `authContext.login(email, password, tenantId)`
- Picker handoff via URL params (`step=password`) renders password step directly on mount (D-08)
- Replaced all 8 legacy tests with 13 new tests covering TENANT-01 through TENANT-05

## Task Commits

1. **Task 1 (prerequisite — 04-01 work committed):** `270036d` + `7e7e546` — authService methods, tenant-picker screen, auth layout registration
2. **Task 1: Rewrite login.tsx + login.test.tsx (TDD)** - `277ab4c` (feat)

## Files Created/Modified

- `apps/mobile/app/(auth)/login.tsx` - Full rewrite: two-step state machine, resolveTenants/selectTenant calls, URL param handoff
- `apps/mobile/app/(auth)/login.test.tsx` - Full rewrite: 13 tests covering all TENANT requirements

## Decisions Made

- `router.push` (not `replace`) to tenant-picker so hardware back returns to email step natively (TENANT-06)
- Inline error text for no-tenant case instead of `Alert.alert` (cleaner mobile UX, consistent with TENANT-04)
- State initialized from URL params at `useState()` call (not `useEffect`) — avoids flash of email step when step=password

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Executed prerequisite plan 04-01 content**

- **Found during:** Pre-execution check
- **Issue:** Plan 04-02 depends on 04-01 (resolveTenants, selectTenant, tenant-picker, authService export). 04-01 had been executed in a previous session but NOT committed.
- **Fix:** Committed the existing uncommitted 04-01 work (all files were already in working tree and tests were passing). No code was written — only committed.
- **Files committed:** authService.ts, types.ts, authService.test.ts, _layout.tsx, (auth)/_layout.tsx, tenant-picker.tsx, tenant-picker.test.tsx
- **Verification:** 17 authService + tenant-picker tests all green before proceeding to 04-02
- **Committed in:** `270036d`, `7e7e546` (04-01 prerequisite commits)

---

**Total deviations:** 1 auto-handled (Rule 3 blocking — prerequisite not committed)
**Impact on plan:** 04-01 work was already complete; only needed to be committed. Zero scope creep.

## Issues Encountered

None — once prerequisite was committed, TDD cycle executed cleanly. All 117 mobile tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TENANT-01 through TENANT-05 requirements fully implemented and tested
- TENANT-06 (back navigation) works via natural stack (`router.push` to picker → hardware back returns to email step)
- Phase 05 (error handling) can replace `Alert.alert` for wrong password with inline errors (AUTH-05)
- Phase 05 (Cognito SRP auth) can wire real `login()` implementation — the tenantId is now passed correctly

---

_Phase: 04-tenant-resolution-flow_
_Completed: 2026-03-28_
