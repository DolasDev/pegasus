# Use Neon branches for E2E test isolation in the prod-deploy gate

## Background

The sibling plan `gate-prod-deploy-on-staging-e2e.md` introduces an
end-to-end test gate between `deploy-staging` and `deploy-prod`. As
written, that gate runs the Playwright suite against the deployed
staging API — which means every E2E run mutates the same shared
staging Postgres database. Two practical issues fall out of that:

1. **Test pollution.** Records created by one run leak into the next.
   Either the suite has to clean up exhaustively (brittle), or staging
   accumulates junk data over time.
2. **No concurrency.** If two CI runs land at once (e.g. revert push
   on top of a merge), they mutate the same DB simultaneously. Tests
   that depend on row counts, ordering, or specific fixture state
   become non-deterministic.

Neon branches solve both — branches are copy-on-write clones, instant
to create regardless of DB size, with `scale-to-zero` compute that
costs nothing when idle. The `reset_branch` API refreshes a long-lived
branch back to its parent's state in seconds, which is the pattern
Neon's docs recommend for staging/CI environments.

This plan does **not** propose branching staging off prod. That
question (covered in conversation around `add-staging-prod-deploy-environments.md`)
landed on "separate Neon projects per AWS account" because Pegasus
holds customer PII and the shared Neon project would cross the AWS
account isolation boundary. This plan is purely about _test_ isolation
within the staging Neon project.

## Goal

Each E2E run starts from a known, clean staging database state, with
no risk of inter-run interference. Implementation should add minimal
overhead (~seconds, not minutes) to the E2E job.

## Two viable patterns

The plan body assumes **Pattern A** as the default. Pattern B is
captured as a future evolution.

### Pattern A — reset the shared staging branch before each E2E run

Project layout in the staging Neon project:

```
baseline   ← root branch; schema + minimal seed fixtures, never written to by app
  └─ staging  ← child of baseline; the branch the staging API actually connects to
```

Each E2E run:

1. Calls `POST /projects/{id}/branches/{staging_id}/reset` to refresh
   `staging` to `baseline`'s current state.
2. Runs the Playwright suite against staging URLs (unchanged).
3. Done. No teardown needed; next run resets again.

Properties:

- One Neon connection string in Secrets Manager, no per-run plumbing.
- Reset is idempotent and ~seconds.
- Concurrency: still only one staging branch, so concurrent runs would
  fight. CI should serialize gate runs (the existing
  `concurrency: deploy-${{ github.ref }}` group already does this for
  push-to-main).

### Pattern B — per-run ephemeral branches (future)

Each run creates `e2e-{run-id}` branched off `baseline`, deploys a
disposable API stack pointing at it, runs the suite, deletes the
branch + stack. Maximal isolation, supports parallelism, but adds
3–5 min for the deploy step and significant CI complexity. Worth
considering only if (a) parallel E2E runs become a real need or
(b) the suite outgrows what fits in a single staging environment.

## Plan (Pattern A)

- [ ] **1. Restructure the staging Neon project.** When provisioning
      the staging Neon database (per the still-outstanding step 5 of
      `add-staging-prod-deploy-environments.md`), set up two branches
      from the start: - `baseline` — schema + minimal seed (the data tests can rely
      on existing); treat as read-only (no API connection). - `staging` — child of `baseline`; this is what
      `pegasus/staging/database-url` in Secrets Manager points at.
      Do this _before_ the first staging deploy so we don't have to
      restructure later.

- [ ] **2. Add a Neon API key to the `staging` GitHub environment.**
      Create a Neon API key scoped to the staging Neon project and
      store as `NEON_API_KEY` (secret, not variable). Also store the
      project + branch IDs as variables (`NEON_PROJECT_ID`,
      `NEON_STAGING_BRANCH_ID`) so the workflow can call `reset`
      without first looking them up.

- [ ] **3. Insert a `reset-staging-db` step into the E2E job.** In
      `_e2e.yml` (or wherever the gate workflow lives — sibling plan
      decides the file name), before the Playwright run:
      `yaml
    - name: Reset staging Neon branch
      env:
        NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}
        NEON_BRANCH_ID: ${{ vars.NEON_STAGING_BRANCH_ID }}
      run: |
        curl -fsSL --request POST \
          "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$NEON_BRANCH_ID/reset" \
          --header "Authorization: Bearer $NEON_API_KEY" \
          --header 'Content-Type: application/json' \
          --data '{}'
    `
      Reset is idempotent and takes a few seconds; the staging API's
      pooled connections re-establish automatically.

- [ ] **4. Decide what lives on `baseline`.** Three options: - Empty schema only (Prisma migrations applied, no rows).
      Simplest; tests must seed everything they need. - Schema + a small fixture set that mirrors the
      `apps/api`-side test seed scripts. - Schema + an opt-in subset of staging data, anonymized.
      Most "realistic" but requires anonymization tooling — defer
      unless a concrete test needs it.
      Default to option 2 — same fixtures the existing local E2E
      setup expects, applied via `prisma migrate deploy` +
      `prisma db seed`. Captures the test-local mental model and
      keeps the gate's pass/fail signal interpretable.

- [ ] **5. Document the contract.** Short note in `apps/e2e/README.md`
      (paired with the sibling gate plan's REMOTE.md): "the gate's
      DB state resets to `baseline` before every run; tests must
      assume an empty fixture-seeded DB and clean up after themselves
      only insofar as they want to interact within a single run."

- [ ] **6. Validate.** Trigger an E2E run; confirm the reset step
      succeeds, the suite passes, and a record created during one
      run is not visible to the next. Deliberately leave bad data in
      staging via a manual SQL insert and confirm the next reset
      wipes it.

## Out of scope

- Prod data exposure to staging (anonymization, snapshot pipelines).
  Tracked separately if/when there's a concrete need.
- Per-PR preview environments off staging. Different shape — adds
  preview deploys, not just DB branches.
- Per-developer dev branches off a shared dev Neon project. Same
  pattern, different lifecycle.
- Pattern B (ephemeral branch per run). File a follow-up if Pattern A
  hits a wall.

## Dependencies and sequencing

- Depends on `add-staging-prod-deploy-environments.md` step 5
  (staging Neon DB provisioning). Ideally do step 1 of _this_ plan
  during that provisioning to avoid restructuring later.
- Depends on `gate-prod-deploy-on-staging-e2e.md` landing first;
  this plan inserts a step into the workflow that plan creates.

## References

- Sibling plan that this complements:
  `plans/todo/gate-prod-deploy-on-staging-e2e.md`
- Predecessor that triggered this discussion:
  `plans/in-progress/add-staging-prod-deploy-environments.md`
- Neon branch reset:
  <https://neon.com/docs/guides/branching-circleci>
- Neon branch lifecycle and costs:
  <https://neon.com/docs/introduction/cost-optimization>
- Neon API — branches:
  <https://api-docs.neon.tech/reference/resetbranch>
