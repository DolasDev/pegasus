---
phase: 04-tenant-resolution-flow
plan: 01
subsystem: auth
tags: [react-native, expo-router, authservice, tenant-resolution, tdd]

# Dependency graph
requires:
  - phase: 03-authcontext-and-session
    provides: authService factory pattern with injected dependencies; createAuthService used in _layout.tsx

provides:
  - TenantResolution type exported from apps/mobile/src/auth/types.ts
  - resolveTenants(email) method on authService - returns TenantResolution[] or [] on empty 200
  - selectTenant(email, tenantId) method on authService - throws AuthError(SelectTenantFailed) on non-2xx
  - TenantPickerScreen component at apps/mobile/app/(auth)/tenant-picker.tsx
  - authService exported as named export from apps/mobile/app/_layout.tsx
  - tenant-picker screen registered in auth Stack layout with system back button

affects: [04-02-login-two-step, future-auth-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Named export of authService from root _layout.tsx for direct import by child screens
    - FlatList-based tenant picker with disabled state during async operation
    - jest.mock('../_layout') pattern to mock authService in screen tests without pulling in polyfills

key-files:
  created:
    - apps/mobile/app/(auth)/tenant-picker.tsx
    - apps/mobile/app/(auth)/tenant-picker.test.tsx
  modified:
    - apps/mobile/src/auth/types.ts
    - apps/mobile/src/auth/authService.ts
    - apps/mobile/src/auth/authService.test.ts
    - apps/mobile/app/(auth)/_layout.tsx
    - apps/mobile/app/_layout.tsx

key-decisions:
  - 'Named export pattern for authService from _layout.tsx — simplest approach, avoids context, login.tsx and tenant-picker.tsx import directly'
  - 'resolveTenants returns [] on empty 200 (never throws for empty result) — driver UI treats empty as no-match, not error'
  - 'tenant-picker registered with headerShown:true — provides system back button for TENANT-06 native back navigation'

patterns-established:
  - 'Screen test pattern: jest.mock parent _layout to avoid polyfill imports, cast authService methods as jest.Mock'
  - 'Async screen interaction pattern: wrap fireEvent.press in act(async () => {...}) for state updates to settle'

requirements-completed: [TENANT-02, TENANT-03, TENANT-06]

# Metrics
duration: 2min
completed: 2026-03-27
---

# Phase 04 Plan 01: Tenant Resolution Building Blocks Summary

**TenantResolution type, resolveTenants/selectTenant authService methods, and TenantPickerScreen with FlatList navigation to login password step**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-27T23:57:54Z
- **Completed:** 2026-03-27T23:59:54Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `TenantResolution` type to `apps/mobile/src/auth/types.ts` with tenantId, tenantName, cognitoAuthEnabled fields
- Extended `createAuthService` factory with `resolveTenants` (returns [] on empty 200, throws AuthError on non-2xx) and `selectTenant` (throws AuthError(SelectTenantFailed) on non-2xx)
- Created `TenantPickerScreen` with FlatList of tenant names; tapping calls selectTenant then routes to login with password step params
- Registered tenant-picker screen in auth Stack with system back button enabled (TENANT-06)
- All 17 new tests passing; full auth suite (40 tests) green

## Task Commits

Each task was committed atomically:

1. **Task 1: TenantResolution type + authService methods** - `7e7e546` (feat)
2. **Task 2: TenantPickerScreen + auth layout registration** - `270036d` (feat)

_Note: TDD tasks executed with RED (failing tests) before GREEN (implementation) per workflow._

## Files Created/Modified

- `apps/mobile/src/auth/types.ts` - Added TenantResolution export type
- `apps/mobile/src/auth/authService.ts` - Added resolveTenants and selectTenant factory methods
- `apps/mobile/src/auth/authService.test.ts` - Added 6 new test cases (3 resolveTenants + 3 selectTenant)
- `apps/mobile/app/(auth)/tenant-picker.tsx` - New TenantPickerScreen with FlatList, selectTenant call, router.replace navigation
- `apps/mobile/app/(auth)/tenant-picker.test.tsx` - New test file with 6 test cases (render, tap, error handling)
- `apps/mobile/app/(auth)/_layout.tsx` - Added tenant-picker Stack.Screen with headerShown: true
- `apps/mobile/app/_layout.tsx` - Changed authService from const to export const

## Decisions Made

- Named export pattern for authService from root `_layout.tsx`: simplest approach per RESEARCH.md Pattern 5 — avoids a new context file, login.tsx and tenant-picker.tsx import directly from `../_layout`
- `resolveTenants` returns `[]` (does not throw) on 200 with empty array: aligns with D-04 decision — empty means no match, which the calling screen handles as a UI concern, not an error condition
- tenant-picker registered with `headerShown: true` in auth layout: provides OS-native back button so pressing it pops back to login email step (TENANT-06) without any explicit back handler code

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `TenantResolution` type and `resolveTenants`/`selectTenant` methods ready for plan 04-02 (login two-step flow)
- `TenantPickerScreen` registered at `/(auth)/tenant-picker` — login.tsx can navigate to it via `router.push`
- `authService` is now a named export from `apps/mobile/app/_layout.tsx` — login.tsx can import it directly

---

_Phase: 04-tenant-resolution-flow_
_Completed: 2026-03-27_
