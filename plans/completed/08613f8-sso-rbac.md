# Gate the SSO provider endpoints — any tenant user can currently self-promote to admin

**Status:** IMPLEMENTED 2026-07-17 — awaiting review/merge. Not yet deployed, so the
post-deploy verification below is still outstanding.

**Branch:** `fix/sso-rbac`

## What landed

`ManageSsoProviders` (`sso:manage`, resourceType `Setting`) added to `authz/actions.ts`

- `authz/cedar.schema.json`; `requirePermission(Actions.ManageSsoProviders)` on all five
  `sso.ts` routes, placed **before** each `validator` so a denied caller gets 403 rather
  than a 400 that would confirm the body shape. No policy file touched — `tenant_admin`
  inherits it via the blanket permit, every other persona is denied by default.

Verified as planned: the plan's whole chain re-checked against the code before editing
(`app.ts:192` `/api/auth` vs `app.ts:367` `v1.route('/sso')` — login is untouched);
`npm test` (14/14 tasks), `typecheck`, `lint` all green; persona snapshots in
`authz-smoke.spec.ts` needed **no** edit, confirming no leak.

## Findings that corrected or extended the plan

- **The plan's route table mislabels line 621** as `PATCH /providers/:id`. It is
  actually `PATCH /providers/auth-settings` (toggles `cognitoAuthEnabled`). Five routes
  either way; all five are gated.
- **Deploy ordering is NOT atomic — the plan's suspicion was right.**
  `packages/infra/lib/stacks/api-stack.ts:1533` sets `executeAfter: [apiFunction]` on
  `SyncAvpPoliciesTrigger`, deliberately running the AVP schema sync **after** the API
  Lambda code is live. `apiFunction` is invoked unqualified (no alias/traffic shifting),
  so new code serves traffic the moment CFN finishes `UpdateFunctionCode`, while
  `PutSchema` lands seconds-to-minutes later (trigger timeout is 5 min). ⇒ a transient
  window where an admin can get 403 on SSO settings. It **fails closed** (never grants)
  and self-heals when the trigger completes. Call this out in the PR.
