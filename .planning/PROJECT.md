# Pegasus Mobile — Driver Login

## What This Is

Real Cognito authentication for the Pegasus mobile Driver Portal (`apps/mobile`). Replaces mock auth with a production-ready multi-step login flow: email-based tenant resolution → multi-tenant picker when needed → Cognito SRP authentication (in-app, no browser redirect) → server-side token validation → encrypted session persistence. Drivers log in with their real company credentials; the app resolves tenant membership from email, eliminating hardcoded sessions and mock data.

**Shipped v1.0 (2026-03-31).** All 20 v1 requirements validated across 7 phases.

## Core Value

A driver can log in with their real company credentials and the app knows which tenant they belong to — no mock data, no hardcoded sessions.

## Requirements

### Validated

- ✓ Login screen UI (email + password fields, LOG IN button, keyboard avoidance) — existing
- ✓ Auth routing guard (`_layout.tsx` redirects unauthenticated users to `/(auth)/login`) — existing
- ✓ Session persistence pattern (AsyncStorage) — existing
- ✓ `POST /api/auth/resolve-tenants` — returns tenants for an email address — existing
- ✓ `POST /api/auth/select-tenant` — records selection, creates AuthSession for pre-token Lambda — existing
- ✓ `POST /api/auth/validate-token` — verifies Cognito ID token, returns session claims — existing
- ✓ `GET /api/auth/mobile-config` — returns Cognito user pool ID and mobile app client ID — v1.0
- ✓ Mobile auth service — `cognitoService` + `authService` factory wiring SRP, tenant resolution, and token validation — v1.0
- ✓ Updated `AuthContext` — real auth service backed by expo-secure-store; session persisted/restored; AppState expiry detection on foreground — v1.0
- ✓ Two-step login UX — email submitted first → tenant resolution → auto-select or picker → password entry — v1.0
- ✓ Tenant picker screen — FlatList of company names; selects tenant and advances to password step — v1.0
- ✓ Cognito SRP authentication — in-app SRP via `amazon-cognito-identity-js`; pool ID + client ID from mobile-config endpoint — v1.0
- ✓ Logout — clears secure store, resets AuthContext, navigates to login — v1.0
- ✓ Error handling — inline messages for all auth failure codes; no Alert.alert; input locking during async — v1.0
- ✓ Login UX hardening — `Promise<void>` throw-on-failure; SHOW/HIDE password toggle; input locking; no Alert.alert — v1.0
- ✓ Auth guard — `Stack.Protected guard={isAuthenticated}` + `SplashScreen.preventAutoHideAsync()` eliminates cold-start login flash — v1.0
- ✓ Mobile token validation fix — `validate-token` accepts mobile client ID in audience; BREAK-01 field name fixed; `Session` extended with `ssoProvider` — v1.0
- ✓ Session expiry fix — `AuthContext` converts JWT seconds to ms at comparison site; all test fixtures updated to seconds-scale — v1.0

### Active

*(None — planning next milestone)*

### Out of Scope

- SSO / SAML provider login on mobile — email+password only for v1; drivers don't use federated SSO
- Forgot password / reset flow — deferred; drivers contact their company admin
- Sign-up — drivers are provisioned by tenant admins, not self-service
- Biometric auth (Face ID / fingerprint) — SESSION-V2-02; future enhancement
- Token refresh / silent re-auth — SESSION-V2-01; session lifetime follows Cognito token expiry; re-login at shift start acceptable for v1
- `NewPasswordRequired` Cognito challenge — ACCT-V2-02; rejects with `AuthError(NewPasswordRequired)` for now; full handling deferred

## Context

Shipped v1.0 on 2026-03-31 across 7 phases, 14 plans, ~11,779 lines changed.

**Tech stack (mobile):** Expo SDK 54 / React Native, `amazon-cognito-identity-js` (SRP, no Amplify), `expo-secure-store` (encrypted session), `expo-router` v6 (`Stack.Protected`).

**API auth endpoints:** All in `packages/api/src/handlers/auth.ts`. `validate-token` accepts audience array `[tenantClientId, mobileClientId]` — web tokens match tenant client, mobile tokens match mobile client.

**Known tech debt (device-only verification):**
- CDK deploy not live-confirmed — CDK tests pass (117) but actual AWS provisioning of mobile client unconfirmed
- `EXPO_PUBLIC_API_URL` has no `.env.example` in `apps/mobile/` — defaults to `''`, silently fails on device builds
- TENANT-06 back navigation requires physical device to confirm native stack-pop
- Human tests pending for SplashScreen cold-start flash elimination, SHOW/HIDE toggle, and input locking native behavior
- End-to-end mobile auth on real device and `COGNITO_MOBILE_CLIENT_ID` deployment confirmation require live environment

## Constraints

- **Tech stack**: Expo / React Native — must use `amazon-cognito-identity-js` (pure JS) for SRP; not `aws-amplify`
- **Security**: Cognito credentials must not be baked into the app bundle; fetched from API after tenant resolution
- **Compatibility**: Must not break existing web auth flow or any existing API auth middleware
- **TDD**: Tests written before implementation per team workflow

## Key Decisions

| Decision                                      | Rationale                                                                      | Outcome     |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ----------- |
| Cognito config via API endpoint               | Keeps credentials out of app bundle; single source of truth if pool changes    | ✓ Good      |
| `amazon-cognito-identity-js` for SRP          | Pure JS, works in RN without native modules; lighter than Amplify              | ✓ Good      |
| Two-step login (email first, password second) | Required for tenant resolution before Cognito auth; matches web app UX pattern | ✓ Good      |
| Dedicated mobile Cognito app client           | Best practice for mobile — no client secret, separate from web client          | ✓ Good      |
| Polyfill in `_layout.tsx` (not `index.ts`)    | Expo-router bypasses `index.ts` in bundle graph; layout is guaranteed first    | ✓ Good      |
| Single `COGNITO_MOBILE_CLIENT_ID` env var     | Mobile app shares one Cognito client across all tenants                        | ✓ Good      |
| `Session` type: no raw token field            | Raw ID token discarded after `validate-token`; enforced at type level          | ✓ Good      |
| `authService` injected as `AuthProvider` prop | Enables clean unit tests without module mock                                   | ✓ Good      |
| `AppState` dep array contains `session`       | Prevents stale closure where null session at mount never detects expiry        | ✓ Good      |
| `router.push` to tenant-picker (not replace)  | Hardware back returns to email step natively for TENANT-06                     | ✓ Good      |
| `login()` throws `AuthError` (not returns)    | Enables try/catch inline error mapping; cleaner than boolean return            | ✓ Good      |
| jose audience array for validate-token        | Accepts web or mobile client tokens; single endpoint serves both clients       | ✓ Good      |
| Option B for expiresAt (multiply at comparison) | No API change, no web package impact; JWT seconds contract preserved         | ✓ Good      |

---

_Last updated: 2026-03-31 after v1.0 milestone — all 20 v1 requirements validated across 7 phases. Next: /gsd:new-milestone_
