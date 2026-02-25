# Failing Tests Fix Plan

## How to Use This Plan

Each step has a **Completion check** — run it first to skip already-done steps.
Steps are ordered by complexity: simplest first. Each step is independent and
can be completed separately. After each step, run all tests and commit if the
suite is no better than the expected residual count.

### Tests vs Code bugs

Same policy as PLAN.md: if a test fails because the **code** is wrong, fix the
code. If a test fails because the **test** is wrong (stale expectation, wrong
mock, misunderstood contract), fix the test. When in doubt, assume the test is
right.

---

## All Failing Tests at a Glance

| #    | File                                                   | Test                                                                   | Root cause                                                                                                             | Fix target |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1    | `packages/api/src/app.test.ts`                         | `POST /api/admin/tenants > returns 201 with the created tenant`        | Body missing required `adminEmail` + `emailDomains`; Cognito SDK not mocked                                            | Test       |
| 2    | `packages/api/src/app.test.ts`                         | `POST /api/admin/tenants > returns 409 when the slug is already taken` | Same as above                                                                                                          | Test       |
| 3    | `packages/api/src/cognito/pre-auth.test.ts`            | `blocks sign-in when USER_POOL_ID env var is not set`                  | Test deletes a non-existent env var instead of triggering the actual guard (empty `userPoolId` on the event)           | Test       |
| 4    | `apps/admin/src/__tests__/TenantFormDialog.test.tsx`   | `submit button is disabled when required fields are empty`             | Submit button is only `disabled={isPending}`, never based on field emptiness                                           | Code       |
| 5–12 | `packages/api/src/__tests__/tenant-middleware.test.ts` | 8 tests (all header-based)                                             | Middleware was rewritten from slug-based resolution to JWT/Bearer authentication; tests still expect the old behaviour | Test       |

**Baseline before this plan:** 12 failing (11 in `@pegasus/api`, 1 in `@pegasus/admin`).

---

## Step 1 — `app.test.ts`: Fix POST /api/admin/tenants bodies (2 tests)

### Completion check

```bash
grep -c "adminEmail" packages/api/src/app.test.ts | xargs -I{} test {} -gt 1 && echo DONE || echo TODO
```

### Root cause

The `CreateTenantBody` Zod schema (in `handlers/admin/tenants.ts`) requires two
fields that were added after the tests were written:

- `adminEmail` — triggers Cognito user provisioning
- `emailDomains` — array, at least one entry required

Both test bodies only contain `name` + `slug`, so validation returns 400 before
any DB call is made.

Additionally, the handler calls `provisionCognitoAdminUser(body.adminEmail)`
before touching the DB. That function reads `process.env['COGNITO_USER_POOL_ID']`
and calls the Cognito SDK. Neither is mocked in `app.test.ts`, so even after
adding the missing fields the handler would return 500 `COGNITO_ERROR`.

### Changes

**File:** `packages/api/src/app.test.ts`

**Change 1 — Add a file-level Cognito SDK mock** (alongside the existing `vi.mock` calls at the top of the file):

```ts
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
  AdminCreateUserCommand: vi.fn(),
}))
```

**Change 2 — Set `COGNITO_USER_POOL_ID` in the `POST /api/admin/tenants` describe block** (add a `beforeEach`/`afterEach` pair, or extend the existing global one):

```ts
describe('POST /api/admin/tenants', () => {
  beforeEach(() => {
    process.env['COGNITO_USER_POOL_ID'] = 'us-east-1_test'
  })
  afterEach(() => {
    delete process.env['COGNITO_USER_POOL_ID']
  })
  // ...existing tests...
})
```

**Change 3 — Add missing fields to the two failing test bodies:**

Line 1109 — "returns 201 with the created tenant":

```ts
// Before:
body: JSON.stringify({ name: 'Beta Movers', slug: 'beta' }),
// After:
body: JSON.stringify({ name: 'Beta Movers', slug: 'beta', adminEmail: 'admin@beta.com', emailDomains: ['beta.com'] }),
```

