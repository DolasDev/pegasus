# Phase 6: Fix Mobile Token Validation — Research

**Researched:** 2026-03-30
**Domain:** Cognito JWT audience validation, Hono auth handler, mobile Session type
**Confidence:** HIGH

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Update `jwtVerify` call in `packages/api/src/handlers/auth.ts` to accept an array: `audience: [tenantClientId, mobileClientId]` where `mobileClientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''`.
- **D-02:** Extend the existing env var guard (`if (!jwksUrl || !tenantClientId)`) to also check `mobileClientId`. If absent, return 500 with `INTERNAL_ERROR` (consistent with the existing guard pattern).
- **D-03:** No separate `/validate-mobile-token` endpoint. One endpoint handles both web and mobile tokens via the audience array.
- **D-04:** Commit the working-tree fix in `apps/mobile/src/auth/authService.ts`: request body is `{ idToken }` not `{ token: idToken }`. The code change is already in place — Phase 6 just commits it as part of the fix batch.
- **D-05:** Add `ssoProvider: string | null` to the `Session` type in `apps/mobile/src/auth/types.ts`. The API `validate-token` response already includes this field; the type was never updated to match.
- **D-06:** Write a full unit test suite for `POST /api/auth/validate-token` in `packages/api/src/handlers/auth.test.ts`. Coverage:
  - Tenant client ID accepted (200 with session claims)
  - Mobile client ID accepted (200 with session claims)
  - Unknown audience rejected (401 UNAUTHORIZED)
  - Expired token (401 TOKEN_EXPIRED)
  - Wrong `token_use` (access token) rejected (401 UNAUTHORIZED)
  - Missing `sub` or `email` claims (401 UNAUTHORIZED)
  - Missing `custom:tenantId` or `custom:role` claims (403 FORBIDDEN)
  - Env vars not set (500 INTERNAL_ERROR)
  - Invalid/unparseable JWT (401 UNAUTHORIZED)
- **D-07:** Tests mock `jwtVerify` from `jose` (already the pattern for isolated unit tests in this file). No real JWTs needed.

### Claude's Discretion

- Exact mock setup for `jwtVerify` (vi.mock pattern vs vi.spyOn)
- Whether to add `extractSsoProvider` helper tests inline or leave that as a side-effect of the validate-token tests
- Commit message structure (one commit vs two — BREAK-01 fix and API fix can be separate or combined)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                          | Research Support                                                                                     |
| ------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| AUTH-03 | Mobile driver can authenticate end-to-end: mobile-config fetch → SRP → validate-token → Session | All four tasks collectively close this gap: BREAK-01 commit, audience array fix, Session type fix, test suite |

</phase_requirements>

---

## Implementation Analysis

### validate-token Handler (`packages/api/src/handlers/auth.ts`)

**Env guard (lines 392–398) — current code:**
```typescript
const jwksUrl = process.env['COGNITO_JWKS_URL'] ?? ''
const tenantClientId = process.env['COGNITO_TENANT_CLIENT_ID'] ?? ''

if (!jwksUrl || !tenantClientId) {
  logger.error('validate-token: COGNITO_JWKS_URL or COGNITO_TENANT_CLIENT_ID not set')
  return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
}
```

**jwtVerify call (lines 405–409) — current code (the bug):**
```typescript
const result = await jwtVerify(idToken, getJwks(), {
  issuer: deriveIssuer(jwksUrl),
  audience: tenantClientId,          // <-- single string; rejects mobile tokens
  algorithms: ['RS256'],
})
```

**Required change for D-01 + D-02:**
```typescript
const mobileClientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''

if (!jwksUrl || !tenantClientId || !mobileClientId) {
  logger.error('validate-token: COGNITO_JWKS_URL, COGNITO_TENANT_CLIENT_ID, or COGNITO_MOBILE_CLIENT_ID not set')
  return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
}

// ...

const result = await jwtVerify(idToken, getJwks(), {
  issuer: deriveIssuer(jwksUrl),
  audience: [tenantClientId, mobileClientId],   // <-- array; accepts both clients
  algorithms: ['RS256'],
})
```

