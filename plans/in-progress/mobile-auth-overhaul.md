# Plan: Mobile Auth Overhaul — Bake Config & Complete SSO

## Background

This plan consolidates two previously separate efforts:

1. **Auth overhaul** — Bake Cognito config into the mobile app via `EXPO_PUBLIC_*` env vars, eliminating a per-login network call (`fetchMobileConfig`) and cutting login time from ~15-40s to ~5-8s.
2. **SSO login** — Add OAuth2 PKCE login to the mobile app so SSO users can sign in.

The SSO work is **already implemented**: `oauthService`, `authenticateWithSso`, `loginWithSso`, the providers login step, CDK OAuth config on the mobile client, and updated types are all in place. What remains is the auth overhaul — baking config into env vars, removing `fetchMobileConfig`, and wiring deploy/build config.

## Problem

Mobile login takes ~15-40s vs ~5s on web. Root cause: the mobile app fetches Cognito config from the API on every login attempt (`GET /api/auth/mobile-config`), adding a sequential network call. The web app bakes config at deploy time and reads it from memory.

### Current Mobile Flow (3 sequential network calls per login)

```
1. fetchMobileConfig(tenantId)           → ~1-2s  (GET /api/auth/mobile-config)
2. cognitoService.signIn(email, pw, ...) → ~10-15s (POST cognito-idp)
3. POST /api/auth/validate-token         → ~2-3s
                                         ────────
                                         ~15-20s minimum (+ phone latency)
```

### Target Flow (config from memory, 2 network calls)

```
0. Config loaded once at app startup from baked-in constants (0ms)
1. cognitoService.signIn(email, pw, ...) → ~3-5s
2. POST /api/auth/validate-token         → ~2-3s
                                         ────────
                                         ~5-8s
```

The config is **identical for all tenants** — one User Pool, one mobile app client. The `tenantId` parameter only validates the tenant exists (which `select-tenant` already does). The entire `fetchMobileConfig` call is unnecessary.

---

## Phase 1: Mobile Config Module

Create `apps/mobile/src/config.ts` — the mobile equivalent of `apps/tenant-web/src/config.ts`.

### 1.1 — Add `EXPO_PUBLIC_*` env vars to `.env.example`

**File:** `apps/mobile/.env.example`

Add:

```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_COGNITO_REGION=us-east-1
EXPO_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxx
EXPO_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_COGNITO_DOMAIN=https://pegasus-123456789.auth.us-east-1.amazoncognito.com
EXPO_PUBLIC_COGNITO_REDIRECT_URI=movingapp://auth/callback
```

### 1.2 — Create `apps/mobile/src/config.ts`

**File:** `apps/mobile/src/config.ts` (new)

```typescript
export type MobileConfig = {
  apiUrl: string
  cognito: {
    region: string
    userPoolId: string
    clientId: string
    domain: string | null
    redirectUri: string
  }
}

export function getMobileConfig(): MobileConfig {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL
  const region = process.env.EXPO_PUBLIC_COGNITO_REGION
  const userPoolId = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID
  const clientId = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID
  const domain = process.env.EXPO_PUBLIC_COGNITO_DOMAIN || null
  const redirectUri = process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI

  if (!apiUrl || !region || !userPoolId || !clientId || !redirectUri) {
    throw new Error(
      'Missing required EXPO_PUBLIC_COGNITO_* env vars. ' + 'Check .env or eas.json build profile.',
    )
  }

  return {
    apiUrl,
    cognito: { region, userPoolId, clientId, domain, redirectUri },
  }
}
```

### 1.3 — Tests for `config.ts`

**File:** `apps/mobile/src/config.test.ts` (new)

Test cases:

- `getMobileConfig: returns config from EXPO_PUBLIC_* env vars`
- `getMobileConfig: throws when EXPO_PUBLIC_API_URL is missing`
- `getMobileConfig: throws when EXPO_PUBLIC_COGNITO_USER_POOL_ID is missing`
- `getMobileConfig: throws when EXPO_PUBLIC_COGNITO_CLIENT_ID is missing`
- `getMobileConfig: throws when EXPO_PUBLIC_COGNITO_REDIRECT_URI is missing`
- `getMobileConfig: returns domain as null when EXPO_PUBLIC_COGNITO_DOMAIN is empty`

