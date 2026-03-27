# Project Research Summary

**Project:** Pegasus Mobile — Driver Login
**Domain:** Multi-tenant Cognito SRP authentication for React Native / Expo
**Researched:** 2026-03-27
**Confidence:** HIGH

## Executive Summary

This project replaces mock authentication in the existing Expo mobile driver portal with real AWS Cognito SRP authentication, wired through the existing Pegasus multi-tenant API. The implementation pattern is well-established: `amazon-cognito-identity-js` performs the SRP challenge exchange in pure JS (no native modules, Expo-managed workflow compatible); the app never hardcodes Cognito credentials (they are fetched per-tenant from a new `GET /api/auth/mobile-config` endpoint); and the flow is two-step — email submitted first for tenant resolution, password submitted second against the resolved tenant's Cognito pool. This mirrors the existing web tenant login flow exactly and reuses all three existing server-side auth endpoints (`resolve-tenants`, `select-tenant`, `validate-token`).

The recommended architecture separates concerns into four strict layers: UI screens, `AuthContext` (session state machine), `authService` (stateless flow coordinator), and `cognitoService` (Cognito SDK wrapper). Each layer is independently testable and each imports only from the layer below it. The auth state machine is driven from `AuthContext`, not from local component state — this is the key design decision that prevents the majority of the session-corruption and back-navigation bugs that plague mobile auth implementations.

The primary risks are infrastructure-level (the new mobile Cognito app client must have `generateSecret: false` and `ALLOW_USER_SRP_AUTH` enabled — if misconfigured it cannot be fixed without deleting and recreating the client) and a subtle startup pitfall (`storage.sync()` must be awaited before `getCurrentUser()` or session restore silently fails on every cold start). Both are easily prevented if addressed early in the correct build order. A development build is required from day one — Expo Go does not support the native crypto module that powers SRP.

---

## Key Findings

### Recommended Stack

The stack is minimal and tightly constrained by the project requirements. Only two new dependencies are needed: `amazon-cognito-identity-js` (pure JS SRP) and `react-native-get-random-values` (crypto polyfill required by the SRP implementation). `AsyncStorage` is already installed. No changes to Metro config or Babel config are required for `amazon-cognito-identity-js` v6, which ships pre-bundled CommonJS.

**Core technologies:**

- `amazon-cognito-identity-js ^6.3.16`: SRP authentication against Cognito User Pool — pure JS, no native linking, explicitly required by project constraints; lighter than Amplify by design
- `react-native-get-random-values ^1.11.0`: Polyfill for `crypto.getRandomValues` — required at runtime; missing it causes a silent crash during the SRP handshake; must be the first import in the app entry point
- `@react-native-async-storage/async-storage 2.2.0` (already installed): Token-store adapter passed to `CognitoUserPool` via the `Storage` constructor option — lets the library manage its own keys; avoids manual token juggling
- `expo-secure-store` (already in SDK 54): Encrypted storage for the validated `Session` object — iOS Keychain / Android Keystore backed; do not use plain AsyncStorage for bearer tokens

**Critical configuration:** `apps/mobile/package.json` `"main"` must point to a new `index.ts` wrapper that imports `react-native-get-random-values` before `expo-router/entry`. This is a required entry-point change, not optional.

See `.planning/research/STACK.md` for installation commands, runtime patterns, and full alternatives analysis.

### Expected Features

The feature set is precisely scoped. There is no ambiguity about what is required versus deferred.

**Must have (table stakes — app is not shippable without these):**

- Two-step login flow (email → tenant resolution → optional picker → password) — required by the multi-tenant architecture; single-screen login cannot work without knowing the tenant first
- Tenant picker screen — shown only when `resolve-tenants` returns more than one result; required for contractors who work across companies
- Cognito SRP via `amazon-cognito-identity-js` — the actual authentication step; without it there is no real auth
- Session persistence: survive app restart without re-login — drivers open the app many times per shift; session must outlive app suspension
- Session expiry detection on startup — expired sessions must redirect to login cleanly; silent acceptance of expired sessions leads to 401s mid-use
- Logout with Cognito token revocation — drivers share devices; logout must clear local state AND call `cognitoUser.signOut()` to revoke the refresh token
- Comprehensive error states with human-readable messages — all Cognito error codes must be translated; raw `NotAuthorizedException` must never reach the UI
- Loading states at every async step — two-step form has four discrete async operations; each needs its own loading indicator to prevent double-submit