**Full response shape (lines 469–481):**
```typescript
const session = {
  sub,
  tenantId: customTenantId,
  role: customRole,
  email,
  expiresAt,
  ssoProvider: extractSsoProvider(payload),
}
return c.json({ data: session })
```

The API already returns `ssoProvider` at line 477. The Session type in mobile just never had it.

**Error paths in the handler:**
- `JWTExpired` → 401 `TOKEN_EXPIRED`
- All other jose errors → 401 `UNAUTHORIZED`
- `token_use !== 'id'` → 401 `UNAUTHORIZED`
- missing `sub` or `email` → 401 `UNAUTHORIZED`
- missing `custom:tenantId` or `custom:role` → 403 `FORBIDDEN`
- env guard not met → 500 `INTERNAL_ERROR`

### Existing Test Patterns (`packages/api/src/handlers/auth.test.ts`)

**File total: 396 lines.** New validate-token describe block appends after line 396.

**Structure:**
- `vi.hoisted()` block at top declares all db mock functions (lines 18–30)
- `vi.mock('../db', ...)` sets up Prisma mock (lines 32–44)
- Helpers: `json(res)`, `post(body)`, `makeTenantUserWithTenant(...)`, `makeTenantRow(...)` (lines 50–95)
- Three `describe` blocks: `POST /api/auth/resolve-tenants` (line 101), `POST /api/auth/select-tenant` (line 216), `GET /api/auth/mobile-config` (line 347)
- Each block uses `beforeEach(() => vi.clearAllMocks())` and `afterEach(() => vi.unstubAllEnvs())` where env stubs are used

**`vi.stubEnv` pattern (from mobile-config tests, lines 349–354):**
```typescript
describe('GET /api/auth/mobile-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('COGNITO_USER_POOL_ID', 'us-east-1_TestPool')
    vi.stubEnv('COGNITO_MOBILE_CLIENT_ID', 'test-mobile-client-id')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })
  // ...
})
```

**validate-token section is absent.** The `auth.test.ts` file ends at line 396 with the closing `})` of the mobile-config describe block. The new describe block inserts at line 397.

**jose is NOT currently mocked in auth.test.ts.** The validate-token handler calls `jwtVerify` and `getJwks()`. Both must be mocked for unit tests that don't make real JWKS HTTP calls.

The `vi.hoisted()` + `vi.mock('jose', ...)` approach is needed because `auth.ts` imports `jwtVerify` at the top level. The mock must be hoisted above the import.

### BREAK-01 Fix (`authService.ts`)

**Git diff — exact lines changed:**
```diff
-   *  3. POST /api/auth/validate-token with { token: idToken } → { data: Session }
+   *  3. POST /api/auth/validate-token with { idToken } → { data: Session }
```
```diff
-      body: JSON.stringify({ token: idToken }),
+      body: JSON.stringify({ idToken }),
```

The fix is already in the working tree (confirmed by `git diff`). Line 71 was `body: JSON.stringify({ token: idToken })`, now reads `body: JSON.stringify({ idToken })`. The Zod schema in auth.ts line 81–84 requires `{ idToken: string }`, so `{ token: idToken }` would produce a `VALIDATION_ERROR` 400 response. The fix aligns the request payload with the schema.

This change is purely in `apps/mobile/src/auth/authService.ts`. No API changes needed for BREAK-01.

### Session Type (`apps/mobile/src/auth/types.ts`)

**Current Session type (lines 13–19):**
```typescript
export type Session = {
  sub: string
  tenantId: string
  role: string
  email: string
  expiresAt: number
}
```

**Field to add (D-05):**
```typescript
ssoProvider: string | null
```

The API `validate-token` response already includes `ssoProvider` (auth.ts line 477). Without this field in the type, TypeScript treats the deserialized session as lacking the field, but it will silently carry the value at runtime since `authService.ts` casts the response with `as { data: Session }`. Adding the field makes the type accurate and enables downstream code to use it.

