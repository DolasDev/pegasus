# Mobile session refresh — stay signed in, never half-signed-in

- **Branch:** `fix/mobile-session-refresh` (worktree `../pegasus-mobile-session-refresh`)
- **Goal:** drivers stay signed in for the 30-day refresh-token life, and an expired session
  can never leave the app "logged in but nothing works".
- **Approved:** 2026-11-24 (Steve) — proposals #1 (silent refresh) + #2 (clean expiry handling)
  in one PR. #3 (biometric unlock) and #4 (biometric + stored password) filed as follow-ups in
  `plans/todo/mobile-auth-followups.md`.

## Diagnosis (confirmed from code, 2026-11-24)

Two independent defects:

1. **No renewal.** Both sign-in paths discard the refresh token Cognito returns:
   - `src/auth/cognitoService.ts` keeps only `AuthenticationResult.IdToken`.
   - `src/auth/oauthService.ts` receives `refresh_token` from `/oauth2/token`, returns only `idToken`.
     The only credential kept is the ID token, valid 8h.
2. **Zombie session.** `src/context/AuthContext.tsx`:
   - cold-start restore applies `pegasus_session` without checking `expiresAt`;
   - the expiry check lives only in the AppState `change` listener, which a cold start never fires;
   - nothing reacts to a 401 — `@pegasus/api-http` throws `ApiError(status 401)` per call.

