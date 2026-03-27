# Architecture Patterns: React Native Multi-Tenant Cognito Auth

**Domain:** Mobile auth — multi-tenant Cognito SRP
**Researched:** 2026-03-27
**Confidence:** HIGH (based on direct codebase inspection + well-established patterns)

---

## Recommended Architecture

### Overview

Four layers, each with a single responsibility:

```
UI Layer          login.tsx / tenant-picker.tsx
                        |
Auth Context      AuthContext.tsx  (session state machine, AsyncStorage persistence)
                        |
Auth Service      src/services/authService.ts  (orchestrates the full flow)
                        |
API/Cognito       Pegasus API endpoints + amazon-cognito-identity-js SRP
```

The UI never touches the API directly. `AuthContext` never calls Cognito directly. The auth service is a pure coordinator — no React, no state.

---

## Component Boundaries

| Component           | Responsibility                                                                                                                                                            | Calls                             | Called By                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `login.tsx`         | Renders email step and password step; shows tenant picker inline or navigates to picker screen                                                                            | `useAuth()`                       | Expo Router                                                       |
| `tenant-picker.tsx` | Lists tenant names; user selects one                                                                                                                                      | `useAuth().selectTenant()`        | Expo Router, pushed from login                                    |
| `AuthContext.tsx`   | Owns session state; exposes typed action methods; persists session to AsyncStorage on write; rehydrates on mount                                                          | `authService.*`                   | All app screens via `useAuth()`                                   |
| `authService.ts`    | Stateless coordinator; executes the full login sequence; returns typed results                                                                                            | `apiClient.*`, `cognitoService.*` | `AuthContext` only                                                |
| `cognitoService.ts` | Wraps `amazon-cognito-identity-js`; constructs `CognitoUserPool` + `CognitoUser` from runtime config; performs `authenticateUser` SRP challenge; returns `idToken` string | `amazon-cognito-identity-js`      | `authService` only                                                |
| `apiClient.ts`      | Typed fetch wrapper; knows base URL; adds `x-correlation-id`; deserialises `{ data }` and `{ error, code }` shapes                                                        | `fetch`                           | `authService` only (during auth), rest of app for protected calls |

**Rule:** `cognitoService` must never be imported outside `authService`. `authService` must never be imported outside `AuthContext`. This keeps the entire auth flow testable at every boundary with simple mocks.

---

## Data Flow: Full Login Sequence

```
Step 1 — Email submitted
  login.tsx
    → useAuth().submitEmail(email)
      → authService.resolveEmail(email)
        → POST /api/auth/resolve-tenants { email }
        ← TenantResolution[]

  Outcomes:
    [] (empty)          → AuthContext sets error: EMAIL_NOT_REGISTERED
    [single tenant]     → AuthContext auto-selects; advance to Step 2b
    [multiple tenants]  → AuthContext stores candidates; advance to Step 2a

Step 2a — Tenant picker (only when multiple tenants)
  tenant-picker.tsx renders list from AuthContext.tenantCandidates
    → useAuth().selectTenant(tenantId)
      → authService.selectTenant(email, tenantId)
        → POST /api/auth/select-tenant { email, tenantId }
        ← TenantResolution (confirms AuthSession created)
      AuthContext stores selectedTenant; advance to Step 2b

Step 2b — Fetch Cognito config for selected tenant
  (runs immediately after tenant is selected, before password entry)
    → authService.fetchMobileConfig(tenantId)
      → GET /api/auth/mobile-config?tenantId=<id>
      ← { userPoolId: string, clientId: string }
  AuthContext stores cognitoConfig; reveal password field

Step 3 — Password submitted
  login.tsx
    → useAuth().submitPassword(password)
      → authService.authenticate(email, password, cognitoConfig)
        → cognitoService.signIn(userPoolId, clientId, email, password)
          → amazon-cognito-identity-js: CognitoUserPool + CognitoUser.authenticateUser
          ← { idToken: string }
        → POST /api/auth/validate-token { idToken }
        ← Session { sub, tenantId, role, email, expiresAt, ssoProvider }
      AuthContext persists session to AsyncStorage; sets isAuthenticated = true

Step 4 — Root layout reacts
  _layout.tsx useEffect sees isAuthenticated=true, router.replace('/(tabs)')
```

---

## Session Model

Replace the current minimal session shape with the full validated payload from `/api/auth/validate-token`:

```typescript
// src/types/auth.ts

export type Session = {
  sub: string // Cognito user sub — stable user identifier
  tenantId: string // from custom:tenantId claim (set by pre-token Lambda)
  role: string // from custom:role claim (e.g. 'tenant_user')
  email: string
  expiresAt: number // Unix epoch seconds (from JWT exp claim)
  ssoProvider: string | null
}

export type AuthStep =
  | 'EMAIL' // initial state — email field shown
  | 'TENANT_PICKER' // multiple tenants found — picker shown
  | 'PASSWORD' // single tenant resolved — password field shown
  | 'AUTHENTICATING' // SRP + validate-token in flight
  | 'DONE' // authenticated

export type AuthError =
  | 'EMAIL_NOT_REGISTERED'
  | 'ACCOUNT_NOT_IN_TENANT'
  | 'INVALID_CREDENTIALS'
  | 'NETWORK_ERROR'
  | 'SESSION_EXPIRED'
  | null
```

