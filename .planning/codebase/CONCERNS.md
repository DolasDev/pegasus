# Codebase Concerns

**Analysis Date:** 2026-03-27

## Tech Debt

### Legacy MSSQL Integration (PEGII & EFWK) — Minimal Test Coverage

**Issue:** The codebase maintains two large legacy integration shims (`packages/api/src/handlers/pegii/` and `packages/api/src/handlers/efwk/`) that bridge the new Pegasus API to an existing MSSQL database. These sections contain approximately 45+ handler files with zero integration tests and only 1 generic test (`packages/api/src/handlers/pegii/__tests__/factory.test.ts`).

**Files:**

- `packages/api/src/handlers/pegii/` (24 domain files: account, billing, budget, crew, etc.)
- `packages/api/src/handlers/efwk/` (10 domain files: gl, portal, atlas, etc.)
- `packages/api/src/handlers/pegii/index.ts` — mounts all routes
- `packages/api/src/handlers/pegii/factory.ts` — dynamic router generation
- `packages/api/src/handlers/pegii/middleware.ts` — MSSQL pool management

**Impact:**

- Any change to the dynamic router factory (`createDomainRouter` in `pegii/factory.ts`) or MSSQL middleware (`pegii/middleware.ts`) affects 34+ endpoints with no automated verification.
- The generic test suite does not exercise the actual domain entities (sale, billing, employee, etc.); it only tests the factory scaffolding.
- Regressions in query generation, error handling, or connection pooling go undetected until production.

**Fix approach:**

- Phase 1: Add at least 3–5 integration test suites covering representative PEGII/EFWK domains (e.g., `packages/api/src/handlers/pegii/__tests__/domains/sale.integration.test.ts`).
- Phase 2: Test MSSQL middleware isolation (ensure connection pooling does not leak credentials or mix tenant data).
- Extend the factory test to verify router mounting and route registration.

---

### Untested API Handlers (Legacy & New)

**Issue:** Of 66 handler files in `packages/api/src/handlers/`, only 14 have corresponding test files. Many untested handlers are on critical paths:

- `packages/api/src/handlers/billing.ts` — **Has test** ✓ (222 lines)
- `packages/api/src/handlers/customers.ts` — **Has test** ✓ (300 lines)
- `packages/api/src/handlers/inventory.ts` — **Has test** ✓ (178 lines)
- `packages/api/src/handlers/moves.ts` — **Has test** ✓ (287 lines)
- `packages/api/src/handlers/quotes.ts` — **Has test** ✓ (227 lines)
- `packages/api/src/handlers/users.ts` — **Has test** ✓ (310 lines)
- `packages/api/src/handlers/api-clients.ts` — **Has test** ✓ (323 lines)
- `packages/api/src/handlers/auth.ts` — **Has test** ✓ (336 lines)
- `packages/api/src/handlers/sso.ts` — **Has test** ✓ (520 lines, largest)
- `packages/api/src/handlers/admin/*.ts` — **Partial** (tenants, tenant-users, cognito, audit tested)

**Untested critical admin handlers:**

- `packages/api/src/handlers/admin/cognito.ts` — Cognito trigger provisioning (HAS test)
- `packages/api/src/handlers/admin/audit.ts` — Admin audit logging (HAS test)

**Files:**

- All admin/pegii/efwk domain-specific handlers (account, sale, billing, budget, crew, driver, employee, etc.)

**Impact:**

- New features added to admin routes without test coverage.
- Endpoint bugs in PEGII/EFWK go undetected.
- Refactoring these handlers risks silent breakage.

**Fix approach:**

- Write unit tests for all untested public handlers before any refactoring.
- Add a pre-commit hook to warn when `.ts` files in `handlers/` have no corresponding `.test.ts`.
- Phase: Create acceptance tests for each handler via Playwright (api acceptance tests in `apps/e2e/tests/api/`).

---

### Frontend Component Tests Are Sparse

**Issue:** Of 92 TypeScript/TSX files in `packages/web/` and `apps/admin/`, only 19 have test files (21% coverage). React components have minimal unit test coverage; most testing is deferred to E2E tests.

**Files:**