**Should have (differentiators — include in v1, minimal cost):**

- "Back to email" navigation in the two-step flow — trivial to implement; a driver who mis-typed their email is otherwise stuck
- Password show/hide toggle — reduces mis-entry for drivers typing on small screens; one line of state
- Inline error display (replace `Alert.alert()` calls) — standard pattern; modal alerts break password-manager flows
- Show resolved company name before password entry — gives the user confidence they are signing in to the right tenant
- "Session expired" notice when redirected to login — contextual message so the user understands why they are seeing the login screen

**Defer to v2+:**

- Token refresh / silent re-authentication — race condition complexity; drivers accept re-login at shift start
- Forgot password / self-service reset — admin-managed in this architecture; add static "contact your admin" text instead
- SSO / SAML / federated identity — browser-redirect pattern, not suitable for driver portal v1
- Biometric authentication — valuable, but must layer on top of working Cognito auth
- Device trust / "remember this device" — Cognito API surface and UX complexity not justified at this stage

See `.planning/research/FEATURES.md` for the full dependency chain and UX expectations per step.

### Architecture Approach

The architecture follows a strict four-layer dependency chain: `UI → AuthContext → authService → cognitoService/apiClient`. No layer skips a level. This is not over-engineering — it is the minimum structure required for the auth flow to be independently testable at each boundary. The `AuthContext` owns the `AuthStep` state machine (`EMAIL → TENANT_PICKER → PASSWORD → AUTHENTICATING → DONE`); UI screens read this state from context and render accordingly. Login flow state (`tenantCandidates`, `selectedTenant`, `cognitoConfig`, current `email`) lives in `AuthContext`, not in the screen component — this is essential for correct back-navigation and background/foreground behaviour.

**Major components:**

1. `src/types/auth.ts` — `Session`, `AuthStep`, `AuthError`, `TenantResolution` types; zero dependencies; everything imports from here
2. `src/services/cognitoService.ts` — wraps `amazon-cognito-identity-js`; constructs `CognitoUserPool` + `CognitoUser` lazily (after `mobile-config` is fetched); exposes a single `signIn()` function that returns `{ idToken: string }`
3. `src/services/authService.ts` — stateless flow coordinator; calls `cognitoService.signIn()` and the three API endpoints (`resolve-tenants`, `select-tenant`, `validate-token`, `mobile-config`); no React, no state
4. `src/context/AuthContext.tsx` — replaces the mock; owns `AuthState`; persists/rehydrates `Session` from AsyncStorage; exposes `submitEmail`, `selectTenant`, `submitPassword`, `logout`
5. `app/(auth)/tenant-picker.tsx` — new screen; separate Expo Router route rather than inline component (needs its own back button behaviour)
6. `app/(auth)/login.tsx` — updated for two-step; renders based on `AuthContext.step`; no local step state
7. `packages/api` — new `GET /api/auth/mobile-config` endpoint; returns `userPoolId` and `clientId` for the requesting tenant

**Session model:** After `validate-token` succeeds, store only the server-validated `Session` (`sub`, `tenantId`, `role`, `email`, `expiresAt`) — never the raw Cognito tokens. The Cognito `idToken` is used once, validated server-side, and discarded. This eliminates token theft risk via AsyncStorage inspection.

See `.planning/research/ARCHITECTURE.md` for the full data flow sequence, AuthContext interface, and anti-patterns.

### Critical Pitfalls

1. **Polyfill import order** — `react-native-get-random-values` must be the absolute first import in `apps/mobile/index.ts`, before `expo-router/entry` and before any other library. Placing it anywhere else (including inside the auth service) causes a silent SRP crash at login time. Fix: create `apps/mobile/index.ts` wrapper and update `"main"` in `package.json`.

2. **`storage.sync()` not called on cold start** — `CognitoUserPool.getCurrentUser()` reads only the in-memory cache, which is empty after a cold start. Without awaiting `storage.sync()` first, session restore always returns null and users must re-login every time they close the app. Fix: await `pool.storage.sync()` inside `checkSession()` before calling `getCurrentUser()`.

