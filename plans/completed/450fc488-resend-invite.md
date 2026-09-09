# Resend invite — unstick a tenant user whose temporary password expired

## Context

A tenant admin reported an invited user whose temporary password had expired.
It is a real dead end, reachable in 7 days, and the admin has no button that
does anything about it.

Three legs, all verified in code:

1. **The temp password expires.** `packages/infra/lib/stacks/cognito-stack.ts:418`
   — `tempPasswordValidity: cdk.Duration.days(7)` (also Cognito's default).
   Invite is `AdminCreateUser` (`apps/api/src/handlers/users.ts:217`), so the
   invitee sits in Cognito `FORCE_CHANGE_PASSWORD` / `TenantUser.status = PENDING`
   until first login, where `cognito/pre-token.ts:450` flips them to `ACTIVE`.
2. **"Reset password" is explicitly withheld from exactly these users.**
   `handlers/users.ts:443` returns 422 for any status other than `ACTIVE`, with
   the comment _"PENDING users re-resolve through the invite / first-login
   set-password path"_. `tenant-web/src/routes/users.tsx:902` only renders the
   button for `status === 'ACTIVE'`. That invite path does not exist.
3. **Re-inviting is blocked too.** `POST /users/invite` calls `repo.findByEmail`
   first and 409s (`users.ts:199`) because the PENDING `TenantUser` row is there.

Cognito's built-in re-invite is `AdminCreateUser` with `MessageAction: 'RESEND'`
— it regenerates the temporary password and re-sends the invite email with a
fresh 7-day window. Nothing here needs a new AWS API; it needs a route.

## Scope

Endpoint + the tenant-web button that reaches it. Explicitly **out of scope**
(each is its own PR):

- `login.tsx:238`, which maps both `NotAuthorizedException` and
  `InvalidParameterException` to "signs in through your organization's identity
  provider" — so an expired invitee who tries "Forgot password?" is wrongly told
  they are an SSO account.
- Bumping `tempPasswordValidity` in CDK. Lowers incidence, does not fix the
  stuck state.
- Mirroring the route on the platform-admin surface
  (`handlers/admin/tenant-users.ts`), which has the same gap.

## Design

### 1. `resendCognitoInvite(email, tenant)` — `handlers/admin/cognito.ts`

Branch on **state**, not on exception names. Read `AdminGetUser` first (IAM
already grants it — `api-stack.ts:954`) and dispatch on `UserStatus`:

| `UserStatus`            | Action                                               | Why                                                         |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `FORCE_CHANGE_PASSWORD` | `AdminCreateUser` + `MessageAction: 'RESEND'`        | The expired-invite case. Fresh temp password, fresh 7 days. |
| `UserNotFoundException` | plain `AdminCreateUser` (as `provisionCognitoUser`)  | TenantUser row whose Cognito user was never created.        |
| anything else           | `already_registered` — no Cognito call; handler 422s | See the revision note below.                                |

Return which branch ran so the handler can log it.

> **Revision (self-review, before the PR).** As planned, this table had
> `CONFIRMED → AdminResetUserPassword`. That was a cross-tenant
> privilege-escalation: the pool is shared and keyed by email, `POST /invite`
> accepts an arbitrary address and swallows `UsernameExistsException`, so any
> tenant admin could mint a PENDING row for someone else's email and reset that
> person's real password pool-wide. The branch also had no legitimate target —
> `pre-token.ts` flips PENDING → ACTIVE on any successful login, so a CONFIRMED
> user needs no admin action at all. Shipped instead: `FORCE_CHANGE_PASSWORD` is
> the only mutable state, plus a cross-tenant roster guard in the handler. Full
> write-up in `dolas/agents/project/GOTCHAS.md`.

Two things that are easy to get wrong and must be got right:

- **`ClientMetadata` must be re-sent on the RESEND call.** Without it
  `cognito/custom-message.ts:140` passes the event straight through and the
  invitee gets Cognito's stock template — no tenant name, no login link, which
  is the exact confusion the custom template exists to prevent.
- **`MessageAction` is a single enum value**, so the existing
  `NODE_ENV !== 'production' ? SUPPRESS` spread used by the invite path cannot be
  reused here — `RESEND` and `SUPPRESS` are mutually exclusive. Non-prod skips
  the Cognito call entirely and returns 200, matching the invite path's
  no-email-in-dev semantics.

### 2. `POST /users/:id/resend-invite` — `handlers/users.ts`

- Gated on `requirePermission(Actions.InviteUser)` — no new Cedar action, so no
  AVP policy sync and no post-merge authz-smoke surprise.
- 404 when the TenantUser is not in this tenant.
- 422 `INVALID_STATE` unless `status === 'PENDING'`: an ACTIVE user has
  "Reset password", a DEACTIVATED user must be reactivated first.
- 500 `COGNITO_ERROR` on a Cognito failure, logged via `logger.error` like its
  neighbours.
- 200 `{ data: TenantUserResponse }` — the row is unchanged, mirroring
  `/:id/reset-password`.

### 3. tenant-web

- `api/queries/users.ts` — `useResendInvite()`, mirroring `useResetUserPassword()`.
- `routes/users.tsx` — `PanelState` gains `{ kind: 'resend'; user }`; a
  `ResendInviteConfirm` card modelled on `ResetPasswordConfirm` (confirm →
  pending → "invite re-sent" done state); a "Resend invite" button rendered on
  the row when `canManageRoles && user.status === 'PENDING'`, sitting where
  "Reset password" sits for ACTIVE users.

## Tests (TDD — red first)

- `apps/api/src/handlers/admin/cognito.test.ts` — `resendCognitoInvite`:
  RESEND for `FORCE_CHANGE_PASSWORD`; no Cognito write for any other state;
  fresh create on `UserNotFoundException`; **`ClientMetadata` present on the
  RESEND command** (the regression that would silently degrade the email);
  no Cognito call in non-prod.
- `apps/api/src/handlers/users.test.ts` — 200 + helper called for PENDING;
  422 for ACTIVE and for DEACTIVATED; 404 for another tenant's user;
  500 when the helper throws; 403 without `user:invite`.
- `apps/tenant-web/src/routes/users.test.tsx` (or the existing users spec) —
  button shows for PENDING and not for ACTIVE/DEACTIVATED; confirm posts to the
  endpoint; done state renders.

## Verification

`npm run typecheck`, `npm test`, `npm run lint` green before `/workstream-finish`.

## Notes

- No IAM or CDK change: `api-stack.ts:948-954` already grants
  `AdminCreateUser`, `AdminResetUserPassword` and `AdminGetUser`.
- The OpenAPI coverage test (`lib/openapi-spec.coverage.test.ts`) only asserts
  **GET** routes on the m2m plane, so this POST does not trip it.