- `packages/web/src/` — 45+ component files, few with tests
- `apps/admin/src/` — 47+ component files, few with tests

**Impact:**

- UI regressions are caught only by E2E tests (slower feedback loop).
- Component refactoring is risky without unit tests.
- State management bugs (TanStack Query, context) are not covered by fast tests.

**Fix approach:**

- Start with highest-risk components (auth flows, form validation, data tables).
- Use Vitest + @testing-library/react for component tests.
- Aim for 60%+ coverage on critical paths (forms, auth UI, layouts).

---

### Cognito Pre-Token Lambda Not Fully Tested

**Issue:** The Cognito pre-token Lambda (`packages/api/src/cognito/pre-token.ts`) enforces critical security rules:

- Validates TenantUser existence in the DB before issuing a token.
- Blocks DEACTIVATED users from logging in.
- Adds tenant/role claims to the JWT.

The test file (`packages/api/src/cognito/pre-token.test.ts`) exists but does not cover:

- Multi-tenant SSO scenarios (different email domains mapping to different tenants).
- Race conditions (user deactivated between COGNITO POST-AUTHENTICATION and PRE-TOKEN Lambda).
- Database failure handling (e.g., connection timeout during TenantUser lookup).

**Files:** `packages/api/src/cognito/pre-token.ts` (Lambda entry point)

**Impact:**

- A bug in the pre-token Lambda could allow deactivated users to access tenant data or incorrectly assign them to the wrong tenant.
- The gating mechanism for the feature `cognitoAuthEnabled` is not fully validated.

**Fix approach:**

- Add test cases for multi-tenant email domain resolution.
- Add error scenario tests (DB unavailable, TenantUser missing).
- Load-test the Lambda under concurrent login attempts.

---

## Security Considerations

### MSSQL Connection String Stored Plaintext in Postgres

**Issue:** The `tenants.mssql_connection_string` column (added in migration `20260308000000_add_tenant_mssql_connection`) stores MSSQL connection strings (which typically include usernames, passwords, or connection tokens) in plaintext in PostgreSQL.

**Files:**

- `packages/api/prisma/schema.prisma` — `Tenant.mssqlConnectionString` (added in latest migration)
- `packages/api/src/handlers/pegii/middleware.ts` — Reads this field and opens MSSQL connections

**Risk:**

- Database breach exposes all MSSQL credentials.
- Credentials are visible in Prisma logs if debug logging is enabled.
- Rotating MSSQL credentials requires updating every tenant record individually.

**Current mitigation:** None.

**Recommendations:**

- Move MSSQL connection strings to AWS Secrets Manager (like the Pegasus database secret).
- Reference secrets by ARN in the tenant record, not the plaintext string.
- Add a database-level encryption layer (transparent data encryption at rest if available in Neon/AWS RDS).
- Audit all places that read/log this field to ensure credentials are not leaked.

---

### API Client Authentication Uses Timing-Safe Comparison, But With Caveats

**Issue:** API client key validation in `packages/api/src/middleware/api-client-auth.ts` uses `crypto.timingSafeEqual` to compare hashes, which is correct. However:

- The key format (`vnd_<48 hex>`) is generated with `crypto.randomBytes`, which is good.
- But if a key is lost/forgotten, there is no recovery mechanism — the hash is not reversible.
- Rotating a key requires creating a new key and deactivating the old one (no graceful transition period).

**Files:**

- `packages/api/src/middleware/api-client-auth.ts` (line with timingSafeEqual)
- `packages/api/src/repositories/api-client.repository.ts` (key creation logic)

**Current mitigation:** Keys are SHA-256 hashed before storage; only the plaintext is returned once on creation.

**Recommendations:**

- Add a key rotation mechanism: new keys can be issued while old ones are still valid for a grace period.
- Document the irreversible nature of lost keys (no password reset analogue).
- Log all API client key operations (creation, rotation, revocation) to the audit log.

---

### Tenant Isolation Enforced Only at Prisma ORM Level

**Issue:** Tenant isolation is implemented via Prisma middleware (`packages/api/src/lib/prisma.ts` — `createTenantDb`), which adds `WHERE tenantId = $1` to all queries. However:

- This is an ORM-level filter, not a database-level constraint.
- Raw SQL queries or direct MSSQL connections (PEGII/EFWK) are NOT protected by this mechanism.
- A bug in the middleware or a bypass in the PEGII router could leak tenant data.
- Prisma schema does not enforce RLS (Row-Level Security) in PostgreSQL.

**Files:**

- `packages/api/src/lib/prisma.ts` — `createTenantDb(db, tenantId)`
- `packages/api/src/handlers/pegii/middleware.ts` — MSSQL pool per tenant (no isolation).
- `packages/api/prisma/schema.prisma` — No `@@index([tenantId])` on critical tables.

**Impact:**

- A tenant_admin account in Tenant A could theoretically craft API requests to access Tenant B's data if there is a bug in the tenant middleware or Prisma query generation.
- PEGII connections are per-tenant-ID only; if tenant resolution is wrong, data leaks.

**Current mitigation:**

- Integration tests in `packages/api/src/lib/__tests__/prisma-tenant-isolation.test.ts` verify isolation for every model.
- Admin API (`packages/api/src/handlers/admin/`) uses the unscoped `basePrisma` to prevent tenant leakage.

**Recommendations:**

- Add database-level constraints: non-null `tenantId` on all tenant-scoped tables, with implicit `WHERE tenantId = X` RLS policies in PostgreSQL (if moving to a multi-tenant RLS strategy).
- Audit MSSQL connection pool logic to confirm tenant_id is never swapped.
- Add a firewall-level test that proves tenant_admin of Tenant A cannot read data from Tenant B via API calls.

---

### Rate Limiting Not Implemented

**Issue:** No rate limiting middleware is present in the Hono app (`packages/api/src/app.ts`). The API is exposed to:

- Brute-force attacks on auth endpoints (validate-token, resolve-tenant).
- Resource exhaustion on expensive queries (inventory lists, quote calculations).
- Denial-of-service via bulk operations (creating 10,000 customers in rapid succession).

**Files:** None (missing feature)

**Impact:**

- A malicious actor (or buggy client) can hammer the API without throttling.
- Lambda/Neon connection limits could be exhausted.
- Tenant data could be crawled/scraped without friction.

**Recommendations:**

- Implement rate limiting middleware (e.g., via Redis, DynamoDB, or in-memory with sliding windows).
- Apply stricter limits to auth endpoints (resolve-tenant, validate-token): 10 req/min per email domain.
- Apply moderate limits to data endpoints: 100 req/min per authenticated user.
- Return `429 Too Many Requests` with retry-after header.

---

## Performance Bottlenecks

### Prisma Query N+1 Patterns in Repositories

**Issue:** Repository functions (e.g., `packages/api/src/repositories/move.repository.ts`) perform common operations like fetching moves with related data. If `include` is not specified carefully, the ORM may execute multiple queries.

**Example Pattern (potential issue):**

```typescript
// In a handler:
const moves = await db.move.findMany({ where: { tenantId } })
// Then later:
for (const move of moves) {
  const quote = await db.quote.findUnique({ where: { moveId: move.id } })
  // ^ Each iteration is another query
}
```

**Files:**

- `packages/api/src/repositories/move.repository.ts` (185 lines)
- `packages/api/src/repositories/quote.repository.ts` (155 lines)
- `packages/api/src/repositories/customer.repository.ts` (196 lines)

**Impact:**

- List endpoints (GET /moves) could issue hundreds of queries for large datasets.
- Page load time degrades as tenant data grows.

**Current mitigation:** Repositories are written to include common relations upfront.

**Recommendations:**

- Profile API handlers with production-scale data (10,000+ moves, customers) using Lambda X-Ray or CloudWatch logs.
- Add indexes on foreign keys and frequently-filtered columns (tenantId, customerId, status).
- Consider caching read-heavy queries with Redis.

---

### MSSQL Connection Pool Overhead

**Issue:** `packages/api/src/handlers/pegii/middleware.ts` opens a new MSSQL connection pool per tenant on each Lambda invocation. For a Lambda handling 100 tenants, this creates 100 pools.

**Files:**

- `packages/api/src/handlers/pegii/middleware.ts` — Pool creation logic