**Downstream files that use Session and need mock updates:**

1. `apps/mobile/src/auth/authService.test.ts` — `mockSession` at line 5 does NOT include `ssoProvider`. Adding the field to the Session type will cause a TypeScript error on `mockSession`. Must add `ssoProvider: null` (or a string value) to the mock object.

2. `apps/mobile/src/context/AuthContext.test.tsx` — `mockSession` at line 20 does NOT include `ssoProvider`. Same issue — must add `ssoProvider: null`.

3. `apps/mobile/src/context/AuthContext.tsx` — uses `Session` as a type annotation only. No runtime property access on `ssoProvider`. No functional change needed, but TypeScript will see the field through the type.

**Summary of files to update for D-05:**
- `apps/mobile/src/auth/types.ts` — add field to type (1 line)
- `apps/mobile/src/auth/authService.test.ts` — add `ssoProvider: null` to `mockSession` (1 line)
- `apps/mobile/src/context/AuthContext.test.tsx` — add `ssoProvider: null` to `mockSession` (1 line)

### jose Version and Array Audience Support

**Version from `packages/api/package.json`:** `"jose": "^5.0.0"`

**Array audience support:** Confirmed. The jose v5 `JWTVerifyOptions.audience` is typed as `string | string[]`. Passing `audience: [tenantClientId, mobileClientId]` is valid. jose will accept a token if its `aud` claim matches ANY element of the array.

Source: [jose JWTVerifyOptions docs](https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md) — `audience?: string | string[]`

### AppEnv Type (`packages/api/src/types.ts`)

`COGNITO_MOBILE_CLIENT_ID` does NOT appear in `AppEnv` or `AppVariables`. The env var is accessed directly via `process.env['COGNITO_MOBILE_CLIENT_ID']` in the handler, consistent with how `COGNITO_JWKS_URL` and `COGNITO_TENANT_CLIENT_ID` are accessed. No type definition update needed — the handler reads env vars via `process.env[...]` without a typed env interface, the same pattern already used for the other two Cognito env vars.

Both `COGNITO_TENANT_CLIENT_ID` and `COGNITO_MOBILE_CLIENT_ID` are already declared in `packages/infra/lib/stacks/api-stack.ts` (lines 109 and 116) and passed to the Lambda environment at deploy time. No CDK changes needed.

---

## Risks and Mitigations

### Empty String Audience Risk

**Scenario:** If `COGNITO_MOBILE_CLIENT_ID` is not set in the environment, `process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''` produces an empty string `''`. If that empty string were passed in the audience array, jose would accept any token whose `aud` claim includes the empty string — this would not happen in practice since Cognito never issues tokens with `aud: ''`, but it is still incorrect behavior and constitutes a misconfigured server.

**Mitigation (D-02):** The env guard is extended to check `!mobileClientId` before the `jwtVerify` call. If the env var is absent, the handler returns 500 `INTERNAL_ERROR` before the audience array is ever constructed. The empty string is never passed to `jwtVerify`.

**Implementation note:** The env guard reads the env var first, then guards. The `mobileClientId` variable is used in both the guard and the `jwtVerify` call — declare it at the top alongside `jwksUrl` and `tenantClientId`.

### Session Type Propagation

**`ssoProvider` is not currently read by any application logic.** `AuthContext.tsx` stores the session to SecureStore as JSON and reads it back — the field will round-trip correctly after the type is updated. No guards or conditional logic references `ssoProvider`.

**Two test files have `mockSession` objects that will fail TypeScript compilation** once `Session` requires `ssoProvider`. Both are test-only changes (adding `ssoProvider: null` to the mock literal). No runtime logic changes.

**No other files in `apps/mobile/src/` reference `ssoProvider`.** Confirmed by grep — zero matches outside test files and the types file itself.

---

## Validation Architecture

### Test Framework

