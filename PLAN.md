# Test Coverage Plan

## How to Use This Plan

Each step has a **Completion Check** — run it before starting to skip already-done steps.
After implementing the test file(s) for a step, run all tests and commit if the suite is clean.
Steps are independent within each phase and may be re-run safely without duplicating work.

---

## Known Baseline Failures

These tests were already failing before this plan started. They are **not regressions**.
Each step's verify block will flag if new failures appear beyond this list.

| File | Failing tests | Root cause |
|------|--------------|------------|
| `src/__tests__/tenant-middleware.test.ts` | 8/9 | Middleware now returns 401; tests expect 400/200 |
| `src/app.test.ts` | 2/98 | `POST /api/admin/tenants` mock shape mismatch |
| `src/cognito/pre-auth.test.ts` | 1/10 | Error message string changed; test not updated |

**Baseline:** 11 failing, 129 passing, 44 skipped across `@pegasus/api`.

---

## Phase 1 — API Layer (no DB required)

### Step 1 — RBAC Middleware (`requireRole`) ✅ DONE

**Completion check:**
```bash
ls packages/api/src/middleware/rbac.test.ts 2>/dev/null && echo DONE || echo TODO
```

**File:** `packages/api/src/middleware/rbac.test.ts`

**Test cases:**
- [x] Returns 403 with code `FORBIDDEN` when no role is set in context
- [x] Returns 403 with code `FORBIDDEN` when the role is not in the allowed list
- [x] Returns 403 when role matches none of several allowed roles
- [x] Returns 403 when `allowedRoles` is an empty array (no roles permitted)
- [x] Calls `next()` and returns 200 when role exactly matches the single allowed role
- [x] Calls `next()` and returns 200 when role matches one of several allowed roles

**Run & Commit:**
```bash
# Run all tests
node node_modules/.bin/turbo run test

# Verify: rbac.test.ts should show 6 passed, no new failures beyond baseline.
# If clean, commit:
git add packages/api/src/middleware/rbac.test.ts PLAN.md
git commit -m "test: add unit tests for requireRole RBAC middleware"
```

---

### Step 2 — Pre-Token Lambda Trigger

**Completion check:**
```bash
ls packages/api/src/cognito/pre-token.test.ts 2>/dev/null && echo DONE || echo TODO
```

**File to create:** `packages/api/src/cognito/pre-token.test.ts`

**Mock:** `@prisma/client` — mock `PrismaClient` constructor, specifically `db.tenant.findFirst`.

**Test cases:**
- [ ] Platform admin path: injects `custom:role = 'platform_admin'`, skips DB lookup
- [ ] Platform admin path: does NOT inject `custom:tenantId`
- [ ] Tenant user path: resolves tenant from email domain, injects `custom:tenantId` + `custom:role = 'tenant_user'`
- [ ] Tenant user path: throws with friendly message when no active tenant matches the domain
- [ ] Tenant user path: throws when email attribute is missing entirely
- [ ] Tenant user path: throws with invalid email format error when email has no `@`
- [ ] Tenant user path: DB query uses `status: 'ACTIVE'` filter (fail-closed)

**Notes:** Mirror the pre-auth test structure (`pre-auth.test.ts`). The handler is imported after
the mock is hoisted. Build a minimal `PreTokenGenerationTriggerEvent` object for each test.

**Run & Commit:**
```bash
# Run all tests
node node_modules/.bin/turbo run test

# Verify: pre-token.test.ts shows 7 passed, no new failures beyond baseline.
# If clean, commit:
git add packages/api/src/cognito/pre-token.test.ts PLAN.md
git commit -m "test: add unit tests for pre-token Cognito Lambda trigger"
```

---

### Step 3 — SSO Handler (CRUD + RBAC enforcement)

**Completion check:**
```bash
ls packages/api/src/handlers/sso.test.ts 2>/dev/null && echo DONE || echo TODO
```

**File to create:** `packages/api/src/handlers/sso.test.ts`

