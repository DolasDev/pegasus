# SSO — detect & recover from signing in with the wrong Microsoft account

## Context

A Reliable Van user (tenant `2b916653-df32-438d-a885-e9aedae40286`, provider
`microsoft-reliable`, Entra tenant `15be5d9e-…`) hit this on 2026-07-21:

```
PreTokenGeneration failed with error Authentication failed: No email associated
with identity. (Service: AWSCognitoIdentityProviderInternalService; Status Code: 400;
Error Code: UserLambdaValidationException; …)
```

Traced in prod. They typed `vdivito@reliablevan.com` into the Pegasus login form
(confirmed by `auth_sessions` rows ~2s before each failure), but their browser had a
**different, cached Microsoft account** signed in, and Entra silently reused it. Two
distinct Entra subjects exist on the same provider:

| Entra `sub`                                   | Email asserted            | Cognito user                         |
| --------------------------------------------- | ------------------------- | ------------------------------------ |
| `KJZaymww6yy8zuZhN1nWjdkGQ8Wgvg6tjSOD0S5Zkd4` | `vdivito@reliablevan.com` | linked onto native `54b8b4f8-…` ✅   |
| `v3xYeiGxUXI6XdEjQDeDN4zuk8t65oCpl0CXOKs3J1Y` | _(none — no `mail` set)_  | orphan `microsoft-reliable_v3xY…` ❌ |

`pre-sign-up` firing at 18:02 for the second sub proves it was a genuinely new
federated identity, not one account intermittently omitting `email`.

Root cause is customer-side (cached wrong account, and that account has no `mail`
attribute in Entra), but **Pegasus makes it undiagnosable and unrecoverable**:

1. We never tell Entra which account we want — no `login_hint` in the authorize URL.
2. `pre-token.ts` never compares the asserted email with the email the user typed.
3. The callback page dumps the raw AWS error string at the user, with no way out —
   retrying just reuses the same cached Microsoft session, forever.

### The silent case that matters most

`pre-token.ts`'s federated branch compares the AuthSession's **tenant** to the
provider's tenant but never the **email**. So today:

| Wrong MS account is…            | Current behaviour                                       |
| ------------------------------- | ------------------------------------------------------- |
| emailless (this incident)       | generic `No email associated with identity`             |
| has email, not on roster        | "Your account has not been granted access" — misleading |
| has email, **is** on the roster | **silently signs you in as that other person**          |

The third row is the one worth fixing regardless of UX: two coworkers on a shared
machine, you type your address, you land in their session with their roles. Not a
privilege escalation (they did authenticate as that person) but it is silent, and it
is the shape of thing that gets reported as "the app showed me someone else's data".

## Goal

Make a wrong-account federated sign-in **impossible to do by accident**, **obvious
when it happens**, and **recoverable in one click**.

Non-goal: migrating the user pool domain to managed login (see "Deferred").

---

## Unit 1 — Send `login_hint` on the authorize request

Cognito forwards `login_hint` to third-party **OIDC** IdPs
([authorization-endpoint docs](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)).
Entra then targets that account instead of silently reusing the cached one. This alone
would have prevented the incident.

**Change:** `apps/tenant-web/src/auth/cognito.ts` → `buildAuthorizeUrl()` takes the
user's email and adds `login_hint`. Thread it from `login.tsx`'s `redirecting` step
(the email is already in component state and in the `redirecting` step payload).

**Caveats to encode in the comment block:**

- Not forwarded to SAML / Google / Apple / Amazon / Facebook — a harmless no-op for
  our SAML providers. Do not condition on provider type; Cognito already ignores it.
- If a tenant's roster email ≠ their Entra UPN, Microsoft will say "we couldn't find
  an account" rather than signing them in. That is a **louder** failure than today's,
  but it is a behaviour change. Note it in the PR body; `pre-token` already requires
  the asserted email to match the roster, so such a user could not have logged in
  anyway — the failure just moves earlier and gets a clearer message.

**Tests:** `apps/tenant-web/src/auth/cognito.test.ts` — asserts `login_hint` is
present and URL-encoded; asserts the rest of the param set is unchanged.

---

## Unit 2 — Detect the mismatch in `pre-token`, with a stable sentinel

> ### ⚠️ Design corrected during implementation
>
> The plan called for `pre-token` to compare the AuthSession's email against the
> asserted email. **That check can never fire.** `pre-token.ts:217` looks the
> AuthSession up _by_ the asserted email:
>
> ```ts
> const authSession = await db.authSession.findFirst({
>   where: { email: normalizedEmail, expiresAt: { gt: now } }, …
> })
> ```
>
> so `authSession.email === normalizedEmail` holds by construction. In the actual
> failure mode the asserted email is the _other_ account's, so this finds no row at
> all — the real session is filed under the email the user typed — and the login
> falls through to the roster path as if no tenant had been picked.
>
> Nothing in the PreTokenGeneration event carries the original authorize request
> (no `state`, no correlator), so **the server cannot know what the user typed**.
> Reconstructing it from the tenant's most recent AuthSession was considered and
> rejected: two users of one tenant signing in at once would falsely accuse each
> other, on the login path, in production.
>
> Revised split, which is also simply better:
>
> - **Server** marks the two federated failure modes it _can_ see, so the client can
>   offer recovery instead of showing a raw AWS exception.
> - **Client** does the "you asked for A, you got B" comparison after the token
>   exchange, where the typed email is still in sessionStorage. This is the only
>   place the comparison is makeable — and it is also the only place that catches
>   the silent third case, where the wrong account IS rostered and everything
>   upstream legitimately succeeds.

