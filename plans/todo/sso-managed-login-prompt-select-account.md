# SSO — migrate to managed login, then send `prompt=select_account`

Status: not started. Parked follow-up from the wrong-Microsoft-account fix (PR #494,
merged 2026-07-21, `98397de5`).

## Why this is the cleanest fix — and why it's blocked

PR #494 addressed the wrong-account sign-in three ways: `login_hint` to steer the IdP,
markers so the pre-token Lambda's federated denials are recognisable, and a one-click
IdP sign-out recovery flow on the callback. Those make a wrong-account sign-in
_preventable in the common case_, _obvious_, and _recoverable_.

`prompt=select_account` is strictly better than all of that: it forces Microsoft's
account picker on every federated sign-in, so a cached wrong account can never be
silently reused in the first place. Cognito forwards `prompt` (all values except
`none`) to third-party OIDC IdPs —
<https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html>.

**Blocker:** `prompt` passthrough is available in **managed login branding only**, NOT
the classic hosted UI. Verified in prod on 2026-07-21:

```
aws cognito-idp describe-user-pool-domain --profile dolas-pegasus-prod \
  --domain pegasus-331145994639 --query 'DomainDescription.ManagedLoginVersion'
# → 1   (classic hosted UI)
```

Pool tier is `ESSENTIALS`, so the feature is tier-eligible — only the branding version
stands in the way.

## The work

### 1. Migrate the tenant Cognito domain to managed login v2

`packages/infra/lib/stacks/cognito-stack.ts` — the `UserPoolDomain` needs
`managedLoginVersion: 2`, plus a `ManagedLoginBranding` resource (even an
empty/`useCognitoProvidedValues`-style one) for the tenant app client. Confirm the CDK
`aws-cognito` version in this repo exposes managed-login branding constructs; if not,
an `AWS::Cognito::ManagedLoginBranding` L1 (`CfnManagedLoginBranding`) is the fallback.

**Blast radius is low but non-zero, and it IS prod auth infrastructure:**

- We route users straight to their IdP via `identity_provider` (see
  `apps/tenant-web/src/auth/cognito.ts` `buildAuthorizeUrl`), so the hosted sign-in
  FORM is never shown — the visual change users would notice is essentially nil.
- BUT the error surface changes: managed login "returns errors that Lambda triggers
  generate as error text above the sign-in prompt" and the redirect-with-
  `error_description` behaviour our recovery flow depends on may render differently.
  **Re-verify the whole PR #494 recovery path against managed login** before shipping —
  the `SSO_ERROR_*` markers in `error_description` are the load-bearing contract.
- Admin-web uses the hosted UI directly (admin client returns early in
  `pre-token.ts`, so it never reaches tenant resolution) — check the admin login still
  works, or scope the branding to the tenant client only.

Do this migration as its **own PR** and soak it on staging first. Do not fold it into
the `prompt` change.

### 2. Send `prompt=select_account` — after the migration lands

`apps/tenant-web/src/auth/cognito.ts` `buildAuthorizeUrl` — add
`prompt: 'select_account'`. Best end state (a small extra bit of logic, worth it):

- **First attempt:** no `prompt` — with `login_hint` already steering the IdP, a user
  with a single cached session signs in with no extra click.
- **Retry after a wrong-account failure:** `prompt=select_account`, so the picker
  appears exactly when it's needed. The callback already knows it's a retry (it landed
  on the `wrong-account` state via a marker or the session-email mismatch — see
  `login.callback.tsx`); thread that through the `/login` redirect (a query flag or
  sessionStorage crumb) so the next `buildAuthorizeUrl` opts in.

If the conditional turns out fiddly, unconditional `prompt=select_account` is an
acceptable v1 — it just costs every SSO user one extra click per login.

## Is it worth doing?

Judgment call for the owner. `login_hint` (shipped) already resolves the normal case —
it steers Entra to the typed account, and the incident that triggered all this was a
cached account the user could have picked correctly. `prompt=select_account` closes the
residual gap (a user who genuinely has multiple live IdP sessions and picks wrong), at
the cost of a prod managed-login migration. Reasonable to leave parked unless
wrong-account reports recur.

## Verification

- Staging soak of the managed-login migration: full SSO login (QMM `M365`, Reliable
  `microsoft-reliable`), admin-web login, AND every branch of the PR #494 recovery flow
  (no-email, not-rostered, session-email mismatch) — confirm the `SSO_ERROR_*` markers
  still arrive in `error_description` intact.
- `cognito.test.ts` — `prompt` present on the retry path, absent on the first attempt
  (or present unconditionally if that's the chosen v1).
- `cognito-stack.test.ts` — managed login version + branding resource asserted.