**Impact:**

- Memory usage scales with number of tenants.
- Cold starts are slow (opening dozens of MSSQL connections).
- Connection timeouts could occur if Neon or the MSSQL server is slow.

**Recommendations:**

- Implement a connection pool cache: reuse pools across warm invocations (singleton pattern).
- Set a TTL on pools (e.g., close after 5 minutes of inactivity).
- Add health checks (e.g., `SELECT 1`) to detect stale connections before use.

---

## Fragile Areas

### Hono Middleware Stack — Tenant Resolution is Critical

**Issue:** The tenant middleware stack in `packages/api/src/middleware/tenant.ts` is responsible for:

1. Resolving `tenantId` from JWT claims or SSO provider config.
2. Creating the scoped Prisma client for the request.
3. Extracting the user role for RBAC.

A bug here affects all tenant-facing requests. The middleware:

- Reads `tenantId` from the JWT, then verifies it exists in the DB (prevents phantom tenants).
- Falls back to domain-based tenant lookup during SSO (`emailDomains` array).

**Files:**

- `packages/api/src/middleware/tenant.ts` (complex, ~100 lines)
- `packages/api/src/middleware/correlation.ts` (reads/sets correlation ID)
- `packages/api/src/middleware/rbac.ts` (role-based access control)

**Why fragile:**

- Multi-pass resolution logic (JWT → DB lookup → domain fallback).
- If `c.set('tenantId', ...)` fails, the scoped DB client is invalid but the request proceeds.
- No explicit error case if tenant is in SUSPENDED or ARCHIVED status (handled at the end of middleware, but could be missed).

**Safe modification:**

- Keep middleware resolution atomic: resolve and validate in one step, then fail fast.
- Add comprehensive middleware tests (already exists: `packages/api/src/__tests__/optional-auth.test.ts`).
- Use TypeScript's strict mode to catch incomplete tenant state.

**Test coverage:** Middleware tests exist but focus on auth flow; tenant isolation edge cases need more coverage.

---

### Database Schema — Enums Without Constraints

**Issue:** The Prisma schema defines enums (MoveStatus, StopType, QuoteStatus, etc.) but does not add PostgreSQL constraints to prevent invalid values being inserted via raw SQL or direct schema manipulation.

**Files:**

- `packages/api/prisma/schema.prisma` — Enum definitions (lines 28–100+)

**Impact:**

- A data corruption script or manual intervention could insert invalid status values (e.g., `PENDING_REVIEW` instead of `PENDING`).
- Domain logic that switches on status values assumes the enum is trustworthy; invalid values bypass validation.

**Recommendations:**

- Ensure all enum fields have `NOT NULL` and add a CHECK constraint in the migration (e.g., `CHECK (status IN ('PENDING', 'SCHEDULED', ...))` if Prisma does not auto-generate this).
- Verify that Prisma's generated client rejects invalid enum values at runtime.

---

### RBAC Not Enforced on All Routes

**Issue:** The auth handler comment in `packages/api/src/handlers/sso.ts` (lines 23–24) states:

> Phase 5 will add an RBAC check so only tenant_admin users can call these endpoints.

Currently, any authenticated tenant user can:

- POST /api/v1/sso/providers (create an SSO IdP)
- PUT /api/v1/sso/providers/:id (modify an SSO IdP)
- DELETE /api/v1/sso/providers/:id (delete an SSO IdP)

**Files:**

- `packages/api/src/handlers/sso.ts` (no `requireRole(['tenant_admin'])` wrapper)
- `packages/api/src/middleware/rbac.ts` (the middleware exists, just not applied)

**Impact:**

- A non-admin user can reconfigure the tenant's SSO settings, locking out the tenant_admin.
- User/role management endpoints are protected (`packages/api/src/handlers/users.ts` has `requireRole(['tenant_admin'])`), but SSO is not.

**Fix approach:**

- Add `requireRole(['tenant_admin'])` middleware to all SSO routes.
- Add tests to verify non-admin users get 403 Forbidden.

---

## Known Bugs

### Type Safety Issue in Cognito Pre-Token Lambda Test

