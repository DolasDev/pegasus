# Gate `prod` deploy on staging E2E tests

## Background

This plan is the follow-up to
`add-staging-prod-deploy-environments.md` and depends on it landing
first. After that plan, every push to `main` deploys directly to
staging _and_ prod. This plan inserts an end-to-end test gate
between the two: prod only deploys if the E2E suite passes against
the freshly-deployed staging environment.

The repo already has a Playwright suite at `apps/e2e/` (the
`@pegasus/e2e` workspace, run via `npm run e2e`). Important caveat:
the suite is **not** staging-ready today. `playwright.config.ts`
uses Playwright's `webServer` to spin up a _local_ API process and
points the tests at it (`reuseExistingServer: !process.env['CI']`).
For this gate to be meaningful, the suite needs an alternate run
mode that skips the local server and points at deployed staging URLs
(API URL + Cognito pool/client IDs from the staging deploy outputs).

The suite also isn't very extensive yet — the gate is only as strong
as what's in it. Expanding coverage is **out of scope** here; treat
this plan as wiring up the gate, with a note that future work makes
the gate meaningful.

## Goal

After `deploy-staging` runs, run the E2E suite against the
just-deployed staging URLs. If it passes, `deploy-prod` proceeds. If
it fails, `deploy-prod` is skipped and the run is marked failed.

## Plan

- [ ] **1. Add a "remote" mode to the E2E suite.** In
      `apps/e2e/playwright.config.ts`, gate the `webServer` and
      `globalSetup` blocks on an env var
      (e.g. `E2E_TARGET=local|remote`, default `local`). When
      `remote`, read `E2E_API_BASE_URL`,
      `E2E_COGNITO_USER_POOL_ID`, `E2E_COGNITO_CLIENT_ID` (etc.)
      from the environment and skip the local server launch. Verify
      `npm run e2e` still works locally by default.

- [ ] **2. Inventory tests for remote-runnability.** Some tests may
      depend on direct DB access (Prisma client, fixture seeding)
      that won't be reachable from a CI runner pointed at staging.
      Tag those `@local-only` (Playwright tag) and skip them in
      remote mode for now; the rest become the gate. Capture the
      diff in a short `apps/e2e/REMOTE.md` so future authors know
      which tests count as gate-eligible.

- [ ] **3. Add an `e2e-staging` job to `.github/workflows/deploy.yml`.**
      Insert it between `deploy-staging` and `deploy-prod`: - `needs: deploy-staging` - `environment: staging` (so it can read the staging vars and
      any secrets that the tests need; it does not need AWS creds
      if tests only hit public URLs) - Download the `cdk-outputs` artifact uploaded by
      `deploy-staging`, extract the API URL + Cognito IDs with
      `jq`, export them as `E2E_*` env vars - Run `npm run e2e --workspace=@pegasus/e2e` with
      `E2E_TARGET=remote` - Upload the Playwright report (`apps/e2e/playwright-report/`)
      as a workflow artifact on both success and failure

- [ ] **4. Make `deploy-prod` need `e2e-staging`.** Change `needs:
    deploy-staging` → `needs: e2e-staging`. Combined with the
      existing `if: success()` semantics (a failed needs job
      short-circuits dependents), this is the actual gate.

- [ ] **5. End-to-end validation.** Push a no-op change to main and
      walk through a full run: `deploy-staging` → `e2e-staging` (all
      green) → `deploy-prod` (auto-promotes, subject to the prod
      environment's required-reviewer rule). Then deliberately break
      one test and confirm `deploy-prod` is skipped, the run is
      marked failed, and the Playwright report shows the failure.

- [ ] **6. Document the contract.** Short note in
      `apps/e2e/README.md` (or the new `REMOTE.md`): "tests run in
      remote mode against staging are the prod-promotion gate; if
      you add a test, decide whether it's `@local-only` or
      gate-eligible." This keeps the gate from quietly weakening as
      the suite grows.

## Out of scope

- Expanding the E2E suite. The gate's strength is exactly the suite's
  current coverage; broadening it is its own follow-up.
- Test data management / cleanup in staging (idempotency, teardown).
  Track separately if tests start mutating durable state.
- Performance / load testing.
- Replacing or augmenting Playwright with a different framework.

## References

- Predecessor plan:
  `plans/todo/add-staging-prod-deploy-environments.md` (must land first)
- E2E suite: `apps/e2e/`
- Playwright config: `apps/e2e/playwright.config.ts`
- Existing deploy workflow: `.github/workflows/deploy.yml`
- GitHub Actions `needs` short-circuit semantics:
  <https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#defining-prerequisite-jobs>