| Property           | Value                                         |
| ------------------ | --------------------------------------------- |
| Framework          | Vitest (packages/api), Jest (apps/mobile)     |
| Config file        | `packages/api/vitest.config.ts`               |
| Quick run command  | `node node_modules/.bin/vitest run packages/api/src/handlers/auth.test.ts` (from repo root) |
| Full suite command | `node node_modules/.bin/turbo run test`        |

### How to Test This Phase

**Unit test approach for validate-token:**

Mock `jwtVerify` and `createRemoteJWKSet` from `jose` at the module level. The handler uses `getJwks()` which calls `createRemoteJWKSet` on first invocation (cached in `_jwks`). The mock must intercept `jwtVerify` before it tries to fetch JWKS.

**Mock setup pattern (vi.hoisted + vi.mock):**
```typescript
const { mockJwtVerify } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
}))

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
    jwtVerify: mockJwtVerify,
  }
})
```

This must go at the top of the file alongside the existing `vi.hoisted()` / `vi.mock('../db', ...)` block — or as a second separate `vi.hoisted()` call.

**Simulating mobile vs tenant tokens:** The difference is only in what `jwtVerify` returns (the mock payload). The handler doesn't check which client ID matched — it just verifies the token validates against one of the two audience values. For test purposes, all valid tokens return a mocked payload; the audience distinction is only tested by having `jwtVerify` throw when the wrong audience is provided.

**Env setup for validate-token tests:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('COGNITO_JWKS_URL', 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST/.well-known/jwks.json')
  vi.stubEnv('COGNITO_TENANT_CLIENT_ID', 'tenant-client-id')
  vi.stubEnv('COGNITO_MOBILE_CLIENT_ID', 'mobile-client-id')
})

afterEach(() => {
  vi.unstubAllEnvs()
})
```

**JWKS cache reset:** `getJwks()` caches `_jwks` at module level. Between tests, `_jwks` may hold a stale mock value. Use `vi.resetModules()` between tests, OR ensure `createRemoteJWKSet` mock always returns the same sentinel value (since `jwtVerify` is separately mocked, the actual value of `getJwks()` doesn't matter — it's passed as the second argument to `jwtVerify` but the mock ignores it).

### The 9 Test Cases

| # | Scenario | Setup | Expected |
|---|----------|-------|----------|
| 1 | Tenant client ID token accepted | `mockJwtVerify` resolves with valid payload including `token_use: 'id'`, `sub`, `email`, `custom:tenantId`, `custom:role` | 200, `data.sub`, `data.tenantId`, `data.role`, `data.email`, `data.expiresAt`, `data.ssoProvider` |
| 2 | Mobile client ID token accepted | Same payload, different scenario label | 200 with session claims |
| 3 | Unknown audience rejected | `mockJwtVerify` throws generic `Error('JWT audience mismatch')` (not JWTExpired) | 401, `code: 'UNAUTHORIZED'` |
| 4 | Expired token | `mockJwtVerify` throws `new errors.JWTExpired('...')` | 401, `code: 'TOKEN_EXPIRED'` |
| 5 | Wrong `token_use` (access token) | `mockJwtVerify` resolves with `token_use: 'access'` instead of `'id'` | 401, `code: 'UNAUTHORIZED'` |
| 6 | Missing `sub` or `email` claims | `mockJwtVerify` resolves with payload where `sub` and/or `email` are absent | 401, `code: 'UNAUTHORIZED'` |
| 7 | Missing `custom:tenantId` or `custom:role` | `mockJwtVerify` resolves with valid `sub`/`email` but no custom claims | 403, `code: 'FORBIDDEN'` |
| 8 | Env vars not set | `vi.unstubAllEnvs()` in the test before calling, then stub only JWKS_URL without client IDs | 500, `code: 'INTERNAL_ERROR'` |
| 9 | Invalid/unparseable JWT | `mockJwtVerify` throws a non-JWTExpired error (e.g. `new Error('invalid token')`) | 401, `code: 'UNAUTHORIZED'` |

Note: Test cases 3 and 9 produce the same outcome (401 UNAUTHORIZED) but test different throw paths. Test 3 tests audience mismatch semantically; test 9 tests the general catch branch. Can be combined if desired — the decision is left to Claude's discretion per CONTEXT.md.

For test case 1, assert the full session shape:
```typescript
expect(data['sub']).toBe('user-sub-123')
expect(data['tenantId']).toBe('tenant-abc')
expect(data['role']).toBe('tenant_user')
expect(data['email']).toBe('user@acme.com')
expect(data['expiresAt']).toBe(9999999999)
expect(data['ssoProvider']).toBeNull()
```

For test case 2 (mobile), also verify `ssoProvider` is returned:
```typescript
// With identities claim present
mockJwtVerify.mockResolvedValueOnce({
  payload: {
    sub: 'user-sub-456',
    email: 'driver@acme.com',
    exp: 9999999999,
    token_use: 'id',
    'custom:tenantId': 'tenant-abc',
    'custom:role': 'tenant_user',
    identities: [{ providerName: 'acme-okta' }],
  },
})
// expect data.ssoProvider === 'acme-okta'
```

---

## Task Boundaries

### Task 1: Commit BREAK-01 fix

**Files:** `apps/mobile/src/auth/authService.ts` — already changed in working tree.

**What:** The diff shows exactly two lines changed:
1. Comment on line 46 (doc comment): `{ token: idToken }` → `{ idToken }` (documentation alignment)
2. Code on line 71: `body: JSON.stringify({ token: idToken })` → `body: JSON.stringify({ idToken })`

**Action:** Stage and commit `apps/mobile/src/auth/authService.ts` only. The fix is complete — no code writing needed.

### Task 2: Validate-token audience fix

**File:** `packages/api/src/handlers/auth.ts`

**Exact change — add one line after line 393, modify lines 394–397, modify line 407:**

Current env guard (lines 392–398):
```typescript
const jwksUrl = process.env['COGNITO_JWKS_URL'] ?? ''
const tenantClientId = process.env['COGNITO_TENANT_CLIENT_ID'] ?? ''

