# Phase 2: Auth Service Layer - Research

**Researched:** 2026-03-27
**Domain:** Amazon Cognito SRP authentication, React Native service module design, Jest mocking patterns
**Confidence:** HIGH

## Summary

Phase 2 builds two pure service modules (`cognitoService.ts` and `authService.ts`) inside `apps/mobile/src/auth/` plus their Jest tests. No UI is touched. The goal is to prove — entirely in tests — that the three-step sequence (fetch mobile config → Cognito SRP handshake → validate-token) works correctly and that typed `AuthError` is thrown on every failure path.

All locked decisions are firm: plain exported functions (not classes), factory function for dependency injection, single `AuthError` class with a `code` field, `Session` type has no `token` field. The main research questions are (a) exactly how `amazon-cognito-identity-js` must be wrapped to convert its callback API to Promises, and (b) how to mock it convincingly in Jest without fighting the library's internal crypto/network layers.

The `amazon-cognito-identity-js` package (v6.3.16) is already installed. Its `authenticateUser` method uses an `IAuthenticationCallback` object with `onSuccess`, `onFailure`, and optional challenge callbacks. Wrapping this in a Promise is straightforward: the wrapper resolves on `onSuccess`, rejects with an `AuthError` on `onFailure`, and rejects with a "challenge not supported" `AuthError` if any of the challenge callbacks fire (since v1 out-of-scope). The `onSuccess` callback receives a `CognitoUserSession` whose `getIdToken().getJwtToken()` returns the raw ID token string.

**Primary recommendation:** Mock `amazon-cognito-identity-js` at the module level with `jest.mock()` — the standard Jest pattern already established in this project for `AsyncStorage`. Do NOT attempt to drive the library's real SRP math in tests; the library's own `__mocks__/mocks.js` is an internal helper only and is not designed for consumer use.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Plain exported functions — mirror the web app pattern (`apps/admin/src/auth/cognito.ts`, `packages/web/src/auth/`). No static class, no class instances. Functions are top-level exports in their module file.
- **D-02:** New `apps/mobile/src/auth/` directory, mirroring the web/admin `src/auth/` structure. Three files: `types.ts`, `cognitoService.ts`, `authService.ts`.
- **D-03:** Single `AuthError extends Error` class with a `code: string` field — same pattern as `CognitoError` in `apps/admin/src/auth/cognito.ts`. The `code` carries the Cognito error name (e.g. `NotAuthorizedException`, `UserNotFoundException`, `NetworkError`). One error class handles all failure modes; callers switch on `code`.
- **D-04:** Factory function pattern: `createAuthService({ apiBaseUrl, cognitoService })` returns `{ fetchMobileConfig, authenticate }`. Dependencies are injected at construction — no module-level state, no global config lookup inside the function bodies.
- **D-05:** `cognitoService` is also injected into `createAuthService`, allowing tests to substitute a mock without `jest.mock()` module patching. In production, the real `cognitoService` module exports are passed in.
- **D-06:** The app creates the real `authService` instance at startup (e.g. in `_layout.tsx` or a top-level service file). API base URL comes from `EXPO_PUBLIC_API_URL` env var at that call site — the services themselves never read env vars directly.
- **D-07:** `Session` type lives in `apps/mobile/src/auth/types.ts`. Shape: `{ sub: string, tenantId: string, role: string, email: string, expiresAt: number }`. No `token` field — raw Cognito ID token is never stored (AUTH-03: only the server-validated Session is returned from `authenticate`).
- **D-08:** `MobileConfig` type also in `types.ts`: `{ userPoolId: string, clientId: string }` — returned by `fetchMobileConfig`, matches the `GET /api/auth/mobile-config` response shape (Phase 1 decision D-02).

### Claude's Discretion

