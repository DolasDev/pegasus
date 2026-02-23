# Multi-Tenant SSO — Implementation Progress

## Current Phase
**Phase 5 — Claims, RBAC & Tenant Isolation** ✅ COMPLETE

## Current Step
Phase 5 fully complete. Ready to begin Phase 6 on confirmation.

## Completed Steps

### Phase 1 — Login Page (Mock) ✅
- [x] `packages/web/src/auth/session.ts` — Session type + sessionStorage utils
- [x] `packages/web/src/auth/tenant-resolver.ts` — (Phase 1: mock; Phase 2: real API)
- [x] `packages/web/src/routes/login.tsx` — Multi-step login UI
- [x] `packages/web/src/routes/login.callback.tsx` — (Phase 1: mock; Phase 2: real)
- [x] `packages/web/src/router.tsx` — /login and /login/callback routes
- [x] `packages/web/src/routes/__root.tsx` — Skip AppShell for /login paths
- [x] `packages/web/src/routes/landing.tsx` — CTAs → /login
- [x] `packages/web/src/components/AppShell.tsx` — Session display + logout

### Phase 2 — Real Cognito SSO Integration ✅
- [x] `packages/web/src/auth/pkce.ts` — PKCE verifier/challenge + state (Web Crypto)
- [x] `packages/web/src/auth/cognito.ts` — buildAuthorizeUrl, exchangeCodeForTokens, buildLogoutUrl
- [x] `packages/web/src/auth/tenant-resolver.ts` — replaced mock with POST /api/auth/resolve-tenant
- [x] `packages/web/src/routes/login.tsx` — generates real PKCE + redirects to Cognito Hosted UI
- [x] `packages/web/src/routes/login.callback.tsx` — real code exchange + backend token validation
- [x] `packages/web/src/components/AppShell.tsx` — logout via Cognito /logout endpoint
- [x] `packages/web/.env.example` — documented all VITE_COGNITO_* env vars
- [x] `packages/api/src/handlers/auth.ts` — resolve-tenant + validate-token endpoints
- [x] `packages/api/src/app.ts` — mounted authHandler at /api/auth
- [x] `packages/api/prisma/schema.prisma` — emailDomains String[] on Tenant
- [x] `packages/api/prisma/migrations/0003_tenant_email_domains/migration.sql`
- [x] Prisma client regenerated (emailDomains now in generated types)
- [x] `packages/infra/lib/stacks/cognito-stack.ts` — tenantCallbackUrls/LogoutUrls props + SSM params
- [x] `packages/infra/lib/stacks/api-stack.ts` — COGNITO_TENANT_CLIENT_ID env var
- [x] `packages/infra/bin/app.ts` — tenantUrl CDK context + cognitoTenantClientId prop
- [x] All packages typecheck clean: web, api, infra, admin

## Key Architectural Decisions (Phase 2)
- **Token validation**: frontend exchanges code directly at Cognito token endpoint (PKCE public client),
  then sends ID token to `/api/auth/validate-token` for server-side validation. Raw tokens discarded.
- **Storage**: Only validated session claims (not raw tokens) stored in sessionStorage. Documented in
  login.callback.tsx why httpOnly cookies were deferred (cross-origin Lambda/CloudFront complexity).
- **tenantId resolution**: Backend derives tenantId from email domain via `emailDomains` DB column —
  not from any claim the frontend supplies. Prevents tenant injection.
- **Provider-agnostic**: OIDC and SAML both use `identity_provider` param in authorize URL; Cognito
  handles protocol differences. No separate frontend code paths.

### Phase 3 — Tenant SSO Configuration UI ✅
- [x] `packages/api/prisma/schema.prisma` — Added `SsoProviderType` enum + `TenantSsoProvider` model; removed `ssoProviderConfig` JSON blob from Tenant
- [x] `packages/api/prisma/migrations/0004_sso_providers/migration.sql` — CREATE TABLE tenant_sso_providers + DROP COLUMN sso_provider_config
- [x] `packages/api/src/lib/prisma.ts` — Added 'TenantSsoProvider' to TENANT_SCOPED_MODELS
- [x] `packages/api/src/handlers/sso.ts` — GET/POST/PUT/DELETE /providers (secretArn never returned)
- [x] `packages/api/src/handlers/auth.ts` — resolve-tenant now queries TenantSsoProvider table
- [x] `packages/api/src/app.ts` — mounted ssoHandler at /api/v1/sso
- [x] `packages/web/src/api/client.ts` — Handle 204 No Content responses in apiFetch
- [x] `packages/web/src/api/queries/sso.ts` — React Query options + mutations for SSO providers
- [x] `packages/web/src/routes/sso-config.tsx` — list/add/edit/delete UI with inline forms
- [x] `packages/web/src/router.tsx` — /settings/sso route
- [x] `packages/web/src/components/AppShell.tsx` — SSO Providers nav item
- [x] All packages typecheck clean: web, api, infra, admin, domain