Line 1170 — "returns 409 when the slug is already taken":

```ts
// Before:
body: JSON.stringify({ name: 'Duplicate', slug: 'acme' }),
// After:
body: JSON.stringify({ name: 'Duplicate', slug: 'acme', adminEmail: 'admin@acme.com', emailDomains: ['acme.com'] }),
```

Also update `mockCreatedTenant` (line 1069) to add the `emailDomains` field so
the response shape passes the `data['slug']` assertions:

```ts
const mockCreatedTenant = {
  // ...existing fields...
  emailDomains: ['beta.com'], // add this
}
```

### Run & commit

```bash
npm test

# Verify: app.test.ts gains 2 passes. api baseline 11 → 9 failing. No new failures.
git add packages/api/src/app.test.ts
git commit -m "fix(test): add missing adminEmail/emailDomains and Cognito mock to POST tenant tests"
```

---

## Step 2 — `pre-auth.test.ts`: Fix failing guard test (1 test)

### Completion check

```bash
grep -q "userPoolId: ''" packages/api/src/cognito/pre-auth.test.ts && echo DONE || echo TODO
```

### Root cause

The test "blocks sign-in when USER_POOL_ID env var is not set" (line 159) intends
to verify the fail-closed guard at `pre-auth.ts:49`:

```ts
if (!userPoolId || !userName) {
  throw new Error('Authentication configuration error. Please contact support.')
}
```

But the guard checks `event.userPoolId`, not an env var. The test deletes
`process.env['USER_POOL_ID']` — a variable the code never reads — so the guard
is never triggered. `makeEvent('any-user')` always supplies `userPoolId: 'us-east-1_test'`.
With no guard hit and `mockSend` unconfigured, `send()` returns `undefined`,
causing a `TypeError` inside the `Promise.all`, which the catch block re-throws
as "Authentication check failed…" — not the expected string.

The test also asserts `expect(mockSend).not.toHaveBeenCalled()`, which is correct
for the intended code path but currently fails because `mockSend` IS called.

### Changes

**File:** `packages/api/src/cognito/pre-auth.test.ts`

Replace lines 159–166:

```ts
// Before:
it('blocks sign-in when USER_POOL_ID env var is not set', async () => {
  delete process.env['USER_POOL_ID']

  await expect(handler(makeEvent('any-user'), fakeContext, fakeCallback)).rejects.toThrow(
    'Authentication configuration error',
  )
  expect(mockSend).not.toHaveBeenCalled()
})

// After:
it('blocks sign-in when userPoolId is missing from the trigger event', async () => {
  const event = { ...makeEvent('any-user'), userPoolId: '' }

  await expect(
    handler(event as Parameters<typeof handler>[0], fakeContext, fakeCallback),
  ).rejects.toThrow('Authentication configuration error')
  expect(mockSend).not.toHaveBeenCalled()
})
```

The expected error string `'Authentication configuration error'` is unchanged —
it already matches the substring in the code's thrown message. Only the setup
changes: we pass an event with an empty `userPoolId` instead of deleting a
non-existent env var.

Also remove `process.env['USER_POOL_ID'] = 'us-east-1_test'` from the
`beforeEach` at line 76-77 — it sets a var the code never reads and is
misleading:

```ts
// Before:
beforeEach(() => {
  mockSend.mockReset()
  process.env['USER_POOL_ID'] = 'us-east-1_test'
})

// After:
beforeEach(() => {
  mockSend.mockReset()
})
```

### Run & commit

```bash
npm test

# Verify: pre-auth.test.ts gains 1 pass. api baseline 11 → 8 failing. No new failures.
git add packages/api/src/cognito/pre-auth.test.ts
git commit -m "fix(test): trigger pre-auth guard via empty event.userPoolId instead of non-existent env var"
```

---

## Step 3 — `TenantFormDialog.tsx`: Disable submit when required fields are empty (1 test)

### Completion check

```bash
grep -q "isFormValid" apps/admin/src/components/TenantFormDialog.tsx && echo DONE || echo TODO
```

### Root cause

