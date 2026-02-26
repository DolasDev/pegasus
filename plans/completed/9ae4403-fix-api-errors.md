# fix-api-errors

**Branch:** feature/fix-api-errors
**Goal:** Fix 404s on moves/customers/invoices (missing /api/v1 prefix in web app) and 403 on providers (premature RBAC check in sso handler).

## Checklist

- [x] Fix URL prefix in `packages/web/src/api/queries/moves.ts`
- [x] Fix URL prefix in `packages/web/src/api/queries/customers.ts`
- [x] Fix URL prefix in `packages/web/src/api/queries/billing.ts`
- [x] Fix URL prefix in `packages/web/src/api/queries/quotes.ts`
- [x] Fix URL prefix in `packages/web/src/api/queries/inventory.ts`
- [x] Remove premature RBAC check from `packages/api/src/handlers/sso.ts`
- [x] Update sso.test.ts to reflect new expected behaviour
- [x] Run full test suite — domain/api/web/admin all pass; infra failures are pre-existing (confirmed baseline)

## Files Modified

- `packages/web/src/api/queries/moves.ts` — add `/api/v1` prefix to all paths
- `packages/web/src/api/queries/customers.ts` — add `/api/v1` prefix
- `packages/web/src/api/queries/billing.ts` — add `/api/v1` prefix
- `packages/web/src/api/queries/quotes.ts` — add `/api/v1` prefix
- `packages/web/src/api/queries/inventory.ts` — add `/api/v1` prefix
- `packages/api/src/handlers/sso.ts` — remove `ssoHandler.use('*', requireRole(['tenant_admin']))` (line 149)

## Root Causes

1. **404 on moves/customers/invoices**: Web app query files call `/moves`, `/customers` etc. without the `/api/v1` prefix. API routes are all mounted under `/api/v1/*`. Hits the global notFound handler.
2. **403 on providers**: `ssoHandler.use('*', requireRole(['tenant_admin']))` was added prematurely. The comment in sso.ts says "Phase 5 will add an RBAC check… For now, any authenticated tenant session can manage providers." The pre-token Lambda only assigns `tenant_user` role — no user currently has `tenant_admin`, so the check blocks everyone.

## Side Effects / Risks

- None from URL prefix changes — purely restoring intended routing.
- Removing RBAC aligns with documented intent; can be re-added in Phase 5 with proper role assignment mechanism.
