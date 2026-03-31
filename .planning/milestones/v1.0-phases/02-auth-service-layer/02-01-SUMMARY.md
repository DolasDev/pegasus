---
phase: 02-auth-service-layer
plan: 01
subsystem: auth
tags: [cognito, amazon-cognito-identity-js, jest, typescript, srp, react-native, mobile]

# Dependency graph
requires:
  - phase: 01-infrastructure-foundation
    provides: mobile-config endpoint returning Cognito poolId + clientId; amazon-cognito-identity-js installed and polyfilled
provides:
  - AuthError class (extends Error, readonly code field) at apps/mobile/src/auth/types.ts
  - Session type (sub, tenantId, role, email, expiresAt — no token field) at apps/mobile/src/auth/types.ts
  - MobileConfig type (userPoolId, clientId) at apps/mobile/src/auth/types.ts
  - signIn async function wrapping Cognito SRP callback API as a Promise
  - 4 passing tests covering AUTH-02 success and all failure paths
affects:
  - 02-02 (authService plan — imports AuthError, Session, MobileConfig from types.ts; calls signIn from cognitoService.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'var-hoisting pattern for jest.mock() factory references (avoids temporal dead zone)'
    - 'Promise wrapping of Cognito SRP callback API (onSuccess/onFailure/newPasswordRequired)'
    - 'AuthError as typed error with .code field matching Cognito error code strings'

key-files:
  created:
    - apps/mobile/src/auth/types.ts
    - apps/mobile/src/auth/cognitoService.ts
    - apps/mobile/src/auth/cognitoService.test.ts
  modified: []

key-decisions:
  - 'Session type has no token field — raw ID token is discarded after validate-token; enforced at type level'
  - 'newPasswordRequired Cognito challenge rejects with AuthError(NewPasswordRequired) — prevents silent hang'
  - 'logger.logAuth uses login (not signIn) — confirmed from logger.ts union type constraint'
  - 'var hoisting used in test file for mockAuthenticateUser — jest.mock() is hoisted before const/let declarations'

patterns-established:
  - 'AuthError: extends Error with readonly code field; this.name = code for stack trace display'
  - 'signIn takes (email, password, poolId, clientId) — Cognito config passed as args, not closed over, enabling runtime pool switching'
  - 'onFailure handler uses err.code ?? UnknownError fallback — never throws without a code'

requirements-completed: [AUTH-02]

# Metrics
duration: 8min
completed: 2026-03-27
---

# Phase 02 Plan 01: cognitoService SRP wrapper + auth type contracts

**Promise-wrapped Cognito SRP handshake (amazon-cognito-identity-js) with AuthError, Session, and MobileConfig type contracts establishing the typed foundation for the entire mobile auth layer**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-27T19:57:18Z
- **Completed:** 2026-03-27T20:05:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- AuthError class, Session type, and MobileConfig type created as the shared auth type contracts
- signIn function wraps the callback-based amazon-cognito-identity-js SRP handshake as a clean async Promise
- All 4 AUTH-02 test cases pass: success path, NotAuthorizedException, NewPasswordRequired challenge, missing error code fallback
- No token field on Session type — enforces at the type level that raw ID tokens are never persisted

## Task Commits

Each task was committed atomically:

1. **Task 1: types.ts — AuthError class, Session type, MobileConfig type** - `79730e6` (feat)
2. **Task 2: cognitoService.ts + cognitoService.test.ts — SRP wrapper and AUTH-02 tests** - `e33d263` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks — test file written first (RED confirmed), implementation added (GREEN confirmed), no refactor needed_

## Files Created/Modified

- `apps/mobile/src/auth/types.ts` — AuthError class, Session type (no token field), MobileConfig type
- `apps/mobile/src/auth/cognitoService.ts` — signIn async function wrapping Cognito SRP callback API
- `apps/mobile/src/auth/cognitoService.test.ts` — 4 Jest tests covering all AUTH-02 paths

## Decisions Made

- Session type has no token field — the raw Cognito ID token is only passed forward to validate-token; it is discarded once session claims are returned. This enforces at the type level that tokens are never inadvertently stored or exposed.
- newPasswordRequired Cognito challenge rejects with AuthError(NewPasswordRequired) — prevents a silent hang where the Promise would never resolve if a newly provisioned account requires a password reset.
- signIn accepts poolId and clientId as arguments rather than closing over config constants — this matches the runtime flow where Cognito config is fetched from the mobile-config endpoint after tenant selection, not baked in at module load.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- AuthError, Session, and MobileConfig types are ready for authService (plan 02-02) to import
- signIn is proven to wrap the SRP handshake correctly; authService will call it and pass the returned idToken to validate-token
- All 4 AUTH-02 test cases green; no blockers for 02-02

---

_Phase: 02-auth-service-layer_
_Completed: 2026-03-27_

## Self-Check: PASSED

- FOUND: apps/mobile/src/auth/types.ts
- FOUND: apps/mobile/src/auth/cognitoService.ts
- FOUND: apps/mobile/src/auth/cognitoService.test.ts
- FOUND: .planning/phases/02-auth-service-layer/02-01-SUMMARY.md
- FOUND commit: 79730e6 (feat: types.ts)
- FOUND commit: e33d263 (feat: cognitoService + tests)
