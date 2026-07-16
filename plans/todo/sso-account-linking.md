# Link federated identities to their existing native user

**Status:** TODO — planned 2026-07-16, not started. Ready to `/workstream-start`.

**Branch (when started):** `fix/sso-account-linking`

**Goal:** When a user signs in via SSO for the first time, link that federated identity to
their **existing native Cognito user in the same tenant**, so one person = one Cognito
user = one stable `sub`. Today Cognito silently creates a *second* user, and the split
`sub` quietly breaks audit attribution and driver scoping.

---

## Why this matters (not cosmetic — verified in prod 2026-07-16)

Federating an email that already has a native user produces **two Cognito users**:

```
native     CONFIRMED          d4788428-1051-70d7-f058-5b66c972eefc
FEDERATED  EXTERNAL_PROVIDER  Microsoft_zSmI_AFcBNlAm5zlipPNBPbiy_Qui3uCDNpDDWIWn8M
```

Cognito does **not** enforce email uniqueness for federated users, even though the pool
sets `UsernameAttributes: ["email"]` — verified, not assumed. Both sign in; both work.

Two users ⇒ **two different `sub` claims**. And:

- `apps/api/src/middleware/tenant.ts:139-145` resolves `TenantUser` **by `cognitoSub`**.
- `apps/api/src/cognito/pre-token.ts:~301` writes `cognitoSub` **only once**, on the
  PENDING→ACTIVE first login. Never updated afterwards.

So whichever identity did not set it misses the lookup. It is **fail-open**, so the
session still works — which is why this hides — but:

