# Plan: Extract shared PKCE + Cognito auth utilities

**Branch:** TBD (create from main)
**Goal:** Extract duplicated PKCE helpers and Cognito REST wrappers into `@pegasus/auth` shared package, consumed by tenant-web, admin-web, and mobile.

## Problem

Three apps independently implement the same auth primitives:

| Utility                       | tenant-web        | admin-web                 | mobile                       |
| ----------------------------- | ----------------- | ------------------------- | ---------------------------- |
| PKCE code verifier generation | `auth/pkce.ts`    | `auth/cognito.ts:149-175` | `auth/oauthService.ts:17-32` |
| base64url encoding            | `auth/pkce.ts`    | `auth/cognito.ts:149-155` | `auth/oauthService.ts:6-14`  |
| State/nonce generation        | `auth/pkce.ts`    | `auth/cognito.ts:171-175` | `auth/oauthService.ts:38-40` |
| Cognito REST API wrapper      | `auth/cognito.ts` | `auth/cognito.ts:41-63`   | `auth/cognitoService.ts`     |
| Session type                  | `auth/session.ts` | N/A                       | `auth/types.ts`              |
| AuthError/CognitoError        | `auth/cognito.ts` | `auth/cognito.ts:31-39`   | `auth/types.ts`              |

## Approach

Extract pure, platform-agnostic utilities into `packages/auth/`. Keep platform-specific wiring (sessionStorage, SecureStore, expo-web-browser) in each app.

## Checklist

### Step 1 — Create @pegasus/auth package scaffold

- [ ] `packages/auth/package.json` — name `@pegasus/auth`, private, vitest + typescript devDeps
- [ ] `packages/auth/tsconfig.json` — extends `../../tsconfig.base.json`
- [ ] `packages/auth/src/index.ts` — barrel export

### Step 2 — Extract PKCE utilities (TDD)

- [ ] Write `packages/auth/src/__tests__/pkce.test.ts`:
  - `generateCodeVerifier()` returns 43-character base64url string
  - `generateCodeChallenge(verifier)` returns base64url SHA-256 hash
  - `generateState()` returns base64url string
  - `base64UrlEncode(buffer)` produces URL-safe characters (no +, /, =)
- [ ] Implement `packages/auth/src/pkce.ts` — pure functions using `crypto.subtle` (works in browser, Node, and React Native with expo-crypto polyfill)
- [ ] Tests pass

### Step 3 — Extract Cognito REST client (TDD)

- [ ] Write `packages/auth/src/__tests__/cognito-client.test.ts`:
  - `cognitoApiRequest(region, target, body)` sends POST to correct URL with correct headers
  - On non-2xx, throws `CognitoError` with `__type` as code
  - On 2xx, returns parsed JSON body
- [ ] Implement `packages/auth/src/cognito-client.ts`:
  - `CognitoError` class (exported)
  - `cognitoApiRequest(region, target, body)` — pure fetch wrapper
- [ ] Tests pass

### Step 4 — Extract shared Session type

- [ ] Add `packages/auth/src/session.ts`:
  - Export `Session` type (shared between tenant-web and mobile)
  - Export `isSessionExpired(session)` utility
- [ ] Write test for `isSessionExpired`

### Step 5 — Update consumers

- [ ] `apps/tenant-web/` — import PKCE functions from `@pegasus/auth`, delete local `auth/pkce.ts`
- [ ] `apps/admin-web/` — import PKCE + cognitoApiRequest from `@pegasus/auth`, remove duplicated helpers from `auth/cognito.ts` (keep app-specific flows like `signIn`, `signOut`, `getAuthorizationUrl` that orchestrate the primitives)
- [ ] `apps/mobile/` — import PKCE + cognitoApiRequest from `@pegasus/auth`, simplify `oauthService.ts` and `cognitoService.ts`
- [ ] Update `Session` imports in tenant-web and mobile to use `@pegasus/auth`

### Step 6 — Verify

- [ ] `node node_modules/.bin/turbo run test`
- [ ] `node node_modules/.bin/turbo run typecheck`

## Files created

- `packages/auth/package.json`
- `packages/auth/tsconfig.json`
- `packages/auth/src/index.ts`
- `packages/auth/src/pkce.ts`
- `packages/auth/src/cognito-client.ts`
- `packages/auth/src/session.ts`
- `packages/auth/src/__tests__/pkce.test.ts`
- `packages/auth/src/__tests__/cognito-client.test.ts`
- `packages/auth/src/__tests__/session.test.ts`

## Files modified

- `apps/tenant-web/src/auth/pkce.ts` (delete, replaced by @pegasus/auth)
- `apps/tenant-web/src/auth/cognito.ts` (import from @pegasus/auth)
- `apps/tenant-web/src/auth/session.ts` (import Session type from @pegasus/auth)
- `apps/admin-web/src/auth/cognito.ts` (import PKCE + cognitoApiRequest from @pegasus/auth)
- `apps/mobile/src/auth/oauthService.ts` (import PKCE from @pegasus/auth)
- `apps/mobile/src/auth/cognitoService.ts` (import cognitoApiRequest from @pegasus/auth)
- `apps/mobile/src/auth/types.ts` (import Session from @pegasus/auth, keep AuthError locally or move it)

## Risks

- Mobile uses `expo-crypto` for `getRandomValues`. The shared PKCE module should use `crypto.getRandomValues` which is standard Web Crypto — verify it works in Hermes runtime (Expo SDK 55+ polyfills this).
- The Cognito REST client uses `globalThis.fetch` — React Native and all modern browsers have this.

## What stays app-specific

- Token storage (sessionStorage vs SecureStore vs nothing)
- OAuth flow orchestration (redirect URL construction, callback handling)
- Sign-in / sign-out orchestration (each app's flow is different)
- Token refresh (when implemented)
