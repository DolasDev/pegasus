# Plan: Cognito Built-in Auth Option + Tenant User Management
**Branch:** `feature/sso-infra`
**Goal:** Make Cognito built-in auth a first-class toggle, add explicit TenantUser roster, wire role through Pre-Token Lambda, add User Management page.

## Checklist

- [x] Step 1: DB Schema migration — add `cognitoAuthEnabled`, `TenantUser` model, new enums
- [x] Step 2: Pre-Token Lambda Update — TenantUser lookup, role injection, PENDING activation, block DEACTIVATED
- [x] Step 3: resolve-tenant response — remove 422, always 200 with `cognitoAuthEnabled`
- [x] Step 4: User Management API — repositories/users.ts, handlers/users.ts
- [x] Step 5: Admin Tenants Handler — create TenantUser ADMIN on tenant creation
- [x] Step 6: Infra IAM — add AdminDisableUser, AdminEnableUser, AdminGetUser
- [x] Step 7: Auth Settings endpoint — PATCH /api/v1/sso/providers/auth-settings
- [x] Step 8: tenant-resolver.ts — add `cognitoAuthEnabled` to TenantResolution type
- [x] Step 9: Login page — replace SSO_NOT_CONFIGURED with cognitoAuthEnabled logic
- [x] Step 10: User Management Page — users.tsx, queries/users.ts, AppShell.tsx nav, router.tsx, sso-config.tsx toggle

## Status: COMPLETE — all tests pass (183 API + 44 skipped DB + 21 web + 48 domain + 92 infra)

## Files Modified/Created

- `packages/api/prisma/schema.prisma`
- `packages/api/src/cognito/pre-token.ts`
- `packages/api/src/handlers/auth.ts`
- `packages/api/src/handlers/sso.ts`
- `packages/api/src/handlers/admin/tenants.ts`
- `packages/api/src/app.ts`
- `packages/infra/lib/stacks/api-stack.ts`
- `packages/web/src/auth/tenant-resolver.ts`
- `packages/web/src/routes/login.tsx`
- `packages/web/src/routes/sso-config.tsx`
- `packages/web/src/components/AppShell.tsx`
- `packages/web/src/router.tsx`
- **NEW** `packages/api/src/handlers/users.ts`
- **NEW** `packages/api/src/repositories/users.ts`
- **NEW** `packages/web/src/routes/users.tsx`
- **NEW** `packages/web/src/api/queries/users.ts`
