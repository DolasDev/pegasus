# Detect a federated _sign-in_, not a federated _user_

**Status:** IN PROGRESS — planned + implemented 2026-07-17. Awaiting prod verification.

**Branch:** `fix/pre-token-federated-detection`

## Checklist

- [x] `isFederatedSignIn(triggerSource, providerName)` gates the federated branch; nothing
      inside that branch changed (the #443 logic is untouched)
- [x] Tests: 5 new cases in a `linked user` block; **verified they fail against the old
      `if (providerName)` condition** (3 of the 5 — the other 2 assert the contract that
      must not change, so they pass either way)
- [x] Parameterised `makeEvent`'s `triggerSource`; the 6 existing federated tests now carry
      `TokenGeneration_HostedAuth`. Their assertions are byte-identical — only the fixture
      became realistic. (They passed before only because the branch ignored triggerSource.)
- [x] `triggerSource` + `linkedProvider` logged on every resolution path
- [x] Gates: `npm test` (14/14), `npm run typecheck`, `npm run lint`
- [ ] PR → merge queue
- [ ] **Post-deploy prod verification (the only thing that proves this)** — see Verification

**Goal:** `pre-token.ts` must decide "was THIS authentication federated?" from how the user
authenticated, not from whether their account _has_ a linked IdP identity. Today the second
question is standing in for the first, and since PR #451 that proxy is wrong.

---

## The bug (live in prod, verified 2026-07-17)

A user rostered in multiple tenants cannot log in with **password** to any tenant except the
one that owns their SSO provider. Observed for `steve@dolas.dev` (rostered in **7** tenants):

```
Pre-Token trigger: SECURITY — AuthSession tenant disagrees with provider
  sessionTenantId : 32dd89be-…  (Nelson Westerberg Test — the tenant the user picked)
  providerTenantId: a90b22bc-…  (Dolios — owner of the `Microsoft` provider)
→ Error: Authentication failed: session does not match the identity provider.
```

### Why

`pre-token.ts:188` classifies a login as federated purely by the **presence** of the
`identities` user attribute:

```ts
const providerName = extractProviderName(event.request.userAttributes.identities)
if (providerName) {
  /* federated: the provider determines the tenant */
}
```

That was a sound proxy while only federated users had `identities`. **PR #451's
`AdminLinkProviderForUser` permanently attaches `identities` to the NATIVE user** — that is
the entire point of linking (one person = one Cognito user = one stable `sub`). So every
login by a linked user, password included, now takes the federated branch, pins the tenant
to the provider's owner, and trips the #443 AuthSession-disagreement guard on any other
tenant pick.

`identities` answers "does this account have a linked IdP identity?". The code needs "did
this sign-in come through an IdP?". Linking made those two questions come apart.

**Blast radius:** only users with a linked federated identity — today just `steve@dolas.dev`.
It will hit every SSO user in >1 tenant as linking spreads. Not tenant-wide; not an outage.

## The fix

Gate the federated branch on the **trigger source**, which reports how the token was
requested:

```ts
const isFederatedSignIn =
  providerName !== null && event.triggerSource === 'TokenGeneration_HostedAuth'
```

Evidence (AWS docs, "Pre token generation Lambda trigger sources"):

| triggerSource                          | Event                                                                              | Our flow                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `TokenGeneration_HostedAuth`           | "Called during authentication from the Amazon Cognito managed login sign-in page." | federated — the ONLY way an IdP sign-in reaches us |
| `TokenGeneration_Authentication`       | "Called after user authentication flows have completed."                           | native `USER_PASSWORD_AUTH` via `InitiateAuth`     |
| `TokenGeneration_NewPasswordChallenge` | "…the user has to change a temporary password."                                    | native (invited user's first login)                |
| `TokenGeneration_RefreshTokens`        | "Called when a user tries to refresh…"                                             | **never fires today** — see below                  |

This holds because of how the apps actually authenticate:

- Native password: `InitiateAuth` + `AuthFlow: 'USER_PASSWORD_AUTH'`
  (`apps/tenant-web/src/auth/cognito.ts:144-145`) — a direct API call, never the hosted UI.
- Federated: `/oauth2/authorize?identity_provider=<name>` (`apps/tenant-web/src/auth/cognito.ts:65`)
  — the hosted UI, and the `identity_provider` param skips its password form entirely.
- `admin-web` does use the hosted UI, but the admin app client short-circuits `pre-token`
  before tenant resolution (`pre-token.ts:115`), so it cannot reach this branch.

⚠️ **This couples pre-token to the login design.** If tenant password login is ever moved to
the hosted UI, a linked user would be misclassified again. Say so in a comment at the check.

### `TokenGeneration_RefreshTokens` — verified a non-issue TODAY

Nothing in this repo refreshes a token. Every exchange is `grant_type: 'authorization_code'`
(tenant-web, mobile, admin-web); `REFRESH_TOKEN_AUTH` appears only as the app client's
`ALLOW_REFRESH_TOKEN_AUTH` permitted flow. `admin-web` stores a refresh token
(`STORAGE_KEY_REFRESH_TOKEN`) but never exchanges it — and admin traffic short-circuits
anyway. (`pre-token.ts:238`'s "e.g. a token refresh, which never carries one" describes a
flow that does not exist yet.)

So refresh needs no handling now, but it is a **loaded gun**: whoever adds refresh must
decide how to resolve the tenant for a linked user, because at refresh neither `identities`
nor `triggerSource` can tell native from federated, and `AuthSession` is 10-minute TTL
(`auth.ts:235`) so it will be long expired. Leave a comment saying exactly that.

## Why this does not reopen #443

#443's boundary is that a federated login's tenant comes from `TenantSsoProvider.tenantId`,
never the asserted email. This narrows _which events_ take the federated branch; it does not
change what that branch does.

A hostile IdP asserting another tenant's admin email still arrives via the hosted UI ⇒
`HostedAuth` ⇒ provider path ⇒ tenant = the attacker's own ⇒ roster check there ⇒ denied.
Reaching the native path instead requires `triggerSource: TokenGeneration_Authentication`,
i.e. `USER_PASSWORD_AUTH`, i.e. the real password — at which point they are the user.

The `AuthSession`-disagreement check stays exactly as-is inside the federated branch.

## Tests (`pre-token.test.ts`)

The gap that let this ship: **no test covers a LINKED user** — one with `identities` present
who authenticates natively. That combination was impossible before #451.

- `identities` present + `TokenGeneration_Authentication` (linked user, password) ⇒ tenant
  from `AuthSession`; a disagreeing AuthSession does **NOT** throw. ← the prod bug
- `identities` present + `TokenGeneration_HostedAuth` ⇒ tenant from the provider (#443).
- `identities` present + `HostedAuth` + disagreeing AuthSession ⇒ still throws (#443 intact).
- `identities` absent + `HostedAuth` ⇒ native path (defensive: no provider ⇒ never federated).
- `identities` present + `TokenGeneration_NewPasswordChallenge` ⇒ native path.
- Existing federated tests must keep passing with `triggerSource` set to `HostedAuth` — if a
  test asserting _native_ behaviour needs its expectations changed, the change has leaked
  (per the #443 containment rule).

Note the existing `makeEvent` helper hardcodes `triggerSource: 'TokenGeneration_Authentication'`
— which is why every current "federated" test is really an `Authentication` event. Those
tests pass today only because the branch ignores `triggerSource`. Parameterise it.

## Observability

Log `triggerSource` on both branches. The live event's literal value is the one thing this
plan cannot verify without deploying, so the first login of each kind must confirm it.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint`.
- **Post-deploy, required — a green suite proves nothing here:**
  1. Password login → a tenant that is NOT Dolios (e.g. Nelson Westerberg Test). Must succeed.
     This is the reported break.
  2. SSO login via `Microsoft` → must still land in Dolios, `Resolved tenant via SSO provider`.
  3. Confirm the logged `triggerSource` is `TokenGeneration_Authentication` for (1) and
     `TokenGeneration_HostedAuth` for (2). If either differs, the rule is wrong — revert.
  4. `steve@dolas.dev` stays ONE Cognito user with `identities` intact (the #451 win holds).

## Out of scope

- Unlinking / reverting #451 — the link is correct; the classification is what is wrong.
- The refresh design (above) — real work, but only once a client actually refreshes.
- `pre-token.ts:191` resolving the provider with an unscoped `findFirst` on a column that is
  only unique per `(tenantId, cognitoProviderName)`.
- `admin/tenants.ts` not lowercasing `contactEmail`.

## Context

Introduced by #451 (`a523933`, SSO account linking), which is otherwise working as designed
and live-verified. Prod pool `us-east-1_gg63uAxs0`; fn `pegasus-cognito-pre-token-pegasus-prod-cognito`.
`pre-token.ts` is the highest-blast-radius file in the repo — every login goes through it.