- Exact error codes surfaced from `amazon-cognito-identity-js` callback errors vs network errors
- Whether `cognitoService.ts` re-exports `AuthError` or it's imported from `types.ts`
- Test file locations (`cognitoService.test.ts` and `authService.test.ts` co-located in `src/auth/`)
- Jest mock implementation details for `amazon-cognito-identity-js`

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. Session persistence (expo-secure-store vs AsyncStorage) is Phase 3.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                 | Research Support                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | After tenant selection, app fetches `GET /api/auth/mobile-config?tenantId=<id>` to obtain pool ID and client ID at runtime | `fetchMobileConfig` in `authService` calls this endpoint; `fetch` is mockable in Jest with `jest.spyOn(globalThis, 'fetch')` or by injecting a custom fetch |
| AUTH-02 | Driver authenticates via Cognito SRP using `amazon-cognito-identity-js` — entirely in-app, no browser redirect              | `CognitoUser.authenticateUser()` with `AuthenticationDetails` and `IAuthenticationCallback` wraps cleanly into a Promise; mocked at module level in tests |
| AUTH-03 | On successful SRP auth, app calls `POST /api/auth/validate-token` with the Cognito ID token and uses returned claims as the session | `authService.authenticate` orchestrates all three steps; `Session` has no `token` field; raw ID token is discarded after the validate-token call |

</phase_requirements>

## Standard Stack

### Core

| Library                       | Version   | Purpose                                             | Why Standard                                                                     |
| ----------------------------- | --------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `amazon-cognito-identity-js`  | ^6.3.16   | SRP authentication handshake with AWS Cognito       | Only pure-JS SRP library for React Native; no native modules required; already installed |
| `react-native-get-random-values` | ~1.11.0 | Polyfill `crypto.getRandomValues` for SRP math      | Required by the SRP handshake; already installed and polyfilled in `_layout.tsx` |
| Jest (v29)                    | ^29.7.0   | Test runner for all mobile unit tests               | Already configured in `apps/mobile/jest.config.js` with `react-native` preset   |

### Supporting

| Library                           | Version  | Purpose                             | When to Use                                   |
| --------------------------------- | -------- | ----------------------------------- | --------------------------------------------- |
| `@testing-library/react-native`   | ^13.3.3  | Already used in AuthContext tests   | Not needed for pure service unit tests (no components) |
| `apps/mobile/src/utils/logger.ts` | internal | Auth breadcrumb logging             | `logger.logAuth('signIn', email)` in cognitoService |

### Alternatives Considered

| Instead of                        | Could Use               | Tradeoff                                                                              |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `amazon-cognito-identity-js` SRP  | Raw Cognito REST API    | Admin app does this (USER_PASSWORD_AUTH flow) but SRP is required for mobile client with no secret |
| `jest.mock()` module mock         | Library's `__mocks__/mocks.js` | Library's mock is an internal test helper (uses ES module imports, references internal `Client` and `AuthenticationHelper`) — not designed for consumer use |

**Installation:** No new packages required. All dependencies are already in `apps/mobile/package.json`.

## Architecture Patterns

### Recommended Project Structure

```
apps/mobile/src/auth/
├── types.ts            # Session, AuthError, MobileConfig types
├── cognitoService.ts   # signIn() — wraps amazon-cognito-identity-js SRP callback into Promise
├── authService.ts      # createAuthService() factory — fetchMobileConfig, authenticate
├── cognitoService.test.ts  # Jest tests for cognitoService
└── authService.test.ts     # Jest tests for authService
```

### Pattern 1: Callback-to-Promise Wrapping (cognitoService)

**What:** Wrap `CognitoUser.authenticateUser()` callback API into an async function that resolves with `{ idToken: string }` or rejects with `AuthError`.

**When to use:** Any time the library's callback-style API must be surfaced as a Promise to callers.

**Rationale for `authenticateUser` vs `initiateAuth`:** `authenticateUser` performs the full SRP handshake (ALLOW_USER_SRP_AUTH flow). `initiateAuth` initiates auth but leaves SRP challenge response to the caller. `authenticateUser` is the correct method for the pre-configured SRP flow.

