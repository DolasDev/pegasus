# Gate `prod` deploy on staging E2E tests

## Background

The predecessor plan `add-staging-prod-deploy-environments.md` has shipped
(see `plans/completed/`). Today, every push to `main` deploys staging then
prod via `.github/workflows/deploy.yml` — `changes` → `deploy-staging` →
`deploy-prod`, with the prod step gated only by the `prod` GitHub
environment's required-reviewer rule. The deploy workflow already includes
a comment (`deploy.yml:140-148`) anticipating this E2E gate.

This plan inserts an end-to-end test job between staging and prod: prod
only runs if the E2E suite passes against the just-deployed staging
environment.

The Playwright suite (`apps/e2e/`, workspace `@pegasus/e2e`) is **not**
staging-ready today:

- `playwright.config.ts` uses `webServer` to spin up a local API process and
  points tests at `http://localhost:3001`.
- `global-setup.ts` runs `prisma migrate deploy` and seeds a test tenant
  via direct DB access.
- Most specs hit authenticated routes assuming `SKIP_AUTH=true`. Staging
  runs real Cognito.

The gate is only as strong as what runs in remote mode. With the current
suite, that's two specs:

- `tests/api/health.spec.ts` — unauthenticated, exercises API + DB depth check.
- `tests/browser/landing.spec.ts` — already remote-ready (reads `WEB_URL` from env).

Everything else needs auth tokens or DB seeding and is **out of scope** for
this plan. Expanding the gate is its own follow-up.

## Goal

After `deploy-staging` succeeds, run the E2E suite (remote mode) against
the just-deployed staging URLs. If it passes, `deploy-prod` proceeds. If
it fails, `deploy-prod` is skipped and the run is marked failed.

## Plan

- [ ] **1. Add a remote mode to the E2E suite.**

      In `apps/e2e/playwright.config.ts`, gate `webServer` and `globalSetup`
      on `E2E_TARGET` (default `local`). When `E2E_TARGET=remote`:

      - Read `E2E_API_BASE_URL` (required; throw if missing) and use it as
        `baseURL`. Also set `process.env.API_BASE_URL = E2E_API_BASE_URL`
        so the existing `apiFetch` fixture (`apps/e2e/fixtures/index.ts:3`,
        already env-aware) picks it up.
      - Skip `webServer` and `globalSetup` (Playwright accepts conditional
        spread: `...(isRemote ? {} : { webServer: { ... }, globalSetup: '...' })`).
      - Set `grepInvert: /@local-only/` so tagged specs are excluded.

      Verify `npm run e2e --workspace=@pegasus/e2e` still works locally by
      default.

- [ ] **2. Tag local-only specs.**

      Add `@local-only` to the `test.describe` blocks (or use `test.skip`
      with a `process.env['E2E_TARGET'] === 'remote'` guard) for specs that
      depend on Prisma fixtures or authenticated routes:

      - `apps/e2e/tests/api/customers.spec.ts`
      - `apps/e2e/tests/api/moves.spec.ts`
      - `apps/e2e/tests/api/quotes.spec.ts`
      - `apps/e2e/tests/api/documents-variants.spec.ts`
      - `apps/e2e/tests/api/longhaul.spec.ts`
      - `apps/e2e/tests/api/vpn.spec.ts`

      Gate-eligible (no change needed):

      - `apps/e2e/tests/api/health.spec.ts`
      - `apps/e2e/tests/browser/landing.spec.ts`

      Note: `health.spec.ts` currently uses an `E2E_SKIP` guard set by the
      local `global-setup.ts` when Postgres is missing. In remote mode
      `global-setup.ts` doesn't run, so `E2E_SKIP` stays unset and the
      tests run as intended.