**Issue:** The `makeEvent` test helper in `packages/api/src/cognito/pre-token.test.ts` casts the `response` field as `any` due to strict AWS Lambda types requiring `claimsOverrideDetails` in a specific shape. This bypasses TypeScript's type checking on the response object.

**Files:**

- `packages/api/src/cognito/pre-token.test.ts` (uses `response as any`)

**Impact:**

- Test bugs could go undetected (e.g., returning the wrong claim structure).
- The test may not catch actual Lambda invocation errors.

**Fix approach:**

- Import the correct response type from `@types/aws-lambda` and build a compliant response object.
- Remove the `as any` cast by fully typing the response.

---

### Prisma Optional Property Type Mismatch

**Issue:** When using nested relation creates (`origin: { create: ... }`) or updates, Prisma's type system can produce confusing errors with `exactOptionalPropertyTypes` enabled. The MEMORY.md documents a workaround:

> For optional Zod fields passed to Prisma: build a clean object `const p: { name?: string } = {}; if (v.name) p.name = v.name` before passing to avoid `string | undefined` vs `string` mismatch.

This is a known friction point that requires developer awareness to work around.

**Files:**

- `packages/api/src/handlers/**/*.ts` (any handler that creates/updates with nested relations)

**Workaround:** Use the spread pattern documented in MEMORY.md.

**Fix approach:**

- Consider downgrading `exactOptionalPropertyTypes` if it causes more pain than benefit, OR
- Wrap Prisma input builders in a helper that coerces the types cleanly.

---

### Mock Overload Errors in Vitest

**Issue:** `vi.mocked(db.tenantUser.findFirst)` can cause TypeScript overload errors when the mocked function has multiple signatures. The workaround is:

```typescript
(db.tenantUser.findFirst as any).mockResolvedValue(...)
```

**Files:**

- Tests across `packages/api/src/**/*.test.ts` that mock Prisma methods

**Impact:**

- Developers must remember to cast as `any` when mocking Prisma functions, or test compilation fails.
- Reduces type safety in test code.

**Fix approach:**

- Create a test utility that wraps vi.mocked for Prisma clients, hiding the cast.
- Or upgrade Vitest/Typescript if a newer version fixes this issue.

---

## Test Coverage Gaps

### E2E Browser Tests Are Minimal

**Issue:** The Playwright E2E suite in `apps/e2e/` has:

- API acceptance tests: `tests/api/{health,customers,moves,quotes}.spec.ts` (basic coverage)
- Browser tests: `tests/browser/landing.spec.ts` (single test file, landing page only)

**Impact:**

- Full user workflows (login → create quote → accept → invoice) are not tested end-to-end.
- UI regressions in critical paths (form submission, data tables, navigation) are not caught.
- New features on the frontend are deferred to manual QA.

**Fix approach:**

- Add browser tests for:
  - SSO login flow (multi-provider)
  - Create/edit customer workflow
  - Create quote → accept quote → invoice workflow
  - Move dispatch (status transitions)
  - Inventory tracking
- Use Playwright's auth fixtures to speed up tests (avoid re-login on every test).

---

### PEGII/EFWK Domain Handlers Have Zero Unit Tests

**Issue:** Each PEGII/EFWK domain directory (account, sale, billing, etc.) defines entity configurations and search keywords, but none have test files verifying:

- SQL query generation is correct.
- Search keyword parsing produces valid SQL.
- Error handling (MSSQL errors) is graceful.
- Pagination and sorting work.

**Files:**

- `packages/api/src/handlers/pegii/domains/*.ts` (account, billing, budget, crew, driver, employee, lead, local-dispatch, sale, survey, vehicle, warehouse, etc.)
- `packages/api/src/handlers/efwk/domains/*.ts` (gl, portal, atlas, email, flat-rate, loans, settings, sale, text-messaging, text-templates)

**Impact:**

- Changes to the entity factory or SQL generation logic could break multiple domains.
- MSSQL query injection vulnerabilities are not tested.

**Fix approach:**

- Create a parametrized test suite that exercises representative domains (sale, customer, account).
- Test SQL generation, pagination, sorting, and search.

---

### Postgres-Specific Features Not Tested

