# Permissions architecture: Cedar via AWS Verified Permissions, per-tenant policy stores

## Context

Pegasus needs to move beyond two-role RBAC (`ADMIN`/`USER`) toward concrete personas (dispatcher, sales, accountant, crew lead, auditor), eventual row/field-level rules ("crew sees only their moves"), tenant-defined roles, and a "what can I do?" introspection API for external consumers. Going **AVP-first** skips a hand-rolled evaluator we'd later throw away — Cedar handles ABAC and tenant-defined policies natively.

**This plan is being handed to a fresh local Claude Code session.** All open questions are decided below — execute as written.

## Decided

1. **One AVP policy store per tenant.** Hard isolation; cross-tenant policy leakage is structurally impossible. The store ID is persisted on `Tenant.policyStoreId` and provisioned at tenant-create time. Soft AVP limit (~100 stores) is fine for early stage; raise via support ticket later. No `forbid (principal.tenant != resource.tenant)` guardrail policy is needed — there's no shared store to leak across.
2. **Role-group membership via Cognito custom claim, not a DB join table.** The pre-token Lambda emits `custom:roles` (JSON-encoded `string[]`); AVP's `IsAuthorizedWithToken` reads it directly. The authoritative source on the DB side is a `TenantUser.roleNames String[]` column. Trade-off accepted: role edits take effect only on the next token refresh (Cognito default ≤1h).
3. **Policies-as-code.** Cedar policy text and schema check into `apps/api/src/authz/`. At tenant-create time the API pushes the schema and one policy per `.cedar` file into the freshly-created store via the AVP SDK. No CDK custom resource — the runtime owns policy lifecycle.
4. **Offline path for tests + local dev.** `@cedar-policy/cedar-wasm/nodejs` evaluates the same policy text. `AUTHZ_OFFLINE=true` (auto-set under `SKIP_AUTH`) bypasses AVP. Production never uses wasm.
5. **Cache.** Short TTL (60s) in-memory per Lambda warm container, keyed by `(sub, action, resourceType, resourceId, policyStoreId)`. Revisit if hot paths show pressure.

## Architecture

```
   Cognito ID token                         Hono API request
   (custom:tenantId,                        │
    custom:role,            ┌──────────────────────────────┐
    custom:roles)           │ tenantMiddleware             │
       │                    │  - verify JWT                │
       │                    │  - parse custom:roles → Principal
       │                    │  - load tenant.policyStoreId │
       │                    │  - c.set('principal', …)     │
       │                    │  - c.set('idToken', token)   │
       │                    │  - c.set('policyStoreId', …) │
       │                    └──────────────┬───────────────┘
       │                                   ▼
       │                    ┌──────────────────────────────┐
       │                    │ requirePermission(Action,    │
       │                    │   resourceFn?)               │
       │                    └──────────────┬───────────────┘
       │                                   ▼
       │                    ┌──────────────────────────────┐
       │                    │ authorize() — pickBackend()  │
       │                    └─┬────────────────────┬───────┘
       │                       AVP (prod)        offline (test/dev)
       │                       │                   │
       ▼                       ▼                   ▼
   AVP IdentitySource ◀── IsAuthorizedWithToken    @cedar-policy/cedar-wasm
   (one per tenant store)     │                    (same .cedar files)
                              ▼
                         Policy Store for tenant T
                         (schema + N policies, one per persona)

   Tenant create flow:
   POST /api/admin/tenants
     → CreatePolicyStore
     → PutSchema
     → CreatePolicy × N (one per .cedar file)
     → CreateIdentitySource (Cognito user pool)
     → tenant.policyStoreId = result
```

## Today's state (verified during prior session)

- `TenantUserRole` enum at `apps/api/prisma/schema.prisma:100-105` (`ADMIN`/`USER`).
- `requireRole(['tenant_admin'])` mounted in three handlers: `users.ts:96`, `settings.ts:44`, `api-clients.ts:88`.
- Pre-token Lambda maps role → claim string at `apps/api/src/cognito/pre-token.ts:206`, sets `custom:tenantId` and `custom:role` at lines 230-231.
- `tenantMiddleware` reads `custom:role` at `apps/api/src/middleware/tenant.ts:101`, JWT verification at lines 56-68.
- Tenant create transaction at `apps/api/src/handlers/admin/tenants.ts:226-264` is the seam for AVP store provisioning.
- `SKIP_AUTH` dev shortcut at `apps/api/src/app.ts:161-169` and `apps/api/src/app.server.ts:21-31`.
- M2M auth (`ApiClient.scopes` + `requireScope` in `apps/api/src/lib/scopes.ts`) is separate — leave alone.
- Cognito stack with pre-token wiring at `packages/infra/lib/stacks/cognito-stack.ts:230-249`.
- No `apps/api/src/handlers/me.ts` — to be created.