- **The AVP throttle risk is already mitigated** — no action needed. `authz-sync.ts:95`
  `withThrottleRetry` (7 attempts, exponential backoff + ±25% jitter, `ThrottlingException`
  only) plus sequential-per-tenant CreatePolicy and a 4-wide tenant pool. That code exists
  _because_ adding the `RunWorkflow` action rolled back a prod deploy (#195) — the exact
  scenario this change repeats. `listAllowedPermissions` chunks at AVP's 30/call
  `BatchIsAuthorized` limit dynamically, so the catalog growing to 65 actions is fine.
- **Hono typing side-effect:** adding middleware to `.delete('/providers/:id', …)` widens
  `c.req.param('id')` to `string | undefined`, which fails `exactOptionalPropertyTypes`
  against Prisma's `WhereUniqueInput` — an error that surfaces at the db call, not the
  edit. Used `users.ts`'s existing `?? ''` idiom. Recorded in GOTCHAS.md.
- **No tenant-web follow-up is needed** (the "Out of scope" item below anticipated one).
  The nav entry for `/settings/sso` is already `ADMIN_ONLY` (`AppShell.tsx:159`), so no
  legitimate non-admin reaches the page; a hand-typed URL is the only way in, and that is
  the attacker path, which now 403s. The page's `perms.has('setting:update')` gate only
  disables mutation buttons and was never the control — its comment claimed the API "does
  not enforce it yet", which is now false, so the comment was corrected.

## Tests

The five-route 403 coverage is table-driven in `sso.test.ts`'s `role access` block, and
was checked for vacuity: with the five `requirePermission` calls stripped, **all 15 new
assertions fail**; restored, all 60 pass. The first draft's "does not reach the database"
assertion passed even ungated on PUT/DELETE because it omitted `findUnique` — the first
db call those handlers make — so it now asserts over every mock. `requirePermission` is
not mocked: `AUTHZ_OFFLINE=true` evaluates the real `.cedar` policies in-process.

**Goal:** Put `requirePermission` on every `handlers/sso.ts` route, so only `tenant_admin`
can register, modify, or delete a tenant's identity providers. Today **any** authenticated
tenant session can — which is an intra-tenant privilege escalation, not a tidiness issue.

---

## Why this is a security fix, not cleanup (verified 2026-07-17, not inferred)

`sso.ts` says so itself: _"Phase 5 will add an RBAC check so only tenant_admin users can call
these endpoints. For now, any authenticated tenant session can manage providers."_

The chain, traced end to end:

1. `app.ts:367` — `v1.route('/sso', ssoHandler)`. No route-level gate; `/api/v1` requires only
   a valid tenant session, and each handler is expected to gate itself.
2. `handlers/sso.ts` — imports **no** `requirePermission` and **no** `Actions`. So every role
   (viewer, driver, sales, anyone with a session) can call all five routes.
3. A viewer registers an IdP **they control** (`POST /providers`) for their **own** tenant.
4. They sign in through it, asserting the **tenant_admin's** email address.
5. `pre-token.ts` resolves the tenant from the provider — correct, and exactly what #443
   mandates — then looks up the roster row for the **asserted email** in that tenant and
   issues `cedarRoles = tenantUser.roleNames` (`pre-token.ts:410`). That row is the admin's.

⇒ **Any authenticated user in a tenant can mint `tenant_admin` claims for that tenant.**

#443 closed the **cross-tenant** form of this (the provider now determines the tenant, so a
tenant's IdP can't mint another tenant's claims). The **intra-tenant** form is untouched: the
provider→tenant binding faithfully resolves the attacker's own tenant, and the roster then
hands over whatever roles the impersonated colleague has. The binding was never the whole
control — "only an admin may add an IdP" is the other half, and it was never built.

Two aggravating factors:

- **#451 makes it sticky.** `preSignUp` would _link_ the attacker's federated identity to the
  admin's **native** Cognito user (same email, same tenant, rostered ⇒ all gates pass). That
  is a permanent attachment to the victim's account, and it survives deleting the IdP.
- **`DELETE /providers/:id`** is equally ungated — any user can knock their tenant's SSO out.

Not remotely exploitable: it needs an authenticated session in the tenant first. But every
tenant user is inside that boundary, and "viewer" is the read-only baseline persona.

## The fix

Model it on `ManageRingCentralIntegration` — same shape (manage a tenant-level setting):

```ts
// authz/actions.ts
ManageSsoProviders: {
  id: 'ManageSsoProviders',
  resourceType: 'Setting',
  permission: 'sso:manage',
},
```

```jsonc
// authz/cedar.schema.json — beside the other Setting actions
"ManageSsoProviders": {
  "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Setting"] }
}
```

Then `requirePermission(Actions.ManageSsoProviders)` on all five routes in `sso.ts`:

| line | route                   |
| ---- | ----------------------- |
| 247  | `GET /providers`        |
| 305  | `POST /providers`       |
| 469  | `PUT /providers/:id`    |
| 621  | `PATCH /providers/:id`  |
| 646  | `DELETE /providers/:id` |

**One action, not a read/manage split.** `sso.ts`'s own stated intent is "only tenant_admin
users can call these endpoints", and the SSO settings page is an admin surface. A separate
`ReadSsoProviders` is easy to add later if a persona ever needs read-only visibility; adding
it now would be inventing a requirement.

**No policy file changes.** `policies/10-tenant-admin.cedar` is a blanket
`permit(principal in Group::"tenant_admin", action, resource)`, so the new action is granted
to admins automatically. No persona policy (`20-viewer.cedar`, `30-personas/*`) lists it, so
everyone else is denied by default — the correct fail-closed direction. **Do not** add it to
any persona.

### Login is NOT affected — checked, because it would be the obvious way to break prod

The tenant login page reads providers from a **different** handler: `authHandler`, mounted at
`/api/auth` (`app.ts:192`), whose routes are deliberately unauthenticated and expose only
tenant name + provider display names. `ssoHandler` is mounted **only** at `v1.route('/sso')`,
inside the tenant-protected block. Gating it cannot touch the pre-session login flow.
Re-verify with `grep -n "route('/sso'\|route('/api/auth'" apps/api/src/app.ts` before starting.

## Tests

- `sso.test.ts`: each of the five routes ⇒ **403** for a session without `sso:manage`;
  ⇒ unchanged behaviour for `tenant_admin`. The 403 case is the whole point — assert it
  per-route, since the gap is per-route and a missed decorator is exactly the failure mode.
- `authz/__tests__/load.test.ts`: the policy set still loads with the new action in schema.
- Persona sets must NOT change: `apps/e2e/tests/api/authz-smoke.spec.ts` pins **exact**
  permission lists per persona (`SALES_PERMISSIONS`, `VIEWER_PERMISSIONS`, dispatcher's 6,
  auditor's 4). If any of those snapshots needs editing, the grant leaked to a persona —
  stop and re-check the policies rather than updating the snapshot.
- `me-permissions.spec.ts` asserts shape + `toContain`, not an exact set, so a tenant_admin
  gaining `sso:manage` will not break it.

## Deploy considerations

- **AVP schema sync.** Adding an action changes `cedar.schema.json`, which fans a `PutSchema`
  out across every tenant's policy store. See the throttle/sequentialise gotcha
  (`ThrottlingException` above ~15 tenants → CFN rollback). Prod has ~7+ tenants; check how
  the sync is triggered on deploy and whether it retries before assuming it is fine.
- **Ordering.** The action must exist in the deployed schema BEFORE `requirePermission` can
  authorise against it. If schema sync and API deploy are separate steps, a window exists
  where admins get 403 on SSO settings. Confirm the deploy order; if it is not atomic, say so
  in the PR rather than discovering it in prod.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint`.
- **Post-deploy:** as `tenant_admin`, load the SSO settings page and list providers — must
  still work (Dolios owns `Microsoft` + `Microsoft-SAML`). Ideally also confirm a non-admin
  session gets 403 on `GET /api/v1/sso/providers`.
- Prod is the live system these two providers serve; a 403 for admins would break SSO
  management, so verify the admin path before calling it done.

## Out of scope

- **`tenant-web`'s SSO settings page.** Once gated, a non-admin opening it gets 403s. Check
  whether the nav/page is already permission-aware (`/me/permissions` exists and other
  surfaces use it); if it is not, a graceful hide is a follow-up — the API gate is the
  security fix and should not wait on UI polish.
- The global unique index on `cognitoProviderName`
  (`plans/completed/27cf540-sso-provider-fail-closed.md`).
- `sso.ts`'s create-then-rollback ordering, which is what leaves stray provider rows.
- `secretArn` (vestigial) and the hardcoded `email` claim mapping in `AttributeMapping`.

## Context

`pre-token.ts` is the highest-blast-radius file in the repo, but this change does not touch
it — the fix is entirely in `sso.ts` + `authz/`. Prior art: #443 (provider→tenant binding),
#451 (account linking), #453 (triggerSource routing), #456 (fail closed on ambiguity).
Prod pool `us-east-1_gg63uAxs0`.