- [ ] **3. Document the remote contract.**

      Create `apps/e2e/REMOTE.md` covering:

      - What remote mode is (`E2E_TARGET=remote`).
      - Required env vars: `E2E_API_BASE_URL`, `WEB_URL`,
        `E2E_COGNITO_USER_POOL_ID`, `E2E_COGNITO_CLIENT_ID` (last two
        reserved for future authenticated tests; not used today).
      - The `@local-only` tagging contract: when adding a test, decide
        whether it needs DB seeding/auth (tag it) or can hit deployed
        staging cleanly (don't).
      - The current gate is intentionally narrow (health + landing).
        Expanding it is a separate plan.

- [ ] **4. Add `e2e-staging` job to `.github/workflows/deploy.yml`.**

      Insert between `deploy-staging` and `deploy-prod`:

      ```yaml
      e2e-staging:
        name: E2E gate against staging
        needs: [changes, deploy-staging]
        if: needs.changes.outputs.any == 'true' && github.ref == 'refs/heads/main'
        runs-on: ubuntu-latest
        environment: staging
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: '20', cache: 'npm' }
          - run: npm ci
          - run: find node_modules/.bin -type f | xargs chmod +x 2>/dev/null || true
          - name: Install Playwright browsers
            working-directory: apps/e2e
            run: npm run install:browsers
          - name: Download CDK outputs
            uses: actions/download-artifact@v4
            with:
              name: cdk-outputs-staging
              path: /tmp
          - name: Extract staging URLs
            id: outs
            run: |
              set -euo pipefail
              F=/tmp/pegasus-cdk-outputs.json
              echo "API_URL=$(jq -r '.["pegasus-staging-api"].ApiUrl' "$F")" >> "$GITHUB_OUTPUT"
              echo "WEB_URL=$(jq -r '.["pegasus-staging-frontend"].DistributionUrl' "$F")" >> "$GITHUB_OUTPUT"
              echo "USER_POOL_ID=$(jq -r '.["pegasus-staging-cognito"].UserPoolId' "$F")" >> "$GITHUB_OUTPUT"
              echo "CLIENT_ID=$(jq -r '.["pegasus-staging-cognito"].MobileClientId // empty' "$F")" >> "$GITHUB_OUTPUT"
          - name: Run E2E (remote)
            working-directory: apps/e2e
            env:
              E2E_TARGET: remote
              E2E_API_BASE_URL: ${{ steps.outs.outputs.API_URL }}
              WEB_URL: ${{ steps.outs.outputs.WEB_URL }}
              E2E_COGNITO_USER_POOL_ID: ${{ steps.outs.outputs.USER_POOL_ID }}
              E2E_COGNITO_CLIENT_ID: ${{ steps.outs.outputs.CLIENT_ID }}
            run: npx playwright test
          - name: Upload Playwright report
            if: always()
            uses: actions/upload-artifact@v4
            with:
              name: playwright-report-staging
              path: apps/e2e/playwright-report
              if-no-files-found: ignore
              retention-days: 14
      ```

      Notes vs. the original todo draft:

      - Artifact is `cdk-outputs-staging` (per-env name from `_deploy.yml:258`),
        not the generic `cdk-outputs`.
      - JSON keys are `pegasus-staging-{api,frontend,cognito}` (see
        `_deploy.yml:226-232`).
      - The `if:` guard mirrors `deploy-staging`/`deploy-prod` so the gate
        skips when `changes.outputs.any == 'false'`.

- [ ] **5. Re-target `deploy-prod`.**

      Change `deploy-prod`'s `needs: [changes, deploy-staging]` to
      `needs: [changes, e2e-staging]`. Update the comment block above
      `deploy-prod` (currently `deploy.yml:140-148`) to note the gate is
      now in place. GitHub Actions' default short-circuit semantics
      (a failed `needs` job skips dependents) provide the actual gate.

- [ ] **6. End-to-end validation.**

      a. **Local smoke against staging** before committing the workflow
         changes. From `apps/e2e/`:
         ```sh
         E2E_TARGET=remote \
         E2E_API_BASE_URL=<staging-api-url> \
         WEB_URL=<staging-web-url> \
         npx playwright test
         ```
         Confirm only `health.spec.ts` and `landing.spec.ts` run, both pass.

      b. **Green-path workflow run.** Push a no-op change touching an
         `apps/api/**` path (e.g. a comment in `apps/api/src/server.ts`)
         so the gate triggers. Walk through: `deploy-staging` →
         `e2e-staging` (green) → `deploy-prod` paused for required reviewer.

      c. **Red-path verification.** On a throwaway branch (or via
         `workflow_dispatch` then revert), break a gate-eligible assertion
         in `health.spec.ts`. Confirm `deploy-prod` is skipped, run is
         marked failed, and `playwright-report-staging` artifact contains
         the failure. Revert.

## Out of scope

- Expanding the E2E suite (auth/seed-aware tests against staging). Today's
  gate is health + landing; broadening it is its own follow-up.
- Test data management / cleanup in staging (idempotency, teardown). Track
  separately if tests start mutating durable state.
- Performance / load testing.
- Replacing or augmenting Playwright with a different framework.

## References

- Predecessor (landed): `plans/completed/add-staging-prod-deploy-environments.md`
- E2E suite: `apps/e2e/`
- Playwright config: `apps/e2e/playwright.config.ts`
- Local global setup: `apps/e2e/global-setup.ts`
- Existing fixture (already env-aware): `apps/e2e/fixtures/index.ts`
- Deploy orchestrator: `.github/workflows/deploy.yml`
- Reusable deploy: `.github/workflows/_deploy.yml` (see `Summarise outputs`
  step at L216-252 for the canonical `jq` extraction pattern; artifact
  upload at L254-261)
- GitHub Actions `needs` short-circuit semantics:
  <https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#defining-prerequisite-jobs>
