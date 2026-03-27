# Domain Pitfalls

**Domain:** Cognito SRP Authentication in React Native / Expo
**Project:** Pegasus Mobile — Driver Login
**Researched:** 2026-03-27
**Scope:** `apps/mobile` — Expo SDK 54, expo-router ~6.0.21, React Native 0.81.6

---

## Critical Pitfalls

Mistakes in this category cause silent auth failures, production crashes, or security vulnerabilities that require rewrites.

---

### Pitfall 1: Polyfill Import Order — Silent SRP Crash

**What goes wrong:** `amazon-cognito-identity-js` uses `crypto.getRandomValues()` during the SRP handshake to generate the client's SRP-A value. In React Native, this global does not exist until polyfilled. If the polyfill is imported _after_ the Cognito library (or anywhere other than the absolute top of the entry point), the SRP call silently produces `undefined` entropy or throws `TypeError: crypto.getRandomValues is not a function` at runtime — after the user has entered their password.

**Why it happens:** Metro evaluates module imports in dependency order. Any file that imports `amazon-cognito-identity-js` transitively triggers its module-level code before the polyfill has run if the entry point ordering is wrong. Developers often place polyfills inside the auth service file rather than the app entry point.

**Consequences:** Auth is completely broken; the error surfaces only after a login attempt, not on startup. The error message does not mention Cognito or crypto — it appears as a generic JS crash.

**Prevention:**

- Place these two imports as the _first two lines_ of `apps/mobile/index.ts` (or whichever file Expo Router uses as `"main"` — currently `"expo-router/entry"`). Since Expo Router controls the entry point, create `apps/mobile/index.js` as a re-export wrapper:
  ```js
  import 'react-native-get-random-values' // MUST be first
  import 'react-native-url-polyfill/auto'
  import 'expo-router/entry'
  ```
  Then change `"main"` in `package.json` to `"./index.js"`.
- Install: `react-native-get-random-values` and `react-native-url-polyfill`.
- Do not import polyfills inside the auth service or AuthContext — those execute too late.

**Detection:** Write a test that instantiates `CognitoUserPool` in a jsdom/React Native test environment and asserts that `crypto.getRandomValues` is defined before the import. If the SRP exchange in unit tests throws on BigInt/random operations, this pitfall is active.

**Phase:** Implement at the start of the auth service phase, before any SRP code is written.

---

### Pitfall 2: `storage.sync()` Not Called — `getCurrentUser()` Always Returns Null

**What goes wrong:** `amazon-cognito-identity-js` uses an in-memory store as its primary cache and AsyncStorage as a backing store. On a fresh app launch (cold start), the in-memory cache is empty. `userPool.getCurrentUser()` reads _only_ from in-memory cache — it returns `null` even when a valid session is stored in AsyncStorage. The `storage.sync()` call must complete first to hydrate the in-memory cache.

**Why it happens:** The library's dual-store design is not obvious from its API. Developers familiar with browser `localStorage` (synchronous) assume `getCurrentUser()` works immediately. In React Native the sync is async.

**Consequences:** Session restoration always fails on app restart. `isAuthenticated` stays `false` after every cold start. Users are forced to re-login after closing the app.

**Prevention:**

- In `AuthContext.checkSession()`, call `userPool.storage.sync()` and await its callback before calling `getCurrentUser()`:
  ```ts
  await new Promise<void>((resolve, reject) =>
    userPool.storage.sync((err, result) => {
      if (err) reject(err)
      else resolve()
    }),
  )
  const cognitoUser = userPool.getCurrentUser()
  ```
- Only after sync resolves should you call `getSession()` on the returned user.
- The existing `checkSession()` in `AuthContext.tsx` must follow this pattern; skipping it will look like auth works in Expo Go (where state sometimes persists in dev) but break in production builds.

**Detection:** Kill and reopen the app after login. If `isAuthenticated` is `false` despite a recent login, this pitfall is active.

**Phase:** Auth service implementation (first phase of auth work).

---

### Pitfall 3: Auth Guard Flicker — Wrong Screen Flashes Before Redirect

**What goes wrong:** The current `_layout.tsx` uses a `useEffect` to redirect unauthenticated users. There is an inherent render cycle gap: the component renders once with `isLoading = false, isAuthenticated = false` (the initial state defaults), starts the AsyncStorage read, renders any children that happen to be mounted, then redirects. On a fast device this appears as a white flash or a brief glimpse of the protected tab screen.

