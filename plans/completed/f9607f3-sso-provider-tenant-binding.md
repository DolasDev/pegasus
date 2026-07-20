# SECURITY: bind federated logins to their provider's tenant

**Branch:** `fix/sso-provider-tenant-binding` (worktree: `../pegasus-sso-provider-tenant-binding`)

**Goal:** Close a **live cross-tenant privilege escalation**. Today the tenant is resolved
from the user's _email_, and the identity provider that authenticated them is never
checked. Because every tenant self-serves its own IdP into a shared user pool, a tenant
can assert another tenant's email and receive that tenant's `custom:tenantId` and roles.

Fix: **the provider determines the tenant.** We own the provider→tenant mapping
(`TenantSsoProvider.tenantId`), so it is our data — not a claim from a party we do not
control.

**Scope is deliberately this fix only.** Account linking (`AdminLinkProviderForUser`),
RBAC on `sso.ts`, domain verification and per-tenant pools are all excluded so this can
ship fast and be reviewed as a security change. See "Follow-ups".

---

## ✅ EXECUTED 2026-07-16

Phase 1 shipped as specified. `extractProviderName` parses the `identities` attribute
defensively (unparseable/empty ⇒ treated as native, never as trusted federation);
federated logins resolve `tenantId` from `TenantSsoProvider`; unknown provider, disabled
provider, and an `AuthSession` disagreeing with the provider's owner all deny and log a
security event. Native logins are untouched.

**The blast-radius tripwire held:** all 28 pre-existing `pre-token.test.ts` tests pass
**unmodified** — the change did not leak out of the federated branch. 11 tests added
(39 total), including the escalation itself as a regression test. Full root `npm test`
14/14 tasks; lint + typecheck 20/20.

**Still required before this is really "done":** a real federated sign-in through the
prod `Microsoft` provider. This changes the live login path for every user and a green
suite is not sufficient evidence. The specific risk to watch: if the `Microsoft`
provider's `TenantSsoProvider.tenantId` is not the tenant `steve@dolas.dev` is rostered
in, federated login now fails closed where it previously succeeded via the email roster.

---

## Phase 0 — ANSWERED 2026-07-16 (tested in prod, not inferred)

**Question:** does Cognito enforce email uniqueness for _federated_ user creation when the
pool has `UsernameAttributes: ["email"]`?

**Answer: NO. Duplicate emails coexist.** Live prod state:

```
DUPLICATE EMAIL: steve@dolas.dev
   native     status=CONFIRMED          username=d4788428-1051-70d7-f058-5b66c972eefc
   FEDERATED  status=EXTERNAL_PROVIDER  username=Microsoft_zSmI_AFcBNlAm5zlipPNBPbiy_Qui3uCDNpDDWIWn8M
      identity: providerName=Microsoft, providerType=OIDC, userId=zSmI_AFcBNlAm5zlipPNBPbiy_Qui3uCDNpDDWIWn8M
```

Both sign in to the **same tenant** — confirmed by the operator. That is email-keyed
tenant resolution doing exactly what the code says, with two unrelated identities landing
in one place.

Consequences:

1. There is **no accidental protection** from email uniqueness. The escalation is real.
2. The same email _can_ exist as two distinct users, so a future "scope the login to the
   provider's own tenant" behavior is buildable (relevant to the linking follow-up).
3. `userId` = `zSmI_AFcBNlAm5zli…` (43 chars, not a GUID) confirms Entra's `sub` is the
   per-application pairwise identifier, not the portal's Object ID (`oid`).

## The exploit chain (why this is P0)

1. `sso.ts` has **no server-side RBAC** — its own header: _"any authenticated tenant
   session can manage providers."_ Any authenticated user of any tenant can
   `POST /api/v1/sso/providers` pointing at an IdP they fully control.
2. PR #442 adds that provider to the shared `tenant-app-client` automatically.
3. They authenticate through it, asserting `email = <target tenant's admin>`.
4. Cognito creates a federated user carrying that email — duplicates permitted (Phase 0).
5. `pre-token.ts:131-172` resolves the tenant **from the email** and injects the victim
   tenant's `custom:tenantId` + `custom:roles`.

Step 5 is the only step we need to break, and breaking it defeats steps 1–4 regardless.

