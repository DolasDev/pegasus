# Phase 6: Fix Mobile Token Validation — Validation

**Phase Goal:** The `validate-token` endpoint accepts both web and mobile Cognito app client audiences; the BREAK-01 field name fix is committed; the Session type reflects the full API response shape.

---

## Validation Strategy

This phase is a pure bug-fix + test phase. No new infrastructure. No database required. All validation is through:
1. TypeScript compilation (type correctness)
2. Vitest unit tests (validate-token handler behaviour)

---

## Test Execution

### Quick Run (validate-token tests only)
```bash
node node_modules/.bin/vitest run packages/api/src/handlers/auth.test.ts
```

### TypeScript Typecheck (mobile package)
```bash
cd apps/mobile && node ../../node_modules/typescript/bin/tsc --noEmit
```

### Full Test Suite
```bash
node node_modules/.bin/turbo run test
```

### Environment
No `DATABASE_URL` required — `validate-token` makes no DB calls. All jose functions are mocked.

---

## Unit Test Coverage: validate-token Endpoint

Tests live in `packages/api/src/handlers/auth.test.ts`.

| # | Scenario | Expected Status | Expected Code |
|---|----------|----------------|---------------|
| 1 | Tenant client ID token (valid) | 200 | — (session claims returned) |
| 2 | Mobile client ID token (valid, with SSO identity) | 200 | — (ssoProvider populated) |
| 3 | Unknown audience rejected | 401 | `UNAUTHORIZED` |
| 4 | Expired token | 401 | `TOKEN_EXPIRED` |
| 5 | Wrong `token_use` (access token) | 401 | `UNAUTHORIZED` |
| 6 | Missing `sub` or `email` claims | 401 | `UNAUTHORIZED` |
| 7 | Missing `custom:tenantId` or `custom:role` | 403 | `FORBIDDEN` |
| 8 | Env vars not set | 500 | `INTERNAL_ERROR` |
| 9 | Invalid/unparseable JWT (general error) | 401 | `UNAUTHORIZED` |

### Mock Architecture

```typescript
// vi.hoisted ensures mockJwtVerify is available when vi.mock factory runs
const { mockJwtVerify } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
}))

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,                                                    // keeps errors.JWTExpired real
    createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),    // prevents HTTP calls
    jwtVerify: mockJwtVerify,                                     // fully controlled per-test
  }
})
```

### Env Setup per Test
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

---

## Success Criteria Verification

| Success Criterion | How to Verify |
|---|---|
| `POST /api/auth/validate-token` with mobile token returns 200 | Test case 2 passes |
| `authService.authenticate()` completes end-to-end | BREAK-01 commit (test case 2 in authService.test.ts still passes) |
| `Session` type includes `ssoProvider: string \| null` | TypeScript typecheck passes with `tsc --noEmit` |
| API handler tests cover both tenant-client and mobile-client audience | Test cases 1 and 2 both pass |

---

## Known Pitfalls

### `errors.JWTExpired` constructor (test case 4)
In jose v5, `JWTExpired` extends `JWTClaimValidationFailed(message, payload, claim, reason)`. For test mocking, use:
```typescript
Object.assign(new Error('token expired'), { code: 'ERR_JWT_EXPIRED' })
```
or construct with correct jose v5 signature. The handler only checks `err instanceof errors.JWTExpired`, so the mock must pass that instanceof check.

### JWKS cache (`_jwks` module-level)
`getJwks()` caches `createRemoteJWKSet` output. Since `jwtVerify` is mocked and ignores the JWKS argument, this is not an issue in practice. If tests fail intermittently by run order, add `vi.resetModules()` to `beforeEach`.

### Session type propagates to two test files
After adding `ssoProvider: string | null` to `Session`, both `authService.test.ts` (line ~5) and `AuthContext.test.tsx` (line ~20) need `ssoProvider: null` in their `mockSession` objects. Update all three files atomically.
