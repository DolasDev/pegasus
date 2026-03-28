# Pegasus Mobile — Driver Login

## What This Is

Real Cognito authentication for the Pegasus mobile Driver Portal (`apps/mobile`). Replaces the current mock auth (any email + 4-char password) with a proper multi-step login flow: email-based tenant resolution → multi-tenant picker when needed → Cognito SRP authentication → server-side token validation → persistent session. Drivers belong to a specific tenant (moving company); the app resolves which company they belong to from their email address, matching the behaviour of the existing web tenant login.

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

### Active

- [x] `GET /api/auth/mobile-config` — returns Cognito user pool ID and mobile app client ID; called after tenant resolution so the app never hardcodes Cognito credentials — Validated in Phase 01: infrastructure-foundation
- [x] Mobile auth service — wraps `resolve-tenants`, `select-tenant`, `validate-token` and Cognito SRP in a clean typed API consumed by `AuthContext` — Validated in Phase 02: auth-service-layer
- [x] Updated `AuthContext` — replaces mock login with real auth service backed by expo-secure-store; session persisted/restored from encrypted storage; AppState expiry detection on foreground resume — Validated in Phase 03: authcontext-and-session
- [x] Login UX hardening — `AuthContext.login()` now `Promise<void>` (throws `AuthError`); SHOW/HIDE password toggle; inline error messages for all auth failure codes; input locking during loading; no Alert.alert — Validated in Phase 05: login-ux-and-auth-guard
- [x] Auth guard — `_layout.tsx` uses `Stack.Protected guard={isAuthenticated}` + `SplashScreen.preventAutoHideAsync()` to eliminate login flash on cold start; useEffect redirect removed — Validated in Phase 05: login-ux-and-auth-guard
- [ ] Two-step login UX — email submitted first → tenant resolution → tenant picker shown only when >1 tenant found → password entry
- [ ] Tenant picker screen — `app/(auth)/tenant-picker.tsx` — list of tenant names, driver selects one, app calls `select-tenant`
- [ ] Cognito SRP authentication — `amazon-cognito-identity-js` performs in-app SRP challenge; no browser redirect; uses pool ID + mobile client ID from mobile-config endpoint
- [ ] Logout — removes Cognito tokens, clears AsyncStorage session
- [ ] Error handling — "email not registered", "invalid credentials", "account not in tenant", network errors each produce clear user-facing messages (no raw error codes leaked to UI)

### Out of Scope

- SSO / SAML provider login on mobile — email+password only for v1; drivers don't use federated SSO
- Forgot password / reset flow — deferred; drivers contact their company admin
- Sign-up — drivers are provisioned by tenant admins, not self-service
- Biometric auth (Face ID / fingerprint) — future enhancement
- Token refresh / silent re-auth — session lifetime follows Cognito token expiry for now; user re-logs in when expired

## Context

The Pegasus monorepo already has a complete Cognito-backed auth system for the web tenant app. The mobile app is a React Native / Expo Driver Portal — crew members use it to view and manage their assigned moves. The existing login screen UI is production-ready; only the `AuthContext.login()` implementation and surrounding flow need replacing.

**Relevant existing code:**

- `apps/mobile/app/(auth)/login.tsx` — login screen (UI stays mostly the same; form becomes two-step)
- `apps/mobile/src/context/AuthContext.tsx` — mock auth to be replaced
- `packages/web/src/auth/tenant-resolver.ts` — reference implementation for tenant resolution flow
- `packages/api/src/handlers/auth.ts` — all auth endpoints; `resolve-tenants` and `select-tenant` are the key ones

**Cognito setup:** Single user pool shared across all tenants. Per-tenant isolation is achieved via the Pre-Token-Generation Lambda which injects `custom:tenantId` and `custom:role` claims. The mobile app will need a dedicated Cognito app client (no secret — standard for mobile) registered against the existing user pool.

## Constraints

- **Tech stack**: Expo / React Native — must use `amazon-cognito-identity-js` (pure JS, no native modules) for SRP; not `aws-amplify` (too heavy)
- **Security**: Cognito credentials (pool ID, client ID) must not be baked into the app bundle; fetched from API after tenant resolution
- **Compatibility**: Must not break existing web auth flow or any existing API auth middleware
- **TDD**: Tests written before implementation per team workflow — `AuthContext`, auth service, and tenant picker all require tests first

## Key Decisions

| Decision                                      | Rationale                                                                      | Outcome    |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| Cognito config via API endpoint               | Keeps credentials out of app bundle; single source of truth if pool changes    | ✓ Phase 01 |
| `amazon-cognito-identity-js` for SRP          | Pure JS, works in RN without native modules; lighter than Amplify              | ✓ Phase 01 |
| Two-step login (email first, password second) | Required for tenant resolution before Cognito auth; matches web app UX pattern | — Pending  |
| Dedicated mobile Cognito app client           | Best practice for mobile — no client secret, separate from web client          | ✓ Phase 01 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-03-28 after Phase 05 (login-ux-and-auth-guard) complete — AuthContext.login() hardened to Promise<void>/throw pattern; SHOW/HIDE toggle and inline errors on login screen; Stack.Protected + SplashScreen guard replaces useEffect redirect. Requirements AUTH-04, AUTH-05, AUTH-06, GUARD-01 validated._