**Mock strategy:** Standalone test file using the same pattern as `app.test.ts`:
- Mock `../middleware/tenant` — sets `tenantId`, `db`, and `role: 'tenant_admin'`
- Mock `../middleware/rbac` is NOT mocked — use the real `requireRole` to exercise RBAC enforcement
- Mock `db` on the Hono context with `tenantSsoProvider` methods

**Test cases:**

`GET /api/v1/sso/providers`
- [ ] Returns 200 `{ data: [] }` when no providers exist
- [ ] Returns 200 `{ data: [...] }` with `secretArn` never present in any item
- [ ] Returns 500 on DB error

`POST /api/v1/sso/providers`
- [ ] Returns 201 with created provider (OIDC, all fields)
- [ ] Returns 400 `VALIDATION_ERROR` when `name` is missing
- [ ] Returns 400 `VALIDATION_ERROR` when `cognitoProviderName` contains invalid characters
- [ ] Returns 400 `VALIDATION_ERROR` when `type` is not `OIDC` or `SAML`
- [ ] Returns 409 `CONFLICT` when Prisma throws P2002 (duplicate `cognitoProviderName`)
- [ ] Returns 500 on unexpected DB error
- [ ] Response never contains `secretArn`

`PUT /api/v1/sso/providers/:id`
- [ ] Returns 200 with updated provider on valid body
- [ ] Returns 404 `NOT_FOUND` when provider does not exist
- [ ] Returns 400 `VALIDATION_ERROR` on invalid `metadataUrl` (not a URL)
- [ ] Immutability: `cognitoProviderName` and `type` are not in the DB update payload

`DELETE /api/v1/sso/providers/:id`
- [ ] Returns 204 No Content on success
- [ ] Returns 404 `NOT_FOUND` when provider does not exist

RBAC enforcement (real `requireRole`, not mocked)
- [ ] Returns 403 when requesting user's role is `tenant_user` (not `tenant_admin`)
- [ ] Returns 403 when role is absent from context

**Run & Commit:**
```bash
# Run all tests
node node_modules/.bin/turbo run test

# Verify: sso.test.ts shows 17 passed, no new failures beyond baseline.
# If clean, commit:
git add packages/api/src/handlers/sso.test.ts PLAN.md
git commit -m "test: add handler tests for SSO CRUD endpoints and RBAC enforcement"
```

---

## Phase 2 — Infrastructure

### Step 4 — Cognito CDK Stack

**Completion check:**
```bash
ls packages/infra/lib/stacks/__tests__/cognito-stack.test.ts 2>/dev/null && echo DONE || echo TODO
```

**File to create:** `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts`

**Pattern:** Same as `api-stack.test.ts` — `Template.fromStack(new CognitoStack(app, 'Test'))` + assertions.

**Test cases:**

User Pool configuration
- [ ] Exactly 1 `AWS::Cognito::UserPool` is created
- [ ] `SelfSignUpEnabled: false`
- [ ] Sign-in alias is `email`
- [ ] MFA is `OPTIONAL` (not `OFF` or `ON`)
- [ ] MFA second factor: SMS disabled, TOTP enabled
- [ ] Password policy: min 12 chars, requires lowercase, uppercase, digits, symbols
- [ ] Removal policy is `RETAIN`
- [ ] Account recovery is email-only

Groups and Hosted UI
- [ ] `AWS::Cognito::UserPoolGroup` named `PLATFORM_ADMIN` is created
- [ ] Cognito hosted UI domain is provisioned (`AWS::Cognito::UserPoolDomain`)

App clients
- [ ] Admin app client: `GenerateSecret: false`, `PreventUserExistenceErrors: true`
- [ ] Admin app client: authorization code grant flow enabled
- [ ] Admin app client: access/id token validity = 1 hour
- [ ] Tenant app client: `GenerateSecret: false`
- [ ] Tenant app client: authorization code grant flow enabled
- [ ] Tenant app client: id token validity = 8 hours, refresh = 30 days

Lambda triggers
- [ ] `PreAuthentication` Lambda trigger is wired to user pool
- [ ] `PreTokenGeneration` Lambda trigger is wired to user pool
- [ ] Pre-auth Lambda has correct runtime (Node.js 20.x) and memory (128 MB)
- [ ] Pre-token Lambda has correct runtime (Node.js 20.x) and memory (256 MB)
- [ ] Pre-token Lambda has DB environment variables set

