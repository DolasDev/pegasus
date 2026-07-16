# Wire SSO identity providers into the Cognito app client (the real 400)

**Branch:** `fix/sso-app-client-idp-wiring` (worktree: `../pegasus-sso-app-client-idp-wiring`)

**Goal:** Make an SSO provider created through **Settings → SSO Providers** actually
usable for login. Today `sso.ts` registers the IdP in the user pool but **never adds it
to any app client's `SupportedIdentityProviders`**, so Cognito refuses to complete the
federated login — the browser reaches Microsoft, authenticates, returns a valid code,
and Cognito then bails to its own `/error` page with a bare 400 and no
`error_description`. Fix the wiring, keep it repaired when CloudFormation resets it, and
grant the one IAM action the API is missing.

---

## ✅ EXECUTED 2026-07-16 (all phases)

- **Phase 1** — `POST /providers` adds the provider to the tenant app client after
  `CreateIdentityProvider`; on failure rolls back the IdP **and** the DB row.
- **Phase 2** — `DELETE /providers/:id` revokes on the client **before** deleting the
  IdP. A failed revoke is deliberately fatal (500, nothing deleted): proceeding would
  leave the client naming a provider that no longer exists, and Cognito validates that
  list on every client update — poisoning every later write to it.
- **Phase 3** — `api-stack.ts` grants `cognito-idp:UpdateUserPoolClient`; the pinned
  `COGNITO_INTROSPECTION_ACTIONS` list in `api-stack.test.ts` covers it.
