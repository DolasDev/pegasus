# Plan: Admin-web cleanup — fix bypassed shared client + delete duplicate tests

**Branch:** TBD (create from main)
**Goal:** Fix `tenant-users.ts` to use `adminFetch` instead of raw `fetch`, and delete the duplicate client test file.

## Problem

1. `apps/admin-web/src/api/tenant-users.ts:31` uses raw `fetch()` with hand-rolled headers instead of `adminFetch`. This bypasses the shared `@pegasus/api-http` client, duplicating correlation-id and token injection logic.
2. `apps/admin-web/src/api/client.test.ts` and `apps/admin-web/src/__tests__/client.test.ts` both test the same `adminFetch`/`adminFetchPaginated` functions. Both run in CI.

## Checklist

### Step 1 — Fix tenant-users.ts (TDD)

- [ ] Write test in `apps/admin-web/src/__tests__/tenant-users.test.ts`:
  - Mock `adminFetch` (not global `fetch`)
  - Verify `listTenantUsers(tenantId)` calls `adminFetch` with correct path
  - Verify `inviteTenantUser(tenantId, input)` calls `adminFetch` with POST + body
  - Verify `updateTenantUserRole(tenantId, userId, role)` calls `adminFetch` with PATCH
  - Verify `deactivateTenantUser`/`reactivateTenantUser` call `adminFetch` with correct methods
- [ ] Rewrite `apps/admin-web/src/api/tenant-users.ts` to use `adminFetch` and `adminFetchPaginated` instead of raw `fetch`
- [ ] Tests pass

### Step 2 — Delete duplicate test file

- [ ] Delete `apps/admin-web/src/api/client.test.ts` (keep `apps/admin-web/src/__tests__/client.test.ts` as the canonical location since all other tests are in `__tests__/`)
- [ ] Verify remaining test still passes

### Step 3 — Verify

- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/admin-web`
- [ ] `node node_modules/.bin/turbo run typecheck --filter=@pegasus/admin-web`

## Files modified

- `apps/admin-web/src/api/tenant-users.ts` (rewrite to use adminFetch)
- `apps/admin-web/src/__tests__/tenant-users.test.ts` (new)
- `apps/admin-web/src/api/client.test.ts` (delete)

## Risks

- Low risk. The `adminFetch` client is already proven by admin-web's other API modules (`tenants.ts`).
