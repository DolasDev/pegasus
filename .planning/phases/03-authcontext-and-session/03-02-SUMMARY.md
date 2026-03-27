---
phase: 03-authcontext-and-session
plan: 02
subsystem: auth
tags: [react-native, expo, secure-store, appstate, session, context]

# Dependency graph
requires:
  - phase: 03-01
    provides: AuthProvider with authService prop, SecureStore-backed session, SESSION-01 and SESSION-03 tests
provides:
  - AppState expiry detection on foreground resume (SESSION-04)
  - Cold-start session restore tests (SESSION-02)
  - Real authService wired into _layout.tsx via createAuthService
  - settings.tsx shows session?.email and session?.role
  - login.tsx passes placeholder tenantId (3-arg login call)
affects: [04-tenant-resolution, mobile-auth]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AppState.addEventListener with session in dep array avoids stale closure on expiry check
    - authService created at module scope in _layout.tsx, passed as AuthProvider prop

key-files:
  created: []
  modified:
    - apps/mobile/src/context/AuthContext.tsx
    - apps/mobile/src/context/AuthContext.test.tsx
    - apps/mobile/app/_layout.tsx
    - apps/mobile/app/(tabs)/settings.tsx
    - apps/mobile/app/(auth)/login.tsx
    - apps/mobile/app/(auth)/login.test.tsx
    - apps/mobile/app/(tabs)/settings.test.tsx

key-decisions:
  - 'Session dep array in AppState useEffect: prevents stale closure where session=null at mount captures initial null and never detects expiry'
  - 'authService created at module scope in _layout.tsx — avoids recreating service on every render'
  - 'login.tsx removes client-side password length check — real Cognito auth handles credential validation'

patterns-established:
  - 'AppState.addEventListener with subscription.remove() cleanup in useEffect return'
  - 'Session dep array on AppState listener — always captures current session value'

requirements-completed: [SESSION-02, SESSION-04]

# Metrics
duration: 5min
completed: 2026-03-27
---

# Phase 03 Plan 02: AuthContext and Session Summary

**AppState-based session expiry detection (SESSION-04) and cold-start restore tests (SESSION-02), with real authService wired end-to-end in _layout.tsx**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-27T22:19:00Z
- **Completed:** 2026-03-27T22:22:37Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added AppState.addEventListener useEffect to AuthContext with session in dep array — calls logout() when app resumes with expired session
- Added SESSION-02 tests (cold-start restore) and SESSION-04 tests (AppState expiry detection) — all 11 AuthContext tests pass
- Wired real authService into _layout.tsx via createAuthService({ apiBaseUrl, cognitoService })
- Updated settings.tsx to show session?.email and session?.role instead of deprecated driverName/driverEmail
- Updated login.tsx to call login(email, password, '') with placeholder tenantId and removed demo hint text

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SESSION-02/04 tests and implement AppState expiry detection** - `469683c` (feat)
2. **Task 2: Wire _layout.tsx, update settings.tsx and login.tsx** - `ce86cff` (feat)

## Files Created/Modified

- `apps/mobile/src/context/AuthContext.tsx` - Added AppState import and expiry detection useEffect with session dep array
- `apps/mobile/src/context/AuthContext.test.tsx` - Added SESSION-02 and SESSION-04 describe blocks (11 tests total)
- `apps/mobile/app/_layout.tsx` - Import createAuthService + cognitoService, create authService at module scope, pass to AuthProvider
- `apps/mobile/app/(tabs)/settings.tsx` - Replace driverName/driverEmail with session?.email and session?.role
- `apps/mobile/app/(auth)/login.tsx` - 3-arg login call with placeholder tenantId, removed password length check and demo hint
- `apps/mobile/app/(auth)/login.test.tsx` - Updated to match new 3-arg login interface, removed hint text and password length tests
- `apps/mobile/app/(tabs)/settings.test.tsx` - Updated mock to use session object instead of driverName/driverEmail

## Decisions Made

- AppState useEffect dep array contains `session` (not `[]`) — prevents stale closure bug where handler captures `session = null` at mount and never detects expiry on foreground resume
- authService created at module scope in _layout.tsx — avoids recreating the service instance on every render cycle
- Removed client-side password length validation from login.tsx — real Cognito auth validates credentials; the 4-char check was a demo artifact

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing login.test.tsx and settings.test.tsx to match new interfaces**

- **Found during:** Task 2 (Wire _layout.tsx, update settings.tsx and login.tsx)
- **Issue:** login.test.tsx tested 2-arg login call and password length check; settings.test.tsx used driverName/driverEmail mock — both reflected old interface now replaced
- **Fix:** Updated login.test.tsx to expect 3-arg login call and removed obsolete tests; updated settings.test.tsx mock to use session object with email/role
- **Files modified:** apps/mobile/app/(auth)/login.test.tsx, apps/mobile/app/(tabs)/settings.test.tsx
- **Verification:** All 100 tests pass
- **Committed in:** ce86cff (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Required fix — tests reflected old interface and would have caused failures. No scope creep.

## Issues Encountered

None — implementation proceeded exactly as specified in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Full Phase 3 session lifecycle is complete: SESSION-01 (secure store persistence), SESSION-02 (cold-start restore), SESSION-03 (logout), SESSION-04 (AppState expiry detection)
- Real authService is wired end-to-end from _layout.tsx through AuthProvider to login
- Ready for Phase 4: tenant resolution to supply real tenantId to login call (placeholder '' removed)
- login.tsx has TODO Phase 4 comment marking the tenantId injection point

---

_Phase: 03-authcontext-and-session_
_Completed: 2026-03-27_