**Change:** `apps/api/src/cognito/pre-token.ts` — hoist `extractProviderName` +
`isFederatedSignIn` above the email guard (`:189`), then mark two federated-only
failure modes:

- federated + no email asserted → `SSO_ERROR_NO_EMAIL`
- federated + email not on the provider tenant's roster → `SSO_ERROR_NOT_ROSTERED`

Native logins keep their existing messages verbatim: they have no IdP session to
blame and no recovery to offer. A DEACTIVATED federated user is deliberately _not_
marked either — signing out of the IdP will not reactivate them.

**Sentinel, not prose.** AWS explicitly documents that
`error_description` is not a fixed string and must not be pattern-matched. So embed
our own stable markers and substring-match _those_ in the client:

```
PEGASUS_IDP_NO_EMAIL
PEGASUS_IDP_NOT_ROSTERED
```

Exported from `packages/domain/src/shared/sso-errors.ts` (zero-dep, already a
dependency of both apps — no new edge in either direction) together with
`findSsoErrorMarker()`, so the match logic itself is shared and tested once rather
than duplicated as a string literal in two apps.

**Do not put the asserted email in the error message.** It lands in the redirect URL
and therefore in browser history and any intermediary logs. tenant-web already has the
typed email in component state / sessionStorage and can render the friendly version
itself. Log both emails at ERROR level in CloudWatch, where they belong.

**Tests:** `apps/api/src/cognito/pre-token.test.ts` — federated no-email and
not-rostered are marked; both native equivalents are asserted _unmarked_; a
DEACTIVATED federated user is unmarked; a correct federated sign-in still gets its
claims. Plus `packages/domain/src/shared/__tests__/sso-errors.test.ts` for the
matcher, including the real Cognito wrapper text from the 2026-07-21 incident and a
test that no marker is a substring of another.

---

## Unit 3 — Callback error screen + one-click chained sign-out

### 3a. Recognise the marker — and catch the silent case

`apps/tenant-web/src/routes/login.callback.tsx:79-84` currently does
`setStatus({name:'error', message: 'Sign-in failed: ' + error_description})` — which is
exactly how the raw AWS string reached the user. When `error_description` contains a
marker, render a dedicated state instead.

**Plus the third case the server cannot see** (see the correction under Unit 2):
after `validate-token` succeeds, compare the returned `session.email` against the
typed email from `sso-context`. Different → refuse the session and show the same
recovery UI. Guarded on an SSO context being present, so password logins are
untouched. This is a _usability_ guard, not a security boundary — the user did
authenticate as that person and is entitled to that session; what it prevents is the
silent landing.

New `auth/sso-context.ts` carries `{email, tenantId, providerId, providerName}`
across the IdP round-trip. Deliberately not folded into the PKCE state, which is a
single-use CSRF credential consumed on first read, whereas this must survive the
recovery redirect and come back.

The recovery state renders:

> **You're signed in to Microsoft as a different account.**
> Pegasus tried to sign you in as `<typed email>`, but your browser is signed in to a
> different Microsoft account. Sign out of it and try again.
> `[ Sign out of Microsoft and retry ]`

### 3b. The chained sign-out

Cognito's `/logout` [does not](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
end the upstream IdP session, so both are needed. **Order matters** — Cognito first:

1. `GET {cognitoDomain}/logout?client_id=…&logout_uri={origin}/login/signed-out`
2. `/login/signed-out` reads the stashed `{tenantId, providerId, email}` from
   sessionStorage and redirects to the IdP's `end_session_endpoint` with
   `post_logout_redirect_uri={origin}/login`.