3. **Cognito app client has a client secret** — If the mobile app client is created with `generateSecret: true` (the Cognito Console default for some flows), SRP fails with `NotAuthorizedException: Unable to verify secret hash`. The secret cannot be removed after creation — the client must be deleted and recreated. Fix: CDK must set `generateSecret: false` and enable only `ALLOW_USER_SRP_AUTH`. Verify in the Cognito Console before writing any auth code.

4. **`select-tenant` / SRP race condition** — The Pre-Token-Generation Lambda reads an ephemeral `AuthSession` record keyed by Cognito `sub`. If a user double-taps the login button, two concurrent SRP attempts can race and inject the wrong tenant into the token, causing cross-tenant data exposure. Fix: the login flow must be a strict serialized state machine; disable all inputs from the moment `select-tenant` is called until `validate-token` completes or an error is returned.

5. **Auth guard screen flicker** — The `useEffect`-based redirect in `_layout.tsx` fires after the first render, briefly showing protected content before redirecting unauthenticated users. Fix: use `expo-splash-screen` to keep the native splash visible until `checkSession()` resolves, or adopt `Stack.Protected` from expo-router v6 (available in SDK 54) for declarative route guarding.

Additional notable pitfalls:

- **Expo Go incompatibility** — `react-native-get-random-values` requires native code not bundled in Expo Go. Switch to a development build (EAS Build or `expo run:ios/android`) before any auth work.
- **ID token vs access token confusion** — Custom Cognito claims (`custom:tenantId`, `custom:role`) are in the ID token only. Pass `session.getIdToken().getJwtToken()` to `validate-token`, not the access token.
- **Plain AsyncStorage for tokens** — AsyncStorage is unencrypted. Use `expo-secure-store` for the `Session` object; it uses iOS Keychain and Android Keystore.

See `.planning/research/PITFALLS.md` for all 12 pitfalls with detection methods and phase-specific warnings.

---

## Implications for Roadmap

Based on the dependency chain established in ARCHITECTURE.md and the phase-specific pitfall warnings in PITFALLS.md, three phases are the right structure. The ordering is non-negotiable: infrastructure misconfigurations block all auth code, so they must come first; the service layer must exist and be tested before AuthContext consumes it; the UI updates come last, after the wiring is proven.

### Phase 1: Infrastructure and Foundation

**Rationale:** Two blockers cannot be discovered later without expensive rework. The Cognito app client must exist with the correct configuration (`generateSecret: false`, `ALLOW_USER_SRP_AUTH`) before a single line of auth code can be tested end-to-end. The entry-point polyfill and development build workflow must be in place before any SRP code is written. Getting these wrong early means deleting and recreating the Cognito client or diagnosing cryptic runtime crashes.

**Delivers:**

- Dedicated mobile Cognito app client registered in the existing user pool (CDK)
- `GET /api/auth/mobile-config` endpoint in `packages/api` returning `userPoolId` and `clientId`
- `apps/mobile/index.ts` entry-point wrapper with `react-native-get-random-values` as first import
- `package.json` `"main"` updated to point to the new entry point
- `amazon-cognito-identity-js` and `react-native-get-random-values` installed via `npx expo install`
- Development build established as the required workflow (not Expo Go)

**Addresses:** Table stake 10 (Cognito config fetched from API)
**Avoids:** Pitfall 4 (client secret), Pitfall 1 (polyfill order), Pitfall 8 (Expo Go incompatibility)

### Phase 2: Auth Service Layer

**Rationale:** The auth service is the most testable and most critical layer. Building it in isolation (with mocked Cognito and mocked API responses) validates the full login sequence before any UI changes. All four sub-components — `src/types/auth.ts`, `cognitoService.ts`, `authService.ts`, and the updated `AuthContext.tsx` — are built test-first in strict dependency order. The `select-tenant`/SRP serialization guarantee is enforced here, before the UI is built on top.

**Delivers:**

