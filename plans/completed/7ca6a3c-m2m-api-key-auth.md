# M2M API Key Authentication — External Vendor Integrations

**Branch:** main
**Goal:** Add API key authentication for external vendors — `api_clients` table, key generation, auth middleware, and admin CRUD endpoints.

---

## Checklist

### Task 1 — Foundation

- [ ] Add `ApiClient` model to `schema.prisma`; add relations to `Tenant` and `TenantUser`
- [ ] Create migration `20260305120000_add_api_clients/migration.sql`
- [ ] Write `packages/api/src/repositories/__tests__/api-client.repository.test.ts`
- [ ] Implement `packages/api/src/repositories/api-client.repository.ts`
- [ ] Export from `packages/api/src/repositories/index.ts`

### Task 2 — Middleware + Scope Utility

- [ ] Write `packages/api/src/__tests__/scopes.test.ts`
- [ ] Implement `packages/api/src/lib/scopes.ts`
- [ ] Write `packages/api/src/__tests__/api-client-auth.test.ts`
- [ ] Implement `packages/api/src/middleware/api-client-auth.ts`
- [ ] Add `ApiClientVariables` / `ApiClientEnv` to `packages/api/src/types.ts`

### Task 3 — Admin CRUD Handler

- [ ] Write `packages/api/src/handlers/api-clients.test.ts`
- [ ] Add `userId?: string` to `AppVariables` in `packages/api/src/types.ts`
- [ ] Update `packages/api/src/middleware/tenant.ts` to extract sub and set `userId`
- [ ] Update `packages/api/src/__tests__/tenant-middleware.test.ts` for new userId mock
- [ ] Implement `packages/api/src/handlers/api-clients.ts`
- [ ] Mount in `packages/api/src/app.ts`

## Files to Create

- `packages/api/prisma/migrations/20260305120000_add_api_clients/migration.sql`
- `packages/api/src/repositories/api-client.repository.ts`
- `packages/api/src/repositories/__tests__/api-client.repository.test.ts`
- `packages/api/src/lib/scopes.ts`
- `packages/api/src/__tests__/scopes.test.ts`
- `packages/api/src/middleware/api-client-auth.ts`
- `packages/api/src/__tests__/api-client-auth.test.ts`
- `packages/api/src/handlers/api-clients.ts`
- `packages/api/src/handlers/api-clients.test.ts`

## Files to Modify

- `packages/api/prisma/schema.prisma`
- `packages/api/src/repositories/index.ts`
- `packages/api/src/types.ts`
- `packages/api/src/middleware/tenant.ts`
- `packages/api/src/__tests__/tenant-middleware.test.ts`
- `packages/api/src/app.ts`

## Risks

- Tenant middleware change (userId lookup) adds 1 DB query per v1 request; acceptable given current pattern
- Migration is additive only — no destructive changes