Cognito config — **read from the DEPLOYED clients 2026-11-24** (`describe-user-pool-client`,
read-only profiles): staging `us-east-1_0LoW8JGgK` / `33kvalt3r6g1ndrgbsqckt8c4g` and prod
`us-east-1_gg63uAxs0` `mobile-app-client` both have `ALLOW_REFRESH_TOKEN_AUTH`,
IdTokenValidity 480 min, RefreshTokenValidity 43200 min (30d), `EnableTokenRevocation: true`,
`RefreshTokenRotation: null` (off), no secret; both pools have `DeviceConfiguration: null` (no
device tracking → `REFRESH_TOKEN_AUTH` needs no `DEVICE_KEY`). Matches the CDK template. **No
Cognito client edit is needed — and must not be made** (any UserPoolClient edit wipes tenant
IdPs, #518).

⚠️ Pre-existing, out of scope: on BOTH pools the mobile client's `SupportedIdentityProviders`
is `["COGNITO"]` only — so mobile SSO sign-in likely fails today (same class as #518). The SSO
refresh path is built and unit-tested but can't be exercised on a device until that's fixed.

Server side (`apps/api/src/cognito/pre-token.ts`, comment above `isFederatedSignIn`):
`TokenGeneration_RefreshTokens` takes the native path — a live AuthSession wins, else a single
roster row, else "Your session has expired". A refreshing client **must call
`POST /api/auth/select-tenant` immediately before each refresh** (AuthSession TTL 10 min), as
the MoveManager desktop does. This covers multi-tenant and SSO users (an SSO user's refresh is
resolved by the AuthSession, not the provider). `select-tenant` requires an active roster row
and an ACTIVE tenant — a deactivated user's refresh fails, which is the desired behavior.
No API change needed.

## Design

### Token storage

- New SecureStore key `pegasus_refresh` holding `{ refreshToken, kind: 'password' | 'sso' }`,
  separate from `pegasus_session` (SecureStore per-value size limit; refresh tokens are ~1.7KB+).
- Web build falls back to `localStorage` via `src/utils/storage.ts` (existing behavior; dev only).
- Logout deletes both keys and best-effort revokes the refresh token
  (`/oauth2/revoke` or `RevokeToken`) — `enableTokenRevocation: true` is already set.

### Refresh call (`src/auth/authService.ts` → new `refreshSession(stored)`)

1. `selectTenant(session.email, session.tenantId)`.
2. Get a new ID token:
   - password sessions: `InitiateAuth` `REFRESH_TOKEN_AUTH` via `cognitoApiRequest`
     (new `cognitoService.refresh(refreshToken, poolId, clientId)`);
   - SSO sessions: `POST {domain}/oauth2/token` `grant_type=refresh_token`
     (new `oauthService.refresh(config, refreshToken)`).
   - **Verify during implementation** whether a Hosted-UI-issued refresh token also works with
     `InitiateAuth`; if so, collapse to one path. Keep `kind` either way.
   - If Cognito returns a new refresh token (rotation), store it.
3. `POST /api/auth/validate-token` → new `Session` (same as sign-in).
4. Persist session (+ refresh token if rotated) and `applySession`.

- Single-flight: concurrent callers share one in-flight refresh promise.
- Failure classes: auth failure (`NotAuthorizedException`, `invalid_grant`, select-tenant 4xx,
  validate-token 401/403) → clean logout with an "expired" reason; network failure → keep the
  current session, retry on next trigger (don't log drivers out in a dead zone).

### When to refresh (`src/context/AuthContext.tsx`)

- **Cold start:** if stored session is expired or within 5 min of `expiresAt` → refresh before
  `applySession`; keep `isLoading` true until resolved. No refresh token (pre-fix install) and
  expired → clean logout to login screen.
- **Foreground (`AppState` → active):** same check (replaces the current immediate `logout()`).
- **401 from the API:** add an optional, additive `onUnauthorized?: () => Promise<string | null>`
  to `ApiClientOptions` in `packages/api-http`. On a 401 the client awaits it once and retries the
  request with the returned token; `null` → throw the original 401. tenant-web/admin-web don't
  pass it → unchanged behavior. Mobile wires it to the single-flight refresh.
  (Covers `fetch`, `get`, `post`, etc. — check every request method in `index.ts` goes through
  one helper or gets the hook.)

### Clean expiry UX (#2)

- `logout(reason?: 'expired')`; login screen shows "Your session expired — please sign in again"
  when reason is `expired`. Push unregister stays best-effort (it will 401 with an expired token;
  that's fine — already best-effort).

## Checklist

- [x] api-http: `onUnauthorized` hook + retry-once, tests (no change for callers that omit it;
      tenant-web/admin-web typecheck clean). `createStreamClient` NOT wired — mobile doesn't stream.
- [x] cognitoService: return `refreshToken` from sign-in; add `refresh()` + `revoke()`; tests
- [x] oauthService: return `refreshToken` from `authorize()`; add `refresh()`; tests
      (revoke goes through Cognito `RevokeToken` for both kinds — one path)
- [x] authService: `{ session, refresh }` from both sign-ins; `refreshSession()`
      (select-tenant → refresh → validate-token); `revokeRefreshToken()`; `isRefreshRejected()`
      classifier; select-tenant/validate-token errors now carry `status`; tests
- [x] AuthContext: `pegasus_refresh` key; cold-start refresh before publish (8s cap, then
      opens on the stored session); foreground refresh; single-flight; `onUnauthorized` wired;
      logout revokes (3s cap) + clears both keys; `sessionExpired`; stale refresh can't
      resurrect a signed-out session; tests (mutation-checked: old cold-start behavior fails 4)
- [x] Login screen: "Your session expired. Please sign in again." on the email step; tests
- [x] ~~Verify Hosted-UI refresh token vs `InitiateAuth`~~ — DESIGNED OUT: each kind refreshes
      through the channel that issued it (password → `REFRESH_TOKEN_AUTH`, sso →
      `/oauth2/token`), so the cross-channel question never arises. aws-auth skill confirms
      refresh-token rotation (OFF on this client) would disable `REFRESH_TOKEN_AUTH` — if
      rotation is ever enabled, move the password path to `GetTokensFromRefreshToken`.
- [x] Gate step 1: root `npm test` — 16/16 turbo tasks, exit 0 (2026-11-24). Plus mobile `tsc`,
      `eslint src app`, `--detectOpenHandles` clean on touched suites; api-http vitest; api `tsc`;
      tenant-web/admin-web typecheck; prettier on every file this PR wrote (GOTCHAS.md already
      fails prettier on main — left alone to avoid churn).
- [ ] Gate step 2 (Playwright `apps/e2e`): NOT run locally. `apps/e2e` doesn't cover the mobile
      app; the one shared change (`@pegasus/api-http` request path, used by tenant-web/admin-web)
      is behavior-neutral when `onUnauthorized` is omitted and is unit-tested. Let CI's e2e run
      on the PR be the check — or run it locally if Steve wants it before merge.
- [x] Review pass (advisor): refresh classification hardened — `UserLambdaValidationException`
      counts as a denial only for pre-token's deliberate messages (a DB blip in the trigger is
      transient), OAuth 4xx only for known codes; pre-token.ts carries a cross-ref warning;
      refresh-key write failure degrades instead of failing sign-in; client wiring test added;
      no effect is keyed on the `session` object (refresh changes its identity — checked)
- [ ] Device test on staging (owed — needs a device/simulator build against staging):
      password sign-in (SSO blocked, see ⚠️ above); force-expire (wait 8h, or edit stored
      `expiresAt`); cold start → lands in app with data; foreground after expiry → data loads;
      airplane mode + expired → app opens, no sign-out; deactivate the roster row → next refresh
      signs out with the expired notice. **Android: confirm the `pegasus_refresh` SecureStore
      round-trip** (size limit — a failed write degrades to no renewal, logged as a warn).
- [ ] Store build (no `expo-updates` → no OTA)
- [x] GOTCHAS: mobile named as a select-tenant-before-refresh client; new section on the
      AppState-never-fires-on-cold-start trap
- [x] Archive plan → `plans/completed/` before PR

## Behavior notes (for review)

- Push is NOT unregistered on an _expired_ sign-out (the call would 401); the device token is
  upserted to whoever signs in next on the device. A deliberate logout still unregisters.
- Existing installs hold no refresh token → one more sign-in after this ships, then fixed.
- JS-only (no native module added), but the app has no `expo-updates`, so there is no OTA path:
  drivers get it with the next store build (bump Android versionCode / iOS build).

## Files

- `packages/api-http/src/index.ts` (+ tests)
- `apps/mobile/src/auth/{cognitoService,oauthService,authService,types}.ts` (+ tests)
- `apps/mobile/src/context/AuthContext.tsx` (+ `AuthContext.test.tsx`)
- `apps/mobile/src/api/client.ts` (wire `onUnauthorized`)
- `apps/mobile/app/(auth)/login.tsx` (expired message)
- `plans/todo/mobile-auth-followups.md` (new — #3, #4)

## Risks

- **Multi-tenant refresh** fails if select-tenant is skipped → covered by always calling it.
- **Refresh storms:** single-flight + retry-once only; never loop on 401.
- **Offline cold start with expired token:** keep session, show existing error states, retry on
  foreground — don't log out on network errors.
- **Existing installs** have no stored refresh token → one more sign-in after upgrade, then fixed.
- **Mobile release:** needs a new store build (EAS) for drivers to get it — no OTA channel.