- **Phase 4** — `GET /providers` reconciles via `reconcileAppClientProvidersSafely`
  (fail-open, add-only — the pool is shared, so other tenants' providers must survive).

New `apps/api/src/lib/cognito-app-client.ts` holds the read-modify-write; every write
echoes the full `DescribeUserPoolClient` output back minus the three read-only fields.
`COGNITO_TENANT_CLIENT_ID` was already threaded to the Lambda — no new env var.

Verified: 59 sso+helper tests, full root `npm test` 14/14 tasks, lint+typecheck 20/20.
The two riskiest mechanics were confirmed against **real** Cognito during diagnosis, not
just mocked: the read-modify-write shape is exactly the payload that fixed prod by hand,
and the provider-must-exist-first constraint came from a live staging rejection.

**One existing test earned its keep:** the delete-idempotency tests mocked _every_
Cognito call to reject, which surfaced the design question of whether a failed
app-client revoke should be fatal. It should — see Phase 2.

---

## Why (the gap) — diagnosed live against prod 2026-07-16

PR #435 fixed a _different_, real bug (OIDC IdPs registered with no `client_secret`).
Login still 400'd afterwards. Everything downstream was proven healthy:

- Secret valid — Entra minted a token for `client_id=69a4033e-…` using the exact value
  stored in Cognito.
- `/oauth2/authorize?identity_provider=Microsoft` → clean **302** to Microsoft.
- Microsoft authenticated and returned a valid `code` to `/oauth2/idpresponse`.
- `/oauth2/idpresponse?code=…` → **302** → `/error?code=…` → **400**, with **no
  `error_description`** (Cognito is silent on this failure).
- No email collision: the conflicting native user was deleted and the 400 was identical.
  Zero federated users had ever been created in the pool.

Root cause: **all three app clients had `SupportedIdentityProviders: ["COGNITO"]`.**
Adding `Microsoft` to `tenant-app-client` by hand fixed login immediately.

`sso.ts` has no `UpdateUserPoolClient` call anywhere — `grep` confirms. The feature
registers an IdP that no client is permitted to use.

### Two facts that constrain the design (both tested, not assumed)

1. **Cognito rejects unknown provider names.** Adding `Google` to a staging client with
   no Google IdP present:

   ```
   InvalidParameterException: The provider Google does not exist for User Pool
   us-east-1_0LoW8JGgK.
   ```

   ⇒ **IaC cannot pre-declare a curated provider list.** Providers are created at
   runtime with tenant-chosen names; CDK cannot know them at synth time, and any
   pre-declared list either fails the deploy or is stale. The list _must_ be maintained
   at runtime, immediately after `CreateIdentityProvider`, when the provider exists.

2. **CloudFormation owns the property today.** CDK's `addClient` renders it even though
   `cognito-stack.ts` never sets it — from the synthesized template:
   ```
   UserPoolTenantAppClientA86A3129 | tenant-app-client | SupportedIdentityProviders: ['COGNITO']
   ```
   CFN only rewrites resources whose template properties change, so runtime drift
   survives ordinary deploys. But the day someone edits the tenant app client in CDK (a
   callback URL, a token TTL), CFN resets the list to `["COGNITO"]` and **every tenant's
   SSO dies at once** — silently, with nothing in the diff that looks related.

### The landmine to respect

`UpdateUserPoolClient` **replaces the entire client config** — any field omitted is
reset to default. A bare `--supported-identity-providers` update would wipe
`CallbackURLs`, `AllowedOAuthFlows`, `ExplicitAuthFlows`, token validity, etc., breaking
**password login for every tenant**, not just SSO. Every write must be a full
read-modify-write of `DescribeUserPoolClient` output.

## Phases

### Phase 1 (P0) — add the provider to the app client on create

- `sso.ts` `POST /providers` — after `CreateIdentityProvider` succeeds, add
  `cognitoProviderName` to the tenant app client's `SupportedIdentityProviders`.
- Implement as a helper (e.g. `lib/cognito-app-client.ts`) that:
  1. `DescribeUserPoolClient` → full current config,
  2. strips read-only fields (`CreationDate`, `LastModifiedDate`, `ClientSecret`),
  3. unions the provider name into `SupportedIdentityProviders`,
  4. `UpdateUserPoolClient` with **everything else echoed back verbatim**.
- Idempotent: adding a name already present is a no-op (skip the write entirely).
- App client id comes from config/env — the tenant app client, not admin/mobile. Needs a
  `COGNITO_TENANT_CLIENT_ID` (or equivalent) available to the Lambda; check what
  `api-stack.ts` already passes before adding a new env var.
- Rollback: if the client update fails, roll back both the Cognito IdP **and** the DB
  row, matching the existing create rollback — a registered-but-unusable IdP is exactly
  the state this plan exists to prevent.

### Phase 2 (P0) — remove on delete

- `sso.ts` `DELETE /providers/:id` — remove the name from `SupportedIdentityProviders`
  (same read-modify-write helper) before/alongside `DeleteIdentityProvider`.
- Idempotent, matching the existing delete semantics (`ResourceNotFoundException` /
  `NotAuthorizedException` are already treated as success).

### Phase 3 (P0) — IAM grant (the IaC piece)

- `api-stack.ts` — add `cognito-idp:UpdateUserPoolClient` to the API Lambda's policy,
  scoped to the user pool ARN. It currently has only `ListUserPoolClients` +
  `DescribeUserPoolClient` (granted for AVP `CreateIdentitySource`).
- Without this the whole feature 500s in prod — verified: the ReadOnly role gets
  `AccessDeniedException` on exactly this action.

### Phase 4 (P1) — self-healing reconcile

- `GET /providers` reconciles the app client's `SupportedIdentityProviders` against the
  tenant's enabled providers in the DB, repairing any drift.
- Rationale: this is the answer to CFN resetting the list. If a CDK edit to the tenant
  app client wipes it, the next visit to the SSO settings page repairs it, rather than
  SSO staying dead until someone re-diagnoses this from scratch. Chosen over a CDK
  escape-hatch (`addPropertyDeletionOverride`) because CFN calls `UpdateUserPoolClient`
  under the hood — which replaces wholesale — so omitting the property may reset it
  anyway. That would need a staging deploy to verify; the reconcile depends on no such
  guess.
- Must be cheap and fail-open: a reconcile failure must **not** break the settings page.
  Log and continue.

### Tests

`apps/api/src/handlers/sso.test.ts` (already mocks the Cognito SDK):

- create → `UpdateUserPoolClient` called with the provider name **unioned into** the
  existing list, and **every other field preserved** (the regression that would break
  all password login).
- create when the name is already listed → **no** `UpdateUserPoolClient` call.
- create → client update fails → IdP **and** DB row both rolled back.
- delete → provider removed from the list, other fields preserved.
- `GET /providers` → drift (a provider in the DB missing from the client) is repaired.
- `GET /providers` → reconcile failure does not fail the request.

`packages/infra` — assert the API role policy includes `UpdateUserPoolClient`.

## Verification

- `npm test` (root), `npm run typecheck`, `npm run lint`.
- Post-deploy: create a throwaway OIDC provider in QA/staging → confirm it lands in the
  staging tenant app client's `SupportedIdentityProviders` → delete it → confirm removed.

## Out of scope (deliberate)

- **Curated provider picker** (Microsoft/Google/Okta prefills) — explicitly declined;
  free-form name stays, with the corrected help text shipped in #435.
- **Prod is currently hand-patched** — `Microsoft` was added to `tenant-app-client`
  manually on 2026-07-16 to unblock login. It stays until this ships; the reconcile in
  Phase 4 makes it self-maintaining afterwards.
- **Rotate the prod client secret** — `describe-identity-provider` returns
  `client_secret` in **plaintext** to any principal with Cognito read (verified via the
  ReadOnly profile), and the live value was exposed in a session transcript. Rotate in
  Entra and re-enter via the UI.
- **Account linking** (`AdminLinkProviderForUser`) — a native user whose email matches a
  federating user is a real future conflict; not hit today (the colliding user was
  deleted). Needs its own design.
- `secretArn` vestigial column; hardcoded SAML/OIDC `email` claim mapping; no
  server-side RBAC on the sso handler — all carried over from #435.
