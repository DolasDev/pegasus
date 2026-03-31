---
phase: 01-infrastructure-foundation
plan: 02
subsystem: auth
tags: [hono, zod, cognito, api, mobile, unit-tests, vitest]

# Dependency graph
requires:
  - phase: 01-infrastructure-foundation
    provides: existing authHandler in packages/api/src/handlers/auth.ts with resolve-tenants, select-tenant, validate-token routes
provides:
  - GET /api/auth/mobile-config endpoint returning Cognito user pool ID and mobile client ID
  - Unit tests for all four mobile-config response paths (validation, tenant lookup, env vars, success)
affects: [02-mobile-auth-service, phase-2-auth-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'GET route with query validator using validator("query", ...) + Zod safeParse pattern on authHandler'
    - 'Environment variable check before DB lookup (env vars checked first, 500 returned before tenant lookup)'
    - 'vi.stubEnv/vi.unstubAllEnvs in beforeEach/afterEach for env-dependent unit tests'
    - 'mockTenantFindUnique separate from mockTenantFindFirst — each Prisma method gets its own mock'

key-files:
  created: []
  modified:
    - packages/api/src/handlers/auth.ts
    - packages/api/src/handlers/auth.test.ts

key-decisions:
  - 'Env vars checked before DB lookup — avoids unnecessary DB round-trip when misconfigured, returns 500 before 400'
  - 'No try/catch on db.tenant.findUnique — consistent with plan spec, errors propagate to app.onError'
  - 'Single shared mobile Cognito client ID (not per-tenant) — COGNITO_MOBILE_CLIENT_ID is a single Lambda env var'

patterns-established:
  - 'GET route with query param validation: validator("query") + Zod safeParse, c.req.valid("query") to access validated data'
  - 'Public auth route pattern: registered on authHandler, no middleware, reads env vars then validates tenant exists'

requirements-completed: [API-01]

# Metrics
duration: 4min
completed: 2026-03-27
---

# Phase 1 Plan 2: Mobile Config Endpoint Summary

**GET /api/auth/mobile-config added to authHandler — validates tenant via db.tenant.findUnique and returns Cognito pool ID and mobile client ID from Lambda env vars, with four unit tests covering all response paths**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T18:04:23Z
- **Completed:** 2026-03-27T18:08:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added GET /api/auth/mobile-config route to existing authHandler with Zod query validation
- Route reads COGNITO_USER_POOL_ID and COGNITO_MOBILE_CLIENT_ID from Lambda env, checks env before DB call
- Uses db.tenant.findUnique (not findFirst) per plan spec, returns 400 TENANT_NOT_FOUND for unknown tenants
- Extended auth.test.ts mock to include mockTenantFindUnique with vi.stubEnv/vi.unstubAllEnvs patterns
- All 623 tests pass (40 test files) — zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add GET /api/auth/mobile-config route to authHandler** - `061418c` (feat)
2. **Task 2: Add GET /mobile-config unit tests to auth.test.ts** - `11e2237` (test)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `packages/api/src/handlers/auth.ts` - Added MobileConfigQuery Zod schema and GET /mobile-config route (56 lines)
- `packages/api/src/handlers/auth.test.ts` - Added mockTenantFindUnique, afterEach import, and 4-test describe block (62 lines net)

## Decisions Made

- Env vars checked before DB lookup — returns 500 early if misconfigured rather than doing a DB round-trip that will succeed but can't produce a response
- No try/catch around db.tenant.findUnique — consistent with plan spec; unexpected DB errors propagate to Hono's app.onError which logs at ERROR level
- Single COGNITO_MOBILE_CLIENT_ID env var — mobile app shares one Cognito app client across all tenants (pool-level config, not per-tenant)

## Deviations from Plan

None — plan executed exactly as written.

The only minor addition was importing `afterEach` from vitest (plan code used it but didn't mention adding the import — added automatically as it was required for correctness).

## Issues Encountered

None. Pre-existing TypeScript errors in unrelated files (packages/api/src/handlers/pegii/, sso.test.ts) were out of scope and not touched.

## User Setup Required

None — no external service configuration required beyond the already-planned COGNITO_USER_POOL_ID and COGNITO_MOBILE_CLIENT_ID Lambda env vars (provisioned by Phase 1 Plan 01 CDK work).

## Next Phase Readiness

- API-01 complete: GET /api/auth/mobile-config is ready for consumption by the mobile auth service
- Phase 2 mobile auth service can now fetch Cognito credentials at runtime after tenant resolution
- No blockers introduced

---

_Phase: 01-infrastructure-foundation_
_Completed: 2026-03-27_