## Files to touch

### Schema + migrations

| File                                                                       | Change                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                                            | Add `policyStoreId String? @map("policy_store_id")` to `Tenant`. Add `roleNames String[] @default([]) @map("role_names")` to `TenantUser`. Keep legacy `role` enum column (deprecated, write-through).                                                   |
| `apps/api/prisma/migrations/<ts>_tenant_user_role_names/migration.sql`     | `ALTER TABLE tenant_users ADD COLUMN role_names TEXT[] NOT NULL DEFAULT '{}';` + backfill: `UPDATE tenant_users SET role_names = ARRAY['tenant_admin'] WHERE role='ADMIN'; UPDATE tenant_users SET role_names = ARRAY['tenant_user'] WHERE role='USER';` |
| `apps/api/prisma/migrations/<ts>_add_tenant_policy_store_id/migration.sql` | `ALTER TABLE tenants ADD COLUMN policy_store_id TEXT;` (nullable — pre-existing tenants need a separate backfill task).                                                                                                                                  |

### Cedar schema and policies (new)

| File                                                                                            | Purpose                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/authz/cedar.schema.json`                                                          | Entity types (`User`, `Group`, `Tenant`, `Quote`, `Move`, `Invoice`, `Customer`, `ApiClient`, `Setting`) with **no `tenant` attribute** (per-tenant store makes it redundant). Action types with `appliesTo` principal/resource matrix. |
| `apps/api/src/authz/actions.ts`                                                                 | `Actions` const map keyed by code identifier; each entry has `id` (Cedar action name), `resourceType`, `permission` (`"resource:verb"` returned by `/me/permissions`). Plus `ALL_ACTIONS` array and `PEGASUS_NS = 'Pegasus'`.           |
| `apps/api/src/authz/policies/10-tenant-admin.cedar`                                             | `permit (principal in Pegasus::Group::"tenant_admin", action, resource);`                                                                                                                                                               |
| `apps/api/src/authz/policies/20-tenant-user.cedar`                                              | Read-only baseline for `tenant_user` (Read{Quote,Move,Invoice,Customer}).                                                                                                                                                               |
| `apps/api/src/authz/policies/30-personas/{dispatcher,sales,accountant,crew-lead,auditor}.cedar` | Persona stubs — see prior commit for the exact action lists.                                                                                                                                                                            |

**Do not** create `00-tenant-isolation.cedar`. Per-tenant stores remove the need.

### API runtime

| File                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/authz.types.ts` (new)                | `Principal { sub, tenantId, roleNames }`, `ActionDef`, `ResourceRef { type, id, attrs? }`, `Decision`, `AuthorizeInput { principal, action, resource?, context?, idToken?, policyStoreId? }`.                                                                                                                                                                                                                                                                                                                                                              |
| `apps/api/src/lib/authz.ts` (new)                      | `authorize(input)` and `listAllowedPermissions(principal, idToken, policyStoreId)`. `pickBackend(policyStoreId)` returns `'avp'` when `policyStoreId` set and not `AUTHZ_OFFLINE`/`SKIP_AUTH`, else `'offline'`. AVP path uses `IsAuthorizedWithToken` / `BatchIsAuthorizedWithToken`. Offline path loads the schema + policies from disk and calls `@cedar-policy/cedar-wasm/nodejs` `isAuthorized`. Includes 60s TTL cache (`_clearAuthzCache` exported for tests). Entity IDs are bare Cognito sub for `User` (no tenant prefix — store is per-tenant). |
| `apps/api/src/lib/authz-provision.ts` (new)            | `provisionTenantPolicyStore({ tenantSlug, userPoolArn, tenantAppClientId })` → `{ policyStoreId }`. Calls `CreatePolicyStore` → `PutSchema` (reads `cedar.schema.json`) → `CreatePolicy` per `.cedar` file → `CreateIdentitySource` (Cognito user pool, principal entity type `Pegasus::User`). On any failure after store creation, best-effort `DeletePolicyStore` and rethrow.                                                                                                                                                                          |
| `apps/api/src/middleware/tenant.ts`                    | After JWT verify: parse `custom:roles` (JSON, fall back to `[customRole]` if absent/malformed); load tenant including `policyStoreId`; set `c.set('principal', { sub, tenantId, roleNames })`, `c.set('idToken', token)`, `c.set('policyStoreId', tenant.policyStoreId ?? undefined)`. Keep `c.set('role', ...)` for compat.                                                                                                                                                                                                                               |
| `apps/api/src/middleware/rbac.ts`                      | Add `requirePermission(action: ActionDef, resourceFn?: (c) => ResourceRef)`. Reads `principal`, `idToken`, `policyStoreId` from context, calls `authorize`. Keep existing `requireRole` until callers migrate.                                                                                                                                                                                                                                                                                                                                             |
| `apps/api/src/types.ts`                                | Add `principal: Principal`, `idToken: string \| undefined`, `policyStoreId: string \| undefined` to `AppVariables`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/api/src/app.ts` and `apps/api/src/app.server.ts` | `SKIP_AUTH` branch: `process.env.AUTHZ_OFFLINE = 'true'`; synthesize principal `{ sub: 'skip-auth-user', tenantId, roleNames: ['tenant_admin'] }`; set `idToken: undefined`, `policyStoreId: undefined`. Mount `meHandler` on `/api/v1/me`.                                                                                                                                                                                                                                                                                                                |
| `apps/api/src/handlers/me.ts` (new)                    | `GET /permissions` → `{ roles: principal.roleNames, permissions: await listAllowedPermissions(principal, idToken, policyStoreId) }`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/src/handlers/users.ts:96`                    | Replace wildcard `requireRole` with per-route `requirePermission(Actions.ListUsers \| InviteUser \| UpdateUser \| DeactivateUser)`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/api/src/handlers/settings.ts:44`                 | Same — `Actions.ReadSettings`, `Actions.UpdateSettings`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/api/src/handlers/api-clients.ts:88`              | Same — split per verb (`ListApiClients`, `CreateApiClient`, `RotateApiClient`, `RevokeApiClient`).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/api/src/handlers/users.ts` (PATCH `/:id`)        | Accept `roleNames: string[]` alongside existing `role`; write both (`role` derived from `'tenant_admin' ∈ roleNames`). Drop `role` writes in a follow-up phase.                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/api/src/repositories/users.ts`                   | Select/expose `roleNames` in `USER_SELECT`; add `updateRoleNames` method; preserve existing `updateRole` for compat.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/src/handlers/admin/tenants.ts` (POST `/`)    | **Before** opening the DB transaction, call `provisionTenantPolicyStore({ tenantSlug: body.slug, userPoolArn: process.env.COGNITO_USER_POOL_ARN, tenantAppClientId: process.env.COGNITO_TENANT_CLIENT_ID })`. On failure return 500 `AUTHZ_ERROR`. Persist `policyStoreId` in the same `tx.tenant.create({ data: { ..., policyStoreId } })`. Set the seeded admin TenantUser's `roleNames: ['tenant_admin']`.                                                                                                                                              |

### Cognito + pre-token

| File                                        | Change                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/cognito/pre-token.ts:189`     | Select `roleNames` alongside `role`.                                                                                                            |
| `apps/api/src/cognito/pre-token.ts:227-234` | Add `'custom:roles': JSON.stringify(tenantUser.roleNames.length > 0 ? tenantUser.roleNames : [roleClaimValue])`. Keep `custom:role` for compat. |
| `apps/api/src/cognito/pre-token.test.ts`    | Cover (a) `custom:roles` from populated `roleNames`; (b) fallback to `[legacyRoleClaim]` when `roleNames` is empty.                             |