**Example:**
```typescript
// Source: amazon-cognito-identity-js index.d.ts (verified in repo)
// apps/mobile/src/auth/cognitoService.ts

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js'
import { AuthError } from './types'
import { logger } from '../utils/logger'

export async function signIn(
  email: string,
  password: string,
  poolId: string,
  clientId: string,
): Promise<{ idToken: string }> {
  return new Promise((resolve, reject) => {
    const pool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId })
    const user = new CognitoUser({ Username: email, Pool: pool })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })

    user.authenticateUser(authDetails, {
      onSuccess(session) {
        logger.logAuth('signIn', email)
        resolve({ idToken: session.getIdToken().getJwtToken() })
      },
      onFailure(err: { code?: string; message?: string }) {
        reject(new AuthError(err.code ?? 'UnknownError', err.message ?? 'Authentication failed'))
      },
      newPasswordRequired() {
        reject(new AuthError('NewPasswordRequired', 'Password change required'))
      },
    })
  })
}
```

### Pattern 2: Factory-Based Service (authService)

**What:** `createAuthService({ apiBaseUrl, cognitoService })` returns an object with `fetchMobileConfig` and `authenticate`. Dependencies are closured — no global state.

**When to use:** When the service needs external collaborators (fetch, cognitoService) that must be substitutable in tests.

**Example:**
```typescript
// apps/mobile/src/auth/authService.ts
import { Session, MobileConfig } from './types'
import { AuthError } from './types'

type CognitoService = {
  signIn(email: string, password: string, poolId: string, clientId: string): Promise<{ idToken: string }>
}

type AuthServiceDeps = {
  apiBaseUrl: string
  cognitoService: CognitoService
}

export function createAuthService({ apiBaseUrl, cognitoService }: AuthServiceDeps) {
  async function fetchMobileConfig(tenantId: string): Promise<MobileConfig> {
    const res = await fetch(`${apiBaseUrl}/api/auth/mobile-config?tenantId=${encodeURIComponent(tenantId)}`)
    if (!res.ok) {
      throw new AuthError('ConfigFetchFailed', `mobile-config returned ${res.status}`)
    }
    const body = await res.json() as { data: MobileConfig }
    return body.data
  }

  async function authenticate(email: string, password: string, tenantId: string): Promise<Session> {
    const config = await fetchMobileConfig(tenantId)
    const { idToken } = await cognitoService.signIn(email, password, config.userPoolId, config.clientId)

    const res = await fetch(`${apiBaseUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: idToken }),
    })
    if (!res.ok) {
      throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
    }
    const body = await res.json() as { data: Session }
    return body.data  // idToken is NOT stored on Session (D-07)
  }

  return { fetchMobileConfig, authenticate }
}
```

### Pattern 3: Jest Module Mock for amazon-cognito-identity-js

**What:** Use `jest.mock('amazon-cognito-identity-js', ...)` with factory to control what `CognitoUser.authenticateUser` does in each test.

**Why module mock (not injection mock):** `cognitoService.ts` constructs `CognitoUserPool` and `CognitoUser` internally — the caller cannot inject them. The library must be mocked at the module level so `new CognitoUser(...)` returns a controlled object. For `authService` tests, the `cognitoService` is injected, so a simple inline mock object suffices there.

**Example:**
```typescript
// apps/mobile/src/auth/cognitoService.test.ts

// Hoist the mock — jest.mock() is hoisted before imports automatically
const mockAuthenticateUser = jest.fn()
jest.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: jest.fn(),
  CognitoUser: jest.fn().mockImplementation(() => ({
    authenticateUser: mockAuthenticateUser,
  })),
  AuthenticationDetails: jest.fn(),
}))

// Simulate success
mockAuthenticateUser.mockImplementation((_details, callbacks) => {
  callbacks.onSuccess({
    getIdToken: () => ({ getJwtToken: () => 'mock-id-token' }),
  })
})

