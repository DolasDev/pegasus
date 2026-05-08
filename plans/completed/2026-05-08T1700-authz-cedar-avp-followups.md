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

- [x] **1. CFN diff sanity on the next deploy.** _Superseded
      2026-05-08._ Five successful staging deploys ran against this
      stack between 2026-05-03 (`b65c69c`) and 2026-05-07
      (`cd838ea`) without any UserPool replacement event or
      ApiStack/Lambda role failures. The "watch the next deploy"
      gate has been overtaken by events; if a regression had been
      latent it would have manifested already.

- [x] **2. DB migration sanity on dev DB.** _Superseded 2026-05-08._
      Both migrations (`20260503120000_add_tenant_policy_store_id`,
      `20260503120100_add_tenant_user_role_names`) ran cleanly during
      the foundation deploy. The legacy `role` column was
      subsequently dropped in `cd838ea` (item #6), so the
      `role`/`role_names` consistency queries no longer apply. The
      `tenants WHERE policy_store_id IS NULL` count was driven to
      zero by item #5's backfill on 2026-05-07.

- [x] **3. New-tenant happy-path AVP smoke.** _Done 2026-05-08
      against staging (account 248812875460)._ Created tenant
      `avp-smoke-20260508` (id `4b2e0267-c597-451e-a367-771dfac52fba`)
      via `POST /api/admin/tenants`. Verified end-to-end:

      - AVP store `MWqwqkPkEohrddMJdWxw2n` created at the same
        timestamp as the tenant row; DB `policy_store_id` matches
      - Store contents: 7 policies, 1 IdentitySource (no
        `groupConfiguration` on the cognitoUserPoolConfiguration —
        per the post-refactor design), schema includes the `Pegasus`
        namespace with `User.memberOfTypes=["Group"]`
      - Seeded admin TenantUser `dolasllc+avpsmoke@gmail.com` has
        `role_names=['tenant_admin']`, status `PENDING` (later
        `ACTIVE` after first login)
      - Logged in as the admin and hit `GET /api/v1/me/permissions`:
        `roles=["tenant_admin"]`, exactly 26 permissions covering
        every CRUD action across user/setting/api_client/quote/move/
        invoice/customer
      - CloudTrail confirmed the provisioning sequence (PutSchema +
        9 CreatePolicy attempts + CreateIdentitySource ×2 with the
        existing eventual-consistency retry dance, settling on 7
        active policies). `IsAuthorized` itself is a data-plane
        event not captured by default CloudTrail; AVP path selection
        is structurally guaranteed by `pickBackend()` whenever
        `policyStoreId` is non-null and `AUTHZ_OFFLINE !== 'true'`,
        which we verified holds for this tenant
      - No ERROR/WARN entries in the API Lambda log group during the
        provisioning + login window

- [x] **4. Negative-auth check.** _Done 2026-05-08 against staging._
      Demoted the smoke tenant's admin to `role_names=['tenant_user']`
      via `UPDATE tenant_users …`, signed out, signed back in to
      mint a fresh JWT (Cognito caches role claims for up to 1h, so a
      sign-out/in cycle is required — Amplify-style token refresh
      doesn't re-run the pre-token Lambda). The new token's
      `custom:roles` claim correctly read `["tenant_user"]`.

      - `POST /api/v1/users/invite` → **403 FORBIDDEN**
        (`{"code":"FORBIDDEN"}`) — write denied as expected
      - `GET  /api/v1/customers` → **200** (operational read allowed)
      - `GET  /api/v1/me/permissions` → 200, `roles=["tenant_user"]`,
        exactly 4 permissions: `quote:read`, `move:read`,
        `invoice:read`, `customer:read`

      Note: the original plan asked for `GET /api/v1/users → 200`,
      but `user:list` is **not** in the `tenant_user` baseline persona
      (`apps/api/src/authz/policies/20-tenant-user.cedar` grants only
      Read{Quote,Move,Invoice,Customer}). User listing is admin-only
      by design — the policy correctly denied. Used `GET /customers`
      as the read-allowed counterpart instead.

      The smoke tenant is intentionally retained for future
      regression checks; teardown when no longer useful via
      `DELETE FROM tenants WHERE id='4b2e0267-...'`,
      `aws verifiedpermissions delete-policy-store --policy-store-id MWqwqkPkEohrddMJdWxw2n`,
      and Cognito AdminDeleteUser on `dolasllc+avpsmoke@gmail.com`.

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

- [x] **9. AVP store count.** _Done 2026-05-08._ Hourly EventBridge
      schedule fires `apps/api/src/lambda-avp-store-count.ts`, which
      counts tenants with a non-null `policy_store_id` and publishes
      to CloudWatch (`Pegasus/Authorization/PolicyStoreCount`,
      `Unit=Count`). MonitoringStack adds two SNS-wired alarms on the
      metric — `pegasus-avp-store-count-warn` at >= 60 (informational,
      "plan ahead") and `pegasus-avp-store-count-critical` at >= 80
      ("file an AWS support ticket NOW to raise the quota"). Both use
      `treatMissingData: BREACHING` so a stuck publisher trips the
      alarm instead of silently coasting. The Operations dashboard
      gains a `SingleValueWidget` (current count) and a `GraphWidget`
      (trend with 60/80 threshold annotations). Metric namespace +
      name are pinned in `packages/infra/lib/metrics.ts`; the
      publisher repeats the same strings literally so apps/api stays
      free of any reverse dep on @pegasus/infra. IAM scopes
      `cloudwatch:PutMetricData` to the namespace via the
      `cloudwatch:namespace` condition key. Coverage: handler unit
      tests + ApiStack synth tests (Lambda shape, EventBridge cadence,
      IAM scoping) + MonitoringStack alarm tests.

- [x] **10. Empty `principal.sub` in `tenantMiddleware`.** _Done
      2026-05-08._ `apps/api/src/middleware/tenant.ts` now hard-rejects
      tokens missing the `sub` claim with `401 UNAUTHORIZED` /
      `Invalid token: missing subject`, before any tenant lookup runs.
      The downstream `?? ''` fallback on `principal.sub` and the
      `if (cognitoSub)` guard around the `TenantUser` lookup were
      dropped — both are now statically unreachable. Tests added in
      `apps/api/src/__tests__/tenant-middleware.test.ts` cover the new
      401 path and the existing 403/missing-claims tests were updated
      to include a `sub` so they still exercise the intended branches.

## Out of scope (and staying that way)

- Platform admin (`/api/admin/*`) authorization — uses
  `adminAuthMiddleware`, never flows through Cedar/AVP. Not in scope
  for this plan or future authz plans unless requirements change.
- M2M `ApiClient.scopes` and `requireScope` — separate identity model.
- Cross-tenant isolation guard policies — per-tenant stores make them
  structurally impossible to violate.
