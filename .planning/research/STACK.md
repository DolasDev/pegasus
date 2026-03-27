# Technology Stack: Cognito SRP Authentication for React Native / Expo

**Project:** Pegasus Mobile — Driver Login (Cognito SRP milestone)
**Researched:** 2026-03-27
**Scope:** Stack dimension only — adding Cognito SRP auth to the existing `apps/mobile` app (Expo ~54, React Native 0.81, expo-router ~6, React 19)

---

## Recommended Stack

### Core Auth Library

| Technology                   | Version   | Purpose                                      | Why                                                                                                                                                      |
| ---------------------------- | --------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amazon-cognito-identity-js` | `^6.3.16` | SRP authentication against Cognito User Pool | Pure JS, no native modules required, works in Expo managed workflow. Ships its own SRP implementation. Lighter than aws-amplify by a significant margin. |

**Confidence: HIGH** — This is the library explicitly named in the project constraints (PROJECT.md), and it is the correct choice. Version 6.3.16 is the latest release as of early 2026. The package is now developed inside the `aws-amplify/amplify-js` monorepo but still published independently as `amazon-cognito-identity-js`.

**Do NOT use `aws-amplify`** — It pulls in `@aws-amplify/react-native` as a peer, which requires native linking, does not support Expo Go, and was explicitly rejected in PROJECT.md as "too heavy". Amplify v6 dropped `amazon-cognito-identity-js` as a standalone dep inside its ecosystem and now manages it internally — this change only affects Amplify users, not direct consumers of `amazon-cognito-identity-js`.

**Do NOT use a custom SRP implementation** — The SRP math (BigInteger arithmetic, HKDF, HMAC-SHA256 over timestamp + pool name + secret block) is subtle and test-difficult. The library handles all challenge exchanges including `PASSWORD_VERIFIER`, `DEVICE_SRP_AUTH`, and `NEW_PASSWORD_REQUIRED`. Re-implementing this is not justified.

**Do NOT use `@aws-sdk/client-cognito-identity-provider` directly** — The AWS SDK v3 Cognito Identity Provider client exposes `InitiateAuth` / `RespondToAuthChallenge` but does not implement the SRP protocol itself. You would be writing the SRP math manually. Reserve this for admin-side or server-side Cognito operations only.

---

### Crypto Polyfill

| Technology                       | Version   | Purpose                                                            | Why                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-get-random-values` | `^1.11.0` | Polyfill `crypto.getRandomValues` for SRP random number generation | `amazon-cognito-identity-js` calls `window.crypto.getRandomValues()` during the SRP handshake. React Native's Hermes engine does not expose this natively. This is the standard polyfill. Compatible with Expo 54 / RN 0.81 (Expo's own dependency validator was updated to accept `~1.9.0`+). |

**Confidence: HIGH** — Required. Without it, authentication throws `"Native crypto module could not be used to get secure random number"` at runtime.

**Alternative considered: `expo-crypto`** — expo-crypto does expose `getRandomValues()` but it does not register itself as a global `crypto.getRandomValues` polyfill in the way that `react-native-get-random-values` does. `amazon-cognito-identity-js` looks for the global, not a module export. Stick with `react-native-get-random-values`.

**Import order is critical.** The polyfill MUST be the first import in the app's entry point — before any other library that relies on crypto. With expo-router, the `main` field in `package.json` points to `expo-router/entry`. You must create a custom entry point file and update `package.json` to point to it instead.

---

### Session Storage

