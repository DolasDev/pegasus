# Live AVP provisioning integration test in CI

## Context

Split out from
`plans/completed/2026-05-06T2118-avp-provisioning-regression-tests.md`
(commit `28292d9`), which closed three of four follow-ups for the
2026-05-03 → 2026-05-06 AVP provisioning incident series:

- `5588b18` — Lambda asset missing `cedar.schema.json` + `policies/**/*.cedar` (bundling)
- `46fb673` — `cognito-idp:DescribeUserPool` not granted (IAM)
- `cf36796` — `ListUserPoolClients` + `DescribeUserPoolClient` not granted (IAM)
- `02a2961` — `PutSchema` racing `CreatePolicyStore` eventual consistency (logic)

Each shipped as a generic `AUTHZ_ERROR` response, distinguishable only via
CloudWatch, and each cost a deploy cycle (~5 min) plus a prod approval.

Items #1, #2, #4 of the parent plan landed regression tests for the
bundling and IAM-removal cases:

- `packages/infra/lib/stacks/__tests__/api-stack.bundle.test.ts` — pins
  the asset contract (catches all three "X missing from bundle" classes).
- `packages/infra/lib/stacks/__tests__/api-stack.test.ts` — pins the
  AVP + Cognito-introspection IAM permission set (one assertion per
  action so a missing one names itself).
- `dolas/agents/project/GOTCHAS.md` — diagnostic-flow note + table of
  the four known error shapes mapped to fix commits.

That leaves a deliberate gap: those tests are unit-shaped and **cannot**
catch:

1. **AWS adding a _new_ required IAM action.** The IAM pin tests
   removal of permissions we already know about — they don't tell us
   when AVP starts requiring something new (which has happened to
   other AWS services on a multi-year cadence).
2. **Logic regressions in `provisionTenantPolicyStore` itself** —
   e.g. someone removes `withConsistencyRetry`, mishandles a cleanup
   edge case, or breaks the schema-load.
3. **Cedar schema/policy validation drift on real AVP.** PutSchema
   runs in STRICT mode against the real service; a schema change that
   passes locally but fails STRICT validation in AWS would slip past
   any unit test.

The team has explicitly decided to **defer this**: the cost
(new OIDC IAM, deploy-chain wiring, AVP quota monitoring) is real, the
benefit is "insurance-policy-shaped," and after the four fixes above
the provisioning code is now stable. Pick this back up if either:

- We get bitten by a class the unit tests don't catch, or
- Operator setup for the staging E2E gate
  (`plans/completed/2026-05-06T1328-authz-staging-e2e-gate.md` step 1)
  is finished and the resulting authz-smoke spec proves insufficient.

## Goal

A live AVP integration test that exercises `provisionTenantPolicyStore`
end-to-end against real AWS on every api-touching deploy, between the
staging-deploy step and the prod-deploy step, so a regression in the
AVP provisioning path blocks prod even when the unit tests are green.

Failure must surface the actual AWS error (`AccessDeniedException`,
`ResourceNotFoundException`, `ValidationException`, etc) directly in
the CI log — no more "AUTHZ_ERROR, check CloudWatch."

## Plan

- [ ] **1. Test spec.**

      New file: `apps/api/src/__tests__/authz-provision.live.test.ts`.

      Shape:

      1. `describe.skipIf(process.env['RUN_AVP_LIVE_TEST'] !== '1')`
         so PR builds, local `npm test`, and any non-explicit run
         skip cleanly.
      2. `beforeAll`: read AWS credentials from the standard chain
         (CI provides via OIDC role assumption; locally either via
         `aws sso login --profile pegasus-staging` or skip).
         Read `COGNITO_USER_POOL_ARN` + `COGNITO_TENANT_CLIENT_ID`
         from env (the same vars the deployed Lambda receives).
      3. `it('provisions a policy store end-to-end')`:
         - Generate a unique slug:
           `ci-test-${runId}-${Date.now().toString(36)}`. Logs to
           stdout so a leaked store can be located by name.
         - Call `provisionTenantPolicyStore({ tenantSlug, userPoolArn, tenantAppClientId })`.
         - Assert `policyStoreId` is non-empty and matches AVP's
           shape (~17 lowercase alphanumerics).
         - Spot-check the store: `GetPolicyStore`, then `ListPolicies`
           (≥7), then `ListIdentitySources` (1).
      4. `it('returns ALLOW for tenant_admin via IsAuthorizedWithToken')`:
         optional second test if minting a real Cognito token isn't
         too involved. If it is, defer to the staging E2E gate's
         authz-smoke spec — which exercises the same code path
         indirectly via real traffic.
      5. `afterEach`: **always** call `DeletePolicyStore` with its
         own retry on `ResourceNotFoundException`, log the
         `policyStoreId` on success/failure so manual cleanup is
         straightforward if teardown ever loses a store.

      Implementation note: the existing `apps/api` vitest config
      glob includes `__tests__/*.test.ts` — confirm this file isn't
      picked up by default `npm test` runs (the skip-guard makes
      that safe even if it is, but cleaner to grep-include
      `*.live.test.ts` separately).