- **`userId` is unset** ⇒ audit attribution is lost (the code's own comment: *"recording
  who created an API client"*). Actions land unattributed.
- **A `driver` principal loses `crewMemberId`** ⇒ Cedar's `User.crewMemberId` attribute
  is absent ⇒ per-record `ReadMove` scoping and the Moves list filter break. A driver
  signing in via SSO sees the wrong moves, or none.

`AdminLinkProviderForUser` fixes this properly: after linking, the federated sign-in
returns the **destination (native) user**, so the `sub` stays stable and matches
`TenantUser.cognitoSub`.

## Prerequisite — reconcile stale `cognitoSub` first

**Do this before/alongside the linking work, and verify it.** During the 2026-07-16
debugging session the `steve@dolas.dev` Cognito users were deleted and recreated
(current rows were both created that day: native 19:58, federated 20:57). The
`TenantUser.cognitoSub` for that row was written at its *original* activation and very
likely points at a **sub that no longer exists** — in which case *neither* identity
matches and audit attribution is already broken on both password and SSO login.

- Query prod (Neon) for `TenantUser.cognitoSub WHERE email = 'steve@dolas.dev'` and
  compare against the two Cognito usernames above.
- The local postgres MCP is **not** usable for this: no password configured, and it
  points at local dev, not prod.
- If stale, re-point it at the native user's sub. Consider whether other tenants have the
  same drift (any user whose Cognito account was ever recreated).
- Worth deciding: should `pre-token.ts` refresh `cognitoSub` on ACTIVE logins too,
  instead of only at activation? That would self-heal drift, but it also means the *last*
  identity to log in wins — which is wrong while duplicates exist, and unnecessary once
  linking guarantees one sub. Probably: fix the data, keep the write PENDING-only.

## The trust boundary (settled — do not re-litigate)

Established by **PR #443**: **the provider determines the tenant.** A federated login's
tenant comes from `TenantSsoProvider.tenantId` (the provider's owner), never from the
asserted email. The pool is shared across tenants and each tenant controls its own IdP,
so an asserted email is not a trustworthy tenant signal.

Linking must respect the same boundary: **only ever link a federated identity from
provider P to a native user rostered in P's owning tenant.** AWS's own warning:

> "Because this API allows a user with an external federated identity to sign in as a
> local user, it is critical that it only be used with external IdPs and linked
> attributes that you trust."

Linking by `email` means trusting the IdP's `email` claim — which is exactly why the
provider→tenant scoping is load-bearing, not optional.

## Design (decided 2026-07-16)

- **Trigger:** a new `preSignUp` Lambda on `PreSignUp_ExternalProvider`. That is the only
  moment linking can happen — `AdminLinkProviderForUser` only works for an identity that
  *"hasn't yet signed in from their third-party IdP"*.
- **Auto-link**, scoped to the provider's own tenant.
- **Cross-tenant email:** allow, scoped to the provider's tenant only — never touch the
  other tenant's account. (Buildable: duplicate emails coexist, proven above.)

### Verified API facts — do NOT rediscover these

- **`Cognito_Subject` is NOT required for OIDC.** Only *social* IdPs (Facebook, Google,
  LoginWithAmazon, SignInWithApple) force it. AWS docs: *"For OIDC, the
  `ProviderAttributeName` can be any mapped value from a claim in the ID token"*; their
  own OIDC example links by `preferred_username`. **Link by `email`**, already mapped via
  `AttributeMapping: { email: 'email' }` in `sso.ts`.
- **Entra's `sub` is pairwise per application ID** — *"two different apps … receive two
  different values"*. It is **not** the portal's Object ID (`oid`, stable across apps), so
  it cannot be looked up ahead of time. Confirmed live: the federated `userId` is
  `zSmI_AFcBNlAm5zli…` (43 chars, not a GUID). Linking by `email` sidesteps this entirely.
- **`DestinationUser.ProviderAttributeValue` is the pool `Username`, NOT the email.**
  Because `UsernameAttributes: ["email"]`, Cognito generates a UUID username (e.g.
  `d4788428-1051-70d7-f058-5b66c972eefc`) and email is only an attribute.
  `DestinationUser.ProviderAttributeName` is **ignored**. `ProviderName` must be `Cognito`.
- **All destination-user attributes must be mutable** or the call fails. Verified in the
  prod pool: `custom:roles` and `email` are both `Mutable: true`. (Would have been a hard
  blocker.)
- Max **5** linked identities per user.
- `AliasExistsException` is a real error path here — handle it.

### Call shape

```
DestinationUser: ProviderName=Cognito, ProviderAttributeValue=<pool Username (UUID)>
SourceUser:      ProviderName=<cognitoProviderName>, ProviderAttributeName=email,
                 ProviderAttributeValue=<asserted email>
```

## Phases

### Phase 1 — `preSignUp` handler

New `apps/api/src/cognito/pre-sign-up.ts` (siblings: `pre-auth.ts`, `pre-token.ts`,
`custom-message.ts` — follow their shape, incl. the Prisma adapter + logger setup).

On `triggerSource === 'PreSignUp_ExternalProvider'`:

1. Parse `event.userName` (`<ProviderName>_<sub>`) for the provider name, and read
   `event.request.userAttributes.email`. (`pre-token.ts`'s `extractProviderName` parses
   the `identities` attribute — that attribute may not be present on preSignUp, so read
   the provider from `userName`. **Verify the real event shape before relying on either.**)
2. Resolve the provider's owning tenant via `TenantSsoProvider` (unknown/disabled ⇒ do
   not link; let `pre-token` deny at token time).
3. Find a native Cognito user with that email **rostered in that tenant** (`ListUsers`
   filtered by email + a `TenantUser` roster check).
4. If found ⇒ `AdminLinkProviderForUser` per the call shape above.
5. If not found ⇒ no-op. `pre-token.ts`'s strict invite-only check denies at token time.
6. **Never** link to a user rostered only in a different tenant.
7. Any other `triggerSource` ⇒ no-op, return the event unchanged.

> ⚠️ `preSignUp` runs on **every** sign-up, including native ones. A throw here blocks
> account creation. Branch on `triggerSource` first and fail loudly only where intended.

### Phase 2 — IaC

- `packages/infra/lib/stacks/api-stack.ts`: grant `cognito-idp:AdminLinkProviderForUser`
  (+ `cognito-idp:ListUsers` if used for the email→username lookup), scoped to the pool
  ARN. Add both to the pinned `COGNITO_INTROSPECTION_ACTIONS` list in
  `api-stack.test.ts` — that list is asserted one-test-per-action.
- `packages/infra/lib/stacks/cognito-stack.ts`: wire `preSignUp` into `lambdaTriggers`
  (already wires `preAuthentication`, `preTokenGeneration`, `customMessage` at ~line 340).
  Give the function DB reach the same way `preTokenFn` gets it.
- NOTE: the linking Lambda needs its **own** role grant — it is not the API function.

### Phase 3 — clean up the existing duplicate

The stray federated `steve@dolas.dev` (`Microsoft_zSmI_…`) must be **deleted** before it
can be linked — `AdminLinkProviderForUser` only links an identity that has not yet signed
in. After deleting, the next SSO sign-in fires `preSignUp` and links cleanly. Verify the
resulting token's `sub` matches `TenantUser.cognitoSub` and that `userId` is set on API
requests (i.e. audit attribution is back).

## Tests

- `pre-sign-up.test.ts`: same-tenant roster match ⇒ `AdminLinkProviderForUser` called with
  the **UUID username** (not the email) and `ProviderAttributeName: 'email'`; email
  rostered only in another tenant ⇒ **no** link call; no roster match ⇒ no link call;
  unknown/disabled provider ⇒ no link call; `triggerSource: 'PreSignUp_SignUp'` (native)
  ⇒ no-op, event returned unchanged; link failure ⇒ surfaced, not silently swallowed (a
  swallowed failure leaves a stray unlinked account — the bug we are fixing).
- `api-stack.test.ts`: the new IAM actions are pinned.
- `cognito-stack.test.ts`: the `preSignUp` trigger is wired.

## Verification

- `npm test` (root), `npm run typecheck`, `npm run lint`.
- **Post-deploy, required:** delete the stray federated user, sign in via the `Microsoft`
  provider, and confirm (a) only ONE Cognito user exists for the email, (b) the token's
  `sub` equals `TenantUser.cognitoSub`, (c) an API request has `userId` set. A green suite
  is not sufficient — this path only exists against real Cognito.

## Out of scope (tracked elsewhere)

- **RBAC on `sso.ts`** — no server-side check; any authenticated tenant session can manage
  providers. Worth doing on its own.
- **Domain verification** — the answer to email squatting across tenants.
- **Per-tenant user pools** — the structural fix. This is the **fifth** distinct bug from
  the shared-pool root (provider-name 409s, cross-tenant deactivation, IdP secrets
  readable pool-wide, duplicate-email identities, cross-tenant escalation #443). Deserves
  a decision rather than a sixth rediscovery.
- **Rotate the prod Entra client secret** — `describe-identity-provider` returns
  `client_secret` in **plaintext** to any principal with Cognito read; the live value was
  exposed in a session transcript on 2026-07-16.
- `secretArn` vestigial column; hardcoded `email` claim mapping in `sso.ts`
  `AttributeMapping` (Entra SAML defaults to the long schema URI).

## Context

Prod pool `us-east-1_gg63uAxs0` (acct `331145994639`, profiles `dolas-pegasus-prod` /
`-ro`). Staging pool `us-east-1_0LoW8JGgK`. Prior work: #435 (client secret), #442 (app
client `SupportedIdentityProviders`), #443 (provider→tenant binding).
