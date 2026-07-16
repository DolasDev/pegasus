# Fix SSO provider registration — missing OIDC client secret + misleading config UX

**Branch:** `fix/sso-oidc-client-secret` (worktree: `../pegasus-sso-oidc-client-secret`)

**Goal:** Make the tenant-web **SSO Providers** page capable of registering — and
editing — a _working_ identity provider. Today it registers an OIDC provider that can
never complete a login, because the form has no client-secret input: the resulting
Cognito IdP has no `client_secret`, so the authorization-code exchange at
`/oauth2/idpresponse` fails with a 400. Fix the missing field, stop edits from wiping
the secret, make the API reject shapes that cannot work instead of silently registering
them, and correct the config UX that describes the opposite of what the code does.

---

## Why (the gap) — evidence from live prod

OIDC login for the prod Microsoft/Entra provider fails with a **400 at**
`https://pegasus-331145994639.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`.
The redirect URI is correct; the IdP registration is not.

CloudTrail (`CreateIdentityProvider`, 2026-07-16T14:56:02Z, principal
`pegasus-prod-api-ApiFunctionCE271BD4-6VvoKdozISxQ` — i.e. created _through this app_,
not the console) shows the exact call, with **no `client_secret` key**:

```json
{
  "userPoolId": "us-east-1_gg63uAxs0",
  "providerName": "Microsoft",
  "providerType": "OIDC",
  "providerDetails": {
    "authorize_scopes": "openid email profile",
    "attributes_request_method": "GET",
    "client_id": "69a4033e-0a14-4fbd-8d7f-0a7b9ba77d47",
    "oidc_issuer": "https://login.microsoftonline.com/0612561a-01c9-497e-95fb-c81e495f916a/v2.0"
  },
  "attributeMapping": { "email": "email" }
}
```

`describe-identity-provider` confirms the stored config still has no `client_secret`.
Entra ID treats Cognito as a confidential client and requires the secret on the token
exchange → `AADSTS7000215` → Cognito surfaces 400 at the idpresponse callback. The
browser redirect and user authentication both succeed, which is why the failure only
appears on the final hop.

### Root cause of the omission

`sso-config.tsx:309` (help text under "OIDC client ID") states:

> "The client secret is stored in Secrets Manager — it is not managed here."

**That flow does not exist.** It is the design intent behind the vestigial
`TenantSsoProvider.secretArn` column — no code path ever writes it. The API instead
forwards `oidcClientSecret` directly to Cognito and never persists it
(`sso.ts:279-306`, and the header invariant at `sso.ts:17-19`). So the form deliberately
omits the one field that makes OIDC work, on the strength of a subsystem that was never
built. `secretArn` is therefore **part of this bug**, not a separate cleanup.

### Failure chain, in code

1. `apps/tenant-web/src/routes/sso-config.tsx` — `ProviderForm` has **no client-secret
   field**. `grep -rn oidcClientSecret apps/tenant-web/` → zero hits.
2. `apps/api/src/handlers/sso.ts:87` — `oidcClientSecret: z.string().min(1).optional()`
   → the request validates fine without it.
3. `apps/api/src/handlers/sso.ts:284-286` — the conditional spread silently drops
   `client_secret` when undefined.
4. `CreateIdentityProviderCommand` registers an unusable OIDC provider, returns 201. The
   tenant finds out only when a real login 400s.

### Second-order hazard — edits wipe the secret

`sso.ts:385-412` rebuilds `ProviderDetails` from scratch and calls
`UpdateIdentityProvider` **unconditionally**, even when only a DB-only field
(`name`, `isEnabled`) changed. Since the edit form has no secret field,
`body.oidcClientSecret` is always undefined → `client_secret` is omitted from the synced
`ProviderDetails`.

> **Unverified:** whether Cognito's `UpdateIdentityProvider` replaces `ProviderDetails`
> wholesale or merges it. The staging pool (`us-east-1_0LoW8JGgK`) has zero providers, so
> this could not be tested read-only. **The Phase 2b design is safe either way** — it
> avoids the call entirely unless a Cognito-relevant field changed.

Practical impact today: after the prod secret is attached out-of-band, toggling that
provider's enabled switch in the UI may silently re-break login.

## Phases

### Phase 1 (P0) — accept the client secret in tenant-web

- `apps/tenant-web/src/api/queries/sso.ts` — add `oidcClientSecret?: string` to
  `CreateSsoProviderInput` and `UpdateSsoProviderInput`.
- `apps/tenant-web/src/routes/sso-config.tsx` — add a **write-only** "Client secret"
  input to `ProviderForm`, rendered when the effective type is OIDC (mirror the existing
  `oidcClientId` condition: `type === 'OIDC' || (isEdit && existing?.type === 'OIDC')`):
  - `type="password"`, `autoComplete="new-password"`.
  - Never populated from server state (the API never returns it, by invariant).
  - **Create:** required. **Edit:** blank = leave unchanged; only send when non-empty.
  - Help text: where to get it (Entra ID → App registration → Certificates & secrets);
    stored in Cognito, never in Pegasus.