// Simulate failure
mockAuthenticateUser.mockImplementation((_details, callbacks) => {
  callbacks.onFailure({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' })
})
```

**Key:** `jest.mock()` declarations are hoisted by Jest's Babel transform, but variables referenced inside the factory must be defined before the factory runs. Use the `mockImplementation` pattern above (define a `jest.fn()` variable before the `jest.mock()` call) or use the `jest.fn()` directly inside the factory and control it with `(CognitoUser as jest.Mock).mockImplementation(...)`.

### Pattern 4: fetch Mock for authService Tests

**What:** `authService` uses the global `fetch`. In `authService.test.ts`, the `cognitoService` is injected as a plain mock object, but `fetch` must be mocked for the HTTP calls.

**How:** Use `jest.spyOn(globalThis, 'fetch')` or assign `global.fetch = jest.fn()`. The `jest.setup.js` uses `testEnvironment: 'node'` which has no built-in `fetch` in older Node, but React Native 0.81 / Expo 54 bundle a `fetch` polyfill. Use `mockImplementation` (not `mockResolvedValue`) for multi-call tests so each call gets a fresh `Response` object.

```typescript
// Per the MEMORY.md gotcha: use mockImplementation for multi-call tests
global.fetch = jest.fn()
;(global.fetch as jest.Mock)
  .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ data: mockConfig }), { status: 200 })))
  .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ data: mockSession }), { status: 200 })))
```

### Anti-Patterns to Avoid

- **Storing the raw ID token on Session:** `authService.authenticate` receives `{ idToken }` from `cognitoService.signIn`, passes it to `validate-token`, then discards it. It must NOT attach `idToken` to the returned `Session` object. (AUTH-03, D-07)
- **Reading env vars inside service functions:** `apiBaseUrl` comes from the factory argument, not from `process.env` or `Constants.expoConfig` inside the function body. (D-06)
- **Using class instances instead of plain functions:** `cognitoService.ts` exports `signIn` as a top-level function, not as a method on a class. (D-01)
- **Calling `initiateAuth` instead of `authenticateUser`:** `initiateAuth` does not perform the full SRP handshake on its own. `authenticateUser` is correct for the `ALLOW_USER_SRP_AUTH` flow.
- **Trying to use the library's `__mocks__/mocks.js`:** It imports from internal paths (`../src/Client`, `../src/AuthenticationHelper`) using ES module syntax and is not consumable from the project's Jest config. Write your own `jest.mock()` factory.

## Don't Hand-Roll

| Problem                        | Don't Build                                         | Use Instead                                          | Why                                                                       |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| SRP handshake math             | Custom SRP implementation                           | `amazon-cognito-identity-js` `authenticateUser`      | SRP involves large-number BigInteger math, hash derivation, timing-safe operations |
| Callback-to-Promise conversion | Complex state machine                               | Single `new Promise()` wrapper (see Pattern 1)       | The callback has exactly two terminal paths: `onSuccess` and `onFailure` |
| TypeScript types for SDK       | Hand-authored types                                 | `index.d.ts` bundled with library (already in repo)  | Types verified in repo — `CognitoUserSession`, `IAuthenticationCallback`, etc. |

**Key insight:** The SRP protocol is cryptographically non-trivial. The library handles A/B values, HKDF derivation, timestamp formatting, and signature verification. The service wrapper is intentionally thin: construct objects, call `authenticateUser`, convert callbacks to Promise.

## Common Pitfalls

### Pitfall 1: `jest.mock()` Factory Variable Hoisting

**What goes wrong:** If you write `const mockFn = jest.fn()` above `jest.mock(...)` and reference `mockFn` inside the factory, Jest hoists the `jest.mock()` call to the top of the file — but does NOT hoist the variable declaration. You get a "Cannot access before initialization" ReferenceError at test runtime.

**Why it happens:** Jest's Babel plugin hoists `jest.mock()` calls before all imports but does NOT hoist user variable declarations.

**How to avoid:** One of two patterns:
1. Name variables starting with `mock` — Jest's hoist plugin exempts `mock`-prefixed `var` declarations (not `const`/`let`). Use `var mockAuthenticateUser = jest.fn()` before the `jest.mock()` call.
2. Capture the mock inside the factory itself and re-reference via the mocked module: `import { CognitoUser } from 'amazon-cognito-identity-js'` then `(CognitoUser as jest.Mock).mockImplementation(...)` in `beforeEach`.

**Warning signs:** `ReferenceError: Cannot access 'mockAuthenticateUser' before initialization` in test output.

### Pitfall 2: `fetch` Body Can Only Be Read Once

**What goes wrong:** `mockResolvedValue(new Response(...))` creates a single `Response` object. When `authService.authenticate` calls `fetch` twice (mobile-config, then validate-token), the second call gets the same already-consumed `Response` and `res.json()` throws or returns empty.

**Why it happens:** The WHATWG `Response` body is a one-time-readable stream.

**How to avoid:** Use `mockImplementation(() => Promise.resolve(new Response(...)))` so each call gets a fresh `Response` instance. This is already documented in `MEMORY.md`.

**Warning signs:** Second `fetch` call returns `{}` or throws; first assertion passes, second fails.

### Pitfall 3: CognitoUserPool Storage in Tests

**What goes wrong:** `CognitoUserPool` and `CognitoUser` internally use `localStorage`/`AsyncStorage` for caching device keys and session tokens. In tests, this causes "storage not available" warnings or unexpected AsyncStorage calls that pollute mock call counts.

**Why it happens:** The library stores session data by default in its internal storage layer.

**How to avoid:** Mock the entire module with `jest.mock('amazon-cognito-identity-js', ...)` so no real `CognitoUserPool` or `CognitoUser` instances are created. The mock factory returns objects with only the methods under test — no storage is touched.

**Warning signs:** AsyncStorage mock calls appearing in `cognitoService` tests even though the service does not import AsyncStorage.

### Pitfall 4: `newPasswordRequired` Challenge Unhandled

**What goes wrong:** A Cognito user whose account was just provisioned triggers the `newPasswordRequired` challenge callback instead of `onSuccess`. If this callback is omitted, the Promise never settles (neither resolves nor rejects), causing the test (and production) to hang indefinitely.

**Why it happens:** `IAuthenticationCallback` treats all callbacks as optional, so the library silently does nothing if `newPasswordRequired` is undefined.

**How to avoid:** Always include `newPasswordRequired` in the `authenticateUser` callback object and reject with `new AuthError('NewPasswordRequired', ...)`. This is out of scope for v1 UX but must be handled at the service level to avoid hangs.

**Warning signs:** A test that simulates `newPasswordRequired` never resolves.

### Pitfall 5: `jest.config.js` transformIgnorePatterns Must Include the Library

**What goes wrong:** `amazon-cognito-identity-js` ships ES module source in its `es/` directory and CJS in `lib/`. Jest with the `react-native` preset may fail to transform it.

**Why it happens:** The current `transformIgnorePatterns` in `apps/mobile/jest.config.js` does not explicitly allow `amazon-cognito-identity-js`. However, since the module is mocked entirely with `jest.mock()`, Jest never needs to load or transform the real library code — so this pitfall only bites if you forget to mock the module in a test file.

**How to avoid:** Always `jest.mock('amazon-cognito-identity-js', ...)` in every test file that imports `cognitoService.ts`. Do not rely on the real library loading in tests.

**Warning signs:** `SyntaxError: Cannot use import statement in a module` in test output pointing to `amazon-cognito-identity-js/es/`.

## Code Examples

Verified patterns from official sources:

### AuthError Class (mirrors CognitoError in admin)

```typescript
// Source: apps/admin/src/auth/cognito.ts (verified in repo)
// apps/mobile/src/auth/types.ts

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = code
  }
}