**Why it happens:** React renders synchronously; AsyncStorage reads are async. Between the first render and the first `useEffect` execution, the component tree is live. `isLoading` starts as `true` in the current `AuthContext` (correctly), but the guard depends on the `useEffect` in `_layout.tsx` — which runs _after_ paint.

**Consequences:** Users briefly see the authenticated UI before being redirected to login. On slower devices this flash is clearly visible and erodes trust. With biometric auth added later, this could expose content before auth completes.

**Prevention — Option A (Splash Screen, SDK 54, current):**
Keep the native splash screen visible until `isLoading` is resolved. This eliminates flicker entirely because users never see the JS UI until auth state is known:

```tsx
// In _layout.tsx or AuthProvider
import * as SplashScreen from 'expo-splash-screen'
SplashScreen.preventAutoHideAsync()
// In AuthProvider, after checkSession() resolves:
SplashScreen.hideAsync()
```

Install `expo-splash-screen` (already available in Expo SDK 54).

**Prevention — Option B (Stack.Protected, available in expo-router v6 / SDK 54+):**
expo-router v6 (which ships with SDK 54) includes `Stack.Protected`. Replacing the `useEffect`-based redirect with declarative guards eliminates the render-cycle race:

```tsx
<Stack.Protected guard={isAuthenticated}>
  <Stack.Screen name="(tabs)" />
</Stack.Protected>
```

This is evaluated before screen rendering rather than in a post-render effect.

The current `_layout.tsx` already handles the `isLoading` check correctly (shows spinner when loading), which prevents the worst case. The splash screen approach is the cleanest fix for the remaining gap.

**Detection:** Add a `console.log` in the tabs index screen. If it fires before login on a fresh install, the guard is not blocking render.

**Phase:** Auth service phase. Must be done before the mock auth is removed (removing mock auth eliminates the current "always authenticated in dev" safety net, exposing this bug immediately).

---

### Pitfall 4: Cognito App Client Has a Client Secret

**What goes wrong:** If the mobile Cognito app client is created with "Generate client secret" enabled, `amazon-cognito-identity-js` SRP authentication will fail with `NotAuthorizedException: Unable to verify secret hash for client`. The library does not compute `SECRET_HASH` by default; computing it requires HMAC-SHA256 with the client secret, which must be done manually before every Cognito API call.

**Why it happens:** The Cognito Console enables client secrets by default for some client types. Web client creation tutorials sometimes include secrets. The error message does not clearly state "remove the secret" — it says "unable to verify secret hash".

**Consequences:** Every SRP auth attempt fails. The fix requires deleting the app client and creating a new one (client secrets cannot be removed after creation).

**Prevention:**

- When creating the mobile Cognito app client in CDK: explicitly set `generateSecret: false`.
- Enable auth flows: `ALLOW_USER_SRP_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH` only. Do not enable `ALLOW_USER_PASSWORD_AUTH` (plaintext password over the wire).
- The CDK snippet:
  ```ts
  userPool.addClient('mobile-app-client', {
    generateSecret: false,
    authFlows: {
      userSrp: true,
    },
    refreshTokenValidity: Duration.days(30),
  })
  ```

**Detection:** Attempt SRP auth with the new client. `NotAuthorizedException: Unable to verify secret hash` is the definitive error.

**Phase:** Infrastructure / Cognito CDK phase. Must be verified before any auth code is written against it.

---

### Pitfall 5: `select-tenant` / SRP Auth Race — Wrong Tenant Injected into Token

**What goes wrong:** The Pegasus Pre-Token-Generation Lambda reads an `AuthSession` record (created by `POST /api/auth/select-tenant`) to inject `custom:tenantId` and `custom:role` into the Cognito token. The `AuthSession` is keyed by `sub` (Cognito user ID) and is intended to be ephemeral. If two login attempts for the same user are initiated concurrently or in rapid succession — or if a stale `AuthSession` from a previous login remains unexpired — the Pre-Token-Generation Lambda may pick up the wrong tenant record.

**Why it happens:** On mobile, users may tap "Log In" multiple times (network latency, impatience). The tenant selection API is called, then SRP is initiated. If the first call's SRP auth completes after the second call's `select-tenant`, the token is generated using the second tenant selection but applied to the first SRP session.