- `src/types/auth.ts` — `Session`, `AuthStep`, `AuthError`, `TenantResolution` types
- `src/services/cognitoService.ts` + tests — lazy `CognitoUserPool` construction, `signIn()` Promise wrapper, `storage.sync()` on restore
- `src/services/authService.ts` + tests — `resolveEmail`, `selectTenant`, `fetchMobileConfig`, `authenticate` functions, all mocked at API and Cognito boundaries
- `src/context/AuthContext.tsx` (replacement) + tests — `AuthStep` state machine, AsyncStorage persistence, `checkSession()` with expiry detection

**Addresses:** Table stakes 3 (Cognito SRP), 4 (session persistence), 5 (expiry detection), 6 (logout with revocation)
**Avoids:** Pitfall 2 (`storage.sync()`), Pitfall 5 (race condition), Pitfall 6 (ID vs access token), Pitfall 7 (unencrypted storage), Pitfall 10 (expiry not checked), Pitfall 12 (logout without revocation)

### Phase 3: UI and Flow Completion

**Rationale:** With the auth service tested and `AuthContext` providing the full `AuthStep` state machine, the UI changes become data-binding work with low risk. The tenant picker is a new screen; the login screen gains two-step rendering logic driven by context state. Error messages, loading states, and the UX polish items (password toggle, company name display, back navigation) are all additive on top of working auth logic. The auth guard flicker fix (`expo-splash-screen`) is applied here, when the mock auth safety net is being removed.

**Delivers:**

- `app/(auth)/tenant-picker.tsx` + tests — flat list of tenant names, `selectTenant` call, loading state on row tap
- `app/(auth)/login.tsx` (updated) + tests — two-step rendering from `AuthContext.step`, inline error display replacing `Alert.alert()`, password show/hide toggle, company name display, back navigation
- `app/(auth)/_layout.tsx` — `Stack.Screen` entry for `tenant-picker`
- `expo-splash-screen` integration in `AuthContext` to prevent auth guard flicker
- "Forgot your password? Contact your company admin." static text
- E2E API test for `GET /api/auth/mobile-config`

**Addresses:** Table stakes 1 (two-step UX), 2 (tenant picker), 7 (error messages), 8 (loading states), 9 (email validation); Differentiators A–E
**Avoids:** Pitfall 3 (auth guard flicker)

### Phase Ordering Rationale

- Phase 1 before Phase 2 because the `mobile-config` endpoint is called inside `authService.fetchMobileConfig()`. Developing the auth service without a real endpoint means writing against a mock that may not match the actual response shape. The Cognito client configuration is also a hard blocker that cannot be validated without the real AWS resource.
- Phase 2 before Phase 3 because the UI screens bind to `AuthContext` state and actions. Building the picker and login form before `AuthContext` is wired means UI work against a mock interface that then changes, requiring rework.
- The `select-tenant`/SRP race condition (Pitfall 5) must be addressed in Phase 2 before Phase 3 adds concurrent tap possibilities via the UI.
- Token storage security (Pitfall 7, `expo-secure-store`) belongs in Phase 2 alongside the auth service, not Phase 3 — introducing it as a follow-on hardening step is a common mistake that leaves a security gap between phases.

### Research Flags

Phases with standard patterns (skip research-phase):

- **Phase 1:** CDK `UserPoolClient` construct is well-documented; Hono handler pattern for the new endpoint follows the established pattern in `packages/api/src/handlers/auth.ts`
- **Phase 2:** `amazon-cognito-identity-js` API is stable and the `storage.sync()` pattern is confirmed in multiple sources; `AuthContext` replacement follows the existing contract
- **Phase 3:** expo-router file-based routing follows the existing `(auth)/login.tsx` pattern exactly; no new routing concepts required

No phases are flagged for `/gsd:research-phase` — the domain is well-documented and the existing codebase provides reference implementations for every integration point.

---

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                                                                                                                                |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack        | HIGH       | `amazon-cognito-identity-js` is explicitly named in PROJECT.md; polyfill requirement confirmed from official README and community reports; no alternative credibly competes                                                          |
| Features     | HIGH       | Requirements are precisely defined in PROJECT.md; all three existing server endpoints are confirmed; Cognito error codes verified against AWS official docs                                                                          |
| Architecture | HIGH       | Based on direct codebase inspection of `AuthContext.tsx`, `login.tsx`, `auth.ts` handler, and `tenant-resolver.ts` reference; all contracts known                                                                                    |
| Pitfalls     | HIGH       | 5 of 12 pitfalls sourced from official AWS/Expo docs; 7 from community sources with multiple corroborating reports; all are verified against this project's specific stack (SDK 54, expo-router v6, `amazon-cognito-identity-js` v6) |