IAM
- [ ] Pre-auth function has `cognito-idp:AdminGetUser` permission
- [ ] Pre-auth function has `cognito-idp:AdminListGroupsForUser` permission

SSM Parameters
- [ ] `/pegasus/admin/cognito-user-pool-id` SSM parameter is created
- [ ] `/pegasus/admin/cognito-admin-client-id` SSM parameter is created
- [ ] `/pegasus/cognito/jwks-url` SSM parameter is created

CloudFormation outputs
- [ ] `UserPoolId`, `AdminClientId`, `TenantClientId`, `HostedUiBaseUrl`, `JwksUrl` outputs exist

**Run & Commit:**
```bash
# Run all tests (infra uses a separate vitest process pool)
node node_modules/.bin/turbo run test

# Verify: cognito-stack.test.ts shows 25+ passed, no new failures in any package.
# If clean, commit:
git add packages/infra/lib/stacks/__tests__/cognito-stack.test.ts PLAN.md
git commit -m "test: add CDK assertions for CognitoStack"
```

---

## Phase 3 — Frontend Packages

### Step 5 — Web Package: Setup + Pure Unit Tests

**Completion check:**
```bash
ls packages/web/vitest.config.ts 2>/dev/null && echo DONE || echo TODO
```

**Files to create:**
- `packages/web/vitest.config.ts`
- `packages/web/src/__tests__/utils.test.ts`
- `packages/web/src/__tests__/pkce.test.ts`
- `packages/web/src/__tests__/session.test.ts`

**Setup required:**
- Add `vitest`, `@vitest/coverage-v8`, `jsdom`, and `@testing-library/react` to `packages/web/package.json` devDependencies
- Configure `packages/web/vitest.config.ts` with `environment: 'jsdom'` and `globals: true`
- Add `"test": "vitest run"` to `packages/web/package.json` scripts

**Test cases:**

`src/lib/utils.ts`
- [ ] `cn()` merges class names correctly (basic cases, conditional classes, tailwind merge conflicts)

`src/auth/pkce.ts`
- [ ] `generateCodeVerifier()` returns a string of appropriate length (43-128 chars per RFC)
- [ ] `generateCodeVerifier()` contains only URL-safe characters (A-Z a-z 0-9 - _ . ~)
- [ ] `generateCodeChallenge()` returns a string (SHA-256 base64url of verifier)
- [ ] `generateCodeChallenge()` is deterministic: same verifier → same challenge

`src/auth/session.ts`
- [ ] `saveSession()` writes token to sessionStorage
- [ ] `getSession()` returns `null` when nothing is stored
- [ ] `getSession()` returns the stored token after `saveSession()`
- [ ] `clearSession()` removes the stored token

**Notes:** Read the actual source files before writing tests to confirm function names and signatures.

**Run & Commit:**
```bash
# Run all tests across all packages
node node_modules/.bin/turbo run test

# Verify: web tests show 9+ passed. No new failures in api or infra packages.
# If clean, commit:
git add packages/web/vitest.config.ts packages/web/package.json \
        packages/web/src/__tests__/ PLAN.md
git commit -m "test: add vitest setup and pure unit tests for web package (auth, utils)"
```

---

### Step 6 — Admin App: Setup + Core Tests

**Completion check:**
```bash
ls apps/admin/vitest.config.ts 2>/dev/null && echo DONE || echo TODO
```

**Files to create:**
- `apps/admin/vitest.config.ts`
- `apps/admin/src/__tests__/cognito.test.ts`
- `apps/admin/src/__tests__/TenantFormDialog.test.tsx`

