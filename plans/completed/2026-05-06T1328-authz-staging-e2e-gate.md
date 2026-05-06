# Cedar/AVP — authenticated staging E2E gate

> **Status (2026-05-06):** Code work complete. Step 1 (operator setup —
> create the staging Cognito user, seed the tenant row, set the GitHub
> secret + repo variables) is the remaining manual blocker before the
> next staging deploy will exercise the new spec end-to-end. The spec
> ships in skip mode until those env vars are present, so merging this
> early is safe.

## Context

PR #91 (`feat(api): cedar/AVP per-tenant authorization foundation`,
merged 2026-05-03 as `b65c69c`) shipped the per-tenant Cedar/AVP
authorization foundation. The post-merge follow-ups plan
(`plans/in-progress/authz-cedar-avp-followups.md`) lists two
verification items (#3 new-tenant happy-path, #4 negative-auth) that
are conceptually a perfect fit for the staging E2E gate added by
`plans/completed/79135c7-gate-prod-deploy-on-staging-e2e.md`.

The current staging gate (per `apps/e2e/REMOTE.md`) runs only
unauthenticated specs:

- `tests/api/health.spec.ts` — health + DB depth
- `tests/browser/landing.spec.ts` — landing loads

Everything else is `@local-only` because it depends on `SKIP_AUTH=true`
or local Prisma seeding. Asserting that AVP is actually wired in
staging requires an authenticated request — there's no unauthenticated
endpoint that proves the AVP path is being hit.

The deploy workflow already extracts `USER_POOL_ID` and
`MobileClientId` into `E2E_COGNITO_USER_POOL_ID` /
`E2E_COGNITO_CLIENT_ID` env vars (`.github/workflows/deploy.yml:181-198`),
labelled "reserved" in REMOTE.md. This plan turns those reservations
into real authenticated smoke tests.

The Cognito stack already enables `USER_PASSWORD_AUTH` on both the
tenant and mobile app clients
(`packages/infra/lib/stacks/cognito-stack.ts:377-385, 416-419`), so
there is no infra change needed for direct `InitiateAuth` token
minting.

## Goal

Add a recurring authenticated AVP smoke test to the staging E2E gate
that proves, on every deploy: (a) the AVP path is wired and answering,
(b) `tenant_admin` sees write permissions, (c) a forbidden write is
rejected. Catches regressions before prod deploys.

## Scope discipline

- **Not in scope**: literally re-implementing follow-ups item #3
  ("create a brand new tenant via `POST /api/admin/tenants` on every
  gate run"). Each run would create a real AVP policy store; AVP has a
  ~100-store soft account limit and CI burns those fast even with
  cleanup. Keep #3 as a one-shot manual smoke against staging during
  the backfill milestone.
- **Not in scope**: follow-ups item #4's "demote a user" path. That
  requires direct DB mutation, which the remote gate doesn't have. Stays
  `@local-only`.
- **Not in scope**: tenant SSO flow, Hosted UI, PKCE. The gate uses the
  direct password auth flow only.

## Plan

- [ ] **1. Provision a stable staging test admin in Cognito.**

      One-time setup. The user must exist before the spec can run, and
      its credentials must be available to the workflow.

      1. Choose a stable email: `e2e-admin@pegasus-test.invalid` (or a
         routable inbox you control — invitation email goes out, but
         we'll set the password directly so the link isn't needed).
      2. Pre-seed a tenant + the corresponding `tenant_users` row in
         the staging DB with `role_names = ARRAY['tenant_admin']`. This
         can be done via the existing admin-create flow
         (`POST /api/admin/tenants`) once, manually. Capture the
         resulting `tenantId` for the spec.
      3. Set the user's password permanently via AdminSetUserPassword
         so it doesn't expire:
         ```
         aws cognito-idp admin-set-user-password \
           --user-pool-id <STAGING_POOL_ID> \
           --username e2e-admin@pegasus-test.invalid \
           --password '<long-random>' --permanent
         ```
      4. Store the password as a GitHub Actions secret:
         `E2E_STAGING_ADMIN_PASSWORD` on the `staging` environment (so
         it's only injected for the staging job).
      5. Store the tenant ID as a non-secret env var or repo variable
         (not sensitive — just an ID): `E2E_STAGING_TENANT_ID`.

      _Verify:_ `aws cognito-idp admin-initiate-auth` with
      `USER_PASSWORD_AUTH` returns an ID token locally using the
      mobile client ID + the stored password. Decode and confirm
      `cognito:groups` is empty (we use `custom:roles`, not groups) and
      `custom:roles` includes `tenant_admin`. If `custom:roles` is
      empty, the pre-token-generation lambda hasn't picked up the
      `role_names` mirror — fix the seed before continuing.

- [x] **2. Choose the right Cognito client.**

      The deploy workflow currently extracts `MobileClientId` into
      `E2E_COGNITO_CLIENT_ID`. For tenant-admin testing we want the
      `tenantAppClient`, not the mobile one. Both support
      `USER_PASSWORD_AUTH`, but:

      - The tenant client has 8h token TTL and is what real tenant
        admins use → matches production traffic shape exactly.
      - The mobile client has 8h TTL too but is "for drivers" — using
        it for an admin user is semantically odd and could surprise a
        future reader.

      In `packages/infra/lib/stacks/cognito-stack.ts`, add a
      `TenantClientId` CfnOutput alongside the existing
      `MobileClientId` output. In `.github/workflows/deploy.yml`,
      extract it as `TENANT_CLIENT_ID` and pass it as
      `E2E_COGNITO_TENANT_CLIENT_ID` to the gate step. Do **not** drop
      the mobile client export — other consumers (mobile build) read
      it.

      _Verify:_ `cdk synth` shows the new output. Deploy run logs show
      the new env var is non-empty in the Run E2E step.

- [x] **3. Add a Cognito auth helper fixture.**

      New file `apps/e2e/fixtures/cognito.ts`:

      - Exports `getAdminIdToken()`: calls
        `cognito-idp:InitiateAuth` (`AuthFlow: USER_PASSWORD_AUTH`)
        against `E2E_COGNITO_TENANT_CLIENT_ID` with the
        `E2E_STAGING_ADMIN_USERNAME` / `E2E_STAGING_ADMIN_PASSWORD`
        credentials and returns the `IdToken`.
      - Caches the token in a module-level variable for the duration
        of the test run (tokens are valid 8h, the suite runs for ~1m).
      - Throws a clear "remote-mode auth not configured" error if any
        of the three env vars is missing — the spec's `test.skip`
        guard should prevent this in practice, but a clear error makes
        local debugging easier.

      Use `@aws-sdk/client-cognito-identity-provider` (already a
      transitive dep of the API; if not present in `apps/e2e`, add it
      as a direct dev dep — small, no native).

      Extend the `apiFetch` fixture in `apps/e2e/fixtures/index.ts` so
      authenticated specs can request a token-bearing variant:

      ```ts
      authedApiFetch: async ({}, use) => {
        const token = await getAdminIdToken()
        const fn = (path, init) => fetch(API_BASE + path, {
          ...init,
          headers: { Authorization: `Bearer ${token}`,
                     'x-tenant-id': process.env.E2E_STAGING_TENANT_ID,
                     'Content-Type': 'application/json',
                     ...init?.headers },
        })
        await use(fn)
      }
      ```

      Don't drop `x-tenant-id` — the existing tenant middleware reads
      it and Cognito groups don't carry tenant binding here.

      _Verify:_ a throwaway local script that imports the fixture and
      calls `getAdminIdToken()` against staging returns a JWT with
      `aud === <tenant client id>` and a non-empty `custom:roles`.

- [x] **4. Add the authenticated AVP smoke spec.**

      New file `apps/e2e/tests/api/authz-smoke.spec.ts`. Untagged (so
      the staging gate runs it). Contents:

      1. **Skip guard.** If `E2E_TARGET !== 'remote'` OR any of the
         four required env vars is missing
         (`E2E_COGNITO_USER_POOL_ID`, `E2E_COGNITO_TENANT_CLIENT_ID`,
         `E2E_STAGING_ADMIN_USERNAME`, `E2E_STAGING_ADMIN_PASSWORD`),
         skip the whole describe block. Local runs of the suite must
         still pass without the staging credentials.
      2. **Test: AVP is wired for tenant_admin.** `GET
         /api/v1/me/permissions` with bearer token →
         - `status === 200`
         - `body.roles` includes `'tenant_admin'`
         - `body.permissions` includes a write action like
           `'quote:create'` (matches the canonical assertion already
           used in `me-permissions.spec.ts`)
         - Every permission entry matches `/^[a-z_]+:[a-z_]+$/`
      3. **Test: a known-allowed write returns 200.** Pick a
         non-mutating write to keep this idempotent. Best option:
         create-then-rollback isn't possible without DB access, so
         instead use `POST /api/v1/users/invite` with a recognisable
         test address and accept either:
         - 200/201 (allowed by AVP, invite created), or
         - 409 (allowed by AVP, idempotency conflict — the test user
           already exists from a prior gate run)

         Reject 403 (AVP path skipped or persona policies missing) and
         reject 401 (token issue, not a Cedar issue).

         **Idempotency note:** the address `e2e-invite-target@pegasus-test.invalid`
         is reserved for this test. Don't use a fresh email per run —
         that would unbounded-grow `tenant_users` in staging. The
         second run yields 409 by design and the assertion handles it.

      4. **Test: a known-denied action.** No safe negative test exists
         for tenant_admin in the current persona model — they have
         every permission. Skip this for now; the negative leg is
         already covered by follow-ups item #4 in `@local-only` form.

      _Verify:_ run locally against staging using the documented
      `E2E_TARGET=remote` invocation in REMOTE.md plus the new env
      vars. All three assertions pass. Then deliberately break
      pickBackend (e.g. force the offline branch) on a throwaway
      branch, redeploy to a scratch env, and confirm the AVP-wired
      assertion still passes (because offline backend is functionally
      correct) but CloudWatch shows no `IsAuthorizedWithToken` calls
      — i.e. document this gate's actual coverage limit in REMOTE.md.

- [x] **5. Update REMOTE.md.**

      In `apps/e2e/REMOTE.md`, change "What the staging gate runs
      today" to list the new spec and document the new required env
      vars:

      | Var | Required | Used by |
      |---|---|---|
      | `E2E_COGNITO_TENANT_CLIENT_ID` | yes (auth specs) | `fixtures/cognito.ts` |
      | `E2E_STAGING_ADMIN_USERNAME` | yes (auth specs) | `fixtures/cognito.ts` |
      | `E2E_STAGING_ADMIN_PASSWORD` | yes (auth specs) | `fixtures/cognito.ts` |
      | `E2E_STAGING_TENANT_ID` | yes (auth specs) | `fixtures/index.ts` |

      Note explicitly: the gate proves AVP is _answering correctly_
      for the seeded admin, not that every tenant's persona policies
      uploaded cleanly during provisioning. That stronger guarantee
      requires per-tenant sampling, which is out of scope.

- [x] **6. Wire the new env vars into deploy.yml.**

      In the `Run E2E (remote)` step, add:

      ```yaml
      E2E_COGNITO_TENANT_CLIENT_ID: ${{ steps.outs.outputs.TENANT_CLIENT_ID }}
      E2E_STAGING_ADMIN_USERNAME: ${{ vars.E2E_STAGING_ADMIN_USERNAME }}
      E2E_STAGING_ADMIN_PASSWORD: ${{ secrets.E2E_STAGING_ADMIN_PASSWORD }}
      E2E_STAGING_TENANT_ID: ${{ vars.E2E_STAGING_TENANT_ID }}
      ```

      `vars.*` are non-secret repo variables (set in repo Settings →
      Secrets and variables → Actions → Variables); `secrets.*` is
      env-scoped. Using `vars` for the username avoids accidentally
      masking it in logs while keeping it environment-specific.

      _Verify:_ trigger a `workflow_dispatch` with `target: api` (or
      any change that touches `apps/api`) on a feature branch via the
      existing `redpath-e2e-gate-test` pattern (see successful run
      `25269075955`). Watch the gate step pass with the new spec
      visible in the report artifact.

- [x] **7. Operational note in `dolas/agents/project/GOTCHAS.md`.**

      Add a short entry: "Staging E2E gate uses a stable test admin
      (`e2e-admin@pegasus-test.invalid`). Don't delete it from staging
      Cognito; rotate via AdminSetUserPassword if the GH secret
      changes. The accompanying tenant row in staging DB is required
      too — its ID is in the `E2E_STAGING_TENANT_ID` repo variable."

      Keeps the implicit dependency from getting lost the next time
      someone audits dormant Cognito users.

## Out of scope

- Authenticated browser flows (login form, post-login redirect). Same
  reason as today: requires Hosted UI or full SPA navigation, much
  larger surface, separate plan.
- Per-tenant policy authoring tests (follow-ups item #7) — not built
  yet, no API to test.
- Replacing the manual one-shot smoke for follow-ups item #3
  (create-a-fresh-tenant). That's still worth doing once during the
  backfill, just not on every deploy.