### Infra (CDK)

| File                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/infra/lib/stacks/cognito-stack.ts` | Add `custom:roles` to the User Pool's custom attribute list (string, mutable, max 2048).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/infra/lib/stacks/api-stack.ts`     | Add `COGNITO_USER_POOL_ARN` env var (`arn:aws:cognito-idp:<region>:<account>:userpool/<poolId>` — built from existing `cognitoUserPoolId` + `cdk.Aws.ACCOUNT_ID` + `this.region`). Two IAM policy statements on the API Lambda: (1) `verifiedpermissions:IsAuthorized*`, `BatchIsAuthorized*`, `DeletePolicyStore`, `PutSchema`, `CreatePolicy`, `CreateIdentitySource` on `arn:aws:verifiedpermissions::<account>:policy-store/*`; (2) `verifiedpermissions:CreatePolicyStore` on `*` (account-scoped action). |

**Do not** create an `AuthzStack`. Stores are runtime-provisioned, not CDK-provisioned.

### Tests

| File                                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/authz.test.ts` (new)                       | Wasm-backend table tests. **Required invariants** (do not skip): (a) `tenant_admin` is allowed every action in `ALL_ACTIONS` (`expect(allowed.length).toBe(ALL_ACTIONS.length)`); (b) `tenant_user` allowed read actions, denied writes; (c) personas (dispatcher, sales, accountant, auditor) match their persona policy; (d) empty-roles principal denied everything; (e) `listAllowedPermissions` returns the full catalog for `tenant_admin`. |
| `apps/api/src/middleware/rbac.test.ts`                       | Add `requirePermission` cases. Keep `requireRole` cases.                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/api/src/handlers/{users,settings,api-clients}.test.ts` | Update `buildApp` helpers: replace `c.set('role', 'tenant_admin')` with seeding a principal that has `roleNames: ['tenant_admin']`. Pull into `apps/api/src/__tests__/_principal.ts`.                                                                                                                                                                                                                                                             |
| `apps/api/src/__tests__/tenant-middleware.test.ts:211-218`   | Assert `principal` is populated; assert fallback when `custom:roles` absent.                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/handlers/me.test.ts` (new)                     | Offline-mode integration test for `GET /permissions`; assert tenant_admin payload contains every `Actions.*.permission`.                                                                                                                                                                                                                                                                                                                          |
| `apps/e2e/tests/api/me-permissions.spec.ts` (new)            | Live local API hit (SKIP_AUTH → offline wasm). Assert shape and that tenant_admin has `quote:create`.                                                                                                                                                                                                                                                                                                                                             |

## Execution order (recommended)

1. Schema + both migrations + `prisma generate`.
2. `apps/api/src/authz/` directory: `cedar.schema.json`, `actions.ts`, all `.cedar` files.
3. `authz.types.ts`, `authz.ts` (offline backend first), `authz.test.ts` — get green at the wasm layer before touching middleware.
4. `tenantMiddleware` + `types.ts` + `app.ts`/`app.server.ts` SKIP_AUTH update; principal-related tests.
5. `requirePermission` middleware + handler migrations (users, settings, api-clients) + their tests.
6. `me.ts` handler + test + e2e spec.
7. Pre-token Lambda update + tests.
8. `authz-provision.ts` + tenant-create wiring.
9. CDK changes (`api-stack.ts`, `cognito-stack.ts`).
10. AVP backend in `authz.ts` (`IsAuthorizedWithToken`, `BatchIsAuthorizedWithToken`) — last, since offline path covers tests.

## Verification

- **Unit:** `npm test --workspace=apps/api` — `authz.test.ts` (tenant_admin-has-everything invariant), pre-token tests for `custom:roles`, updated handler tests. ~811 tests should pass; the ~10 DB-required test files skip cleanly without `DATABASE_URL`.
- **Typecheck:** `npm run typecheck` clean across `apps/api` and `packages/infra` (the two pre-existing `@aws-sdk/client-ssm` errors in infra are not new).
- **Migration:** apply against a copy of dev DB; `SELECT count(*) FROM tenant_users WHERE role='ADMIN' AND NOT 'tenant_admin' = ANY(role_names)` must be 0; same for USER → tenant_user.
- **Integration (SKIP_AUTH):** existing e2e specs continue to pass — synthesized principal has `tenant_admin`.
- **AVP smoke (deployed dev):** create a fresh tenant via admin API, observe AVP store created with schema + N policies + identity source, log in as the admin user, hit `GET /api/v1/me/permissions`, verify shape and CloudWatch shows `IsAuthorizedWithToken` calls.
- **Negative auth:** promote a test user to `tenant_user` only; `POST /api/v1/users/invite` returns 403, `GET /api/v1/users` returns 200 — both via the new evaluator.
- **Manual:** `curl /api/v1/me/permissions` as both roles. Output is the public contract; must read cleanly to a human.

## Out of scope

- API client `scopes` and `requireScope` — separate identity model, leave alone.
- Tenant-authored Cedar editing UX — when needed, surface as a CRUD endpoint over a `tenant_policies` table whose rows are pushed to the tenant's AVP store via a separate prefix.
- Removing `tenant_users.role` enum or `custom:role` claim — follow-up cleanup.
- Backfilling `policyStoreId` for pre-existing tenants — separate ops task.
- Domain-layer state-machine functions (`canTransition`, `canFinalizeQuote` in `packages/domain`) — not authorization.
- Platform admin (`/api/admin/*`) authz — uses `adminAuthMiddleware`, never flows through Cedar/AVP. Not touched here.

## Notes for the executor

- This was previously implemented in a sandbox session and verified (typecheck clean, 811 tests pass). The branch was named `feat/avp-authz-foundation`. You can use the same name or a new one.
- Sign commits per repo convention. Don't `--no-verify`.
- After implementation: `npm install` (lockfile picks up `@aws-sdk/client-verifiedpermissions` and `@cedar-policy/cedar-wasm`), `npm run typecheck`, `npm test --workspace=apps/api`, then push and open a PR against `main`.
