# Phase 3: AuthContext and Session - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the mock `AuthContext` with a real implementation backed by `authService`. Sessions are persisted to `expo-secure-store` (encrypted); restored on cold start; cleared on logout; checked for expiry on foreground resume.

Deliverables:
- Updated `apps/mobile/src/context/AuthContext.tsx` — real login via `authService.authenticate`, secure-store persistence, cold-start restore, expiry detection
- Updated `apps/mobile/app/_layout.tsx` — creates real `authService` instance, passes it to `<AuthProvider authService={...}>`
- Updated `apps/mobile/app/(tabs)/settings.tsx` — uses `session?.email` / `session?.role` instead of removed `driverName`/`driverEmail`
- Jest tests for all SESSION-01 through SESSION-04 success criteria with mock `authService`

Login UX changes (two-step flow, tenant picker, password step) are Phase 4. `login.tsx` is not E2E-functional in Phase 3 — the login screen still exists but will need tenantId from Phase 4 to complete real auth.
</domain>

<decisions>
## Implementation Decisions

### Login function signature

- **D-01:** `login(email: string, password: string, tenantId: string): Promise<boolean>` — tenantId added to the signature now. Phase 4 will supply it from tenant resolution. In Phase 3, `login.tsx` cannot call this function end-to-end (no tenantId source yet); tests cover the full flow via Jest with a mock authService.

### AuthContext interface

- **D-02:** `session: Session | null` replaces `driverName: string` and `driverEmail: string`. The `Session` type (from `apps/mobile/src/auth/types.ts`) carries `{ sub, tenantId, role, email, expiresAt }` — consumers access `session?.email`, `session?.role`, etc. directly.
- **D-03:** `isAuthenticated: boolean` is derived from `session !== null` — kept as a convenience field (auth guard and layout already use it).
- **D-04:** `isLoading: boolean` is kept — used during cold-start restore before the auth guard can decide where to route.
- **D-05:** `driverName` and `driverEmail` are removed entirely. `apps/mobile/app/(tabs)/settings.tsx` is updated in Phase 3 to use `session?.email` and `session?.role` (no driverName equivalent exists in the real Session).

### AuthService injection

- **D-06:** `AuthProvider` accepts `authService` as a prop: `<AuthProvider authService={authService}>`. The real instance is created in `apps/mobile/app/_layout.tsx` using `createAuthService({ apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '', cognitoService })`. Tests inject a plain mock object — no `jest.mock()` needed, matching the Phase 2 factory pattern.

### Session persistence

- **D-07:** `expo-secure-store` for the persisted session (SESSION-01). Must be installed via `npx expo install expo-secure-store` (not yet in package.json). Raw Cognito tokens are discarded after `validate-token` succeeds — only the `Session` object is stored.
- **D-08:** On `AsyncStorage` → `expo-secure-store` migration: the old `@moving_app_session` AsyncStorage key is abandoned. No migration needed — the old session shape is incompatible with the new Session type; cold start will find nothing in secure store and show login.

### Cold-start restore (SESSION-02)

- **D-09:** `checkSession()` reads secure store in a `useEffect` at mount. Sets `isLoading = true` during the read, `false` after. The auth guard in `_layout.tsx` already waits on `isLoading` before routing — this prevents the login-screen flash for authenticated drivers.

### Logout (SESSION-03)

- **D-10:** `logout()` deletes the secure-store entry and resets `session` to `null`. No Cognito token revocation in Phase 3 (tokens were discarded at login; nothing to revoke). The auth guard redirects to login when `isAuthenticated` goes false.

### Expired session detection (SESSION-04)

- **D-11:** `AppState` change listener (react-native built-in) fires on foreground resume. Handler reads the current `session` from state; if `session.expiresAt < Date.now()`, calls `logout()`. This clears secure store and routes the driver to re-login. No modal or prompt overlay — the login screen is the re-login experience.

### Claude's Discretion

- Exact storage key string for expo-secure-store (e.g. `pegasus_session`)
- Whether `checkSession` and `AppState` listener are extracted into a custom hook or stay inline in AuthProvider
- Test file location (`AuthContext.test.tsx` stays co-located in `src/context/`)
- Whether `AppState` subscription is set up in the same `useEffect` as `checkSession` or a separate one
</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §Session — SESSION-01, SESSION-02, SESSION-03, SESSION-04 (success criteria for this phase)

### Phase 3 ROADMAP success criteria

- `.planning/ROADMAP.md` §Phase 3 — Exact plan breakdown and acceptance conditions

### Auth types and service (Phase 2 output)

- `apps/mobile/src/auth/types.ts` — `Session`, `MobileConfig`, `AuthError` types
- `apps/mobile/src/auth/authService.ts` — `createAuthService` factory; `authenticate(email, password, tenantId)` signature

### Files modified in Phase 3

- `apps/mobile/src/context/AuthContext.tsx` — primary target; mock auth to be replaced
- `apps/mobile/src/context/AuthContext.test.tsx` — rewritten to cover real auth + Session + secure store
- `apps/mobile/app/_layout.tsx` — wires real authService, passes to AuthProvider
- `apps/mobile/app/(tabs)/settings.tsx` — updated to use `session?.email` / `session?.role`

### Existing patterns to match

- `apps/mobile/src/auth/authService.ts` — factory injection pattern (D-06)
- `apps/mobile/src/context/AuthContext.test.tsx` — existing test structure (renderWithProvider, TestConsumer, act() pattern)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `apps/mobile/src/auth/authService.ts` — `createAuthService({ apiBaseUrl, cognitoService })` returns `{ fetchMobileConfig, authenticate }`. Phase 3 injects this into AuthProvider as a prop.
- `apps/mobile/src/utils/logger.ts` — `logger.logAuth('login', email)` and `logger.logAuth('logout', email)` already used in AuthContext; keep the same calls.
- `apps/mobile/src/auth/types.ts` — `Session` type, import directly.

### Established Patterns

- **Factory injection (Phase 2):** `createAuthService({ apiBaseUrl, cognitoService })` — AuthProvider follows the same pattern, accepting `authService` as a prop rather than importing a singleton.
- **TestConsumer + renderWithProvider:** Existing AuthContext test structure uses a `ctxRef` approach with `act(async () => {})` to flush effects — reuse this pattern in the rewritten tests.
- **`describe.skipIf(!process.env.DATABASE_URL])`:** Not applicable here (no DB), but the skip-guard pattern is established team practice for environment-dependent tests.

### Integration Points

- `apps/mobile/app/_layout.tsx` — currently imports `AuthProvider` with no props; Phase 3 adds `authService` prop wiring and `createAuthService` call here.
- `apps/mobile/app/(tabs)/settings.tsx` — currently destructures `{ driverName, driverEmail, logout }` from `useAuth()`; Phase 3 changes to `{ session, logout }`.
- `apps/mobile/app/(auth)/login.tsx` — imports `login` from `useAuth()`; Phase 3 changes the signature to `login(email, password, tenantId)` but login.tsx cannot supply tenantId yet — leave it calling with a placeholder or update the call site comment to indicate Phase 4 will complete it. Phase 4 owns this file.

</code_context>

<specifics>
## Specific Ideas

- No specific UI or interaction preferences stated — standard approach for all items.
- Session expiry check on foreground: `session.expiresAt < Date.now()` (milliseconds) — consistent with the `expiresAt: number` type in `Session` (millisecond epoch).
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

Token refresh / silent re-auth is v2 (SESSION-V2-01) and explicitly out of scope for Phase 3.
</deferred>

---

_Phase: 03-authcontext-and-session_
_Context gathered: 2026-03-27_
