# Multi-Tenant Login (Tenant Picker)

**Branch:** main
**Goal:** Allow a user invited to multiple tenants to select which tenant to log into at login time.

## Ordered Implementation Checklist (TDD)

### 1. Schema & Migration

- [x] Add `AuthSession` model to `packages/api/prisma/schema.prisma`
- [x] Create migration SQL file `20260306000000_add_auth_sessions`
- [x] Run `node node_modules/.bin/prisma generate` to update client

### 2. Backend: resolve-tenants endpoint

- [x] Write tests in `packages/api/src/handlers/auth.test.ts` for `POST /api/auth/resolve-tenants`
- [x] Implement `POST /api/auth/resolve-tenants` in `packages/api/src/handlers/auth.ts`

### 3. Backend: select-tenant endpoint

- [x] Write tests in `packages/api/src/handlers/auth.test.ts` for `POST /api/auth/select-tenant`
- [x] Implement `POST /api/auth/select-tenant` in `packages/api/src/handlers/auth.ts`

### 4. Backend: pre-token Lambda

- [x] Extend tests in `packages/api/src/cognito/pre-token.test.ts` for AuthSession-based path
- [x] Update `packages/api/src/cognito/pre-token.ts` with AuthSession lookup + fallback

### 5. Frontend: tenant resolver

- [x] Write tests in `packages/web/src/auth/tenant-resolver.test.ts`
- [x] Add `resolveTenantsForEmail` and `selectTenant` to `packages/web/src/auth/tenant-resolver.ts`

### 6. Frontend: login UI

- [x] Write tests in `packages/web/src/routes/login.test.tsx`
- [x] Update `packages/web/src/routes/login.tsx` with `select-tenant` step

## Result

All tests pass: 5 packages, 0 failures.

- API: 438 tests (26 files) — includes 19 new auth handler tests + 6 new pre-token tests
- Web: 60 tests (12 files) — includes 7 new login page tests + 4 new tenant-resolver tests
- Infra: 92 tests (6 files) — unchanged
