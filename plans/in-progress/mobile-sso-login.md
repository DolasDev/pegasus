# Plan: Enable SSO Login on Mobile App

## Problem

Any user who can log in to the tenant web app should also be able to log in to the same tenant on the mobile "Moving & Storage" app. Today, this is **not** the case for SSO users:

- The **tenant web app** supports two auth paths:
  1. **SSO (OIDC/SAML)** — OAuth2 Authorization Code + PKCE flow through Cognito Hosted UI
  2. **Password** — Direct `USER_PASSWORD_AUTH` when no SSO providers are configured

- The **mobile app** only supports:
  1. **Password** — SRP authentication via `amazon-cognito-identity-js`

Users who authenticate via SSO on the web (the majority once SSO is configured) have **no Cognito password** and cannot use SRP. They are locked out of the mobile app entirely.

## Root Cause Analysis

| Component                                                             | Gap                                                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **CDK** (`packages/infra/lib/stacks/cognito-stack.ts:344-352`)        | Mobile app client has `authFlows: { userSrp: true }` only — no OAuth block, no callback URLs |
| **Mobile types** (`apps/mobile/src/auth/types.ts:35-39`)              | `TenantResolution` omits `providers` array — API returns them but mobile ignores them        |
| **Mobile auth service** (`apps/mobile/src/auth/authService.ts`)       | Only supports password-based `authenticate()` — no OAuth/PKCE flow                           |
| **Mobile login screen** (`apps/mobile/app/(auth)/login.tsx`)          | Only shows email → password steps; no SSO provider buttons                                   |
| **Mobile Cognito service** (`apps/mobile/src/auth/cognitoService.ts`) | Only implements SRP via `amazon-cognito-identity-js`                                         |
| **API mobile-config** (`apps/api/src/handlers/auth.ts:505-534`)       | Returns `{ userPoolId, clientId }` — missing Hosted UI domain needed for OAuth redirects     |

## Approach

Add OAuth2 Authorization Code + PKCE support to the mobile app, mirroring the tenant web app's SSO flow but using `expo-auth-session` / `expo-web-browser` for the redirect instead of a browser navigation.

### Flow After Changes

```
1. User enters email → POST /api/auth/resolve-tenants
2. API returns tenants WITH providers array
3. User selects tenant → POST /api/auth/select-tenant (creates AuthSession)
4. If providers exist → show SSO provider buttons
   If cognitoAuthEnabled only → show password form (existing SRP flow)
   If both → show both options
5. SSO tap → open Cognito Hosted UI in system browser (expo-web-browser)
   with PKCE challenge + identity_provider hint
6. IdP authenticates → redirect back to app via deep link (movingapp://auth/callback)
7. App exchanges code for tokens at Cognito /oauth2/token
8. POST /api/auth/validate-token with idToken → validated session
9. Store session in SecureStore
```

---

## Phase 1: Tests

Write tests first for all new/modified components. Tests should fail initially and pass after Phase 2 implementation.

### 1.1 — API: `/api/auth/mobile-config` returns OAuth fields

**File:** `apps/api/src/handlers/auth.test.ts`

Add test cases to the existing `mobile-config` describe block:

- `returns hostedUiDomain and redirectUri when COGNITO_HOSTED_UI_DOMAIN is set`
- `returns hostedUiDomain as null when env var is not set` (backwards compat)

The endpoint needs to return `{ userPoolId, clientId, hostedUiDomain, redirectUri }` so the mobile app can build OAuth URLs without hardcoding Cognito domain info.

### 1.2 — Mobile: `TenantResolution` type includes providers

**File:** `apps/mobile/src/auth/types.ts`

No test file needed — this is a type-only change. TypeScript will catch mismatches.

### 1.3 — Mobile: `authService.authenticateWithSso()`

**File:** `apps/mobile/src/auth/authService.test.ts`

Add test cases for a new `authenticateWithSso()` method on the auth service:

- `authenticateWithSso: fetches mobile config, calls oauthService.authorize, validates token`
- `authenticateWithSso: throws AuthError on oauthService failure`
- `authenticateWithSso: throws AuthError on validate-token failure`

