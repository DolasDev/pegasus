# Admin Handler Unit Tests

**Branch:** `feature/admin-handler-tests`
**Goal:** Unit tests for the 3 untested admin handlers: tenants, audit, cognito.

## Context

`tenants.ts`, `audit.ts`, `cognito.ts` admin handlers have zero tests. `tenant-users.test.ts` (311 lines) provides the pattern to follow using `vi.hoisted` mocks.

## Implementation Checklist

### 1. Tenants handler tests

- [x] Write test: `packages/api/src/handlers/admin/tenants.test.ts`
  - CRUD operations (create, read, update, list)
  - Suspend / reactivate / offboard flows
  - Validation errors (missing required fields, invalid input)
  - Not-found responses
  - Authorization checks

### 2. Audit handler tests

- [x] Write test: `packages/api/src/handlers/admin/audit.test.ts`
  - Audit log writing (success path)
  - before/after field handling including Prisma.JsonNull for nulls
  - Optional ipAddress/userAgent included/omitted correctly
  - Error propagation from tx.auditLog.create

### 3. Cognito handler tests

- [x] Write test: `packages/api/src/handlers/admin/cognito.test.ts`
  - Provision user (success + already exists / UsernameExistsException)
  - Disable user (success + not found / UserNotFoundException fail-open)
  - Non-matching exceptions are rethrown
  - getCognito singleton behaviour

### 4. Verify

- [x] `npm test` — new tests all pass (pre-existing openapi/env failures unaffected)
- [x] `npm run typecheck` — no new type errors introduced by new test files

## Files

| Action | Path |
|--------|------|
| Create | `packages/api/src/handlers/admin/tenants.test.ts` |
| Create | `packages/api/src/handlers/admin/audit.test.ts` |
| Create | `packages/api/src/handlers/admin/cognito.test.ts` |

## Pattern Reference

Follow `packages/api/src/handlers/admin/tenant-users.test.ts`:
- `vi.hoisted` for mock setup
- `vi.mock` for repository/service modules
- Test app created with `new Hono()` mounting the handler
- Assert status codes and response bodies

## Risks / Side Effects

- Test-only change — no production code modified

## Dependencies

None — can start immediately.