## Key Architectural Decisions (Phase 3)
- **TenantSsoProvider table** replaced `ssoProviderConfig` JSON blob for proper relational integrity and per-row enable/disable.
- **secretArn never returned**: only a Secrets Manager ARN reference is stored; the actual credential never touches the API response.
- **cognitoProviderName immutable**: changing the Cognito IdP name requires delete + recreate to preserve Cognito registration integrity.
- **Tenant-scoped queries**: TenantSsoProvider added to TENANT_SCOPED_MODELS so all queries automatically filter by tenantId.

### Phase 4 — Tenant Creation ✅
- [x] `packages/api/src/handlers/admin/tenants.ts` — Added `emailDomains` + `adminEmail` to `CreateTenantBody`; `emailDomains` to `PatchTenantBody`; removed stale `ssoProviderConfig` from `DETAIL_SELECT` and `PatchTenantBody`; added Cognito `AdminCreateUser` call (idempotent, email suppressed in non-production)
- [x] `packages/api/src/handlers/auth.ts` — `resolve-tenant` returns 422 `SSO_NOT_CONFIGURED` when tenant has no enabled providers (server-side login gate)
- [x] `packages/infra/lib/stacks/api-stack.ts` — Added `cognitoUserPoolId` prop, `COGNITO_USER_POOL_ID` env var, and `cognito-idp:AdminCreateUser` IAM permission
- [x] `packages/infra/bin/app.ts` — Passes `cognitoUserPoolId` to `ApiStack`
- [x] `apps/admin/src/api/tenants.ts` — Added `emailDomains` to `Tenant` type; added `adminEmail`/`emailDomains` to `CreateTenantBody`; removed `ssoProviderConfig` from `TenantDetail`/`UpdateTenantBody`
- [x] `apps/admin/src/components/TenantFormDialog.tsx` — Added `adminEmail` (required) + `emailDomains` (comma-separated) fields; removed SSO config JSON editor; client-side validation for both
- [x] `apps/admin/src/routes/_auth/tenants/$id.tsx` — Replaced SSO config JSON blob with Email domains row; removed stale `ssoProviderConfig` reference
- [x] `packages/web/src/routes/login.tsx` — Catches `ApiError` with `code: 'SSO_NOT_CONFIGURED'` and shows actionable error message
- [x] All packages typecheck clean: web, api, infra, admin, domain

## Key Architectural Decisions (Phase 4)
- **Cognito first, DB second**: `AdminCreateUser` is called before the DB transaction. If Cognito fails the request aborts with `COGNITO_ERROR` and no orphaned DB record is created. If Cognito succeeds but the DB fails, an orphaned Cognito user is created but it can't log in (no tenant record) — recoverable via retry.
- **Idempotent provisioning**: `UsernameExistsException` is silently ignored, so retrying a failed create is safe.
- **Email suppression in dev**: `MessageAction: 'SUPPRESS'` is set in non-production to avoid sending real emails during development.
- **emailDomains replace semantics**: PATCH replaces the full array when `emailDomains` is provided; empty body leaves them unchanged.
- **422 SSO_NOT_CONFIGURED**: `resolve-tenant` blocks login before a provider is configured, enforced server-side regardless of frontend state.

### Phase 5 — Claims, RBAC & Tenant Isolation ✅
- [x] `packages/api/src/cognito/pre-token.ts` — Pre-Token-Generation Lambda to inject `custom:tenantId` and `custom:role`
- [x] `packages/infra/lib/stacks/cognito-stack.ts` — Attached `preTokenFn` Lambda with Prisma DB access
- [x] `packages/api/src/handlers/auth.ts` — `validate-token` extracts injected claims directly from the ID token instead of querying the DB
- [x] `packages/api/src/middleware/tenant.ts` — Parsed Bearer token, verified JWT, mapped `custom:tenantId`, and attached `role` to context
- [x] `packages/api/src/middleware/rbac.ts` — Added `requireRole` middleware to restrict access based on user role
- [x] `packages/api/src/handlers/sso.ts` — Applied `requireRole(['tenant_admin'])` to SSO config routes
- [x] `packages/web/src/auth/session.ts` — Added `token` to the frontend `Session` type
- [x] `packages/web/src/routes/login.callback.tsx` — Saved the ID token upon successful authentication
- [x] `packages/web/src/api/client.ts` — Automatically injects `Authorization: Bearer` on every `apiFetch` call
- [x] All packages typecheck and build successfully

## Key Architectural Decisions (Phase 5)
- **ID Token auth**: The frontend sends the ID token to authenticate with the backend, as it contains the Cognito-injected `custom:tenantId` and `custom:role` claims required by the API.
- **Token validation context**: The backend verifies token signatures without network calls by caching the remote JWKS asynchronously within process scope.
- **Stateless Tenant Middleware**: Tenant routing relies entirely on the authenticated claims in the JWT rather than subdomain matching or explicit payload queries, enhancing cross-domain security.

---

## Phase 6 — TBD (NOT STARTED)

---

_Updated at end of each discrete step._