The method orchestrates: fetchMobileConfig → oauthService.authorize() → POST /validate-token. Similar to existing `authenticate()` but calls an injected `oauthService` instead of `cognitoService.signIn`.

### 1.4 — Mobile: `oauthService` (PKCE + token exchange)

**File:** `apps/mobile/src/auth/oauthService.test.ts` (new)

- `generateCodeVerifier: returns 43+ character URL-safe string`
- `generateCodeChallenge: returns base64url SHA-256 of verifier`
- `authorize: opens browser with correct authorize URL params`
- `authorize: exchanges code for tokens on callback`
- `authorize: throws on user cancellation`
- `authorize: throws on missing code in callback`

This service wraps `expo-web-browser` and `expo-crypto` for PKCE. Tests mock these Expo modules.

### 1.5 — Mobile: `fetchMobileConfig` returns OAuth fields

**File:** `apps/mobile/src/auth/authService.test.ts`

Update the existing `fetchMobileConfig` test to assert the response includes `hostedUiDomain` and `redirectUri` fields (from the updated API).

### 1.6 — Mobile: Login screen shows SSO providers

**File:** `apps/mobile/app/(auth)/__tests__/login.test.tsx` (new)

- `shows SSO provider buttons when tenant has providers`
- `shows password form when tenant has cognitoAuthEnabled only`
- `shows both SSO buttons and password option when tenant has both`
- `calls authenticateWithSso when SSO provider button is tapped`
- `existing password flow still works when no providers`

### 1.7 — CDK: Mobile app client has OAuth configuration

**File:** `packages/infra/lib/__tests__/cognito-stack.test.ts` (update existing)

- `mobile app client has OAuth authorization code grant flow`
- `mobile app client has movingapp:// callback URL`
- `mobile app client SSM parameter for hosted UI domain exists`

---

## Phase 2: Implementation

### 2.1 — CDK: Add OAuth to mobile app client

**File:** `packages/infra/lib/stacks/cognito-stack.ts`

```diff
 this.mobileAppClient = this.userPool.addClient('MobileAppClient', {
   userPoolClientName: 'mobile-app-client',
   generateSecret: false,
-  authFlows: { userSrp: true },
+  authFlows: { userSrp: true, userPassword: false },
+  oAuth: {
+    flows: { authorizationCodeGrant: true },
+    scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
+    callbackUrls: ['movingapp://auth/callback'],
+    logoutUrls: ['movingapp://auth/logout'],
+  },
   idTokenValidity: cdk.Duration.hours(8),
   ...
 })
```

**Note:** The deep link scheme `movingapp` is already registered in `app.json` line 10 (`"scheme": "movingapp"`). For Expo development builds, also add `exp://` variants or use `AuthSession.makeRedirectUri()` which handles this automatically.

### 2.2 — API: Extend `/api/auth/mobile-config` response

**File:** `apps/api/src/handlers/auth.ts` (around line 505-534)

Add `COGNITO_HOSTED_UI_DOMAIN` env var to the mobile-config endpoint:

```typescript
const hostedUiDomain = process.env['COGNITO_HOSTED_UI_DOMAIN'] ?? null
// ...
return c.json({
  data: {
    userPoolId,
    clientId,
    hostedUiDomain, // null when not configured (backwards compat)
    redirectUri: 'movingapp://auth/callback',
  },
})
```

Also update the `MobileConfigQuery` Zod schema response if one exists.

**File:** `packages/infra/lib/stacks/api-stack.ts` (or wherever Lambda env vars are wired)

Pass `COGNITO_HOSTED_UI_DOMAIN` env var to the API Lambda from the Cognito stack's `hostedUiBaseUrl` output.

### 2.3 — Mobile: Update types

**File:** `apps/mobile/src/auth/types.ts`