**Issue:** The schema uses PostgreSQL-specific features (UUID-OSSP extension, custom schemas), but the local test setup does not verify these features are available.

**Files:**

- `packages/api/prisma/schema.prisma` (line 20: `extensions = [uuidOssp(...)]`)
- `packages/api/vitest.config.ts` (test environment setup)

**Impact:**

- Migrations may fail in a Neon environment if the UUID-OSSP extension is not enabled.
- Dual-schema support (public + platform) might not work if the database does not support schema separation.

**Recommendations:**

- Add a pre-migration check in the deployment script to enable required extensions.
- Document the Neon setup requirements (schema permissions, extensions).

---

## Missing Critical Features

### No Audit Trail for Sensitive Operations

**Issue:** The platform performs sensitive operations (create tenant, invite user, change SSO config, issue API keys) but does not log these to an audit table. There is an `AuditLog` model in the schema, but it is not used in the handlers.

**Files:**

- `packages/api/prisma/schema.prisma` — `AuditLog` model exists but unused
- `packages/api/src/handlers/admin/audit.ts` — Placeholder for audit API (no implementation)

**Impact:**

- Compliance audits cannot track who made what changes.
- Security incident investigation is blind (no trail of who provisioned a rogue SSO provider).
- Tenant admins cannot audit user invitations or role changes within their account.

**Fix approach:**

- Create an audit middleware that logs all POST/PUT/DELETE operations to AuditLog.
- Include: user ID, timestamp, operation, resource type, old/new values (for updates), and result (success/failure).
- Phase: Add audit log querying endpoints (`GET /api/admin/audit-logs`).

---

### No Graceful Degradation for MSSQL Outage

**Issue:** If the MSSQL database is unavailable, PEGII/EFWK requests fail immediately. There is no fallback, retry, or circuit-breaker pattern.

**Files:**

- `packages/api/src/handlers/pegii/middleware.ts` (connection pool creation, no retry logic)

**Impact:**

- A brief MSSQL outage causes the entire PEGII/EFWK surface to fail.
- Users see raw error messages instead of friendly "service unavailable" responses.

**Recommendations:**

- Implement exponential backoff and retry logic on MSSQL connection failures (e.g., 3 retries with 100ms–1000ms delays).
- Add a circuit-breaker pattern: if MSSQL fails consistently, return `503 Service Unavailable` with a user-friendly message.
- Log all MSSQL failures to CloudWatch for alerting.

---

### No Secrets Rotation Automation

**Issue:** Secrets (DATABASE_URL, COGNITO_JWKS_URL, COGNITO_USER_POOL_ID, Secrets Manager ARNs) are manually injected into Lambda environment variables at deploy time. There is no automated rotation or version management.

**Files:**

- `packages/infra/lib/stacks/api.stack.ts` (where secrets are injected via CDK)

**Impact:**

- If a secret is compromised, rotation requires a full redeployment.
- Secrets in environment variables are visible in Lambda console (if IAM allows).
- No audit trail of when/who rotated secrets.

**Recommendations:**

- Use AWS Secrets Manager for all secrets (not environment variables).
- Enable automatic rotation for supported secrets (RDS credentials).
- Reference secrets by ARN in Lambda environment, then resolve at runtime.

---

## Scaling Limits

### Lambda Memory and Timeout

**Issue:** The API Lambda runs on a default configuration (likely 1024 MB memory, 30-second timeout). As the codebase grows (more handlers, larger Prisma schema), cold-start time and query execution time increase.

**Files:**

- `packages/infra/lib/stacks/api.stack.ts` (Lambda function definition)

**Current capacity:**

- Cold start: ~5–10 seconds (Prisma schema generation, Node bundle loading).
- Warm start: ~500ms.
- Timeout: Default API Gateway timeout (29 seconds) leaves little margin for long-running queries.

**Scaling path:**

- Monitor Lambda X-Ray traces and CloudWatch metrics (Duration, Throttles, Errors).
- Increase memory to 2048 MB if cold starts exceed 10 seconds or queries are timing out.
- Consider Lambda SnapStart (if Java is not ruled out) to eliminate cold starts.
- Investigate slow queries and add indexes or caching.

---

### Neon Connection Pool Limits

