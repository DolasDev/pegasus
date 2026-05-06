# Catch AVP-provisioning regressions in CI before they hit a deploy

> **Status (2026-05-06):** Closed. Items #1, #2, #4 landed in commit
> `28292d9` (bundle-contract test + IAM permission pin + GOTCHAS
> diagnostic note). Item #3 (live AVP integration test) was reviewed
> and explicitly deferred — the cost (new OIDC IAM, deploy-chain
> wiring, AVP quota monitoring) was judged not worth the
> insurance-policy-shaped marginal benefit on top of #1/#2 right now,
> so it's been split into its own standalone plan to revisit later:
> `plans/todo/avp-live-provisioning-integration-test.md`. The original
> #3 section below is preserved in this plan as historical record;
> the standalone plan is the live source of truth.

## Context

Between 2026-05-03 (cedar/AVP foundation merged in #91) and 2026-05-06,
`POST /api/admin/tenants` failed in staging four separate times, each
returning the same generic response:

```json
{
  "error": "Failed to provision the tenant authorization store. Please try again.",
  "code": "AUTHZ_ERROR"
}
```

Each failure had a different root cause, only distinguishable by reading
CloudWatch:

| Commit    | Class       | What was missing                                                               |
| --------- | ----------- | ------------------------------------------------------------------------------ |
| `5588b18` | Bundling    | `cedar.schema.json` and `policies/**/*.cedar` not copied into the Lambda asset |
| `46fb673` | IAM         | `cognito-idp:DescribeUserPool` not granted to the API Lambda role              |
| `02a2961` | Logic (AVP) | Eventual consistency on `PutSchema` after `CreatePolicyStore` not handled      |
| `cf36796` | IAM         | `cognito-idp:ListUserPoolClients` + `DescribeUserPoolClient` not granted       |

Each round cost a deploy cycle (~5 min) plus a prod approval. The
existing unit/integration tests did not catch any of these because:

1. **Bundling** is invisible to esbuild (`readFileSync(__dirname/...)`
   isn't a module reference) and to the CDK synth assertions
   (`Template.fromStack` doesn't inspect asset contents).
2. **IAM** assertions in `packages/infra/lib/stacks/__tests__/api-stack.test.ts`
   don't currently pin the AVP/Cognito permission set.
3. **Logic** errors in `apps/api/src/lib/authz-provision.ts` are only
   exposed by an end-to-end call into AVP, and the offline cedar-wasm
   path used by API integration tests skips `provisionTenantPolicyStore`
   entirely.

The staging E2E gate (added by
`plans/completed/79135c7-gate-prod-deploy-on-staging-e2e.md`) caught
_none_ of these because:

- The unauthenticated specs (`tests/api/health.spec.ts`,
  `tests/browser/landing.spec.ts`) don't touch AVP.
- The new authenticated AVP smoke
  (`apps/e2e/tests/api/authz-smoke.spec.ts`, shipped in #348cfba) skips
  cleanly until the operator setup in
  `plans/completed/2026-05-06T1328-authz-staging-e2e-gate.md` step 1
  is completed (which is itself blocked on tenant creation working,
  which is what kept failing).

So we had a chicken-and-egg problem: the gate that would have caught
issues 2/3/4 was gated on the very thing it was meant to verify.

## Goal

Catch the three classes of AVP-provisioning regression at CI time,
without depending on a successful deploy or a fully-provisioned staging
admin user. Failure on CI must distinguish between bundling, IAM, and
logic errors — no more "AUTHZ_ERROR, check CloudWatch."

## Plan

- [x] **1. Lambda bundle-contract assertion (cheap, no AWS dependency).**

      New test: `packages/infra/lib/stacks/__tests__/api-stack.bundle.test.ts`.
      Synthesises the `ApiStack` with a real bundle, then walks
      `cdk.out/asset.<hash>/` for the api function and asserts:

      - `cedar.schema.json` exists at the asset root
      - Every `*.cedar` file under `apps/api/src/authz/policies/`
        is present at the corresponding path inside the asset
        (preserving `30-personas/` subdirectory structure)
      - `node_modules/@cedar-policy/cedar-wasm/nodejs/cedar_wasm_bg.wasm`
        exists (regression test for `19c0798` — same class)

      Implementation note: the existing `api-stack.test.ts` uses
      `bundling-stacks: []` to skip bundling for speed. This new test
      explicitly *enables* bundling and accepts the ~3-5s synth latency.
      Mark with `it.concurrent` so it doesn't serialise the rest of the
      suite, and gate it behind an env var (`PEGASUS_RUN_BUNDLE_TESTS=1`)
      if the latency proves disruptive in local watch-mode runs.

      _Verify:_ delete `commandHooks.afterBundling` from
      `packages/infra/lib/stacks/api-stack.ts` on a throwaway branch,
      confirm the new test fails with a useful message naming the
      missing file. Restore the hook; test passes.

- [x] **2. IAM permission-set assertion for AVP and Cognito-introspection
      actions (cheap, no AWS dependency).**

      Extend `packages/infra/lib/stacks/__tests__/api-stack.test.ts` with
      a `describe('ApiStack — AVP / Cognito IAM')` block that asserts the
      synthesised CFN template grants every action in two pinned sets:

      ```
      AVP_REQUIRED = [
        'verifiedpermissions:CreatePolicyStore',
        'verifiedpermissions:DeletePolicyStore',
        'verifiedpermissions:PutSchema',
        'verifiedpermissions:CreatePolicy',
        'verifiedpermissions:CreateIdentitySource',
        'verifiedpermissions:IsAuthorized',
        'verifiedpermissions:IsAuthorizedWithToken',
        'verifiedpermissions:BatchIsAuthorized',
        'verifiedpermissions:BatchIsAuthorizedWithToken',
      ]

      COGNITO_INTROSPECTION_REQUIRED = [
        'cognito-idp:DescribeUserPool',
        'cognito-idp:ListUserPoolClients',
        'cognito-idp:DescribeUserPoolClient',
      ]
      ```

      Use `Template.hasResourceProperties('AWS::IAM::Policy', { ... })`
      with `Match.arrayWith([action])` per action. One assertion per
      action so a missing one prints exactly which action is gone, not
      just "policy doesn't match."

      Add a comment in the test naming the AWS docs reference for the
      Cognito set
      (`https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/identity-providers-cognito.html`)
      so the next person knows where the pin came from.

      _Verify:_ remove `cognito-idp:ListUserPoolClients` from the policy
      statement on a throwaway branch, confirm the new test names that
      action specifically. Restore.

      **What this catches:** someone tightening IAM and dropping a
      pinned action. **What this misses:** AWS adding a *new*
      requirement we don't yet know about (item #3 covers that).

- [ ] **3. Live AVP provisioning integration test (expensive, opt-in).**

      The above two are unit-shaped and can't catch runtime issues like
      the eventual-consistency bug fixed in `02a2961`, nor a future
      AWS-side requirement we haven't pinned. A live test that actually
      calls `provisionTenantPolicyStore` against real AVP would.

      Approach: a new vitest spec
      `apps/api/src/__tests__/authz-provision.live.test.ts` that:

      1. Skips unless `RUN_AVP_LIVE_TEST=1` is set (so PR builds and
         local `npm test` runs don't trigger it).
      2. Reads AWS credentials from the standard chain (CI provides
         them via OIDC role assumption).
      3. Reads `COGNITO_USER_POOL_ARN` + `COGNITO_TENANT_CLIENT_ID`
         from env (same vars the deployed Lambda uses).
      4. Calls `provisionTenantPolicyStore({ tenantSlug: 'ci-test-' + runId, ... })`.
      5. Asserts the returned `policyStoreId` is non-empty.
      6. Calls `IsAuthorizedWithToken` against the new store with a
         synthesised token to confirm the identity-source attached
         correctly (or a simpler `GetPolicyStore` if minting tokens is
         too involved).
      7. **Always** calls `DeletePolicyStore` in `afterEach`, with its
         own retry on `ResourceNotFoundException` so a teardown miss
         doesn't leak. Logs `policyStoreId` on every run for manual
         cleanup if needed.

      **CI wiring (where it gets opinionated):**

      - Run only when these paths change in a PR or on `main`:
        `apps/api/src/lib/authz-provision.ts`,
        `apps/api/src/authz/**`,
        `packages/infra/lib/stacks/api-stack.ts` (the IAM block),
        `packages/infra/lib/stacks/cognito-stack.ts`.
      - Run against the `staging` AWS account, reusing the existing OIDC
        role (`.github/workflows/_deploy.yml`).
      - As a separate job in `deploy.yml` that runs *after* the staging
        deploy completes — so the test exercises the just-deployed code
        path against the just-deployed IAM — but *before* the prod
        deploy, so a regression blocks prod. Adds maybe 10s to the
        critical path; worth it.

      **Cost watch:** the staging AVP account has a soft cap of ~100
      stores. With cleanup in `afterEach`, steady-state is 0; any orphan
      means a teardown failure. Add an alarm threshold of 5 (file as a
      separate item if/when this lands).

      _Verify:_ break `provisionTenantPolicyStore` on a throwaway branch
      (e.g. drop the consistency retry and the IAM grant), push, watch
      the new CI job fail with the actual AccessDeniedException /
      ResourceNotFoundException — exactly the signal that previously
      only appeared in CloudWatch after a successful deploy.

- [x] **4. Document the diagnostic flow in
      `dolas/agents/project/GOTCHAS.md`.**

      A short note: when `POST /api/admin/tenants` returns
      `AUTHZ_ERROR`, the only way to distinguish bundling vs IAM vs
      logic is CloudWatch. Capture the exact filter command:

      ```
      aws logs filter-log-events --log-group-name <api-log-group> --start-time $(($(date +%s) - 600))000 --filter-pattern '"Failed to provision"' --query 'events[].message' --output text
      ```

      Include the three error-message shapes we've seen so the next
      person can pattern-match without re-deriving the diagnosis.
      Reference items #1–#3 above as the durable fixes.

## Out of scope

- **Rewriting `provisionTenantPolicyStore` to skip AVP entirely in
  tests.** That would let us mock the SDK calls and assert the
  call-graph shape, but it would NOT catch IAM regressions (the SDK
  client never sees the AccessDenied because there's no real AWS
  contact). The CDK template assertion in #2 covers the same ground at
  much lower cost. We need a live test (#3) for the SDK path _because_
  it talks to real AWS.

- **CDK custom-resource provisioning.** The original cedar/AVP
  foundation plan
  (`plans/completed/2026-05-04T0000-cedar-avp-foundation.md`) explicitly
  rejected this — moving to a custom resource would replace the runtime
  provisioning path with a deploy-time one, which has its own failure
  modes (CFN rollback complexity, drift, partial-update orphans) and
  would invalidate the tests proposed here. Stay the course.

- **Mocking AVP eventual consistency in a unit test.** Possible but
  brittle (the consistency timing is implementation-defined by AWS); a
  retry harness either works against real AWS or doesn't, so the live
  test in #3 is the right shape.

## References

- AVP IAM requirements (Cognito identity source):
  `https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/identity-providers-cognito.html`
- The four follow-up commits, in order:
  - `5588b18` — bundle cedar schema + policies into API Lambda asset
  - `46fb673` — grant `cognito-idp:DescribeUserPool` for AVP
  - `02a2961` — retry on `ResourceNotFoundException` after `CreatePolicyStore`
  - `cf36796` — grant `ListUserPoolClients` + `DescribeUserPoolClient`
- Adjacent work:
  - `plans/in-progress/authz-cedar-avp-followups.md` (item #1: deploy-time
    sanity gates — same spirit, narrower scope)
  - `plans/completed/2026-05-06T1328-authz-staging-e2e-gate.md` (the
    end-to-end gate that _eventually_ covers the same ground but is
    operator-gated)
  - `plans/todo/staging-api-health-alarm.md` (catches the _next_ class
    of regression — runtime failures after a healthy deploy)