The `AuthContext` state object:

```typescript
interface AuthState {
  // Persistent (hydrated from AsyncStorage)
  session: Session | null

  // Derived
  isAuthenticated: boolean // session != null && session.expiresAt > now
  isLoading: boolean // true during AsyncStorage rehydration

  // Ephemeral login flow state (never persisted)
  step: AuthStep
  authError: AuthError
  tenantCandidates: TenantResolution[]
  selectedTenant: TenantResolution | null
  cognitoConfig: { userPoolId: string; clientId: string } | null
  email: string // carried across steps
}
```

**AsyncStorage key:** Keep `@moving_app_session` for backward compatibility (existing users have nothing stored, but the key name costs nothing to preserve). Store only the `Session` object.

---

## Auth Service Module Structure

```
apps/mobile/src/services/
├── authService.ts          Main coordinator — the only file AuthContext imports
├── cognitoService.ts       amazon-cognito-identity-js wrapper
├── apiClient.ts            (exists or to be created) fetch wrapper for auth endpoints
├── authService.test.ts     Unit tests — mock cognitoService and apiClient
├── cognitoService.test.ts  Unit tests — mock amazon-cognito-identity-js
└── mockData.ts             (existing)
```

`authService.ts` exports only named functions (not a class):

```typescript
resolveEmail(email)           → Promise<TenantResolution[]>
selectTenant(email, tenantId) → Promise<TenantResolution>
fetchMobileConfig(tenantId)   → Promise<{ userPoolId: string; clientId: string }>
authenticate(email, password, config) → Promise<Session>
```

`cognitoService.ts` exports a single function:

```typescript
signIn(userPoolId, clientId, email, password) → Promise<{ idToken: string }>
```

