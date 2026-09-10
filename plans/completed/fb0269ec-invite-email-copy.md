# Forgot-password message + invite / reset email copy

Follow-up to #673. Two asks: fix the forgot-password message an expired invitee
sees, and audit the language of every email sent about a password reset or an
invite / re-invite for anything misleading or confusing.

## 1. The forgot-password message (the reported defect)

`apps/tenant-web/src/routes/login.tsx:238` maps **both** `NotAuthorizedException`
and `InvalidParameterException` from `ForgotPassword` to:

> "This account signs in through your organization's identity provider and has no
> password to reset."

An invitee whose 7-day temporary password expired hits one of those codes and is
told they are an SSO account. `apps/admin-web/src/routes/login.tsx:94` has the
same defect in a milder form ("This account has no password to reset. Contact
another administrator.") — platform admins are also created with
`AdminCreateUser`, so it is the same journey.

**Do not change which exception codes are caught.** Which one Cognito returns for
a `FORCE_CHANGE_PASSWORD` user is not verified, and guessing is what produced the
bug. Change only the message.

**Do not add account state to `POST /api/auth/resolve-tenants`.** It is public and
unauthenticated; reporting "this email has a pending invite" would turn it into a
user-enumeration oracle.

Instead, branch on data that endpoint **already** returns publicly. In the catch,
re-resolve the _typed_ email (the form lets it differ from the sign-in email):

| resolution                                | message                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| every tenant has `providers.length === 0` | SSO is impossible ⇒ invite-only guidance                                                                              |
| any tenant has providers                  | combined: invite guidance + "if you normally sign in through your organization's identity provider, use that instead" |
| empty, or the resolve call fails          | generic "unable to start password reset"                                                                              |

The mixed-tenant case hedges. That is honest, and strictly better than being
confidently wrong.

## 2. Email copy audit

Only one Cognito email is customized today: `CustomMessage_AdminCreateUser`
(`apps/api/src/cognito/custom-message.ts`). Everything else falls through to
Cognito's stock text.

### Findings

1. **The invite email never mentions the expiry.** This is the root cause of the
   original ticket — the recipient has no way to know the password dies in 7 days.
2. **"For your security, please change your temporary password after signing in."**
   is wrong about the mechanic. Cognito issues a `NEW_PASSWORD_REQUIRED` challenge
   _during_ sign-in; it is not an optional afterwards step.
3. **A re-invite is indistinguishable from a first invite.** `MessageAction: 'RESEND'`
   re-fires the same trigger source, so #673's resend sends "You're invited to X"
   to someone who was already invited, and never says the earlier temporary
   password just stopped working.
4. **The password-reset email is Cognito's stock "Your confirmation code is …"**,
   with no statement of what to do with the code and no link. Worse for the
   admin-initiated reset (`POST /users/:id/reset-password`), where the recipient
   did not ask for anything and gets a bare code.

### Fixes

- Invite: state the 7-day expiry; replace the change-it-afterwards line with
  "Sign in with this temporary password and you'll be asked to choose a permanent
  one." Hardcode "7 days" next to a keep-in-sync comment pointing at
  `cognito-stack.ts` — same arrangement as `PASSWORD_POLICY_MESSAGE`. A CDK env
  var would couple a copy change to a cognito-stack deploy.
- Re-invite: `resendCognitoInvite` adds `intent: 'resend'` to its `ClientMetadata`
  (same IAM-gated caller, so trusted). Distinct subject, and a line saying the
  previous temporary password no longer works.
- Reset: customize `CustomMessage_ForgotPassword` — say a reset was requested,
  give the code, link to the sign-in page, and tell them to ignore it if they did
  not ask.

### Security constraint on the reset email — the reason it stays generic

`ForgotPassword` is a **public, unauthenticated** Cognito API **that accepts
`ClientMetadata`**. Anything the trigger renders from metadata on that source is
attacker-controlled: anyone could call it for a victim's address with
`tenantName: "Your account is compromised, call 555-…"` and our own domain would
send it. `escapeHtml` stops markup, not text.

So the ForgotPassword branch reads **no metadata at all** — fixed copy, login URL
from SSM only. That also settles the admin-initiated case: there is no
`CustomMessage_AdminResetUserPassword` source in the trigger enum, so
`AdminResetUserPassword` shares `CustomMessage_ForgotPassword` with self-service
and the two cannot be told apart safely. Generic "a password reset was requested"
is true for both.

The existing `AdminCreateUser` branch keeps reading metadata — its only callers
are IAM-gated (`handlers/users.ts`, `handlers/admin/*`).

## Out of scope

- The `source === 'admin'` branch in `resolveInviteContext` is dead: nothing sends
  it, and `scripts/create-admin-user.ts` passes `MessageAction: 'SUPPRESS'` so no
  email is sent at all. Leave it; do not invent copy for a path that never fires.
- What an expired invitee sees at **sign-in** (before they ever click "Forgot
  password?"). Same journey, but the fix needs the actual Cognito string from the
  ticket rather than a guess. Asked separately.

## Tests

- `custom-message.test.ts` — resend renders distinct copy; invite states the
  expiry; ForgotPassword source renders a body containing `{####}` (Cognito
  rejects one without it); **and a security test that the ForgotPassword source
  renders nothing from `clientMetadata`**, which fails if someone later wires
  `tenantName` into it.
- `login.test.tsx` (tenant-web) — the three message branches.
- admin-web login — the corrected message.

## Deploy risk

`custom-message.ts` is the Cognito stack's `lambdaTriggers.customMessage`, and
`.github/deploy-manifest.json` maps `apps/api` → the api component → `CognitoStack`.
That is the #518 blast radius (a CDK edit to a tenant `UserPoolClient` wipes
`SupportedIdentityProviders` and took SSO down for 22h). This change touches
Lambda source only, no CDK constructs, so `cdk diff` must show zero
`UserPoolClient` changes — that is the gate before merge.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` green; `/security-review` re-run
(the metadata-trust question is exactly what it is for).