---

## Phase 2: Refactor Auth Service to Use Baked Config

### 2.1 — Update `authService` to accept config instead of fetching it

**File:** `apps/mobile/src/auth/authService.ts`

Change the dependency injection from `apiBaseUrl: string` to `config: MobileConfig`. Remove `fetchMobileConfig()` entirely.

```typescript
import type { MobileConfig } from '../config'

type AuthServiceDeps = {
  config: MobileConfig // was: apiBaseUrl: string
  cognitoService: CognitoService
  oauthService: OAuthService
}

export function createAuthService({ config, cognitoService, oauthService }: AuthServiceDeps) {
  const { apiUrl, cognito } = config

  async function authenticate(email: string, password: string, tenantId: string): Promise<Session> {
    // Config comes from baked-in constants — no network call
    const { idToken } = await cognitoService.signIn(
      email,
      password,
      cognito.userPoolId,
      cognito.clientId,
    )

    const res = await fetch(`${apiUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (!res.ok) throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
    const body = (await res.json()) as { data: Session }
    return body.data
  }

  async function authenticateWithSso(tenantId: string, providerId: string): Promise<Session> {
    if (!cognito.domain) {
      throw new AuthError('SsoNotConfigured', 'SSO is not configured for this environment')
    }

    const { idToken } = await oauthService.authorize(
      {
        hostedUiDomain: cognito.domain,
        clientId: cognito.clientId,
        redirectUri: cognito.redirectUri,
      },
      providerId,
    )

    const res = await fetch(`${apiUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (!res.ok) throw new AuthError('ValidateTokenFailed', `validate-token returned ${res.status}`)
    const body = (await res.json()) as { data: Session }
    return body.data
  }

  // resolveTenants and selectTenant unchanged — use apiUrl instead of apiBaseUrl
  async function resolveTenants(email: string): Promise<TenantResolution[]> {
    /* ... */
  }
  async function selectTenant(email: string, tenantId: string): Promise<void> {
    /* ... */
  }

  return { authenticate, authenticateWithSso, resolveTenants, selectTenant }
}
```

Key changes:

- `fetchMobileConfig()` **removed** — config comes from `getMobileConfig()` at app startup
- `authenticate()` goes from 3 sequential network calls to 2
- `authenticateWithSso()` goes from 3 sequential network calls to 2
- `apiBaseUrl` replaced by `config.apiUrl`

### 2.2 — Update `_layout.tsx` to use baked config

**File:** `apps/mobile/app/_layout.tsx`

```typescript
import { getMobileConfig } from '../src/config'

const config = getMobileConfig() // Fails fast at startup if env vars missing

export const authService = createAuthService({
  config, // was: apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? ''
  cognitoService,
  oauthService,
})
```

### 2.3 — Update `authService.test.ts`

**File:** `apps/mobile/src/auth/authService.test.ts`

Update all tests:

- Replace `apiBaseUrl` with a `config: MobileConfig` object in test setup
- Remove all `fetchMobileConfig` tests (method no longer exists)
- Verify `authenticate()` makes exactly 1 fetch call (validate-token only), not 2
- Verify `authenticateWithSso()` uses `cognito.domain` from baked config
- Verify `authenticateWithSso()` throws `SsoNotConfigured` when domain is null

Test cases to remove:

- `fetchMobileConfig: returns config on success`
- `fetchMobileConfig: throws AuthError on non-2xx`
- Any test asserting `fetchMobileConfig` is called during `authenticate()`

### 2.4 — Update `AuthContext` types

**File:** `apps/mobile/src/context/AuthContext.tsx`

The `AuthProviderProps.authService` type should no longer include `fetchMobileConfig`. Verify the type matches the new return type of `createAuthService()`. No functional changes — context just calls `authService.authenticate()` and `authService.authenticateWithSso()`.

### 2.5 — Update `AuthContext.test.tsx`

**File:** `apps/mobile/src/context/AuthContext.test.tsx`

Remove `fetchMobileConfig` from the mock `authService` object if present.

---

## Phase 3: Deploy Script & Build Config

### 3.1 — Add Cognito env vars to `eas.json`

**File:** `apps/mobile/eas.json`

Add the Cognito env vars to each build profile:

```json
{
  "build": {
    "preview": {
      "env": {
        "EXPO_PUBLIC_ENV": "preview",
        "EXPO_PUBLIC_API_URL": "https://API_URL_FROM_CDK",
        "EXPO_PUBLIC_COGNITO_REGION": "us-east-1",
        "EXPO_PUBLIC_COGNITO_USER_POOL_ID": "us-east-1_XXXXX",
        "EXPO_PUBLIC_COGNITO_CLIENT_ID": "XXXXX",
        "EXPO_PUBLIC_COGNITO_DOMAIN": "https://pegasus-XXXXX.auth.us-east-1.amazoncognito.com",
        "EXPO_PUBLIC_COGNITO_REDIRECT_URI": "movingapp://auth/callback"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_ENV": "production",
        "EXPO_PUBLIC_API_URL": "https://API_URL_FROM_CDK",
        "EXPO_PUBLIC_COGNITO_REGION": "us-east-1",
        "EXPO_PUBLIC_COGNITO_USER_POOL_ID": "us-east-1_XXXXX",
        "EXPO_PUBLIC_COGNITO_CLIENT_ID": "XXXXX",
        "EXPO_PUBLIC_COGNITO_DOMAIN": "https://pegasus-XXXXX.auth.us-east-1.amazoncognito.com",
        "EXPO_PUBLIC_COGNITO_REDIRECT_URI": "movingapp://auth/callback"
      }
    }
  }
}
```

**Note:** In practice these come from CDK outputs or EAS Secrets. The deploy script in 3.2 generates a `.env.deploy` from CDK outputs for local dev and CI consumption.

### 3.2 — Add mobile config generation to deploy script

**File:** `packages/infra/deploy.sh`

After CDK deploy completes and outputs are written (after line 110), generate a `.env.deploy` file:

```bash
# ── Generate mobile .env from CDK outputs ─────────────────────────────────
COGNITO_USER_POOL_ID=$(jq -r '.["pegasus-dev-cognito"].UserPoolId // empty' "$OUTPUTS_FILE" 2>/dev/null || true)
COGNITO_MOBILE_CLIENT_ID=$(jq -r '.["pegasus-dev-cognito"].MobileClientId // empty' "$OUTPUTS_FILE" 2>/dev/null || true)
COGNITO_HOSTED_UI_DOMAIN=$(jq -r '.["pegasus-dev-cognito"].HostedUiBaseUrl // empty' "$OUTPUTS_FILE" 2>/dev/null || true)

MOBILE_ENV_FILE="$REPO_ROOT/apps/mobile/.env.deploy"

if [[ -n "$API_URL" && -n "$COGNITO_USER_POOL_ID" && -n "$COGNITO_MOBILE_CLIENT_ID" ]]; then
  cat > "$MOBILE_ENV_FILE" <<ENVEOF
# Generated by deploy.sh — do not edit manually
EXPO_PUBLIC_API_URL=$API_URL
EXPO_PUBLIC_COGNITO_REGION=us-east-1
EXPO_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID
EXPO_PUBLIC_COGNITO_CLIENT_ID=$COGNITO_MOBILE_CLIENT_ID
EXPO_PUBLIC_COGNITO_DOMAIN=$COGNITO_HOSTED_UI_DOMAIN
EXPO_PUBLIC_COGNITO_REDIRECT_URI=movingapp://auth/callback
ENVEOF
  echo "   Mobile .env:     $MOBILE_ENV_FILE"
fi
```

### 3.3 — Add `.env.deploy` to `.gitignore`

**File:** `apps/mobile/.gitignore`

Add `.env.deploy` so generated deploy env files aren't committed.

---

## Phase 4: Test Infrastructure & Jest Setup

### 4.1 — Add `EXPO_PUBLIC_COGNITO_*` env vars to jest setup

**File:** `apps/mobile/jest.setup.js`

Add env vars so `getMobileConfig()` works in tests:

```javascript
process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3000'
process.env.EXPO_PUBLIC_COGNITO_REGION = 'us-east-1'
process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_TestPool123'
process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = 'test-mobile-client-id'
process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'https://pegasus-test.auth.us-east-1.amazoncognito.com'
process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI = 'movingapp://auth/callback'
```

### 4.2 — Verify layout test still works

Verify `__tests__/app/_layout.test.tsx` works with the new config pattern. The mock env vars from 4.1 ensure `getMobileConfig()` succeeds.

---

## Phase 5: Clean Up Deprecated Code

### 5.1 — Remove `MobileConfig` type from `types.ts`

**File:** `apps/mobile/src/auth/types.ts`

The `MobileConfig` type was used by `fetchMobileConfig()`. It's now defined in `config.ts`. Remove from `types.ts` to avoid confusion.

### 5.2 — Mark `GET /api/auth/mobile-config` as deprecated

**File:** `apps/api/src/handlers/auth.ts`

Add a deprecation comment and log line. Do NOT remove — older app versions may still call it:

```typescript
logger.info('mobile-config: DEPRECATED — mobile app should use baked-in config')
```

### 5.3 — Verify no remaining imports of `fetchMobileConfig`

Grep the codebase for any remaining references to `fetchMobileConfig` and remove them.

---

## Files Changed Summary

| File                                           | Action  | Phase |
| ---------------------------------------------- | ------- | ----- |
| `apps/mobile/.env.example`                     | Modify  | 1     |
| `apps/mobile/src/config.ts`                    | **New** | 1     |
| `apps/mobile/src/config.test.ts`               | **New** | 1     |
| `apps/mobile/src/auth/authService.ts`          | Modify  | 2     |
| `apps/mobile/src/auth/authService.test.ts`     | Modify  | 2     |
| `apps/mobile/src/context/AuthContext.tsx`      | Modify  | 2     |
| `apps/mobile/src/context/AuthContext.test.tsx` | Modify  | 2     |
| `apps/mobile/app/_layout.tsx`                  | Modify  | 2     |
| `apps/mobile/eas.json`                         | Modify  | 3     |
| `packages/infra/deploy.sh`                     | Modify  | 3     |
| `apps/mobile/.gitignore`                       | Modify  | 3     |
| `apps/mobile/jest.setup.js`                    | Modify  | 4     |
| `apps/mobile/src/auth/types.ts`                | Modify  | 5     |
| `apps/api/src/handlers/auth.ts`                | Modify  | 5     |

## Performance Impact

| Metric                             | Before          | After          |
| ---------------------------------- | --------------- | -------------- |
| Network calls per login (password) | 3 sequential    | 2 sequential   |
| Network calls per login (SSO)      | 3 sequential    | 2 sequential   |
| Config load time                   | ~1-2s per login | 0ms (baked in) |
| Estimated total login time         | ~15-40s         | ~5-8s          |

## Risks & Mitigations

| Risk                                       | Mitigation                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Config changes require app rebuild         | Same trade-off as web app. Cognito config rarely changes.                          |
| Old app versions still call mobile-config  | Endpoint kept but deprecated. No breaking change.                                  |
| Missing env vars crash at startup          | `getMobileConfig()` throws immediately with clear error — fail-fast.               |
| EAS Build needs secrets for Cognito values | Deploy script generates `.env.deploy`; EAS Secrets or pre-build hook injects them. |

## Out of Scope

- Refresh token handling (neither web nor mobile uses it currently)
- Removing the `mobile-config` API endpoint entirely (backwards compat)
- MFA challenge handling on mobile
- Token caching / offline support
- Mobile logout that clears Cognito SSO session
- Biometric / passkey authentication