| Technology                                  | Version                     | Purpose                                            | Why                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@react-native-async-storage/async-storage` | `2.2.0` (already installed) | Persist Cognito session tokens across app restarts | Already in the project. `amazon-cognito-identity-js` accepts a custom `Storage` adapter on the `CognitoUserPool` constructor. Passing AsyncStorage as this adapter means all tokens (ID, access, refresh) are automatically persisted by the library without manual token management. |

**Confidence: HIGH** — The `Storage` parameter on `CognitoUserPool({ UserPoolId, ClientId, Storage })` is how you wire AsyncStorage in. There is a critical gotcha (see below) — after a cold start, you must call `userPool.storage.sync()` before calling `getCurrentUser()`, because the library's in-memory cache is empty until sync populates it from AsyncStorage.

**Do NOT store tokens manually** — Do not read `session.getIdToken().getJwtToken()` and write it yourself to AsyncStorage in a separate key. The library manages a complete set of keys (IdToken, AccessToken, RefreshToken, LastAuthUser, clockDrift) keyed by pool ID and username. Storing tokens manually creates a second source of truth and breaks `getCurrentUser()` / session validation.

---

### No Additional Dependencies Required

The following are **NOT needed** for this milestone (token refresh is out of scope per PROJECT.md):

- `react-native-url-polyfill` — Not required. `amazon-cognito-identity-js` does not use the URL constructor. This polyfill is needed for the AWS SDK v3 but not for the Cognito identity JS library.
- `@aws-amplify/react-native` — Not needed. Only required if using the Amplify umbrella.
- Any background token refresh timer library — Token refresh is explicitly deferred to a future milestone.

---

## Installation

```bash
# From apps/mobile/
npx expo install amazon-cognito-identity-js react-native-get-random-values
```

Use `npx expo install` (not plain `npm install`) so Expo's version resolver can check compatibility with the installed Expo SDK version.

---

## Required Configuration Changes

### 1. Create a Custom Entry Point

The polyfill must load before expo-router initialises. The current `package.json` has `"main": "expo-router/entry"`. Change it to point to a new root-level file.

**`apps/mobile/index.ts`** (replace current content):

```typescript
import 'react-native-get-random-values' // MUST be first
import 'expo-router/entry'
```

**`apps/mobile/package.json`** — update `main`:

```json
{
  "main": "index.ts"
}
```

### 2. No Metro Config Changes Required

`amazon-cognito-identity-js` v6 ships as pre-bundled CommonJS that Metro resolves without any `resolver.extraNodeModules` shims. Unlike the AWS SDK v3, it does not require `stream`, `buffer`, or `crypto` Node.js module shimming in `metro.config.js`. No `metro.config.js` changes are needed for this library.

### 3. No Babel Config Changes Required

The existing `babel-preset-expo` handles all required transforms. No additional Babel plugins are needed.

---

## Runtime Usage Pattern

### CognitoUserPool — Construct with Runtime Config

The pool ID and client ID must come from the `GET /api/auth/mobile-config` endpoint (not baked into the app bundle). Construct the pool lazily after fetching config:

```typescript
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