- Delete the false "stored in Secrets Manager — it is not managed here" line at :309.

### Phase 2 (P0) — reject shapes that cannot work

- `sso.ts` — `.superRefine` on `CreateSsoProviderBody`:
  - `type === 'OIDC'` ⇒ `oidcClientSecret`, `oidcClientId`, `metadataUrl` all required.
  - `type === 'SAML'` ⇒ `metadataUrl` required (**parity gap**: the UI enforces this via
    `required={type === 'SAML'}` at :294, but Zod does not — a direct API call registers
    a SAML IdP with empty `ProviderDetails`, which Cognito rejects → opaque 500 +
    rollback).
  - 400 `VALIDATION_ERROR` naming the missing field.
- Rationale: registering an IdP that can never complete a login is worse than a 400 — it
  fails late, in prod, with an opaque Cognito error, and both the DB row and the Cognito
  registration look healthy.

### Phase 2b (P0) — stop edits from wiping Cognito config

- `sso.ts` PUT — only call `UpdateIdentityProvider` when a **Cognito-relevant** field
  actually changed (`metadataUrl`, `oidcClientId`, `oidcClientSecret`). A `name`- or
  `isEnabled`-only edit is DB-only and must not touch Cognito.
- When a Cognito-relevant field _does_ change on an OIDC provider and no
  `oidcClientSecret` is supplied → 400 asking for the secret (the API cannot re-send what
  it never stored). Surface this in the form's help text.
- This makes the wipe impossible regardless of Cognito's merge semantics.

### Phase 3 (P1) — correct the UX that says the opposite of the truth

Three places claim the provider must pre-exist. `POST /providers` **creates** it:

- `sso-config.tsx:272` — "Must exactly match the identity provider name registered in
  your Cognito User Pool" → the name you choose **is created** in the pool, is used in
  the login URL, and is immutable after creation.
- `sso-config.tsx:~205` (`CardDescription`) — "Register an identity provider that is
  already configured in your Cognito User Pool" → same correction.
- `sso-config.tsx:1-19` (header comment) — "Out of scope (Phase 4+): Provisioning the
  IdP in Cognito automatically". It shipped. Correct or delete.

### Phase 4 (P1) — map provider-name collisions to 409, not 500

- `sso.ts:307-314` — the catch-all turns **every** Cognito error into a generic 500.
- Map `DuplicateProviderException` → **409 CONFLICT**, matching the Prisma `P2002` → 409
  path (`sso.ts:259-274`). Keep the message generic — the pool is shared, so a specific
  message would leak that another tenant holds the name.
- Record in-code: the user pool is **shared across tenants**, so Cognito's `ProviderName`
  is unique **per pool**, while the DB constraint is only
  `@@unique([tenantId, cognitoProviderName])`. Two tenants choosing `Microsoft` collide
  at the Cognito layer — the second passes the DB check, fails the Cognito call, gets
  rolled back, and today sees an opaque 500.

### Tests

Extend `apps/api/src/handlers/sso.test.ts` (already mocks
`@aws-sdk/client-cognito-identity-provider`):

- `client_secret` **is** forwarded in `ProviderDetails` when supplied → guards the
  original regression.
- OIDC create without `oidcClientSecret` → 400, **no** Cognito call made.
- SAML create without `metadataUrl` → 400, no Cognito call.
- SAML create _with_ `metadataUrl` still succeeds → no regression from the refinement.
- `name`/`isEnabled`-only update → **no** `UpdateIdentityProvider` call (Phase 2b).
- OIDC update changing `metadataUrl` without a secret → 400.
- `DuplicateProviderException` → 409, DB row rolled back.

tenant-web: extend the existing `sso-config` component tests — secret field renders for
OIDC and not SAML; blank-on-edit omits the field from the payload.

## Verification

- `npm test` (api + tenant-web), `npm run typecheck`, `npm run lint`.
- Manual after deploy: create an OIDC provider without a secret → 400 in the UI, not a
  201 + broken IdP.

## Out of scope (file as follow-ups)

- **Drop the vestigial `secretArn` column** — requires a migration; the misleading help
  text it spawned is removed in Phase 1, so the column is inert. Either implement the
  Secrets Manager flow or drop the column.
- **SAML email claim name is hardcoded** — `AttributeMapping: { email: 'email' }`
  (`sso.ts:304`) assumes the assertion emits a claim literally named `email`. Entra ID
  SAML defaults to `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`.
  The setup hint does instruct tenants to emit `email`, so this is a constraint rather
  than a break — but the claim name should be configurable.
- **No server-side RBAC** on the sso handler — `sso.ts:23-24` notes "Phase 5 will add an
  RBAC check"; today any authenticated tenant session can manage providers. The
  `perms.has('setting:update')` gate at `sso-config.tsx:544` is UI-only.
- **Prod hotfix** for the existing `Microsoft` provider — attaching the secret to the
  live registration is an out-of-band prod write via `update-identity-provider`. This PR
  does not touch live config.