**Issue:** The pooled connection string (DATABASE_URL) from Neon has a default connection limit (typically 100). Each Lambda invocation may open a connection; under high load, the pool could be exhausted.

**Files:**

- `packages/api/src/db.ts` (PrismaClient initialization)
- `packages/infra/lib/stacks/database.stack.ts` (Neon configuration)

**Impact:**

- Concurrent requests > 100 will fail with `ECONNREFUSED` or pool timeout errors.
- Tenants with multiple PEGII/EFWK connections could exhaust the pool faster.

**Recommendations:**

- Set `connection_limit` in the Prisma client configuration to a safe value (e.g., 20 per Lambda, accounting for reserved connections).
- Use connection pooling at the application level (already done via Neon's pooled connection string).
- Monitor Neon metrics (connection count, pool wait time) via the Neon dashboard.
- Scale horizontally: add read replicas for read-heavy workloads.

---

### MSSQL Connection Pool Per Tenant

**Issue:** The MSSQL middleware creates one pool per tenant per Lambda invocation. If a single Lambda handles requests for 50 tenants, it opens 50 pools, each consuming memory and file descriptors.

**Current capacity:**

- Each pool: ~5 MB memory + file descriptors per open connection.
- 50 tenants × 5 MB = 250 MB, leaving only ~774 MB for the app if Lambda has 1024 MB.

**Scaling path:**

- Implement a shared connection pool cache (singleton across warm invocations).
- Set a TTL on pools (e.g., close after 5 minutes of inactivity).
- Monitor file descriptor limits (`ulimit -n`).
- Consider a dedicated MSSQL proxy/router if the legacy system can be isolated to a separate tier.

---

## Dependencies at Risk

### AWS SDK Versions Not Pinned

**Issue:** The AWS SDK packages (e.g., `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-secrets-manager`) are used throughout the codebase but may not be pinned to specific versions in `packages/api/package.json`. Major version bumps could introduce breaking changes.

**Files:**

- `packages/api/src/handlers/users.ts` (uses CognitoIdentityProviderClient)
- `packages/api/src/handlers/sso.ts` (uses CognitoIdentityProviderClient)
- `packages/api/src/cognito/pre-token.ts` (uses Cognito SDK)

**Risk:**

- Upgrading AWS SDK major versions could break Cognito interactions (e.g., changed request/response shapes).
- Security patches to AWS SDK may not be automatically applied.

**Recommendations:**

- Pin AWS SDK packages to specific minor versions (e.g., `^5.1.0`, not `^5.0.0`).
- Use Dependabot to monitor for security updates.
- Test AWS SDK upgrades in a staging environment before production deployment.

---

### Prisma Schema Migrations Are Sequential

**Issue:** Prisma migrations are applied sequentially and stored in the `migrations/` folder. If a migration is lost or corrupted, the entire migration chain breaks.

**Files:**

- `packages/api/prisma/migrations/` (8 migrations, ~672 lines total)

**Risk:**

- Migration files are version-controlled; if accidentally deleted or edited, `prisma migrate` will fail with a checksum mismatch.
- Database state can drift from the schema if migrations are not run (e.g., in a manual database setup).

**Recommendations:**

- Treat migration files as immutable (never edit a committed migration; create a new one instead).
- Add a pre-deploy check: `prisma migrate deploy --preview-feature` to verify all migrations will apply cleanly.
- Backup the database before each production migration.

---

## Summary of Immediate Actions

**High Priority (Blocks Deployment):**

1. Add RBAC (`requireRole(['tenant_admin'])`) to SSO endpoints.
2. Move MSSQL connection strings to AWS Secrets Manager instead of plaintext in the DB.
3. Verify tenant isolation is enforced in PEGII/EFWK handlers.

**Medium Priority (Next Sprint):** 4. Add integration tests for 5+ representative PEGII/EFWK domains. 5. Implement rate limiting middleware. 6. Add audit logging for sensitive operations.

**Low Priority (Backlog):** 7. Expand frontend component test coverage to 60%. 8. Add circuit-breaker/retry logic for MSSQL failures. 9. Implement secrets rotation automation.

---

_Concerns audit: 2026-03-27_