function createUserPool(userPoolId: string, clientId: string): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: userPoolId,
    ClientId: clientId,
    Storage: AsyncStorage, // wire in AsyncStorage as the token store
  })
}
```

### SRP Authentication — Promise Wrapper

`authenticateUser` is callback-based. Wrap it in a Promise for use with async/await:

```typescript
function authenticateUserSRP(
  pool: CognitoUserPool,
  username: string,
  password: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const authDetails = new AuthenticationDetails({ Username: username, Password: password })
    const cognitoUser = new CognitoUser({ Username: username, Pool: pool, Storage: AsyncStorage })

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
      // MFA and password-reset challenges are out of scope for v1
      // but must be declared to satisfy the callback interface
      newPasswordRequired: () => reject(new Error('NEW_PASSWORD_REQUIRED')),
      mfaRequired: () => reject(new Error('MFA_REQUIRED')),
    })
  })
}
```

Note: `CognitoUser` also takes a `Storage` parameter — it must match the pool's storage or session restoration will silently fail.

### Session Restoration on Cold Start

```typescript
async function restoreSession(pool: CognitoUserPool): Promise<CognitoUserSession | null> {
  // sync() populates in-memory cache from AsyncStorage
  await new Promise<void>((resolve, reject) =>
    pool.storage.sync((err, result) => (result === 'SUCCESS' ? resolve() : reject(err))),
  )
  const user = pool.getCurrentUser()
  if (!user) return null

  return new Promise((resolve, reject) =>
    user.getSession((err: Error | null, session: CognitoUserSession | null) =>
      err ? reject(err) : resolve(session),
    ),
  )
}
```

`getSession` validates token expiry and triggers a silent refresh using the refresh token if the access token has expired — even though we are not building explicit refresh UI, the library handles it transparently here.

---

## Alternatives Considered

| Category        | Recommended                          | Alternative                                 | Why Not                                                                                                          |
| --------------- | ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Auth library    | `amazon-cognito-identity-js`         | `aws-amplify`                               | Too heavy, requires native linking, Expo Go incompatible, contradicts project constraints                        |
| Auth library    | `amazon-cognito-identity-js`         | Custom SRP                                  | Non-trivial crypto math, high risk, no justification when library exists                                         |
| Auth library    | `amazon-cognito-identity-js`         | `@aws-sdk/client-cognito-identity-provider` | No SRP implementation — you would write the SRP math yourself                                                    |
| Crypto polyfill | `react-native-get-random-values`     | `expo-crypto`                               | Does not register as global; `amazon-cognito-identity-js` needs `window.crypto.getRandomValues` globally patched |
| Session storage | `AsyncStorage` (via `Storage` param) | Manual token storage                        | Creates dual source of truth, breaks `getCurrentUser()`, requires reimplementing expiry tracking                 |

---

## Confidence Assessment

| Area                                          | Confidence | Notes                                                                                                                                                                                                               |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library choice (`amazon-cognito-identity-js`) | HIGH       | Explicitly mandated in PROJECT.md; confirmed as the correct pure-JS SRP option                                                                                                                                      |
| Version (6.3.16)                              | HIGH       | Confirmed as latest stable from npm registry as of early 2026                                                                                                                                                       |
| Crypto polyfill requirement                   | HIGH       | Confirmed from official npm README and community reports; missing it causes runtime crash                                                                                                                           |
| Entry point polyfill order                    | MEDIUM     | Pattern confirmed from expo-router community discussions; `expo-router/entry` must come last                                                                                                                        |
| No Metro config changes needed                | MEDIUM     | Confirmed by absence of any community reports of Metro shim issues with `amazon-cognito-identity-js` v6 specifically; v5 had issues but v6 ships pre-bundled CJS                                                    |
| `storage.sync()` required on cold start       | HIGH       | Confirmed in official README and multiple community reports; omitting it causes `getCurrentUser()` to return null after app restart                                                                                 |
| Token refresh via `getSession`                | MEDIUM     | Standard library behaviour; `getSession` does call `refreshSession` internally when access token expired — verified from SDK source and community examples, but not tested against this specific pool configuration |

---

## Sources

- [amazon-cognito-identity-js npm package](https://www.npmjs.com/package/amazon-cognito-identity-js)
- [AWS SDK for JavaScript v3 — Getting Started with React Native](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started-react-native.html)
- [react-native-get-random-values npm package](https://www.npmjs.com/package/react-native-get-random-values)
- [Expo Crypto documentation](https://docs.expo.dev/versions/latest/sdk/crypto/)
- [Expo SDK 54 changelog](https://expo.dev/changelog/sdk-54)
- [AWS Cognito: Amplify vs amazon-cognito-identity-js vs AWS SDK (maxivanov.io)](https://www.maxivanov.io/aws-cognito-amplify-vs-amazon-cognito-identity-js-vs-aws-sdk/)
- [Amplify v6 React Native migration — expo/expo Discussion #25586](https://github.com/expo/expo/discussions/25586)
- [expo-router polyfill import order — expo/router Discussion #935](https://github.com/expo/router/discussions/935)
- [amazon-cognito-identity-js issue #615 — storage.sync() pattern](https://github.com/amazon-archives/amazon-cognito-identity-js/issues/615)