export type Session = {
  sub: string
  tenantId: string
  role: string
  email: string
  expiresAt: number
  // NOTE: no `token` field — raw ID token is never stored (AUTH-03)
}

export type MobileConfig = {
  userPoolId: string
  clientId: string
}
```

### CognitoUserSession token extraction

```typescript
// Source: amazon-cognito-identity-js index.d.ts (verified in repo at node_modules/)
// CognitoUserSession has:
//   getIdToken(): CognitoIdToken
//   getAccessToken(): CognitoAccessToken
//   getRefreshToken(): CognitoRefreshToken
// CognitoIdToken has:
//   getJwtToken(): string   ← this is what cognitoService returns
//   getExpiration(): number
//   decodePayload(): { [id: string]: any }

session.getIdToken().getJwtToken()  // returns the raw JWT string
```

### authService test with injected cognitoService mock

```typescript
// apps/mobile/src/auth/authService.test.ts
import { createAuthService } from './authService'
import { AuthError, Session, MobileConfig } from './types'

const mockConfig: MobileConfig = { userPoolId: 'us-east-1_ABC', clientId: 'client123' }
const mockSession: Session = { sub: 'sub-1', tenantId: 'tenant-1', role: 'driver', email: 'a@b.com', expiresAt: 9999999999 }

