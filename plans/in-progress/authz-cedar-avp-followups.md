# Cedar/AVP authorization — follow-ups

## Context

PR #91 (`feat(api): cedar/AVP per-tenant authorization foundation`,
merged 2026-05-03 as `b65c69c`) landed the per-tenant Cedar/AVP
authorization foundation per `plans/completed/2026-05-04T0000-cedar-avp-foundation.md`.

That plan deliberately scoped out several follow-ups, and the merge
itself surfaces a few smoke gates that can only be exercised post-deploy.
This plan tracks what's left so nothing rots.

## Goal

Close out post-merge validation, run the existing-tenant backfill, then
work down the deferred cleanup items in safest-first order.

## Plan

### Post-deploy smoke gates (must run on next deploy)

- [ ] **1. CFN diff sanity on the next deploy.** Push to `main` triggers
      `.github/workflows/deploy.yml`; both `apps/api` and `packages/infra`
      lanes deploy. Watch:

      - **CognitoStack:** `AWS::Cognito::UserPool` should report
        `UPDATE_IN_PROGRESS` (in-place `AddCustomAttributes` for
        `custom:roles`). If the changeset shows
        `_requires replacement_` — **stop**; replacement invalidates
        every existing user.
      - **ApiStack:** Lambda IAM role gains two new policy statements
        (per-store AVP ops + `CreatePolicyStore`); Lambda env gains
        `COGNITO_USER_POOL_ARN`. No replacement of the function itself.

      _Verify:_ open the deploy run, expand each stack's CFN events,
      confirm `Resources: 0 to destroy` on Cognito specifically.

- [ ] **2. DB migration sanity on dev DB.** Both new migrations
      (`20260503120000_add_tenant_policy_store_id`,
      `20260503120100_add_tenant_user_role_names`) run via the API's
      existing migrate step. After deploy:

      ```sql
      -- both must return 0
      SELECT count(*) FROM tenant_users WHERE role='ADMIN' AND NOT 'tenant_admin' = ANY(role_names);
      SELECT count(*) FROM tenant_users WHERE role='USER'  AND NOT 'tenant_user'  = ANY(role_names);

      -- expected: every existing tenant has NULL policy_store_id (item #4 backfills them)
      SELECT count(*) FROM tenants WHERE policy_store_id IS NULL;
      ```

- [ ] **3. New-tenant happy-path AVP smoke.** Create a fresh tenant via
      `POST /api/admin/tenants`. Confirm in the AWS console:

      - Verified Permissions → a new policy store exists, store ID
        matches `tenants.policy_store_id` for the row
      - Store has the `Pegasus` schema + 7 policies (1 admin baseline +
        1 user baseline + 5 personas) + 1 Cognito IdentitySource
      - Seeded admin TenantUser has `role_names = ['tenant_admin']`
      - Log in as that admin, hit `GET /api/v1/me/permissions`:
        `roles: ['tenant_admin']`, `permissions` covers all 26 actions
      - CloudWatch on the API Lambda shows `IsAuthorizedWithToken` calls

- [ ] **4. Negative-auth check.** In dev DB, demote a test user:
      `UPDATE tenant_users SET role_names = ARRAY['tenant_user'], role='USER' WHERE id=...`.
      Force a token refresh (sign out/in — tokens cache up to 1h):

      - `GET  /api/v1/users` → **200** (read allowed)
      - `POST /api/v1/users/invite` → **403** (write denied)
      - `GET  /api/v1/me/permissions` → only the read actions

      If invite returns 200 in prod, the AVP path is being skipped
      (probably falling through to the offline `AUTHZ_OFFLINE` branch —
      a deploy bug). If 403 but reads also fail, the persona policies
      didn't upload during the new-tenant provisioning.

### Existing-tenant backfill