**Setup required:**
- Add `vitest`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` to `apps/admin/package.json` devDependencies
- Configure `apps/admin/vitest.config.ts` with `environment: 'jsdom'` and `globals: true`
- Add `"test": "vitest run"` to `apps/admin/package.json` scripts

**Test cases:**

`src/auth/cognito.ts` (pure/logic parts only)
- [ ] Auth URL builder produces a valid Cognito authorize URL with correct query params
- [ ] Logout URL builder produces a valid logout URL

`src/components/TenantFormDialog.tsx`
- [ ] Renders "Add Tenant" dialog with name and slug fields
- [ ] Submit button is disabled when fields are empty
- [ ] Calls the correct API mutation on valid submit
- [ ] Closes dialog after successful submit

**Notes:** Read source files first to confirm what functions/components exist.
Mock `src/api/tenants.ts` for component tests to avoid network calls.

**Run & Commit:**
```bash
# Run all tests across all packages
node node_modules/.bin/turbo run test

# Verify: admin tests show 6+ passed. No new failures in any package.
# If clean, commit:
git add apps/admin/vitest.config.ts apps/admin/package.json \
        apps/admin/src/__tests__/ PLAN.md
git commit -m "test: add vitest setup and unit tests for admin app (auth, TenantFormDialog)"
```

---

## Completion Status

| Step | File(s) | Status |
|------|---------|--------|
| 1 — RBAC middleware | `packages/api/src/middleware/rbac.test.ts` | ✅ DONE |
| 2 — Pre-token trigger | `packages/api/src/cognito/pre-token.test.ts` | ✅ DONE |
| 3 — SSO handler | `packages/api/src/handlers/sso.test.ts` | ☐ TODO |
| 4 — Cognito CDK stack | `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts` | ☐ TODO |
| 5 — Web package setup + units | `packages/web/vitest.config.ts` + test files | ☐ TODO |
| 6 — Admin app setup + units | `apps/admin/vitest.config.ts` + test files | ☐ TODO |

---

## Gap Analysis (Post-Execution)

Once all steps are complete, the following gaps will remain by design (out of scope for this plan):

### Intentionally Out of Scope

| Gap | Reason |
|-----|--------|
| **E2E tests (Playwright/Cypress)** | No test environment configured; requires running infra. Separate effort. |
| **API integration tests (with real DB)** | Already exist for repositories. Handler integration (non-mocked) would require a DB and duplicate repository tests. |
| **Frontend route-level tests** | TanStack Router's `createMemoryRouter`-based tests are non-trivial to set up and offer low ROI compared to E2E for routing. |
| **Admin handler isolated tests** | Admin routes are already covered end-to-end in `app.test.ts`. Isolated handler files add overhead without additional coverage. |
| **Visual regression tests** | No Storybook or Chromatic set up; components are mostly Radix-based utility UI. |

### Structural Gaps (not addressable by unit tests)

| Gap | Notes |
|-----|--------|
| **Multi-tenant data isolation** | The Prisma row-level isolation model (`createTenantDb`) is mocked in all handler tests. An integration test that signs in as two different tenants and verifies data cannot cross boundaries would require a live DB + real API calls. |
| **RBAC at route level** | Step 3 covers `requireRole` enforcement for SSO. The TODO comment in `sso.ts` notes Phase 5 will add RBAC to all tenant routes. Those routes (customers, moves, etc.) currently have no role enforcement and no tests for it. |
| **Token refresh / session expiry** | The web `session.ts` module is unit-tested in Step 5, but the full Cognito token refresh flow (polling silent renew, handling 401 from API) is not exercised. |
| **Cognito trigger error propagation** | The pre-auth and pre-token triggers throw `Error` objects whose `message` Cognito surfaces to the user. There are no tests verifying the exact string matches Cognito's expected format for user-facing error messages. |

### Coverage Summary After All Steps Complete

| Package | Before | After |
|---------|--------|-------|
| `packages/domain` | ~100% | ~100% (unchanged) |
| `packages/api` — middleware | ~70% | ~100% |
| `packages/api` — handlers | ~75% | ~90% (SSO added) |
| `packages/api` — cognito | 50% (pre-auth only) | ~100% |
| `packages/infra` | 60% (3/4 stacks) | ~100% |
| `packages/web` | 0% | ~30% (pure utils + auth) |
| `apps/admin` | 0% | ~25% (auth utils + key component) |