**Consequences:** A driver is authenticated into a tenant they did not select. On a shared-pool setup this is a cross-tenant data exposure — a driver from Company A sees Company B's moves.

**Prevention:**

- The auth service must serialize the login flow: disable the login button / show a loading state from the moment `select-tenant` is called until the token is validated or an error is returned. The current `AuthContext.login()` mock does this with a simple state; the replacement must maintain this guarantee.
- Consider including a request-scoped nonce in both the `select-tenant` call and the SRP `clientMetadata`, and validate the nonce in the Pre-Token-Generation Lambda.
- `AuthSession` records must have a short TTL (60–120 seconds) and be deleted after successful token validation.

**Detection:** Instrument the Pre-Token-Generation Lambda to log when it finds an `AuthSession` and the time elapsed since it was created. Log alerts on sessions older than 2 minutes indicate stale session risk.

**Phase:** Auth service implementation phase. Design the login flow as a strict sequential state machine before writing code.

---

## Moderate Pitfalls

---

### Pitfall 6: Custom Claims Only in ID Token, Not Access Token (by Default)

**What goes wrong:** The Pre-Token-Generation Lambda injects `custom:tenantId` and `custom:role` into the Cognito ID token. If the mobile app (or `validate-token` endpoint) reads claims from the access token instead of the ID token, these claims will be absent and the session will appear to have no tenant.

**Why it happens:** The access token is used for authorising API calls; the ID token carries user identity claims. Developers unfamiliar with this distinction pass the access token to `validate-token`. `amazon-cognito-identity-js` provides both via `getSession()` — it is easy to grab the wrong one.

**Consequences:** `tenantId` and `role` are undefined in the session; every API call after login fails with a 403.

**Prevention:**

- `amazon-cognito-identity-js` `CognitoUserSession.getIdToken().getJwtToken()` — this is the token to send to `POST /api/auth/validate-token`.
- `getAccessToken().getJwtToken()` should be used only if you need to call Cognito APIs directly (e.g., `GetUser`).
- Document this distinction explicitly in the auth service code with a comment.
- Note: Cognito's Pre-Token-Generation V2 event can add claims to the access token too, but that requires upgrading the Lambda trigger version and is not needed here.

**Detection:** Decode the JWT sent to `validate-token` (base64 decode the payload). If `custom:tenantId` is absent, the wrong token type is being sent.

**Phase:** Auth service implementation.

---

### Pitfall 7: Token Storage in Plain AsyncStorage — Unencrypted on Device

**What goes wrong:** The current `AuthContext` stores the session in `AsyncStorage` under `@moving_app_session`. `AsyncStorage` is unencrypted on both iOS and Android. On a rooted/jailbroken device, or via a backup extraction, the Cognito tokens (ID token, access token, refresh token) are readable in plaintext.

**Why it happens:** AsyncStorage is the obvious React Native storage primitive; its security implications are not surfaced in the API.

**Consequences:** Long-lived refresh tokens (30-day TTL) are exposed. An attacker with device access can replay the refresh token to obtain new access tokens indefinitely until expiry or revocation.

**Prevention:**

- Use `expo-secure-store` (already in the Expo SDK 54 ecosystem, no additional native install required for managed workflow) as the storage backend.
- Pass a custom storage adapter to `CognitoUserPool` via the `Storage` constructor option, or store the validated session (from `validate-token`) in `expo-secure-store` instead of AsyncStorage.
- `expo-secure-store` uses iOS Keychain and Android Keystore — hardware-backed encryption where available.
- Note: `expo-secure-store` has a 2048-byte value size limit per key. Cognito JWTs are typically 800–1200 bytes but can grow with many claims. Store the ID token, access token, and refresh token in separate keys.

**Detection:** After login, open the app's AsyncStorage database on a simulator. If the tokens are visible in plaintext, this pitfall is active.

**Phase:** Auth service implementation. Can be introduced alongside the real auth service rather than as a follow-on security hardening step.

---

### Pitfall 8: Expo Go Cannot Run the Polyfilled Auth Flow

**What goes wrong:** `react-native-get-random-values` requires native code to access the device's CSPRNG. Expo Go does not support arbitrary native modules. Running the auth-enabled app in Expo Go will throw `Native module RNGetRandomValues not found` or silently fall back to an insecure PRNG, making SRP produce bad output.