The submit button is `disabled={isPending}` only. It is never disabled based on
whether required fields are filled. The test correctly specifies that the button
should be disabled when the form is empty; this is a code bug.

Required fields in create mode: `name`, `slug`, `adminEmail`, `emailDomains`
(at least one domain after parsing). In edit mode: `name` only.

### Changes

**File:** `apps/admin/src/components/TenantFormDialog.tsx`

Add a derived boolean after the `isPending` declaration (around line 204):

```ts
const isFormValid =
  mode === 'create'
    ? create.name.trim() !== '' &&
      create.slug.trim() !== '' &&
      create.adminEmail.trim() !== '' &&
      parseDomains(create.emailDomains).length > 0
    : edit.name.trim() !== ''
```

Update the submit button's `disabled` prop (around line 482):

```tsx
// Before:
disabled={isPending}

// After:
disabled={isPending || !isFormValid}
```

### Run & commit

```bash
npm test

# Verify: TenantFormDialog "submit button disabled" test passes. admin 1 → 0 failing.
git add apps/admin/src/components/TenantFormDialog.tsx
git commit -m "fix: disable TenantFormDialog submit button when required fields are empty"
```

---

## Step 4 — `tenant-middleware.test.ts`: Rewrite for JWT-based middleware (8 tests)

### Completion check

```bash
grep -q "mockJwtVerify\|jwtVerify" packages/api/src/__tests__/tenant-middleware.test.ts && echo DONE || echo TODO
```

### Root cause

`tenantMiddleware` was completely rewritten from slug-based resolution
(Host subdomain / `X-Tenant-Slug` header) to JWT/Bearer authentication.
The new implementation:

1. Requires `Authorization: Bearer <token>`; returns 401 `UNAUTHORIZED` if absent or malformed
2. Calls `jwtVerify(token, jwks, { issuer, audience })` from `jose`
3. Returns 401 `TOKEN_EXPIRED` if the token is expired; 401 `UNAUTHORIZED` for other JWT errors
4. Returns 401 `UNAUTHORIZED` if `payload.token_use !== 'id'`
5. Returns 403 `FORBIDDEN` if `custom:tenantId` or `custom:role` claims are absent
6. Looks up the tenant by `custom:tenantId`; returns 404 `TENANT_NOT_FOUND` if not found
7. Returns 403 `TENANT_SUSPENDED` or 404 `TENANT_NOT_FOUND` for non-ACTIVE tenants
8. On success: sets `tenantId`, `role`, and `db` in context; calls `next()`

All 8 failing tests send no `Authorization` header (old header-based slug
pattern), so the middleware always returns 401 at step 1 before any of the
previously-tested logic runs.