```diff
+export type ProviderType = 'oidc' | 'saml'
+
+export type TenantProvider = {
+  id: string
+  name: string
+  type: ProviderType
+}
+
 export type TenantResolution = {
   tenantId: string
   tenantName: string
   cognitoAuthEnabled: boolean
+  providers: TenantProvider[]
 }

 export type MobileConfig = {
   userPoolId: string
   clientId: string
+  hostedUiDomain: string | null
+  redirectUri: string
 }
```

### 2.4 — Mobile: Add `oauthService`

**File:** `apps/mobile/src/auth/oauthService.ts` (new)

Implements PKCE helpers and the OAuth redirect flow:

```typescript
import * as WebBrowser from 'expo-web-browser'
import * as Crypto from 'expo-crypto'

export type OAuthConfig = {
  hostedUiDomain: string
  clientId: string
  redirectUri: string
}

export type OAuthResult = { idToken: string }

export function createOAuthService() {
  async function generateCodeVerifier(): Promise<string> { /* 43-128 char random */ }
  async function generateCodeChallenge(verifier: string): Promise<string> { /* SHA-256 base64url */ }

  async function authorize(
    config: OAuthConfig,
    providerId: string,
  ): Promise<OAuthResult> {
    const verifier = await generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = /* random string */

    const authorizeUrl = buildAuthorizeUrl(config, providerId, challenge, state)

    // Opens system browser, waits for deep link callback
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, config.redirectUri)

    if (result.type !== 'success') throw new AuthError('UserCancelled', 'SSO login cancelled')

    const code = extractCodeFromUrl(result.url)

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(config, code, verifier)
    return { idToken: tokens.id_token }
  }

  return { authorize, generateCodeVerifier, generateCodeChallenge }
}
```

**Dependencies to add:** `expo-web-browser`, `expo-crypto` (both already available in Expo SDK 55).

### 2.5 — Mobile: Extend `authService` with SSO method

**File:** `apps/mobile/src/auth/authService.ts`

Add `oauthService` to the dependency injection type and add `authenticateWithSso()`:

```typescript
type OAuthService = {
  authorize(config: OAuthConfig, providerId: string): Promise<{ idToken: string }>
}

type AuthServiceDeps = {
  apiBaseUrl: string
  cognitoService: CognitoService
  oauthService: OAuthService // new
}

// Inside createAuthService:
async function authenticateWithSso(tenantId: string, providerId: string): Promise<Session> {
  const config = await fetchMobileConfig(tenantId)

  if (!config.hostedUiDomain) {
    throw new AuthError('SsoNotConfigured', 'SSO is not configured for this environment')
  }

  const { idToken } = await oauthService.authorize(
    {
      hostedUiDomain: config.hostedUiDomain,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    },
    providerId,
  )

  // Same validate-token call as password flow
  const res = await fetch(`${apiBaseUrl}/api/auth/validate-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })

  if (!res.ok) throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
  const body = (await res.json()) as { data: Session }
  return body.data
}

return { fetchMobileConfig, authenticate, authenticateWithSso, resolveTenants, selectTenant }
```

### 2.6 — Mobile: Update `AuthContext`

**File:** `apps/mobile/src/context/AuthContext.tsx`

Add `loginWithSso(tenantId: string, providerId: string)` method alongside existing `login()`:

```typescript
const loginWithSso = async (tenantId: string, providerId: string) => {
  const session = await authService.authenticateWithSso(tenantId, providerId)
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session))
  setSession(session)
}
```

### 2.7 — Mobile: Update login screen for SSO

**File:** `apps/mobile/app/(auth)/login.tsx`

After email resolution returns tenants with providers:

1. When tenant has providers → show a new `'providers'` step with SSO buttons
2. When tenant has only `cognitoAuthEnabled` → show existing password step (no change)
3. When tenant has both → show providers step with a "Sign in with password" link at the bottom

New step in the flow:

```
email → (resolve tenants) → [tenant-picker if multiple] → providers → (SSO redirect)
                                                        → password  → (SRP auth)
```

The provider buttons render each `TenantProvider` as a touchable card with the provider name. Tapping calls `loginWithSso(tenantId, provider.id)`.

### 2.8 — Mobile: Wire up dependencies in `_layout.tsx`

**File:** `apps/mobile/app/_layout.tsx`

```diff
 import * as cognitoService from '../src/auth/cognitoService'