**Overall confidence:** HIGH

### Gaps to Address

- **Mobile Cognito app client does not exist yet** — The CDK `userPool.addClient('mobile-app-client', ...)` call needs to be written and deployed. The `mobile-config` endpoint needs to know what tenant maps to which client ID. This mapping may require a new column on the `Tenant` model or a static config if all tenants share a single pool and single mobile client. Clarify the data model in Phase 1 planning.
- **`expo-secure-store` vs AsyncStorage for the `Session` object** — ARCHITECTURE.md recommends storing only the server-validated `Session` (not raw Cognito tokens) in AsyncStorage. PITFALLS.md recommends `expo-secure-store` for the session. The session object itself (sub, tenantId, role, email, expiresAt) is not a raw token but is still sensitive. Decide at Phase 2 planning whether `expo-secure-store` or AsyncStorage is used for the session record (the raw Cognito tokens are never stored either way).
- **`storage.sync()` requirement vs. architecture recommendation to not use library storage** — ARCHITECTURE.md recommends constructing `CognitoUserPool` statelessly (extract `idToken` and discard library-managed tokens). STACK.md documents `storage.sync()` as required. These are compatible: `storage.sync()` is needed only if the library's internal storage is used for restore. If the app validates tokens server-side and stores only the `Session` object, `storage.sync()` is irrelevant — but verify this before omitting it.
- **`expiresAt` field format** — ARCHITECTURE.md says Unix epoch seconds; check that `validate-token` returns `expiresAt` in seconds (not milliseconds). Mismatched format causes expiry checks to always pass or always fail.

---

## Sources

### Primary (HIGH confidence)

- [amazon-cognito-identity-js npm](https://www.npmjs.com/package/amazon-cognito-identity-js) — library API, storage adapter pattern
- [react-native-get-random-values npm](https://www.npmjs.com/package/react-native-get-random-values) — polyfill requirement and install
- [AWS Cognito managing errors](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-managing-errors.html) — error codes and lockout policy
- [Amazon Cognito app client settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html) — `generateSecret`, auth flows
- [Pre-Token Generation Lambda Trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html) — custom claims injection
- [Expo Router Authentication guide](https://docs.expo.dev/router/advanced/authentication/) — auth guard patterns
- [Expo Protected Routes](https://docs.expo.dev/router/advanced/protected/) — `Stack.Protected` (SDK 53+)
- [expo-secure-store docs](https://docs.expo.dev/versions/latest/sdk/securestore/) — size limits, iOS Keychain
- [React Native Security docs](https://reactnative.dev/docs/security) — AsyncStorage security implications
- Direct codebase inspection: `apps/mobile/src/context/AuthContext.tsx`, `apps/mobile/app/(auth)/login.tsx`, `packages/api/src/handlers/auth.ts`, `packages/web/src/auth/tenant-resolver.ts`

### Secondary (MEDIUM confidence)

- [amazon-cognito-identity-js issue #615](https://github.com/amazon-archives/amazon-cognito-identity-js/issues/615) — `storage.sync()` pattern for React Native
- [expo/router Discussion #935](https://github.com/expo/router/discussions/935) — polyfill import order with expo-router
- [expo/router issue #675](https://github.com/expo/router/issues/675) — screen flicker on auth guard
- [amplify-js issue #1234](https://github.com/aws-amplify/amplify-js/issues/1234) — `NotAuthorizedException` message-based lockout detection
- [SecureStore size issue expo/expo #6231](https://github.com/expo/expo/issues/6231) — 2048-byte per-key limit on iOS
- [Cognito lockout policy deep-dive](https://blog.ilearnaws.com/2020/05/10/dive-deep-on-the-lockout-policy-of-aws-cognito/) — lockout timing

---

_Research completed: 2026-03-27_
_Ready for roadmap: yes_
