# Cognito email case — stop duplicate users + fix admin password reset for SSO-linked users

**Branch:** `fix/cognito-email-case` · **Goal:** stop mixed-case Cognito emails from causing duplicate users on invite and silent reset-password failures.

## Context (so any agent can resume)

**Symptom (reported 2026-09-15):** (1) admin "Reset password" for `TimStrey@nelsonwesterberg.com` did nothing; (2) inviting an SSO user to a second tenant created a duplicate Cognito user.

**Root cause (verified against prod, read-only, profile `dolas-pegasus-prod-ro`, pool `us-east-1_gg63uAxs0`):**

- Invites DO lowercase (#245). CloudTrail: the API Lambda called AdminCreateUser for Tim at 2026-09-03 15:34:57.
- `handlers/sso.ts:384` creates every IdP with `AttributeMapping: { email: 'email' }`. After pre-sign-up links the federated identity (16:16:15), Cognito writes the IdP-asserted email (`TimStrey@…`) onto the NATIVE user and sets `email_verified=false`. It does this again on EVERY SSO sign-in.
- Pool `UsernameConfiguration: null` ⇒ lookups by email alias are **case-sensitive**: `admin-get-user --username timstrey@…` → UserNotFound, `TimStrey@…` → found.
- `ListUsers` with `Filter: email = "…"` is **case-insensitive** (verified: `spobuta@…` returns `SPobuta@…`).
- Prod: 5 of 30 users drifted, all SSO-linked, all `email_verified=false`.

**Failure 1: reset password.** `resetCognitoUserPassword(existing.email)` sends the DB's lowercase email → UserNotFoundException → swallowed on purpose ("fail-open", cognito.ts:97) → route returns 200 and nothing happens. Even when addressed by the real Username, an SSO-linked user has `email_verified=false` (no code can be delivered), and Tim is FORCE_CHANGE_PASSWORD (never set a native password).

**Failure 2: duplicate.** Invite → AdminCreateUser(lowercase) → the case-sensitive pool sees no `pegasus-gigi@…` → creates a SECOND native user (no UsernameExistsException). Proof: 2026-09-14 16:17:45 AdminCreateUser (Reliable Van and Storage), then at 16:18:35 pre-sign-up logged `multiple native users share this email — not linking (anomaly)` count 2, and the Reliable SSO login became a stray unlinked `microsoft-reliable_…` EXTERNAL_PROVIDER user. `resendCognitoInvite` has the same flaw (AdminGetUser(email) 404 → provisionCognitoUser → create).

**Already hand-fixed by the user on 2026-09-15 (CloudTrail):** deleted gigi's duplicate native user; lowercased gigi's email attribute (it drifts back on the next microsoft-nw login; harmless after this fix).

**Out of scope, flagged to the user (manual prod ops, NOT in this PR):**

- Stray EXTERNAL_PROVIDER `microsoft-reliable_uuBY…` (gigi): Reliable logins use it with a different sub; pre-sign-up won't re-fire to link it.
- Stray EXTERNAL_PROVIDER `microsoft-nw_h0nP…` + native FORCE_CHANGE_PASSWORD `c488f4b8…` for `steved@nelsonwesterberg.com` (2026-07-24, before account linking existed).

**Rejected:**

- Removing the IdP email mapping: pre-sign-up linking and the pre-token email guard need it.
- A one-shot AdminUpdateUserAttributes repair: the next SSO login re-drifts it.
- Overriding the email claim in pre-token: fixes neither failure, no consumer found, and it is the login-critical path.

## Design

One helper in `apps/api/src/handlers/admin/cognito.ts`:

`findNativeCognitoUser(email): Promise<UserType | null>` does ListUsers with `Filter: email = "<escaped lowercase>"`, drops `UserStatus === 'EXTERNAL_PROVIDER'`, and compares `email` attribute `.toLowerCase()` on both sides (same pattern as `cognito/pre-sign-up.ts` step 3). If more than one native user matches, it throws a distinct error so callers 500 with a log line rather than acting on an arbitrary one. The filter-escape function moves from pre-sign-up.ts into a shared spot and pre-sign-up imports it (no behavior change).

Callers:

1. `provisionCognitoUser(email, tenant)`: if `findNativeCognitoUser` returns a user → return (same meaning as the existing UsernameExistsException idempotence); else AdminCreateUser as today. Covers both admin invite paths + new-tenant admin.
2. `handlers/users.ts` POST `/invite`: replace its inline duplicate AdminCreateUser block with `provisionCognitoUser` (identical ClientMetadata / SUPPRESS semantics) so the check applies there too.
3. `resetCognitoUserPassword(email, tenant)` → returns an outcome instead of silently succeeding (**user decision 2026-09-15: re-verify, then reset**):
   - `not_found`: no native user. Route → 422 `NO_SIGN_IN` "This user has no password sign-in to reset." (Replaces the silent 200.)
   - Drifted/unverified email (typical for SSO-linked users): first `AdminUpdateUserAttributes` with `email=<lowercase>` + `email_verified=true`, by UUID Username. Setting `email_verified` in the same call stops Cognito sending a verification code. The next SSO login re-drifts it; accepted, because the reset code is delivered immediately.
   - `reset`: AdminResetUserPassword with `Username: user.Username` (the UUID, not the email).
   - `resent`: user is `FORCE_CHANGE_PASSWORD` (e.g. Tim: went straight to SSO and never set a native password). There is no password to reset, so issue a fresh temporary password via AdminCreateUser `MessageAction: RESEND` (same ClientMetadata as resendCognitoInvite, `intent: 'resend'`). Route returns 200 either way.
4. `resendCognitoInvite(email, tenant)`: resolve via `findNativeCognitoUser` instead of `AdminGetUser(email)`; absent → provision; state branching unchanged; RESEND uses `Username: user.Username`.

Infra: add `cognito-idp:ListUsers` and `cognito-idp:AdminUpdateUserAttributes` (re-verify before reset) to the API Lambda grant (`packages/infra/lib/stacks/api-stack.ts` ~948) and to the assertion list in `packages/infra/lib/stacks/__tests__/api-stack.test.ts:438`. `AdminGetUser` stays (other callers may use it; remove only if grep shows none).

Frontend: check how tenant-web `routes/users.tsx` surfaces reset-password errors; make sure a 422 message is shown, not swallowed.

## Checklist

- [x] TDD the lookup (shipped as `findCognitoUsersByEmail`) in `cognito.test.ts`: `ListUsers` `__command` discriminator; case-insensitive match, EXTERNAL_PROVIDER separated, non-matching email rejected, >1 native throws, quotes escaped
- [x] `provisionCognitoUser` skips create when a native match exists (`Gigi@…` + invite `gigi@…` ⇒ no AdminCreateUser)
- [x] `resetCognitoUserPassword` outcomes (`reset` by UUID / re-verify first / `resent` for FORCE_CHANGE_PASSWORD / `not_found` → 422 `NO_SIGN_IN`) in `cognito.test.ts` + `users.test.ts`
- [x] `handlers/admin/tenant-users.ts` has no reset route; its invite goes through `provisionCognitoUser` (test added)
- [x] `resendCognitoInvite` resolves via ListUsers; RESEND by UUID; state-guard tests still pass
- [x] `users.ts` `/invite` uses `provisionCognitoUser`; update `users.test.ts` mocks (ListUsers discriminator)
- [x] Move `escapeFilterValue` to a shared module (`cognito/list-users-filter.ts`); pre-sign-up imports it; pre-sign-up tests green
- [x] Infra: ListUsers + AdminUpdateUserAttributes grant + api-stack test
- [x] tenant-web reset UI: `ResetPasswordConfirm` already showed the thrown API message (so 422 `NO_SIGN_IN` surfaces). The reset response now carries `data.delivery` (`reset_code` | `temporary_password`), and the done-state copy branches on it, because Cognito refuses "Forgot password" for FORCE_CHANGE_PASSWORD users. Pinned in `routes/users.test.tsx`
- [x] Gates: api vitest (3385 pass), infra `api-stack.test.ts` (94 pass), `npm run typecheck` (14/14), `npm run lint` (9/9). `app.test.ts`'s SDK mock needed the new command exports
- [x] GOTCHAS.md entry: "SSO sign-in re-cases the Cognito email — never address a Cognito user by email"
- [x] Archive the plan → `plans/completed/` in the impl commit

## Outcome notes

- `findCognitoUsersByEmail` returns `{ native, federated }`. `resendCognitoInvite` treats "no native user but an unlinked federated one" as `already_registered` (never mutate). `provisionCognitoUser` (invite) still creates a native user in that case, which matches pre-existing behavior and is the linking flow's expected order.
- `AdminGetUser` is no longer called by the API Lambda. The grant is left in place (removing IAM is a separate, riskier change).
- The RESEND (AdminCreateUser `MessageAction: RESEND`) is the one call NOT addressed by UUID. It uses the email exactly as Cognito currently stores it (`emailOf(native)`; in reset, the just-restored lowercase form), because RESEND by email alias is proven in prod (CloudTrail 2026-09-10) and RESEND by UUID is not.
- apiFetch unwraps `{ data }`, so the reset outcome rides on `data.delivery` rather than `meta`.
- Unverified in a live pool: whether an SSO-linked user in `RESET_REQUIRED` (after an admin reset) can still sign in through SSO. Watch the first real use.

## Files

- M `apps/api/src/handlers/admin/cognito.ts`, `cognito.test.ts`
- M `apps/api/src/handlers/users.ts`, `users.test.ts`
- M `apps/api/src/handlers/admin/tenant-users.ts` (+ test) if it resets passwords
- M `apps/api/src/cognito/pre-sign-up.ts` (import the shared escape)
- M `packages/infra/lib/stacks/api-stack.ts`, `__tests__/api-stack.test.ts`
- M `apps/tenant-web/src/routes/users.tsx` (if the 422 message is not surfaced)
- M `dolas/agents/project/GOTCHAS.md`

## Risks

- **Deploy ordering:** the API code needs the `ListUsers` IAM grant. Both ship in one deploy (api component = CDK + Lambda). If the grant lands late, invite would 500 (AccessDenied) instead of creating a duplicate. That fails safe, but it is visible.
- **Filter-semantics dependency:** ListUsers `=` being case-insensitive is verified empirically, not documented. The lowercase re-compare keeps a case-sensitive filter from matching the wrong user, but it would then miss drifted users again. Add a code comment citing the 2026-09-15 prod check.
- **Latency:** invite/reset/resend each add one ListUsers call. Admin-only, low volume.