The 1 currently-passing test ("does not expose OFFBOARDED status in the response
body") passes coincidentally — the 401 response doesn't contain the word
"OFFBOARDED" — but it too must be rewritten.

### Changes

**File to rewrite:** `packages/api/src/__tests__/tenant-middleware.test.ts`

Keep the existing `vi.mock('../db', ...)` and `vi.mock('../lib/prisma', ...)` mocks.
Add a hoisted `jose` mock. Add env var management. Replace all test bodies.

**Mock additions required:**

```ts
// Hoist the jwtVerify mock function above all imports
const { mockJwtVerify } = vi.hoisted(() => ({ mockJwtVerify: vi.fn() }))

// Mock jose — spread actual exports to preserve errors.JWTExpired class,
// override only createRemoteJWKSet and jwtVerify
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
    jwtVerify: mockJwtVerify,
  }
})
```

**Env var setup (replace or extend the existing `beforeEach`):**

```ts
beforeEach(() => {
  process.env['COGNITO_JWKS_URL'] =
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test/.well-known/jwks.json'
  process.env['COGNITO_TENANT_CLIENT_ID'] = 'tenant-client-id'
  mockJwtVerify.mockReset()
  vi.mocked(db.tenant.findUnique).mockReset()
})

afterEach(() => {
  delete process.env['COGNITO_JWKS_URL']
  delete process.env['COGNITO_TENANT_CLIENT_ID']
})
```

**Helper additions:**

```ts
// Returns RequestInit with a Bearer token
function bearerRequest(opts: RequestInit = {}): RequestInit {
  return { ...opts, headers: { Authorization: 'Bearer mock-token', ...opts.headers } }
}

// Configures mockJwtVerify to resolve with valid tenant claims
function mockValidToken(tenantId = 'tenant-uuid', role = 'tenant_user') {
  mockJwtVerify.mockResolvedValueOnce({
    payload: { token_use: 'id', 'custom:tenantId': tenantId, 'custom:role': role },
  })
}
```

**Update probe endpoint** to expose `role` so tests can assert on it:

```ts
app.get('/probe', (c) => c.json({ tenantId: c.get('tenantId'), role: c.get('role') }))
```

**New test cases** (replace all existing tests in the describe block):

```
// ── Authorization header checks ────────────────────────────────────────────
- returns 401 UNAUTHORIZED when Authorization header is absent
- returns 401 UNAUTHORIZED when Authorization header is not Bearer scheme
- returns 401 UNAUTHORIZED when JWT fails verification (invalid signature)
- returns 401 TOKEN_EXPIRED when JWT is expired (jwtVerify throws JWTExpired)
- returns 401 UNAUTHORIZED when token_use claim is not 'id' (access token used)

// ── Missing claims ─────────────────────────────────────────────────────────
- returns 403 FORBIDDEN when custom:tenantId claim is absent
- returns 403 FORBIDDEN when custom:role claim is absent

// ── Tenant DB lookup ───────────────────────────────────────────────────────
- returns 404 TENANT_NOT_FOUND when no tenant matches the tenantId claim

// ── Tenant status enforcement ─────────────────────────────────────────────
- passes request through and sets tenantId + role for ACTIVE tenant
- returns 403 TENANT_SUSPENDED for SUSPENDED tenant
- returns 404 TENANT_NOT_FOUND for OFFBOARDED tenant
- does not expose OFFBOARDED status in the response body for OFFBOARDED tenant
```

**JWTExpired mock note:** To simulate an expired token, construct the error from
the real class (preserved via `importOriginal` in the mock):

```ts
import { errors } from 'jose'

const expired = new errors.JWTExpired('token expired')
mockJwtVerify.mockRejectedValueOnce(expired)
```

### Run & commit

```bash
npm test

# Verify: tenant-middleware.test.ts all pass. api baseline 11 → 0 failing.
# Confirm no new failures in any other package.
git add packages/api/src/__tests__/tenant-middleware.test.ts
git commit -m "fix(test): rewrite tenant-middleware tests for JWT Bearer authentication"
```

---

## Completion Summary

| Step                                 | File(s)                                                | Tests fixed | Status  |
| ------------------------------------ | ------------------------------------------------------ | ----------- | ------- |
| 1 — POST tenant body + Cognito mock  | `packages/api/src/app.test.ts`                         | 2           | ✅ DONE |
| 2 — pre-auth guard trigger           | `packages/api/src/cognito/pre-auth.test.ts`            | 1           | ✅ DONE |
| 3 — TenantFormDialog submit disabled | `apps/admin/src/components/TenantFormDialog.tsx`       | 1           | ✅ DONE |
| 4 — Tenant middleware rewrite        | `packages/api/src/__tests__/tenant-middleware.test.ts` | 8           | ✅ DONE |

**Target after all steps:** 0 failing tests across all packages.

## Implementation Notes

- Step 1: The plan suggested `vi.fn(() => ({ send: vi.fn() }))` for the Cognito constructor mock. This
  pattern doesn't work correctly in Vitest when the mock is used as a constructor (the spy doesn't
  forward the factory's return value as the `new` result). Used a plain class instead:
  ```ts
  class MockCognitoClient {
    send() {
      return Promise.resolve({})
    }
  }
  ```
- The 2 remaining `apps/admin/src/__tests__/cognito.test.ts` failures are pre-existing and not part
  of this plan (confirmed by `git stash` test run).