It constructs `CognitoUserPool` and `CognitoUser` fresh per call (stateless from the mobile app's perspective). Tokens from `amazon-cognito-identity-js` are not stored in its internal `localStorage` shim — only the `idToken` string is returned to the caller. The app owns the token lifecycle, not the library.

---

## AuthContext Interface (replacing current)

```typescript
interface AuthContextType {
  // Existing (keep)
  isAuthenticated: boolean
  isLoading: boolean
  session: Session | null // replaces driverName / driverEmail

  // Login flow state (new)
  step: AuthStep
  authError: AuthError
  tenantCandidates: TenantResolution[]

  // Login actions (two-step, replaces single login())
  submitEmail: (email: string) => Promise<void>
  selectTenant: (tenantId: string) => Promise<void>
  submitPassword: (password: string) => Promise<void>

  // Session
  logout: () => Promise<void>
}
```

The context no longer exposes `driverName` / `driverEmail` directly. Consumers read `session.email`. Display name is not in the JWT — screens that need a name continue to fetch from the API using the session `sub`.

---

## Two-Step Login UX

The current `login.tsx` renders a single form. The two-step approach uses a local `step` variable driven by `AuthContext.step`:

```
AuthContext.step === 'EMAIL'          → show email field + NEXT button
AuthContext.step === 'TENANT_PICKER'  → navigate to tenant-picker.tsx
AuthContext.step === 'PASSWORD'       → show email (read-only) + password field + LOG IN button
AuthContext.step === 'AUTHENTICATING' → show spinner, disable all inputs
```

The login screen does not manage its own `step` state — it reads `step` from context so it is always in sync with the actual auth flow state (critical for handling back navigation correctly).

The tenant picker is a separate route (`app/(auth)/tenant-picker.tsx`) not an inline component, because:

1. It needs its own back button that returns to email entry and resets step.
2. The `(auth)` stack already supports multiple screens; adding one requires only a `Stack.Screen` entry in `(auth)/_layout.tsx`.
3. It keeps `login.tsx` focused on a single screen's concerns.

---

## Build Order (dependency chain)

Each item must exist and be tested before the next begins.

```
1. src/types/auth.ts
   — Session, AuthStep, AuthError, TenantResolution types
   — No dependencies; everything else imports from here

2. src/services/cognitoService.ts  +  cognitoService.test.ts
   — Depends on: amazon-cognito-identity-js (add to package.json)
   — Pure function; mock the library in tests

3. GET /api/auth/mobile-config endpoint (packages/api)
   — Depends on: nothing new in mobile; API must exist before authService
   — Must be deployed / available at test API base URL before E2E

4. src/services/authService.ts  +  authService.test.ts
   — Depends on: cognitoService (2), API endpoint (3), types (1)
   — Tests mock both cognitoService and fetch

5. src/context/AuthContext.tsx  (replace mock)  +  AuthContext.test.tsx
   — Depends on: authService (4), types (1)
   — Tests mock authService entirely

6. app/(auth)/tenant-picker.tsx  +  tenant-picker.test.tsx
   — Depends on: AuthContext (5)
   — Tests mock useAuth()

7. app/(auth)/login.tsx  (update for two-step)  +  login.test.tsx (update)
   — Depends on: AuthContext (5), tenant-picker route (6) existing
   — Tests mock useAuth()

8. app/(auth)/_layout.tsx  (add tenant-picker screen)
   — Depends on: tenant-picker.tsx (6)
   — Trivial change; no dedicated test needed

9. E2E: apps/e2e/tests/api/auth.spec.ts
   — Validates mobile-config endpoint and full flow against running API
```

---

## Cognito Credentials Storage

**Credentials (poolId + clientId) must not be in the app bundle.** They are fetched from `/api/auth/mobile-config` after tenant resolution and held only in `AuthContext` ephemeral state (`cognitoConfig` field). They are never written to AsyncStorage.

The `idToken` returned by Cognito SRP is also never stored — it is passed immediately to `/api/auth/validate-token` and discarded. The API-validated `Session` object (sub, tenantId, role, email, expiresAt) is what gets persisted to AsyncStorage. This means:

- AsyncStorage never holds Cognito tokens (no token theft via storage inspection).
- Session rehydration on app restart restores the validated claims without re-hitting Cognito.
- Session expiry is checked client-side by comparing `session.expiresAt` (Unix seconds) against `Date.now() / 1000`. On expiry, `isAuthenticated` returns false and the router guard redirects to login.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Calling Cognito from AuthContext directly

**What goes wrong:** AuthContext becomes untestable without mocking the Cognito SDK. The service boundary disappears.
**Instead:** AuthContext calls `authService.authenticate()`; authService calls `cognitoService.signIn()`. Each layer is mockable independently.

### Anti-Pattern 2: Storing login flow state in the screen component

**What goes wrong:** Back navigation or a background/foreground cycle resets the step. The user must re-enter their email.
**Instead:** `step`, `tenantCandidates`, and `email` live in `AuthContext`. They survive screen unmounts. They reset only on explicit `logout()` or a new `submitEmail()` call.

### Anti-Pattern 3: Using amazon-cognito-identity-js's internal localStorage for the session

**What goes wrong:** The library stores tokens in its own AsyncStorage keys using unpredictable key names. The app loses visibility into what is stored, cannot control expiry, and cannot easily clear on logout.
**Instead:** Extract the `idToken` from the SRP result immediately, validate server-side, and store only the server-validated `Session`. Clear via `AsyncStorage.removeItem(STORAGE_KEY)` on logout.

### Anti-Pattern 4: A single-screen two-step form driven by local state

**What goes wrong:** `useAuth()` and local `step` state diverge. Errors in step 2 cannot reset cleanly to step 1 because the screen doesn't know the context's state.
**Instead:** The screen renders based on `AuthContext.step`. All transitions go through context actions.

### Anti-Pattern 5: Fetching mobile-config before tenant is selected

**What goes wrong:** The endpoint needs a `tenantId` to return the right pool credentials. Calling it before selection means either a hardcoded pool or a broken request.
**Instead:** `fetchMobileConfig` is called inside `selectTenant` (or immediately after, before revealing the password field). This is enforced by the build order: cognitoConfig is only set in context after `selectTenant` completes.

---

## Scalability Considerations

| Concern                 | Current scope                                        | If needed later                                                                                                    |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Token refresh           | Out of scope (session expires, user re-logins)       | Add silent `cognitoService.refreshTokens()` using stored refresh token; extend `Session` with `refreshToken` field |
| Biometric re-auth       | Out of scope                                         | Store refresh token in Expo SecureStore (not AsyncStorage) behind biometric prompt                                 |
| Multiple active tenants | Not in mobile scope (drivers belong to one employer) | If needed, `Session` becomes an array; route guard checks active session                                           |
| Offline behaviour       | No change from current                               | Auth guard must tolerate no network; check stored session first                                                    |

---

## Sources

- Direct inspection of `apps/mobile/src/context/AuthContext.tsx` (mock implementation)
- Direct inspection of `apps/mobile/app/(auth)/login.tsx` (existing UI)
- Direct inspection of `packages/api/src/handlers/auth.ts` (endpoint contracts)
- Direct inspection of `packages/web/src/auth/tenant-resolver.ts` (web reference implementation)
- Direct inspection of `.planning/PROJECT.md` (requirements and constraints)
- `amazon-cognito-identity-js` patterns: established React Native SRP usage (HIGH confidence — pure JS library, stable API, no native modules required)
- Expo Router file-based routing: `app/(auth)/tenant-picker.tsx` follows existing `app/(auth)/login.tsx` pattern (HIGH confidence — same router version in use)