The pool holds users across several orgs (`nelsonwesterberg.com`, `qmm.com`, `dolas.dev`,
…), so there are real targets. Only one provider exists today, which is the sole reason
this has not happened — that is circumstance, not a control. Note PR #442 **completed**
the chain: the gap predates it, but before #442 no tenant IdP was usable on the app
client, so federation never worked.

## Phase 1 — the boundary

`apps/api/src/cognito/pre-token.ts`:

- Read `identities` from `event.request.userAttributes` (Cognito delivers it as a **JSON
  string** for federated users; absent for native ones). Parse defensively — malformed or
  empty ⇒ treat as native, never as "trusted".
- **Federated (providerName present):**
  - `db.tenantSsoProvider.findFirst({ where: { cognitoProviderName: providerName } })` →
    `tenantId`. This is the tenant. **Do not** consult the email roster to resolve it.
  - Unknown provider ⇒ **deny** + log a security event.
  - `isEnabled: false` ⇒ **deny** + log.
  - If an `AuthSession` exists and its `tenantId` disagrees with the provider's owner ⇒
    **deny** + log. The login flow only ever routes a user to their selected tenant's own
    provider, so a mismatch is an attack signal or a serious bug.
- **Native (no identities):** unchanged — the existing AuthSession → roster path runs
  exactly as today.
- Downstream is unchanged for both: the `tenantUser` lookup by `(tenantId, email)`,
  strict invite-only, DEACTIVATED/PENDING handling and Cedar role injection all stay.
  Roster membership remains the authz gate; only _tenant resolution_ changes.

**Why this is the right boundary:** `TenantSsoProvider.tenantId` is our own record of who
owns a provider. An IdP can lie about `email`; it cannot lie about which provider it is,
because Cognito stamps `providerName` from the pool's own registration.

> ⚠️ **`pre-token.ts` is the highest-blast-radius file in the repo.** Every token for
> every user — SSO and password, tenant and mobile — passes through it. A mistake locks
> everyone out of prod. The federated-only branch is deliberate blast-radius control.
> **The existing native-login tests must pass untouched.** If one needs changing, that is
> evidence the change leaked out of its branch — stop and reconsider rather than editing
> the test.

## Tests

`apps/api/src/cognito/pre-token.test.ts`:

- Federated token → tenant comes from the provider's owner, not the email roster.
- **The escalation, as a regression test:** provider owned by tenant B + email rostered
  only in tenant A ⇒ resolves to B (then denies on B's roster), and **never** issues
  tenant A's `custom:tenantId`/roles.
- Unknown `providerName` ⇒ deny.
- `isEnabled: false` provider ⇒ deny.
- `AuthSession.tenantId` ≠ provider's tenant ⇒ deny.
- `AuthSession.tenantId` == provider's tenant ⇒ allow.
- Malformed / empty `identities` JSON ⇒ treated as native, not trusted.
- Native login with no `identities` ⇒ existing behavior, existing tests untouched.
- Admin client short-circuit unaffected.

## Verification

- `npm test` (root), `npm run typecheck`, `npm run lint`.
- Post-deploy, before declaring done: sign in through the real `Microsoft` provider in
  prod and confirm the token still carries the right `custom:tenantId`. This changes the
  live login path — a green suite is not sufficient evidence.

## Follow-ups (deliberately NOT here)

- **Account linking** (`AdminLinkProviderForUser`) — the original ask; its own plan. Now
  known buildable. Practical note: `steve@dolas.dev` already has a stray federated user,
  and linking only works for an identity that _"hasn't yet signed in"_ — that row must be
  deleted before it can be linked to the native one.
- **RBAC on `sso.ts`** — worth doing, but not a fix here: a malicious tenant _admin_
  retains the whole chain.
- **Domain verification** — the answer to email squatting across tenants.
- **Per-tenant user pools** — the structural fix. This is the **fifth** distinct bug from
  the shared-pool root (provider-name 409s, cross-tenant deactivation, IdP secrets
  readable pool-wide, duplicate-email identities, and this escalation). Deserves a
  decision rather than a sixth rediscovery.
- **Rotate the prod Entra client secret** — readable in plaintext by any Cognito-read
  principal; exposed in a session transcript 2026-07-16.
