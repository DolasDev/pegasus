# Cross-Tenant Data Isolation Integration Tests

**Branch:** `feature/on-prem-server`
**Goal:** Integration tests proving `createTenantDb` prevents cross-tenant data access across all 12 scoped models.

## Context

`createTenantDb` Prisma extension auto-scopes 12 models. Tenant middleware is unit-tested, but no integration test proves Tenant A cannot read/update/delete Tenant B's data. A regression here is a critical business and legal risk.

## Implementation Checklist

### 1. Isolation test suite

- [x] Write test: `packages/api/src/lib/__tests__/prisma-tenant-isolation.test.ts`
  - Skip-guarded: `describe.skipIf(!process.env['DATABASE_URL'])`
  - Create records for Tenant A and Tenant B
  - `findMany` with Tenant A's client returns only Tenant A's data
  - `update` with Tenant A's client cannot touch Tenant B's records
  - `delete` with Tenant A's client cannot touch Tenant B's records
  - Cover all 12 models: Customer, Move, Quote, Invoice, CrewMember, Vehicle, Availability, InventoryRoom, LeadSource, Account, RateTable, TenantSsoProvider

### 2. Schema-sync assertion

- [x] Add test case: parse Prisma schema, extract models with `tenantId` field, assert they match `TENANT_SCOPED_MODELS` set
  - Catches forgotten models when new tables are added
  - Accounts for intentionally unscoped tenantId models: TenantUser, AuthSession, ApiClient

### 3. Verify

- [x] `npm test` — all pass (619 tests pass; isolation tests skip without DB)
- [x] With DATABASE_URL set, isolation tests pass
- [x] `npm run typecheck` — no new type errors (pre-existing errors in unrelated files)

## Files

| Action | Path |
|--------|------|
| Export | `packages/api/src/lib/prisma.ts` — added `export` to `TENANT_SCOPED_MODELS` |
| Create | `packages/api/src/lib/__tests__/prisma-tenant-isolation.test.ts` |

## Risks / Side Effects

- Test-only change — no production code modified beyond exporting `TENANT_SCOPED_MODELS`
- Requires Docker Postgres to run (skip-guarded otherwise)

## Dependencies

None — can start immediately.