**Why it happens:** Expo Go is a convenient development tool, but it bundles a fixed set of native modules. Custom native modules — including `react-native-get-random-values` — are not included.

**Consequences:** The entire development workflow breaks if team members rely on Expo Go for testing. CI builds that use Expo Go simulation will fail.

**Prevention:**

- Switch to a **development build** (EAS Build or `npx expo run:ios` / `npx expo run:android`) for all auth-related development and testing.
- Document this in the repo: add a note to `apps/mobile/README.md` that Expo Go is not supported for this app once real auth is enabled.
- `expo-crypto` (bundled with SDK 54) provides `getRandomValues` and may work in Expo Go for some use cases, but is not a verified substitute for `react-native-get-random-values` with `amazon-cognito-identity-js`.

**Detection:** If the app starts in Expo Go without crashing, either the polyfill is not loaded or SRP is not being exercised. Run an actual login attempt.

**Phase:** Project setup / pre-auth-service phase. Establish the dev build workflow before writing auth code.

---

### Pitfall 9: `CognitoUserPool` Instantiated with Hardcoded Credentials

**What goes wrong:** The project requirement is to fetch `userPoolId` and `clientId` from `GET /api/auth/mobile-config` after tenant resolution, so credentials are not baked into the app bundle. If a developer instantiates `CognitoUserPool` at module load time (e.g., as a module-level constant), there are no credentials available yet — the pool will have `undefined` IDs or use a hardcoded fallback.

**Why it happens:** Most Cognito tutorials and examples show `new CognitoUserPool({ UserPoolId: '...', ClientId: '...' })` as a top-level constant. This is incompatible with the dynamic config requirement.

**Consequences:** Either the app leaks credentials (if hardcoded) or SRP fails with `InvalidParameterException: Neither UserPoolId nor ClientId are provided`.

**Prevention:**

- Instantiate `CognitoUserPool` lazily inside the auth service after `mobile-config` has been fetched and validated.
- Cache the instance for the session, but do not create it at module load time.
- The auth service should expose a `configure(poolId, clientId)` method called during the login flow, after tenant resolution.

**Detection:** Search the codebase for `new CognitoUserPool` — if it appears outside a function/class method, the pool is being created too early.

**Phase:** Auth service design. Address in the auth service interface design before implementation.

---

## Minor Pitfalls

---

### Pitfall 10: Token Expiry Not Checked on App Resume

**What goes wrong:** The project explicitly defers token refresh (out of scope for v1 — users re-login when expired). However, if `checkSession()` only validates that a session _exists_ in storage without checking `expiresAt`, users who left the app in the background for 60 minutes (Cognito ID token default expiry) are considered "authenticated" when they return. Their next API call returns a 401.

**Why it happens:** Session hydration reads the stored session object; it does not re-validate the JWT.

**Consequences:** Users see a 401 error on the first API call after resuming from background, with no explanation. The auth guard did not redirect them to login.

**Prevention:**

- Store `expiresAt` in the session (the `validate-token` endpoint returns this; the existing `AuthContextType` is being updated to include it).
- In `checkSession()`, after restoring from storage, check `Date.now() < session.expiresAt * 1000`. If expired, clear the session and set `isAuthenticated = false` before setting `isLoading = false`.
- This does not require token refresh — just expiry awareness.

**Detection:** Login, set device time forward 2 hours, background and foreground the app. If the app shows authenticated state and then 401s on API calls, expiry is not being checked.

**Phase:** Auth service implementation. Cheap to add when writing `checkSession()`.

---

### Pitfall 11: `SRP_A` Parameter Size Causes Unexpected `InvalidParameterException`

**What goes wrong:** The SRP-A value generated by `amazon-cognito-identity-js` is a large BigInt (2048-bit). On some React Native environments where the BigInt polyfill is incomplete or the `crypto.getRandomValues` replacement returns shorter values than expected, the SRP-A can be shorter than Cognito's minimum, causing `InvalidParameterException: SRP_A cannot be less than 2^1007`.

**Why it happens:** Incomplete polyfill chaining. If `react-native-get-random-values` is installed but its native module silently falls back (e.g., wrong JSI bridge version), it returns fewer random bytes.

**Prevention:**

