# Phase 2: Auth Service Layer - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `cognitoService` and `authService` as pure service modules in `apps/mobile/src/auth/`. No AuthContext changes, no UI changes, no session persistence. Goal: the full Cognito SRP authentication sequence can be exercised in Jest tests with all external boundaries mocked.

Deliverables:
- `apps/mobile/src/auth/types.ts` — Session, AuthError, MobileConfig types
- `apps/mobile/src/auth/cognitoService.ts` — wraps `amazon-cognito-identity-js` SRP handshake
- `apps/mobile/src/auth/authService.ts` — factory-based service orchestrating fetchMobileConfig → cognitoService.signIn → validate-token
- Jest tests proving all ROADMAP success criteria with mocked boundaries

AuthContext replacement (Phase 3), session persistence (Phase 3), and login UX (Phases 4–5) are out of scope.
</domain>

<decisions>
## Implementation Decisions

### Module Structure

- **D-01:** Plain exported functions — mirror the web app pattern (`apps/admin/src/auth/cognito.ts`, `packages/web/src/auth/`). No static class, no class instances. Functions are top-level exports in their module file.
- **D-02:** New `apps/mobile/src/auth/` directory, mirroring the web/admin `src/auth/` structure. Three files: `types.ts`, `cognitoService.ts`, `authService.ts`.

### AuthError

- **D-03:** Single `AuthError extends Error` class with a `code: string` field — same pattern as `CognitoError` in `apps/admin/src/auth/cognito.ts`. The `code` carries the Cognito error name (e.g. `NotAuthorizedException`, `UserNotFoundException`, `NetworkError`). One error class handles all failure modes; callers switch on `code`.

### AuthService API Config (Injection)

- **D-04:** Factory function pattern: `createAuthService({ apiBaseUrl, cognitoService })` returns `{ fetchMobileConfig, authenticate }`. Dependencies are injected at construction — no module-level state, no global config lookup inside the function bodies.
- **D-05:** `cognitoService` is also injected into `createAuthService`, allowing tests to substitute a mock without `jest.mock()` module patching. In production, the real `cognitoService` module exports are passed in.
- **D-06:** The app creates the real `authService` instance at startup (e.g. in `_layout.tsx` or a top-level service file). API base URL comes from `EXPO_PUBLIC_API_URL` env var at that call site — the services themselves never read env vars directly.

### Session Type

- **D-07:** `Session` type lives in `apps/mobile/src/auth/types.ts`. Shape: `{ sub: string, tenantId: string, role: string, email: string, expiresAt: number }`. No `token` field — raw Cognito ID token is never stored (AUTH-03: only the server-validated Session is returned from `authenticate`).
- **D-08:** `MobileConfig` type also in `types.ts`: `{ userPoolId: string, clientId: string }` — returned by `fetchMobileConfig`, matches the `GET /api/auth/mobile-config` response shape (Phase 1 decision D-02).

### Claude's Discretion

- Exact error codes surfaced from `amazon-cognito-identity-js` callback errors vs network errors
- Whether `cognitoService.ts` re-exports `AuthError` or it's imported from `types.ts`
- Test file locations (`cognitoService.test.ts` and `authService.test.ts` co-located in `src/auth/`)
- Jest mock implementation details for `amazon-cognito-identity-js`
</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §Authentication — AUTH-01, AUTH-02, AUTH-03 (success criteria for this phase)

### Phase 2 ROADMAP success criteria

- `.planning/ROADMAP.md` §Phase 2 — Exact function signatures and test scenarios required

### Existing auth patterns to match

- `apps/admin/src/auth/cognito.ts` — CognitoError class pattern (D-03), plain function exports (D-01)
- `packages/web/src/auth/session.ts` — Session type shape reference (D-07)
- `packages/web/src/auth/tenant-resolver.ts` — apiFetch usage pattern for API calls

### Mobile app entry point (where authService instance is created)

- `apps/mobile/app/_layout.tsx` — Root layout; where the real authService instance should be wired at startup

### Existing mobile service pattern (for test style reference)

- `apps/mobile/src/services/orderService.test.ts` — Jest test patterns in mobile app
- `apps/mobile/src/context/AuthContext.test.tsx` — act() usage, mock patterns in mobile tests

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `apps/mobile/src/utils/logger.ts` — Logger singleton; `cognitoService` and `authService` can import this for auth breadcrumbs (e.g. `logger.logAuth('signIn', email)`)
- `apps/mobile/src/context/AuthContext.tsx` — Current mock-based `login()` function; Phase 3 will replace this with `authService.authenticate()` — Phase 2 does NOT touch this file

### Established Patterns

- **Plain functions, not classes**: `apps/admin/src/auth/cognito.ts` uses top-level `export async function signIn(...)` — the mobile `cognitoService` follows this exactly
- **Factory for injection**: `createAuthService({ apiBaseUrl, cognitoService })` is a new pattern for mobile, but consistent with how the web's `apiFetch` is configured with a base URL
- **Error class with code**: `class CognitoError extends Error { constructor(public readonly code: string, message: string) }` — mobile `AuthError` is identical in shape
- **Jest module mocks**: Existing mobile tests mock `AsyncStorage` via `@react-native-async-storage/async-storage` setup in `jest.config.js` — `amazon-cognito-identity-js` will be mocked similarly via `jest.mock()`

### Integration Points

- `apps/mobile/app/_layout.tsx` — Production `authService` instance created here; currently imports `AuthProvider` from `../src/context/AuthContext` (Phase 3 concern, not Phase 2)
- `apps/mobile/src/context/AuthContext.tsx` — Phase 3 target; Phase 2 services are built independently and will be wired in by Phase 3
- `amazon-cognito-identity-js` — Already installed via `npx expo install` (Phase 1 plan 01-03); `cognitoService` wraps `AuthenticationDetails` + `CognitoUser` + `CognitoUserPool`

</code_context>

<specifics>
## Specific Ideas

- Mirror `apps/admin/src/auth/cognito.ts` structure as closely as the SRP flow allows — different auth flow (SRP vs PASSWORD_AUTH) but same module shape
- `cognitoService.signIn` must return `{ idToken: string }` on success (not the full TokenSet) — the mobile service intentionally discards access/refresh tokens; only the ID token is passed to validate-token
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Session persistence (expo-secure-store vs AsyncStorage) is Phase 3.
</deferred>

---

_Phase: 02-auth-service-layer_
_Context gathered: 2026-03-27_