const mockCognitoService = {
  signIn: jest.fn<Promise<{ idToken: string }>, [string, string, string, string]>(),
}

// For multi-call fetch: use mockImplementation (not mockResolvedValue) - MEMORY.md gotcha
beforeEach(() => {
  global.fetch = jest.fn()
  mockCognitoService.signIn.mockReset()
})

it('authenticate calls fetchMobileConfig, signIn, then validate-token and returns Session', async () => {
  ;(global.fetch as jest.Mock)
    .mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ data: mockConfig }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )
    .mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ data: mockSession }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )
  mockCognitoService.signIn.mockResolvedValue({ idToken: 'raw-id-token' })

  const authService = createAuthService({ apiBaseUrl: 'http://api.test', cognitoService: mockCognitoService })
  const result = await authService.authenticate('a@b.com', 'pass', 'tenant-1')

  expect(mockCognitoService.signIn).toHaveBeenCalledWith('a@b.com', 'pass', 'us-east-1_ABC', 'client123')
  expect(result).toEqual(mockSession)
  expect(result).not.toHaveProperty('token')  // raw token must not be stored
})
```

## State of the Art

| Old Approach                              | Current Approach                          | When Changed | Impact                                       |
| ----------------------------------------- | ----------------------------------------- | ------------ | -------------------------------------------- |
| Amplify library for Cognito in mobile     | `amazon-cognito-identity-js` standalone   | ~2022        | Amplify is much heavier; standalone is preferred for RN |
| `initiateAuth` for SRP                    | `authenticateUser` (same library)         | Always       | `authenticateUser` does full SRP; `initiateAuth` requires manual SRP challenge response |
| Class-based service pattern               | Factory function / plain exported functions | Project decision | Consistent with existing admin/web auth modules |

**Deprecated/outdated:**

- `aws-amplify` for auth-only use cases: Amplify v6 is 150KB+ heavier than `amazon-cognito-identity-js`. Admin app deliberately uses the standalone library.
- `CognitoUser.setAuthenticationFlowType('USER_SRP_AUTH')` explicit call: The `ALLOW_USER_SRP_AUTH` flow is the default when using `authenticateUser` — no explicit setAuthenticationFlowType call is needed.

## Environment Availability

| Dependency                       | Required By                              | Available | Version    | Fallback |
| -------------------------------- | ---------------------------------------- | --------- | ---------- | -------- |
| `amazon-cognito-identity-js`     | `cognitoService.ts` SRP handshake        | Yes       | ^6.3.16    | —        |
| `react-native-get-random-values` | Cognito SRP crypto at runtime            | Yes       | ~1.11.0    | —        |
| Jest v29                         | All unit tests                           | Yes       | ^29.7.0    | —        |
| Node.js `fetch`                  | `authService.ts` HTTP calls in tests     | Yes       | Node 18+   | `global.fetch = jest.fn()` already works in test env |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None. The environment is fully provisioned by Phase 1.

## Validation Architecture

### Test Framework

| Property           | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| Framework          | Jest 29 with `react-native` preset                     |
| Config file        | `apps/mobile/jest.config.js`                           |
| Quick run command  | `cd apps/mobile && npm test -- --testPathPattern=src/auth` |
| Full suite command | `cd apps/mobile && npm test`                           |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                                              | Test Type | Automated Command                                                                 | File Exists?   |
| ------- | ------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | -------------- |
| AUTH-01 | `fetchMobileConfig(tenantId)` calls `GET /api/auth/mobile-config` and returns `MobileConfig` | unit | `npm test -- --testPathPattern=src/auth/authService` | Wave 0 |
| AUTH-02 | `cognitoService.signIn(email, password, poolId, clientId)` resolves with `{ idToken }` on success; rejects with `AuthError` on failure | unit | `npm test -- --testPathPattern=src/auth/cognitoService` | Wave 0 |
| AUTH-03 | `authenticate` orchestrates all three steps; returned `Session` has no `token` field  | unit      | `npm test -- --testPathPattern=src/auth/authService`                              | Wave 0         |

### Sampling Rate

- **Per task commit:** `cd apps/mobile && npm test -- --testPathPattern=src/auth --forceExit`
- **Per wave merge:** `cd apps/mobile && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/mobile/src/auth/types.ts` — `Session`, `AuthError`, `MobileConfig` types
- [ ] `apps/mobile/src/auth/cognitoService.ts` — `signIn` implementation
- [ ] `apps/mobile/src/auth/authService.ts` — `createAuthService` factory
- [ ] `apps/mobile/src/auth/cognitoService.test.ts` — covers AUTH-02
- [ ] `apps/mobile/src/auth/authService.test.ts` — covers AUTH-01, AUTH-03

No new framework config needed — `jest.config.js` and `jest.setup.js` already exist and cover the test environment.

## Open Questions

1. **`logAuth` breadcrumb method on logger for signIn events**
   - What we know: `logger.logAuth` exists with signature `logAuth(action: 'login' | 'logout', email?: string)` — verified in `apps/mobile/src/utils/logger.ts`.
   - What's unclear: `'signIn'` is not one of the two allowed action literals. The service should use `'login'` (not `'signIn'`) to match the existing union type, or extend the logger.
   - Recommendation: Use `logger.logAuth('login', email)` in `cognitoService.onSuccess` — matches the existing union. Do not add a new `'signIn'` literal without updating `logger.ts`.

2. **`validate-token` response shape**
   - What we know: Phase 1 implemented `POST /api/auth/validate-token` and it returns claims as per REQUIREMENTS.md.
   - What's unclear: Whether the response is `{ data: Session }` or `{ session: Session }` or raw claims object — the Phase 1 plan should have documented this.
   - Recommendation: Verify `packages/api/src/handlers/` for the actual response shape before writing the `authService` implementation. If it follows the standard Hono handler pattern documented in MEMORY.md, it is `{ data: ... }`.

3. **`Session.role` type string vs union**
   - What we know: CONTEXT.md D-07 says `role: string`. The web `Session` type uses `role: 'tenant_admin' | 'tenant_user'` (packages/web/src/auth/session.ts). REQUIREMENTS.md says the driver role is "driver".
   - What's unclear: Whether the mobile Session `role` should be `string` (flexible) or a union type.
   - Recommendation: Use `role: string` as specified in D-07. The mobile Session is intentionally distinct from the web Session type. Adding a narrow union can be done in a future phase once driver roles are confirmed.

## Sources

### Primary (HIGH confidence)

- `apps/mobile/package.json` — Verified installed versions of all dependencies
- `node_modules/amazon-cognito-identity-js/index.d.ts` — Verified TypeScript API surface: `CognitoUser.authenticateUser`, `IAuthenticationCallback`, `CognitoUserSession.getIdToken().getJwtToken()`
- `apps/mobile/jest.config.js` — Verified test framework configuration
- `apps/mobile/jest.setup.js` — Verified global mocks (AsyncStorage, expo-constants, logger) and fake timers
- `apps/admin/src/auth/cognito.ts` — Verified `CognitoError` pattern (D-03), plain function exports (D-01)
- `packages/web/src/auth/session.ts` — Verified Session type shape (reference for D-07)
- `apps/mobile/src/services/orderService.test.ts` — Verified Jest mock patterns (`jest.mock`, `jest.fn`, `.mockResolvedValue`)
- `apps/mobile/src/context/AuthContext.test.tsx` — Verified `act()` usage and mock patterns in mobile tests

### Secondary (MEDIUM confidence)

- `node_modules/amazon-cognito-identity-js/__mocks__/mocks.js` — Confirms the library's own mocks are not consumer-friendly (internal imports); validates the decision to write a custom `jest.mock()` factory

### Tertiary (LOW confidence)

- None

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries verified in `package.json` and `node_modules/`
- Architecture: HIGH — patterns traced directly from existing codebase files and SDK types
- Pitfalls: HIGH — derived from existing `MEMORY.md` gotchas plus direct inspection of library internals
- Test patterns: HIGH — traced from existing `jest.setup.js`, `orderService.test.ts`, `AuthContext.test.tsx`

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable libraries, internal code patterns)