if (!jwksUrl || !tenantClientId) {
  logger.error('validate-token: COGNITO_JWKS_URL or COGNITO_TENANT_CLIENT_ID not set')
  return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
}
```

Becomes:
```typescript
const jwksUrl = process.env['COGNITO_JWKS_URL'] ?? ''
const tenantClientId = process.env['COGNITO_TENANT_CLIENT_ID'] ?? ''
const mobileClientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''

if (!jwksUrl || !tenantClientId || !mobileClientId) {
  logger.error('validate-token: COGNITO_JWKS_URL, COGNITO_TENANT_CLIENT_ID, or COGNITO_MOBILE_CLIENT_ID not set')
  return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
}
```

Current jwtVerify call (line 407):
```typescript
audience: tenantClientId,
```

Becomes:
```typescript
audience: [tenantClientId, mobileClientId],
```

**No AppEnv type update needed.** Env vars are read via `process.env[...]` directly, not via a typed interface. `COGNITO_MOBILE_CLIENT_ID` is already in the CDK stack.

### Task 3: Session type update

**File:** `apps/mobile/src/auth/types.ts`

**Exact change — add one field to the Session type:**
```typescript
export type Session = {
  sub: string
  tenantId: string
  role: string
  email: string
  expiresAt: number
  ssoProvider: string | null   // <-- add this line
}
```

**Downstream test fixes required (TypeScript will error without them):**

`apps/mobile/src/auth/authService.test.ts` line 5–11 — `mockSession` needs `ssoProvider: null`:
```typescript
const mockSession: Session = {
  sub: 'sub-1',
  tenantId: 'tenant-1',
  role: 'driver',
  email: 'a@b.com',
  expiresAt: 9999999999,
  ssoProvider: null,   // <-- add this line
}
```

`apps/mobile/src/context/AuthContext.test.tsx` line 20–26 — `mockSession` needs `ssoProvider: null`:
```typescript
const mockSession: Session = {
  sub: 'user-123',
  tenantId: 'tenant-abc',
  role: 'driver',
  email: 'driver@example.com',
  expiresAt: Date.now() + 3600_000,
  ssoProvider: null,   // <-- add this line
}
```

**No changes needed to `AuthContext.tsx`** — it only uses `Session` as a type annotation; no property access on `ssoProvider` exists in the component.

### Task 4: Validate-token test suite

**File:** `packages/api/src/handlers/auth.test.ts`

**Where to insert:** After line 396 (end of file, after closing `})` of GET mobile-config describe block).

**Mock setup to add at top of file** (alongside existing `vi.hoisted()` block):

Add a second `vi.hoisted()` block and a `vi.mock('jose', ...)` after the existing `vi.mock('../db', ...)`:

```typescript
const { mockJwtVerify } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
}))

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
    jwtVerify: mockJwtVerify,
  }
})
```

This must appear before the `authHandler` import or alongside the existing mocks block. The `vi.hoisted()` call ensures `mockJwtVerify` is available when the mock factory runs.

**Describe block appended after line 396:**

```typescript
describe('POST /api/auth/validate-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('COGNITO_JWKS_URL', 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST/.well-known/jwks.json')
    vi.stubEnv('COGNITO_TENANT_CLIENT_ID', 'tenant-client-id')
    vi.stubEnv('COGNITO_MOBILE_CLIENT_ID', 'mobile-client-id')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Case 1, 2, 3, 4, 5, 6, 7, 8, 9...
})
```

**Full list of 9 test cases with what each asserts:**

1. **Tenant client ID accepted — returns 200 with session claims**
   - `mockJwtVerify` resolves with `{ payload: { sub, email, exp, token_use: 'id', 'custom:tenantId', 'custom:role', identities: undefined } }`
   - Assert: status 200, `data.sub`, `data.tenantId`, `data.role`, `data.email`, `data.expiresAt`, `data.ssoProvider === null`

2. **Mobile client ID accepted — returns 200 with ssoProvider populated**
   - `mockJwtVerify` resolves with payload including `identities: [{ providerName: 'acme-okta' }]`
   - Assert: status 200, `data.ssoProvider === 'acme-okta'`

3. **Unknown audience — returns 401 UNAUTHORIZED**
   - `mockJwtVerify` throws `new Error('JWT audience mismatch')`
   - Assert: status 401, `code === 'UNAUTHORIZED'`

4. **Expired token — returns 401 TOKEN_EXPIRED**
   - `mockJwtVerify` throws `new errors.JWTExpired('token expired')`
   - Assert: status 401, `code === 'TOKEN_EXPIRED'`
   - Import `errors` from `jose` in the test file (already imported in auth.ts, not yet in test file)

5. **Wrong token_use (access token) — returns 401 UNAUTHORIZED**
   - `mockJwtVerify` resolves with `token_use: 'access'`
   - Assert: status 401, `code === 'UNAUTHORIZED'`

6. **Missing sub or email — returns 401 UNAUTHORIZED**
   - `mockJwtVerify` resolves with payload where `sub` is undefined (or `email` is undefined)
   - Assert: status 401, `code === 'UNAUTHORIZED'`

7. **Missing custom:tenantId or custom:role — returns 403 FORBIDDEN**
   - `mockJwtVerify` resolves with valid `sub`/`email`/`token_use: 'id'` but without `custom:tenantId` and `custom:role`
   - Assert: status 403, `code === 'FORBIDDEN'`

8. **Env vars not set — returns 500 INTERNAL_ERROR**
   - In the test: `vi.unstubAllEnvs()` then `vi.stubEnv('COGNITO_JWKS_URL', '')` (or just unstub all without re-stubbing)
   - Assert: status 500, `code === 'INTERNAL_ERROR'`
   - Note: do NOT call `mockJwtVerify` — the guard fires before jwtVerify is called

9. **Invalid JWT (non-expired error) — returns 401 UNAUTHORIZED**
   - `mockJwtVerify` throws `new Error('Invalid compact JWS')`
   - Assert: status 401, `code === 'UNAUTHORIZED'`
   - This validates the catch-all path vs the JWTExpired-specific path

**Note on `errors.JWTExpired`:** The test file will need to import `errors` from `jose` to construct the `JWTExpired` instance. Since `jose` is already mocked with `...actual`, the `errors` export is still the real one (only `jwtVerify` and `createRemoteJWKSet` are replaced). `new errors.JWTExpired('msg')` will work.

---

## Standard Stack

### Core (no changes to stack — phase is fix/test only)

| Library | Version | Purpose |
| ------- | ------- | ------- |
| jose    | ^5.0.0  | JWT verification — `jwtVerify`, `errors.JWTExpired`, `createRemoteJWKSet` |
| Vitest  | existing | Unit test framework for `packages/api` |
| Hono    | existing | HTTP framework — `authHandler.request(...)` in tests |

---

## Common Pitfalls

### JWKS Cache Pollution Between Tests

**What goes wrong:** `getJwks()` in `auth.ts` stores the result of `createRemoteJWKSet` in module-level `_jwks`. If one test populates it, subsequent tests pass the same (potentially wrong) mock value.

**Why it happens:** Module-level state persists across test cases within the same test file run.

**How to avoid:** Since `jwtVerify` is mocked directly, the value passed as its second argument (the JWKS) is irrelevant — the mock ignores it. As long as `createRemoteJWKSet` returns a stable mock value, the cache holds a valid mock object and `jwtVerify` still gets called with it. No special reset needed.

**Warning sign:** Tests fail intermittently depending on run order — suggests `_jwks` reset is needed. Use `vi.resetModules()` in `beforeEach` if this occurs.

### `errors.JWTExpired` Constructor Requires Payload

**What goes wrong:** `new errors.JWTExpired('message')` may throw if the constructor expects a JWT payload. In jose v5, `JWTExpired` extends `JWTClaimValidationFailed` which takes `(message, payload, claim, reason)`. Constructing it with just a string may not work as expected.

**How to avoid:** Use `Object.assign(new Error('JWTExpired'), { code: 'ERR_JWT_EXPIRED' })` as a simpler alternative, or check the jose v5 constructor signature. The handler only checks `err instanceof errors.JWTExpired` — so the mock error must pass that `instanceof` check. Constructing `new errors.JWTExpired(...)` with the correct args is the safest approach.

### Session Type Change Breaks Existing Mobile Tests

**What goes wrong:** Adding `ssoProvider: string | null` to `Session` makes `mockSession` objects in `authService.test.ts` and `AuthContext.test.tsx` TypeScript-invalid (missing required field).

**How to avoid:** Update both mock objects in the same task as the type change. These are one-line additions — do all three files atomically.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is code and test changes only. No external services, databases, or CLI tools beyond the existing test framework are required. `packages/api` Vitest runs without `DATABASE_URL` (validate-token handler makes no DB calls — confirmed by reading the handler, which calls only `jwtVerify` and `extractSsoProvider`, no `db.*` calls).

---

## Sources

### Primary (HIGH confidence)

- jose v5 `JWTVerifyOptions` official docs — `audience?: string | string[]` — https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md
- `packages/api/src/handlers/auth.ts` — full handler read; exact line numbers documented above
- `packages/api/src/handlers/auth.test.ts` — full test file read; pattern analysis for mock setup

### Secondary (MEDIUM confidence)

- `apps/mobile/src/auth/types.ts` — current Session type confirmed
- `apps/mobile/src/auth/authService.ts` — working tree diff confirmed BREAK-01 fix
- `packages/infra/lib/stacks/api-stack.ts` — `COGNITO_MOBILE_CLIENT_ID` already in Lambda env (line 116)

---

## Metadata

**Confidence breakdown:**

- Implementation analysis: HIGH — read source files directly
- jose array audience support: HIGH — confirmed from official docs
- Test mock approach: HIGH — matches existing vi.mock pattern in project; jose mock approach is standard Vitest
- Session type propagation: HIGH — confirmed by grep of all Session usages in mobile app

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable libraries, no moving targets)