+import { createOAuthService } from '../src/auth/oauthService'

+const oauthService = createOAuthService()
 export const authService = createAuthService({
   apiBaseUrl: Constants.expoConfig?.extra?.EXPO_PUBLIC_API_URL ?? '',
   cognitoService,
+  oauthService,
 })
```

---

## Phase 3: Infrastructure Wiring

### 3.1 — Pass Hosted UI domain to API Lambda

**File:** `packages/infra/lib/stacks/api-stack.ts` (or equivalent)

The API Lambda needs `COGNITO_HOSTED_UI_DOMAIN` env var. Wire it from the CognitoStack's `hostedUiBaseUrl` property, similar to how `COGNITO_MOBILE_CLIENT_ID` is already passed.

### 3.2 — CDK snapshot tests

Update any CDK snapshot tests to reflect the new mobile app client OAuth configuration and the new Lambda env var.

---

## Files Changed Summary

| File                                                 | Action  | Description                                            |
| ---------------------------------------------------- | ------- | ------------------------------------------------------ |
| `packages/infra/lib/stacks/cognito-stack.ts`         | Modify  | Add OAuth config to mobile app client                  |
| `packages/infra/lib/stacks/api-stack.ts`             | Modify  | Pass COGNITO_HOSTED_UI_DOMAIN env var                  |
| `packages/infra/lib/__tests__/cognito-stack.test.ts` | Modify  | Add mobile OAuth tests                                 |
| `apps/api/src/handlers/auth.ts`                      | Modify  | Extend mobile-config response                          |
| `apps/api/src/handlers/auth.test.ts`                 | Modify  | Add mobile-config OAuth tests                          |
| `apps/mobile/src/auth/types.ts`                      | Modify  | Add providers to TenantResolution, extend MobileConfig |
| `apps/mobile/src/auth/oauthService.ts`               | **New** | PKCE + OAuth redirect via expo-web-browser             |
| `apps/mobile/src/auth/oauthService.test.ts`          | **New** | Tests for OAuth service                                |
| `apps/mobile/src/auth/authService.ts`                | Modify  | Add authenticateWithSso(), accept oauthService dep     |
| `apps/mobile/src/auth/authService.test.ts`           | Modify  | Add SSO auth tests                                     |
| `apps/mobile/src/context/AuthContext.tsx`            | Modify  | Add loginWithSso()                                     |
| `apps/mobile/src/context/AuthContext.test.tsx`       | Modify  | Add SSO login tests                                    |
| `apps/mobile/app/(auth)/login.tsx`                   | Modify  | Add SSO provider step/buttons                          |
| `apps/mobile/app/(auth)/__tests__/login.test.tsx`    | **New** | Login screen SSO tests                                 |
| `apps/mobile/app/_layout.tsx`                        | Modify  | Wire oauthService dependency                           |
| `apps/mobile/package.json`                           | Modify  | Add expo-web-browser, expo-crypto deps                 |

## Risks & Mitigations

| Risk                                                 | Mitigation                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deep link callback doesn't work in Expo Go           | Use `AuthSession.makeRedirectUri()` which returns `exp://` in dev and `movingapp://` in production builds                                             |
| CDK deploy changes Cognito app client (destructive?) | Adding OAuth to an existing client is non-destructive — Cognito merges the config. SRP continues to work.                                             |
| Pre-token Lambda already handles mobile client ID    | No change needed — the Lambda's tenant/mobile path already resolves tenants and injects claims regardless of auth flow (SRP or OAuth)                 |
| `validate-token` audience check                      | Already accepts `[tenantClientId, mobileClientId]` — mobile OAuth tokens will have the mobile client ID in the `aud` claim, which is already accepted |

## Out of Scope

- Refresh token handling (existing SRP flow doesn't use it either)
- Mobile logout that clears Cognito SSO session (can be added later)
- Biometric / passkey authentication
- MFA challenges on mobile (SSO delegates this to the IdP)
