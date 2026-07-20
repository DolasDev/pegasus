# Make Cedar/AVP authorization actually work via attribute-based policies

## Status — COMPLETE (2026-05-07)

**End state: AVP backend is no longer attribute-based — it uses
`IsAuthorized` (no-token) with manually-built `User + Group` entities,
matching the offline cedar-wasm path's entity shape.** The
attribute-based approach this plan was named for did not work: AWS docs
make explicit (see
https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/cognito-map-token-to-schema.html
"The roles claim `cognito:groups` is an exception to this rule") that
AVP treats `cognito:groups` specially and never projects it as a
principal attribute, regardless of `groupConfiguration` state. The
clean fix-forward — switching `IsAuthorizedWithToken` → `IsAuthorized`
and constructing the principal hierarchy in code from
`principal.roleNames` — is the AWS-documented path for RBAC-by-groups
and is what landed.

**Successful staging+prod run:** GitHub Actions
[run 25521612203](https://github.com/DolasDev/pegasus/actions/runs/25521612203).

- Staging deploy job 74907021829 ✓
- E2E gate against staging job 74907369365 ✓
- Prod deploy job 74907814730 ✓

**Commits delivered:**

- `a4bb03c` (failed attempt — attribute-based; staging gate caught it)
- `b544caa` (the working fix — `IsAuthorized` + manual entity hierarchy)

**Cleanup performed:**

- 7 speculative Cognito groups (`tenant_admin`, `tenant_user`,
  `dispatcher`, `sales`, `accountant`, `auditor`, `crew_lead`) deleted
  from the staging user pool `us-east-1_0LoW8JGgK`. Only `PLATFORM_ADMIN`
  remains.
- `steve@dolas.dev` removed from the `tenant_admin` group before
  deletion.

**Migration script (`apps/api/src/scripts/migrate-policy-store.ts`)
applied twice to `KRzp8Jrxxkvy3YGnkeYQBP`:** once with the
attribute-based schema (failed approach) and once with the final
group-hierarchy schema (verified post-migration via `GetSchema`).

**GOTCHAS.md AUTHZ_ERROR table** updated with the AVP token-RBAC
unsupported entry and the fix reference.

---

## Original status (paused 2026-05-07)

**The AVP backend has never worked end-to-end.** Every tenant with
`policy_store_id` set has been failing with empty `/me/permissions`
or 500s on `requirePermission`-guarded routes since the foundation
merged 2026-05-03. The offline path masked it locally because that
backend builds the entity hierarchy in code; AVP has no equivalent
escape hatch.

Three sequential attempts to patch around AVP's token-derived
principal/group synthesis all hit fundamental restrictions and have
to be unwound:

| Commit    | Approach                                                                                                                    | Why it failed                                                                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2e74355` | Set `groupConfiguration.groupEntityType = Pegasus::Group` on the IdentitySource and emit `cognito:groups` from pre-token.   | AVP synthesises Group entities with **user-pool-prefixed** entity IDs (`Pegasus::Group::"<poolId>\|tenant_admin"`). Cedar policies use bare names, so `principal in Pegasus::Group::"tenant_admin"` never matched. /me/permissions returned 200 with `permissions: []`. |
| `5d585a7` | Pass `entities` to `IsAuthorizedWithToken` containing a User principal entity with bare Group parents.                      | AVP rejects: `ValidationException: PrincipalEntityType Pegasus::User cannot be defined in Entities`. The principal must come from the token, not be supplied externally.                                                                                                |
| `e94c3dc` | Pass `entities` containing prefixed Group → bare Group parent edge so transitivity makes `principal in bare-Group` resolve. | AVP rejects: `ValidationException: GroupEntityType Pegasus::Group cannot be defined in Entities`. **Any** entity of the type registered in `groupConfiguration` is forbidden in `entities` for token-based calls.                                                       |

**The root cause**: AVP's Cognito identity source treats principal-derivation
and group-derivation as fully owned by the IdentitySource configuration when
called via `IsAuthorizedWithToken`. There is no supported way to override the
prefixed entity IDs AVP generates, AND no supported way to declare bare-named
Group entities in the request when groupConfiguration is set. This is
documented behavior, not a bug in our code.

The `is-authorized` (no-token) API doesn't have these restrictions, which is
why both `5d585a7` and `e94c3dc` could be smoke-tested via direct CLI calls
returning `decision: ALLOW` — but the production code path goes through
`IsAuthorizedWithToken` and hits the validation rejections.

**This plan replaces the entity-hierarchy approach with attribute-based
policies.** The pre-token Lambda continues emitting `cognito:groups` into
the token. AVP — without `groupConfiguration` — automatically projects that
claim onto the principal as a User attribute when the schema declares it.
Policies check the attribute directly: `principal["cognito:groups"].contains("tenant_admin")`.
No entity-hierarchy gymnastics, no environment-specific entity-ID prefixes,
no `entities` argument needed.

The same change keeps the offline backend identical: `buildEntities`
populates the same attribute on the User entity instead of building Group
parents. Both backends evaluate the same policy text against the same
attribute shape — the long-standing parity goal of the foundation.

## What's currently broken on `main`

`HEAD = e94c3dc` (the `entities` reparent attempt). Staging API responses:

- `GET /api/v1/me/permissions` → **500** with
  `ValidationException: GroupEntityType Pegasus::Group cannot be defined in Entities`
- `POST /api/v1/users/invite` (any `requirePermission`-guarded route) → **500** same shape
- `GET /api/v1/me/permissions` for any tenant _without_ `policy_store_id` → 200 with correct
  `permissions` (offline backend, unaffected)

Prod has no AVP-provisioned tenants, so prod isn't affected by either
the AVP empty-permissions problem or the new 500. The prod deploy
chain is gated on the staging E2E gate, which is failing, so prod has
no in-flight changes from this rabbit hole.

The deploy-time IAM, bundling, and retry fixes in commits `5588b18`,
`46fb673`, `cf36796`, `02a2961`, `28292d9` are unaffected by this
plan and should stay. The `groupOverrideDetails` emission in
pre-token (`2e74355`) also stays — AVP needs the `cognito:groups`
claim to appear in the token regardless of which projection mechanism
we use.

## Goal

End-to-end on staging: a tenant_admin user authenticates against the
tenant Cognito client, hits `GET /api/v1/me/permissions`, and receives
the full 26-action permission set. `POST /api/v1/users/invite`
returns 200/201/409 (not 401/403/500). Same Cedar policies and same
schema power both the AVP backend and the offline cedar-wasm backend
so the SKIP_AUTH local test path stays a faithful production
simulation. The staging E2E gate's auth-smoke spec passes, prod
deploys unblock.

Policies must be environment-portable — no user-pool-ID prefixes
embedded in policy text, no per-tenant policy templating at provision
time, no per-environment policy variants. Schema and policy files on
disk are the single source of truth; provisioning copies them
verbatim into each tenant's AVP store.

## Plan

- [x] **1. Schema: declare `cognito:groups` as a User attribute.**

      Edit `apps/api/src/authz/cedar.schema.json`:

      ```json
      "User": {
        "memberOfTypes": [],
        "shape": {
          "type": "Record",
          "attributes": {
            "cognito:groups": {
              "required": false,
              "type": "Set",
              "element": { "type": "String" }
            }
          }
        }
      }
      ```

      Notes:

      - Drop `memberOfTypes: ["Group"]` from `User` — neither backend
        will use Group hierarchy any more.
      - The `Group` entity type itself can stay in the schema for now
        (no policies reference it after the rewrite, but leaving it
        means existing AVP stores' PutSchema migration is a smaller
        diff). Remove it in a follow-up cleanup once stable.
      - **`required: false`** is critical: a token without
        `cognito:groups` (admin app client tokens, M2M tokens, the
        SKIP_AUTH synthesised principal) must still parse against this
        schema without rejection.
      - Revert the `Group.memberOfTypes = ["Group"]` change shipped in
        `e94c3dc` — Group→Group parenthood is no longer needed and
        keeping it muddies the schema.

      _Verify locally:_ `npx vitest run --root apps/api authz` (12
      tests) still passes after the schema edit; the offline path's
      schema-validation is the only thing that exercises the schema
      shape locally.

- [x] **2. Policies: rewrite all 7 from group-hierarchy to attribute-check.**

      Files: `apps/api/src/authz/policies/{10-tenant-admin,20-tenant-user,30-personas/{dispatcher,sales,accountant,auditor,crew-lead}}.cedar`.

      Pattern: replace `principal in Pegasus::Group::"<role>"` with a
      `when` clause that guards on the attribute being present, then
      checks set membership:

      ```cedar
      // 10-tenant-admin.cedar — full access via tenant_admin role
      permit (
        principal,
        action,
        resource
      ) when {
        principal has "cognito:groups" &&
        principal["cognito:groups"].contains("tenant_admin")
      };
      ```

      ```cedar
      // 30-personas/dispatcher.cedar — operational read/write
      permit (
        principal,
        action in [
          Pegasus::Action::"ReadMove",
          Pegasus::Action::"CreateMove",
          Pegasus::Action::"UpdateMove",
          Pegasus::Action::"ReadCustomer",
          Pegasus::Action::"UpdateCustomer",
          Pegasus::Action::"ReadQuote"
        ],
        resource
      ) when {
        principal has "cognito:groups" &&
        principal["cognito:groups"].contains("dispatcher")
      };
      ```

      Apply the same pattern to all seven files. The action-list
      guards (where present) stay unchanged — the only edit per file
      is principal scope and the `when` clause.

      Why the `principal has "cognito:groups"` guard: Cedar throws on
      attribute access if the attribute is absent. STRICT validation
      mode (which our policy stores use) flags `principal["X"]`
      without a `has` guard as an unconditional error. The `&&`
      short-circuits to fail-closed: missing claim → no permission,
      which is the correct conservative answer.

      _Verify locally:_ run `npx vitest run --root apps/api authz`.
      The offline-backend tests exercise these policies via cedar-wasm.
      Adapt failing tests if necessary, but the policy semantics
      should be identical (same role → same actions allowed).

- [x] **3. `apps/api/src/lib/authz.ts`: rip out the entity-hierarchy
      machinery and rebuild the offline path on the new attribute.**

      Concretely:

      - Delete `buildAvpEntities` (introduced in `5d585a7`, reshaped in
        `e94c3dc`). AVP rejects every entity it would emit.
      - Delete the `entities: { entityList: buildAvpEntities(...) }` argument
        from `authorizeAvp` and the batch call in `listAllowedPermissions`.
        Both calls become identical to the pre-`5d585a7` shape *except*
        for the `groupConfiguration` removal in step 4 — i.e. plain
        `IsAuthorizedWithToken({ policyStoreId, identityToken, action, resource })`.
      - Rewrite `buildEntities` (offline path) to set the attribute
        instead of building Group parents:

        ```ts
        function buildEntities(principal: Principal): cedar.Entities {
          return [
            {
              uid: { __entity: { type: `${PEGASUS_NS}::User`, id: principal.sub } },
              attrs: {
                'cognito:groups': principal.roleNames,
              },
              parents: [],
            },
          ]
        }
        ```

        No Group entities, no parents — Cedar's `principal["cognito:groups"]`
        attribute access reads directly from `attrs`. The shape
        matches what AVP auto-projects from the token claim, so policy
        evaluation is identical across backends.
      - Drop the unused import of `EntitiesDefinition`.

      _Verify locally:_ `npx vitest run --root apps/api authz` still
      green. If the existing offline tests assume Group entities in
      `buildEntities`'s output, update them — the attribute shape is
      the new contract.

- [x] **4. `apps/api/src/lib/authz-provision.ts`: drop `groupConfiguration`.**

      Revert the `groupConfiguration: { groupEntityType: ... }` block
      added in `2e74355`. The `CreateIdentitySourceCommand` should be:

      ```ts
      new CreateIdentitySourceCommand({
        policyStoreId,
        principalEntityType: 'Pegasus::User',
        configuration: {
          cognitoUserPoolConfiguration: {
            userPoolArn: input.userPoolArn,
            clientIds: [input.tenantAppClientId],
          },
        },
      })
      ```

      Keep the `withConsistencyRetry` wrapper from `02a2961` —
      eventual-consistency on `CreateIdentitySource` is unrelated to
      the configuration shape.

      Drop the `import { PEGASUS_NS } from '../authz/actions'` if it
      becomes unused after the `groupEntityType` removal.

- [x] **5. `apps/api/src/cognito/pre-token.ts`: leave `groupOverrideDetails` in place.**

      No code change. Confirm the file still emits both `custom:roles`
      and `groupOverrideDetails.groupsToOverride`. Both are needed:

      - `custom:roles` populates `principal.roleNames` via tenant
        middleware for the offline backend's `attrs['cognito:groups']`
        injection.
      - `groupOverrideDetails` puts `cognito:groups` into the issued
        token so AVP can project it onto the principal attribute.

      The `pre-token.test.ts` assertions added in `2e74355` for both
      claim shapes still apply — they're correct.

- [x] **6. Migration script for existing AVP stores.**

      The dolios staging store (`KRzp8Jrxxkvy3YGnkeYQBP`) was
      provisioned with the old schema and old policies. The
      `entities`-argument experiments in `5d585a7`/`e94c3dc` did not
      modify any AVP state, but the schema PutSchema in `e94c3dc`
      *did* push `Group.memberOfTypes = ["Group"]` to that store.

      One-shot script `apps/api/src/scripts/migrate-policy-store.ts`
      (idempotent, safe to re-run):

      1. List policies via `ListPolicies`. Delete each via
         `DeletePolicy`. Use `withConsistencyRetry` from
         `lib/authz-provision.ts` for each call.
      2. `PutSchema` with the new on-disk schema (User has
         `cognito:groups` attribute).
      3. `CreatePolicy` for each of the 7 rewritten `.cedar` files.
      4. List identity sources via `ListIdentitySources`. For each,
         `UpdateIdentitySource` with the new configuration (no
         `groupConfiguration`).
      5. Print a summary: store ID, policy count, identity source
         count, schema attribute presence verification.

      Invoke: `npx tsx apps/api/src/scripts/migrate-policy-store.ts <policyStoreId>`.
      Run against `KRzp8Jrxxkvy3YGnkeYQBP` from a workstation with
      AWS creds for the staging account (the same SSO profile used
      in this debugging session).

      _Verify post-migration:_ direct AVP CLI smoke (single line):

      ```
      aws verifiedpermissions is-authorized-with-token --profile pegasus-staging --region us-east-1 --policy-store-id KRzp8Jrxxkvy3YGnkeYQBP --identity-token "<freshly-minted-id-token>" --action '{"actionType":"Pegasus::Action","actionId":"InviteUser"}' --resource '{"entityType":"Pegasus::User","entityId":"__tenant__:b40b082e-1932-4182-a081-47b7df363276"}'
      ```

      Expected: `decision: ALLOW`. To mint the token: `aws cognito-idp admin-initiate-auth --profile pegasus-staging --region us-east-1 --user-pool-id us-east-1_0LoW8JGgK --client-id 1rcruiremqqtovtmpp3nr7b7th --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME=<E2E_STAGING_ADMIN_USERNAME>,PASSWORD='<E2E_STAGING_ADMIN_PASSWORD>' --query 'AuthenticationResult.IdToken' --output text`.

- [x] **7. Update the regression tests in `packages/infra/lib/stacks/__tests__/api-stack.test.ts`.**

      The IAM permission pin currently asserts on the full set of
      AVP and Cognito introspection actions, including the three
      Cognito-introspection ones (`DescribeUserPool`,
      `ListUserPoolClients`, `DescribeUserPoolClient`) that AVP
      `CreateIdentitySource` needs *only* when `groupConfiguration`
      is set. Without `groupConfiguration`, those three may not be
      strictly required.

      Verify by `grep`-ing the AVP CLI output post-migration: if the
      `IdentitySource` config is just `{userPoolArn, clientIds}`
      with no group config, AVP will still need at minimum
      `DescribeUserPool` to validate the pool exists. Keep
      `DescribeUserPool`. Drop the other two from the IAM grant + the
      test pin if confirmed unused — overgranting is a security
      smell and the regression test is the place to keep this honest.

      Fall-back: leave all three pinned + granted. The cost is one
      stale permission, not broken auth.

- [x] **8. Cleanup: remove speculative resources from staging.**

      During debugging, two pieces of state were added to staging
      Cognito for hypotheses that didn't pan out:

      - 7 Cognito groups (`tenant_admin`, `tenant_user`, `dispatcher`,
        `sales`, `accountant`, `auditor`, `crew_lead`) created via
        `aws cognito-idp create-group`. The old hypothesis was that
        AVP needed actual Cognito group memberships. With the
        attribute-based approach, `cognito:groups` comes purely from
        the pre-token override; actual Cognito groups are unused and
        irrelevant.
      - `steve@dolas.dev` was added to the `tenant_admin` Cognito
        group via `AdminAddUserToGroup` for the same hypothesis.

      Decision options:

      - **Delete them** (cleanest — removes confusion). One CLI call
        to delete each group; `AdminRemoveUserFromGroup` first if a
        group has members.
      - **Keep them as documentation** (low effort — name them in CDK
        with clear comments saying they're inert). Easier to track in
        IaC, but adds noise.

      Recommended: **delete**. The cleanup is one shell loop and
      removes future confusion ("why are these groups here? do they
      do anything?"). Future tenants don't need them.

      Single line to delete (after re-verifying pool ID):

      ```
      for g in tenant_admin tenant_user dispatcher sales accountant auditor crew_lead; do aws cognito-idp delete-group --profile pegasus-staging --region us-east-1 --user-pool-id us-east-1_0LoW8JGgK --group-name "$g"; done
      ```

      `delete-group` errors on a non-empty group, so the
      `AdminRemoveUserFromGroup` for steve has to run first:

      ```
      aws cognito-idp admin-remove-user-from-group --profile pegasus-staging --region us-east-1 --user-pool-id us-east-1_0LoW8JGgK --username steve@dolas.dev --group-name tenant_admin
      ```

- [x] **9. Update `dolas/agents/project/GOTCHAS.md`.**

      The existing `AUTHZ_ERROR` diagnostic table covers bundling, IAM,
      and consistency. Add a fourth entry for the AVP-entity-rejection
      class, with the symptom (500s with
      `ValidationException: <Type>EntityType X cannot be defined in Entities`)
      and the fix reference (this plan, archived once complete).

      Also note: AVP's `IsAuthorizedWithToken` does **not** accept
      `entities` containing the principal type or any type registered
      in `groupConfiguration`. This is a design constraint, not a bug.
      Future AVP work should use attribute-based policies + token
      claim projection, not entity hierarchy passing.

- [x] **10. Push, watch the staging gate, confirm prod deploy.**

      Sequence:

      1. `git push origin main` — commits should include the schema +
         policy + code changes from steps 1–5 in **one** commit so the
         migration's pre-condition (new code expecting new schema) and
         the on-disk artifacts move together. The migration script
         from step 6 ships in the same commit.
      2. CI auto-triggers deploy.yml because `apps/api/**` and
         possibly `packages/infra/**` (if step 7's IAM tightening
         lands) match the path filter. Path filter in
         `.github/workflows/deploy.yml` already covers this.
      3. **Before the gate runs**, execute the migration script
         locally against the dolios store. The deploy timing is:
         staging-deploy → e2e-gate → prod-deploy. The migration must
         complete before the gate runs, so:
            - either run the migration manually as soon as
              staging-deploy completes (visible in `gh run watch`),
            - or — preferably — run the migration *first*, before the
              push. The new code path doesn't break the old store
              shape (it just doesn't use the entities hierarchy any
              more), so migrating first is safe even if the deploy
              hasn't landed.

         Order chosen: **migrate first, push second.** Keeps the
         migration script's invocation deterministic and removes a
         race window.
      4. `gh run watch` on the deploy run. Expected sequence:
         Detect changes → Deploy to staging → E2E gate (passes) →
         Deploy to prod. The auth-smoke spec returns the full
         permission set on `/me/permissions` and the invite test
         returns 200/201/409.
      5. If gate fails: pull `playwright-report-staging` artifact,
         decode the response body, and start by checking
         CloudWatch for the API Lambda for any new
         `ValidationException` or unexpected error. The two most
         likely failure modes at this point:
            - Pre-token Lambda not redeployed (CognitoStack didn't
              update, despite `apps/api/**` triggering api-true): the
              token still won't carry `cognito:groups`. Force a
              CognitoStack redeploy via `workflow_dispatch` with
              `target=api`.
            - Schema migration didn't run before the request: AVP
              rejects PutSchema attempts with stale schema + new
              policies, or vice versa. Re-run the migration; the
              script is idempotent.

- [x] **11. Archive the plan.**

      Move `plans/in-progress/avp-attribute-based-policies.md` to
      `plans/completed/2026-05-XX-avp-attribute-based-policies.md`
      with the run IDs of the successful gate + prod deploys
      referenced in a closing status banner. Tick all checkboxes
      above. Add a note pointing back at this plan from
      `plans/in-progress/authz-cedar-avp-followups.md` item #5
      (existing-tenant backfill) — the backfill is now unblocked
      because provisioning works correctly for new tenants.

## Out of scope

- **Live AVP integration test (`plans/todo/avp-live-provisioning-integration-test.md`).**
  Still deferred. Once this fix lands and the gate is reliably
  green, that plan's trigger condition ("the staging E2E gate's
  authz-smoke proves insufficient") becomes more concrete — the
  smoke does cover the AVP path now, so the live integration test
  can stay deferred unless a class of regression slips past it.

- **Removing the `Group` entity type from the schema.** Leaving it
  in place keeps the PutSchema migration small. A follow-up plan can
  delete it once we're confident no policies reference it. Track as
  a one-line cleanup in `authz-cedar-avp-followups.md`.

- **Rewriting the offline backend to skip Cedar entirely** (e.g.
  decision tables in TypeScript). The two-backend setup is
  intentional: cedar-wasm in offline mode keeps SKIP_AUTH a faithful
  production simulation. Don't touch.

- **Cognito group lifecycle management.** Once the speculative
  groups are deleted in step 8, we don't add or remove Cognito
  groups going forward — `cognito:groups` comes purely from the
  pre-token override of `groupOverrideDetails`. If a future feature
  ever needs Cognito-native groups (for AWS console access, OIDC
  group claims), reopen the question.

- **Reverting the `Group.memberOfTypes = ["Group"]` change in the
  e94c3dc commit.** Roll forward, not back: step 1 of this plan
  rewrites the schema entirely with `User.memberOfTypes = []` (or
  whatever's correct for the attribute-based design). The earlier
  edit is superseded.

## References

- AVP Cognito identity source — token claim mapping:
  `https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/identity-providers-cognito.html`
- AVP IsAuthorizedWithToken request shape (especially the entities
  argument restrictions):
  `https://docs.aws.amazon.com/verifiedpermissions/latest/apireference/API_IsAuthorizedWithToken.html`
- Cedar attribute access syntax:
  `https://docs.cedarpolicy.com/policies/syntax-policy.html#attribute-access`
- Three failed attempts (commits to revert via roll-forward):
  - `5d585a7` fix(api): pass entities to AVP so policies match unprefixed Group names
  - `e94c3dc` fix(api): re-parent AVP-synthesised prefixed Groups under bare-named Groups
- Earlier follow-ups still in good standing (do not touch):
  - `5588b18` bundle cedar schema + policies into API Lambda asset
  - `46fb673` grant cognito-idp:DescribeUserPool to API Lambda for AVP
  - `cf36796` grant ListUserPoolClients + DescribeUserPoolClient for AVP
  - `02a2961` retry AVP writes on ResourceNotFoundException
  - `28292d9` infra regression tests for IAM + bundling
  - `2e74355` pre-token cognito:groups override (the groupConfiguration
    half of this commit gets reverted in step 4; the
    groupOverrideDetails half stays and is still required)
- Adjacent plans:
  - `plans/in-progress/authz-cedar-avp-followups.md` (item #5
    backfill — gated on this fix)
  - `plans/completed/2026-05-06T1328-authz-staging-e2e-gate.md`
    (the gate this fix unblocks)
  - `plans/completed/2026-05-06T2118-avp-provisioning-regression-tests.md`
    (parent plan for the regression-test infrastructure)
  - `plans/todo/avp-live-provisioning-integration-test.md`
    (deferred; still deferred after this lands)
- Staging diagnostic state at pause time:
  - dolios staging store: `policyStoreId=KRzp8Jrxxkvy3YGnkeYQBP`,
    `tenantId=b40b082e-1932-4182-a081-47b7df363276`, schema currently
    has `Group.memberOfTypes=["Group"]` from `e94c3dc` PutSchema.
  - User pool: `us-east-1_0LoW8JGgK`. Tenant client:
    `1rcruiremqqtovtmpp3nr7b7th`. Test admin: `steve@dolas.dev`,
    sub `a44804a8-b081-7027-a4b7-1fd913bd1c9c`.
  - Speculative Cognito groups present (step 8 deletes them):
    `tenant_admin`, `tenant_user`, `dispatcher`, `sales`,
    `accountant`, `auditor`, `crew_lead`. Also `PLATFORM_ADMIN`
    (pre-existing, unrelated, keep).
  - Steve is a member of the `tenant_admin` Cognito group
    (speculative, removed in step 8).
- Verified-good direct AVP calls during debugging (for sanity at
  resume time):
  - `aws verifiedpermissions is-authorized` with manually-built
    User+Group hierarchy → `ALLOW`. Proves policies + schema + store
    are syntactically correct.
  - `aws verifiedpermissions is-authorized` with prefixed-Group
    reparented under bare Group → `ALLOW`. Proves transitivity works
    in principle but not via `IsAuthorizedWithToken`.
  - `aws verifiedpermissions is-authorized-with-token` always rejects
    User and Group entities in the `entities` argument. This is the
    binding constraint that forces the attribute-based approach.