- After installing `react-native-get-random-values`, write a startup assertion: `console.assert(crypto.getRandomValues(new Uint8Array(32)).length === 32)`.
- Use `npx expo run:ios --device` or a real device for auth testing — simulators occasionally have crypto edge cases.

**Detection:** `InvalidParameterException` with an SRP_A message from Cognito is the telltale sign.

**Phase:** Auth service implementation, caught during first SRP login test.

---

### Pitfall 12: Logout Does Not Invalidate the Cognito Session

**What goes wrong:** Clearing AsyncStorage (or SecureStore) removes the local session but does not call `cognitoUser.signOut()`. The Cognito refresh token remains valid for 30 days. If the device is shared or the token is extracted, a new session can be initiated without re-authentication.

**Why it happens:** Developers treat "delete local tokens" as equivalent to "log out". For auth systems backed by durable refresh tokens, it is not.

**Prevention:**

- The logout function must call `cognitoUser.signOut()` (which calls Cognito's `RevokeToken` endpoint to invalidate the refresh token) before clearing local storage.
- `cognitoUser.globalSignOut()` invalidates all sessions across devices — use this if the product requires "log out everywhere".

**Detection:** After local logout, attempt to use the previously-stored refresh token to obtain new credentials. If it succeeds, `signOut()` was not called.

**Phase:** Auth service implementation, logout path.

---

## Phase-Specific Warnings

| Phase Topic                        | Likely Pitfall                                         | Mitigation                                                                      |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Project setup / dev tooling        | Expo Go incompatibility with native crypto (Pitfall 8) | Establish EAS/dev build workflow before writing auth code                       |
| Entry point configuration          | Polyfill import order (Pitfall 1)                      | Create `index.js` wrapper; set as `"main"` in `package.json`                    |
| CDK Cognito app client creation    | Client secret on mobile client (Pitfall 4)             | `generateSecret: false` in CDK, verified in Cognito Console                     |
| Auth service — `checkSession`      | `storage.sync()` not called (Pitfall 2)                | Await sync before `getCurrentUser()`                                            |
| Auth service — login flow design   | `select-tenant` / SRP race (Pitfall 5)                 | Serialized state machine; disable button during flow                            |
| Auth service — token handling      | ID token vs access token confusion (Pitfall 6)         | Use `getIdToken()` for `validate-token`; document this                          |
| Auth service — session persistence | AsyncStorage unencrypted (Pitfall 7)                   | Use `expo-secure-store` with per-key storage for tokens                         |
| `_layout.tsx` auth guard           | Screen flicker (Pitfall 3)                             | `expo-splash-screen` + `Stack.Protected` (available in expo-router v6 / SDK 54) |
| `checkSession` restore             | Expired token treated as valid (Pitfall 10)            | Check `expiresAt` on restore; clear if expired                                  |
| Logout implementation              | Refresh token not revoked (Pitfall 12)                 | Call `cognitoUser.signOut()` before clearing storage                            |

---

## Sources

- [Authentication in Expo Router — Expo Docs](https://docs.expo.dev/router/advanced/authentication/) — HIGH confidence (official)
- [Protected Routes — Expo Docs](https://docs.expo.dev/router/advanced/protected/) — HIGH confidence (official, SDK 53+)
- [AWS SDK for JavaScript — Getting Started in React Native](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started-react-native.html) — HIGH confidence (official)
- [Pre-Token Generation Lambda Trigger — Amazon Cognito Docs](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html) — HIGH confidence (official)
- [Application-specific settings with app clients — Amazon Cognito Docs](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html) — HIGH confidence (official)
- [React Native Security — React Native Docs](https://reactnative.dev/docs/security) — HIGH confidence (official)
- [expo-secure-store — Expo Docs](https://docs.expo.dev/versions/latest/sdk/securestore/) — HIGH confidence (official)
- [amazon-cognito-identity-js storage.sync issue #615](https://github.com/amazon-archives/amazon-cognito-identity-js/issues/615) — MEDIUM confidence (community)
- [Screen flicker issue #675 — expo/router](https://github.com/expo/router/issues/675) — MEDIUM confidence (community)
- [Simplifying auth flows with protected routes — Expo Blog](https://expo.dev/blog/simplifying-auth-flows-with-protected-routes) — HIGH confidence (official Expo blog)
- [expo-crypto getRandomValues regression issue #22539](https://github.com/expo/expo/issues/22539) — MEDIUM confidence (community, SDK 54 relevant)