- [x] **5. Backfill `tenants.policy_store_id` for all pre-existing tenants.**
      _Unblocked 2026-05-07 by
      `plans/completed/2026-05-07T2102-avp-attribute-based-policies.md`._
      Provisioning is now correct end-to-end (the AVP backend uses
      `IsAuthorized` with manually-built entities), so backfill no
      longer risks broken stores.

      **Done 2026-05-07.** Script
      `apps/api/src/scripts/backfill-policy-stores.ts` runs idempotently
      and dry-runs by default. Staging executed cleanly: 1 legacy
      tenant (`default-tenant`) provisioned to policy store
      `GwJsDZrH6knT6pWrG6muoS`; post-run
      `count(*) FROM tenants WHERE policy_store_id IS NULL` = 0.
      Verified the new store carries the right shape: User
      `memberOfTypes=["Group"]`, 7 policies, IdentitySource with no
      `groupConfiguration`. Prod will pick up legacy tenants when
      run there with `AWS_PROFILE=pegasus-prod` and the prod
      DATABASE_URL secret.

      Until backfilled, their requests fall through `pickBackend()` to
      the offline wasm path — functionally correct but:

      - defeats the per-tenant store isolation guarantee
      - produces no AVP CloudTrail/audit trail for those tenants
      - means policy edits made via AVP console don't take effect for
        legacy tenants

      Approach: a one-shot script `apps/api/src/scripts/backfill-policy-stores.ts`
      that reuses `provisionTenantPolicyStore()` from
      `apps/api/src/lib/authz-provision.ts`. For each tenant where
      `policy_store_id IS NULL`:

      1. `provisionTenantPolicyStore({ tenantSlug, userPoolArn, tenantAppClientId })`
      2. `UPDATE tenants SET policy_store_id = $1 WHERE id = $2`
      3. Skip tenants that already have one set (idempotent re-runs)
      4. On partial failure, the new function does best-effort
         `DeletePolicyStore` so re-runs don't leak orphan stores

      Run it from a workstation with the API Lambda's role assumed (or
      a temporarily-granted IAM principal with the same AVP perms).

      **Watch the soft AVP limit (~100 stores per account)** — if the
      tenant count is approaching, file an AWS support ticket to raise
      it before backfilling. Confirm current count first via the AVP
      console; abort the script with a clear error if `count + tenants_to_backfill > 90`.

      _Verify:_ after the script runs,
      `SELECT count(*) FROM tenants WHERE policy_store_id IS NULL` is 0.
      Spot-check by inspecting the new policy store(s) via
      `aws verifiedpermissions get-schema` and `list-policies` (expect
      User `memberOfTypes=["Group"]` and 7 policies). Logging in as a
      backfilled tenant and watching `verifiedpermissions:IsAuthorized`
      calls in CloudTrail confirms the AVP path is selected (the
      backend uses no-token `IsAuthorized`, not `IsAuthorizedWithToken`
      — see `plans/completed/2026-05-07T2102-avp-attribute-based-policies.md`).

### Deferred cleanup (no urgency)

- [x] **6. Drop the legacy `tenant_users.role` enum + `custom:role` claim.**
      The original plan deliberately kept both as write-through shadows
      so in-flight tokens (≤1h Cognito TTL) don't break on deploy.
      After 24h post-deploy:

      1. Stop writing `role` in `apps/api/src/handlers/users.ts` (PATCH
         `/:id`) and `apps/api/src/handlers/admin/tenants.ts` (initial
         seed).
      2. Stop emitting `custom:role` from `apps/api/src/cognito/pre-token.ts`.
      3. Stop reading `custom:role` in
         `apps/api/src/middleware/tenant.ts` (the fallback to
         `[customRole]` becomes dead — switch to a hard error if
         `custom:roles` is absent).
      4. Drop the `role` field from the principal shim and `c.set('role', ...)`
         in middleware + SKIP_AUTH branches. Remove `role` from
         `apps/api/src/types.ts` AppVariables.
      5. Remove the `requireRole` factory from `apps/api/src/middleware/rbac.ts`
         (no callers should remain at this point).
      6. Migration: drop `tenant_users.role` column and the
         `TenantUserRole` enum.

      Each step is reversible until step 6. Land 1–4 in one PR, sit on
      it for a week, then 5–6 in a second PR.

- [ ] **7. Tenant-authored Cedar editing UX.** When a tenant needs to
      author their own policies (target persona: an enterprise tenant's
      security team), surface as a CRUD endpoint over a new
      `tenant_policies` table whose rows are pushed to that tenant's
      AVP store under a separate ID prefix (e.g. `custom-{uuid}`)
      so the system-managed policies (the 7 from
      `apps/api/src/authz/policies/`) remain distinguishable and
      unconflicted on next deploy.

      Out-of-scope for this plan; capture as its own phase when there's
      a real ask.

- [ ] **8. Domain-layer state-machine guards.** `canTransition` /
      `canFinalizeQuote` style rules in `packages/domain` are NOT
      authorization (those are about whether the entity itself supports
      the transition); they're a separate concern from "is this user
      allowed to do it." Out-of-scope here, listed only so it doesn't
      get conflated with the authz layer in future planning.

### Operational watch-items

- [ ] **9. AVP store count.** Soft limit ~100 stores per AWS account.
      Add a CloudWatch metric or ops dashboard: count of Pegasus
      tenants with non-null `policy_store_id`. Alert at 80; ticket-raise
      threshold at 60.

- [ ] **10. Empty `principal.sub` in `tenantMiddleware`.** Defensive
      fallback at `apps/api/src/middleware/tenant.ts` sets
      `sub: cognitoSub ?? ''`. Real Cognito tokens always carry `sub`,
      and SKIP_AUTH synthesizes the principal in `app.ts`, so this
      branch is unreachable in practice — but `''` would be a malformed
      AVP entity ID if ever hit. Either:

      - tighten to `if (!cognitoSub) return c.json({ error: 'INVALID_TOKEN' }, 401)`, or
      - leave as-is and document the invariant in a comment.

      Trivial; bundle into the next authz-area PR.

## Out of scope (and staying that way)

- Platform admin (`/api/admin/*`) authorization — uses
  `adminAuthMiddleware`, never flows through Cedar/AVP. Not in scope
  for this plan or future authz plans unless requirements change.
- M2M `ApiClient.scopes` and `requireScope` — separate identity model.
- Cross-tenant isolation guard policies — per-tenant stores make them
  structurally impossible to violate.