Cognito-first degrades gracefully: the customer's Entra app registration may not have
our `post_logout_redirect_uri` registered (we don't control it), in which case
Microsoft shows its generic "you're signed out" page — but by then **both** sessions
are already cleared, which is the goal. IdP-first would strand the user with the
Cognito session still live.

### 3c. Getting `end_session_endpoint`

Do not hardcode `login.microsoftonline.com` — derive it per protocol so it also works
for non-Microsoft OIDC tenants. We store the OIDC discovery URL as
`TenantSsoProvider.metadataUrl` (`sso.ts:236` strips
`/.well-known/openid-configuration` off it to get `oidc_issuer`), so:

New public endpoint, `apps/api/src/handlers/auth.ts`:

```
POST /api/auth/idp-sign-out-url   { tenantId, providerId }  →  { signOutUrl: string | null }
```

- Looks up `TenantSsoProvider` by `(tenantId, cognitoProviderName)`, enabled only.
- OIDC → fetch `metadataUrl`, return `end_session_endpoint`. Cache in a module-level
  `Map` for the Lambda container's lifetime; discovery docs are effectively static.
- SAML, or provider has no `end_session_endpoint`, or the fetch fails → `null`.
- Public/unauthenticated is fine and consistent with the sibling `resolve-tenants` /
  `select-tenant` routes: it returns a URL that is already published in a public
  discovery document, and leaks nothing about the user. Keep the response shape free
  of any provider config beyond the URL.

When `signOutUrl` is `null`, the button still performs the Cognito logout and the page
tells the user to sign out of their identity provider manually. Never leave them with
no action.

### 3d. CDK

`packages/infra/lib/stacks/cognito-stack.ts:134-143` — add `/login/signed-out` to
`tenantLogoutUrls` for localhost, the CloudFront domain, and the custom domain.
`logoutUrls` already carries `/login`, so a dedicated landing route avoids relying on
Cognito accepting a `logout_uri` that differs from a registered one by query string.

**Tests:**

- `login.callback.test.tsx` — all three wrong-account paths; marker absent → generic
  error unchanged; no context → generic error; case-only email difference still
  signs in; password login (no context) untouched; raw AWS text never rendered.
- `login.signed-out.test.tsx` — forwards to the IdP when one is stashed, continues to
  `/login` when not.
- `idp-signout.test.ts` — URL construction for both legs, single-use consumption,
  non-https values refused.
- `sso-context.test.ts` — round-trip, repeated reads, and every malformed-storage
  shape degrading to null rather than throwing.
- `cognito.test.ts` — `login_hint` present, normalized, encoded; the rest of the
  parameter set pinned exactly.
- `auth.test.ts` — the new endpoint: OIDC hit, SAML → null, unknown/disabled → null,
  fetch failure → null, non-OK → null, non-https → null, DB throw → null, memoized.
- `cognito-stack.test.ts` — `/login/signed-out` **and** `/login` registered as
  sign-out URLs on the tenant client (previously untested for that client).

---

## Order & risk

1 → 2 → 3, all in one PR (3 depends on 2's sentinel; 1 is independent but trivially
small and thematically inseparable).

Blast radius is the tenant login path, which is the highest-consequence surface in the
app — see `[[project_sso_provider_tenant_binding]]`. Mitigations:

- Unit 2 only **adds** a throw inside the already-federated branch; the native path,
  the tenant-disagreement check, and the roster lookups are untouched.
- No change to how the tenant is resolved. This PR must not touch the
  provider→tenant binding.
- Unit 1 is the only behaviour change visible to a _working_ user; the roster-email ≠
  UPN caveat is the one thing to call out at review.

## Found along the way

`apps/tenant-web`'s `vite.config.ts` and `vitest.config.ts` both aliased
`@pegasus/domain` to `../domain/src/index.ts` — i.e. `apps/domain`, which does not
exist. It never surfaced because every prior tenant-web import of the package was
`import type`, which is erased before resolution. The first value import (the SSO
markers) failed immediately. Corrected to `../../packages/domain/src/index.ts` in
both files; without it, any future runtime use of the domain package from tenant-web
would have failed the same way.

## Verification

- `npm run typecheck && npm test` green across the monorepo.
- `apps/e2e` authz/login smoke unaffected (no snapshot of the authorize URL there —
  confirm before assuming).
- Post-merge, on prod: delete the orphan Cognito user
  `microsoft-reliable_v3xYeiGxUXI6XdEjQDeDN4zuk8t65oCpl0CXOKs3J1Y` so it cannot be
  re-selected and cannot block a future `AdminLinkProviderForUser`, then have the user
  retry.

## Deferred (explicitly not in this PR)

- **`prompt=select_account`** — the cleanest fix; forces Microsoft's account picker and
  kills the whole bug class. Cognito forwards it to OIDC IdPs, but **only under managed
  login branding**. Prod is `ManagedLoginVersion: 1` (classic hosted UI) on an
  `ESSENTIALS`-tier pool, so it is tier-eligible but branding-blocked. Since we bypass
  the hosted sign-in form entirely via `identity_provider`, migrating the domain to
  managed login has near-zero visual blast radius. End state once migrated: no `prompt`
  on the first attempt (no extra click), `prompt=select_account` automatically on the
  retry after a mismatch.
- **`pre-sign-up` idempotency** — `AdminLinkProviderForUser failed: SourceUser is
already linked to DestinationUser` (prod, 18:02:10) is a duplicate invocation 5s
  after a successful link, and it throws a user-facing error for what is arguably a
  success. Separate, unrelated fix.
- Tightening the AuthSession-email check on the **native** login path.