- [ ] **2. CI job wiring.**

      Add a new job to `.github/workflows/deploy.yml`:

      ```yaml
      avp-provisioning-smoke:
        name: AVP provisioning smoke (staging)
        needs: [changes, deploy-staging]
        if: needs.changes.outputs.api == 'true' && github.ref == 'refs/heads/main'
        runs-on: ubuntu-latest
        environment: staging
        permissions:
          id-token: write
          contents: read
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with:
              node-version: '20'
              cache: 'npm'
          - run: npm ci
          - uses: aws-actions/configure-aws-credentials@v4
            with:
              role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_STAGING }}
              aws-region: us-east-1
          - name: Read Cognito outputs from staging
            id: cognito
            run: |
              # Use the same SSM params the deployed Lambda reads, so the
              # test exercises the just-deployed configuration.
              echo "POOL_ID=$(aws ssm get-parameter --name /pegasus/admin/cognito-user-pool-id --query Parameter.Value --output text)" >> "$GITHUB_OUTPUT"
              echo "CLIENT_ID=$(aws ssm get-parameter --name /pegasus/tenant/cognito-client-id --query Parameter.Value --output text)" >> "$GITHUB_OUTPUT"
          - name: Run live AVP smoke
            working-directory: apps/api
            env:
              RUN_AVP_LIVE_TEST: '1'
              COGNITO_USER_POOL_ARN: arn:aws:cognito-idp:us-east-1:${{ vars.AWS_ACCOUNT_STAGING }}:userpool/${{ steps.cognito.outputs.POOL_ID }}
              COGNITO_TENANT_CLIENT_ID: ${{ steps.cognito.outputs.CLIENT_ID }}
            run: npx vitest run __tests__/authz-provision.live.test.ts
      ```

      Wire `deploy-prod` to depend on `avp-provisioning-smoke` so a
      red smoke blocks prod:

      ```yaml
      deploy-prod:
        needs: [changes, e2e-staging, avp-provisioning-smoke]
      ```

      Adds ~10–15s to the critical path on api-touching deploys; no
      cost on plan-only or web-only pushes.

- [ ] **3. OIDC role permissions.**

      The existing staging deploy role already has the AVP +
      cognito-idp permissions (`packages/infra/lib/stacks/api-stack.ts`
      grants them to the API Lambda; the deploy role needs the same
      set to drive the test). Verify, and **only add what's missing**
      — don't over-broaden the deploy role.

      Concretely the deploy role needs:

      - `verifiedpermissions:CreatePolicyStore`
      - `verifiedpermissions:DeletePolicyStore`
      - `verifiedpermissions:PutSchema`
      - `verifiedpermissions:CreatePolicy`
      - `verifiedpermissions:CreateIdentitySource`
      - `verifiedpermissions:GetPolicyStore`
      - `verifiedpermissions:ListPolicies`
      - `verifiedpermissions:ListIdentitySources`
      - `cognito-idp:DescribeUserPool`
      - `cognito-idp:ListUserPoolClients`
      - `cognito-idp:DescribeUserPoolClient`
      - `ssm:GetParameter` on the two cognito SSM params

      **If the deploy role is shared with prod**, narrow this to a
      separate test-only role assumed by this job specifically. Don't
      give the prod-touching role AVP write permissions.

      Cross-reference: `plans/todo/tighten-deploy-role-policy.md` may
      already be the right home for these scoping decisions; reconcile
      before adding anything.

- [ ] **4. AVP quota monitoring.**

      The staging AVP account has a soft cap of ~100 policy stores.
      With teardown in `afterEach`, steady-state is 0; any orphan means
      a cleanup failure. Add a CloudWatch alarm in `MonitoringStack`:

      - Custom metric: `Pegasus/AVP/PolicyStoreCount` published by a
        small EventBridge-scheduled Lambda that calls
        `ListPolicyStores` and emits the count once per hour.
      - Alarm: count > 5 for 1 datapoint → SNS topic.
      - Threshold rationale: 1 production tenant + headroom for one
        in-flight test run; anything above means orphan accumulation.

      Defer if/until the live test is actually leaking — but flag it
      now so it doesn't get forgotten.

- [ ] **5. Document in `dolas/agents/project/GOTCHAS.md`.**

      Append a note to the existing `AUTHZ_ERROR` diagnostic block:
      "If the `avp-provisioning-smoke` job ever fails on `main`, the
      raw AWS exception will be in that job's log — no need to chase
      CloudWatch. The job creates and deletes a policy store named
      `ci-test-{runId}-{ts}`; if you see one of those lingering in
      AVP, the teardown failed and it should be safe to delete."

      Reference the alarm from item #4 once it's live.

## Out of scope

- **Mocking the AVP SDK in a unit test.** Considered and rejected in
  the parent plan: a mocked SDK never sees real `AccessDeniedException`
  or `ResourceNotFoundException`, so it would catch nothing the
  existing CDK template + bundle assertions don't already catch. We
  need a real-AWS test _because_ it talks to real AWS.

- **Running on PR builds.** AVP API rate limits + quota sharing across
  parallel CI jobs make this risky. Main-only is the right shape;
  feature-branch coverage is the staging E2E gate's job once operator
  setup is complete.

- **Replacing the staging E2E gate's authz-smoke spec.** That spec is
  user-flow-shaped (real Cognito sign-in → real bearer token → real
  request through API Gateway → real AVP); this test is
  provisioning-shaped (the create-tenant code path specifically).
  Different blast radii, both worth having.

## References

- Parent plan (closed):
  `plans/completed/2026-05-06T2118-avp-provisioning-regression-tests.md`
  — items #1, #2, #4 (the cheap unit tests + GOTCHAS note).
- Diagnostic table in `dolas/agents/project/GOTCHAS.md` under the
  `AUTHZ_ERROR` bullet.
- AVP IAM requirements (Cognito identity source):
  `https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/identity-providers-cognito.html`
- Adjacent ops:
  - `plans/todo/staging-api-health-alarm.md` (different signal — runtime
    failures _after_ a healthy deploy)
  - `plans/todo/tighten-deploy-role-policy.md` (where AVP-related deploy
    role scoping likely belongs)
