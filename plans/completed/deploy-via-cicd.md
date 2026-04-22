# Move deploy.sh to CI/CD Pipeline

## Goal

Replace manual `packages/infra/deploy.sh` execution with an automated GitHub
Actions deploy workflow. After the change, merges to `main` should deploy the
stack automatically, and on-demand deploys should be dispatchable from the
Actions UI with the same flag semantics (`--api-only`, `--admin-only`).

## Current behavior (what deploy.sh does)

1. Builds `@pegasus/tenant-web` and `@pegasus/admin-web` (unless `--api-only`).
2. Runs `cdk deploy` with stack selection driven by `--api-only` / `--admin-only`
   / default (`--all`), writing outputs to `/tmp/pegasus-cdk-outputs.json`.
3. Parses outputs with `jq` and prints the client/admin/API URLs.
4. Writes `apps/mobile/.env.deploy` from Cognito + API outputs.

AWS auth today: developer-local `AWS_PROFILE=admin-dev`.

## Target behavior

- A new workflow `.github/workflows/deploy.yml` performs steps 1–4 in CI.
- Triggers:
  - `push` to `main` (after the existing CI jobs pass) — default full deploy.
  - `workflow_dispatch` with an input `target` ∈ `{all, api, admin}` mirroring
    the script flags.
- AWS auth via OIDC (`aws-actions/configure-aws-credentials@v4` assuming an IAM
  role) — no long-lived keys in secrets.
- Mobile `.env.deploy` is uploaded as a workflow artifact (not committed).
- CDK outputs JSON also uploaded as an artifact for traceability.
- The old `deploy.sh` is retained but slimmed down to delegate locally to the
  same CDK command, OR deleted — decide in step 6 below.

## Plan

- [x] **1. Pre-flight: AWS OIDC trust set up.**
      Setup doc `plans/completed/aws-oidc-setup.md` captures the manual
      steps. Deployed state: - OIDC provider `token.actions.githubusercontent.com` exists in the
      `admin-dev` account (ID `864899848943`). - Deploy role ARN:
      `arn:aws:iam::864899848943:role/pegasus-github-deploy-dev`,
      `AdministratorAccess` attached (to tighten later). - Trust policy allows `repo:DolasDev/pegasus:ref:refs/heads/main`
      and `repo:DolasDev/pegasus:environment:dev`. - `dev` GitHub environment holds `AWS_DEPLOY_ROLE_ARN` and
      `AWS_REGION=us-east-1` as variables.
      Two landmines surfaced during smoke-test, both corrected in the
      setup doc: 1. Trust-policy template had a literal `AWS_ACCOUNT_ID` placeholder. 2. Repo owner is `DolasDev`, not `dolasllc`; `StringLike` is
      case-sensitive, so the first trust policy rejected all claims.

- [x] **2. Extract a reusable deploy npm script.**
      Added `deploy:ci` in `packages/infra/package.json`; `deploy.sh` now
      exports `TARGET` and delegates to `npm run deploy:ci` so local and CI
      paths share the same CDK invocation.

- [x] **3. `deploy` GitHub environment.** Done as part of the OIDC
      setup (step 4 of the setup doc). `dev` environment exists with
      required-reviewer rules and the two AWS variables.

- [x] **4. Create `.github/workflows/deploy.yml`.**
      Implemented with per-component change detection via `dorny/paths-filter`:
      pushes to main deploy only the stacks whose source changed (api,
      tenant-web, admin-web), and infra/workflow changes force `--all`.
      `workflow_dispatch` accepts `target ∈ {all, api, tenant-web, admin-web}`
      for manual component deploys. Uses OIDC via `aws-actions/configure-aws-credentials@v4`,
      uploads `cdk-outputs.json` and `mobile.env.deploy` as artifacts, and
      writes a deploy plan + URL summary to `$GITHUB_STEP_SUMMARY`.
      Structure: - `on: push: branches: [main]` and `workflow_dispatch` with `target` input. - `permissions: id-token: write, contents: read`. - Job `deploy` runs on `ubuntu-latest`, uses environment `dev`. - Steps: 1. `actions/checkout@v4` 2. `actions/setup-node@v4` with `node-version: 20` and `cache: npm` 3. `npm ci` 4. Fix binary permissions (same one-liner as ci.yml) 5. `prisma generate` (needed for typecheck-free build of the API bundle
      that CDK's NodejsFunction emits) 6. Conditional build: - `target != 'api'` → `npm run build --workspace=@pegasus/tenant-web` + `@pegasus/admin-web` 7. `aws-actions/configure-aws-credentials@v4` with
      `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}` and
      `aws-region: us-east-1` 8. Run `npm run deploy:ci` with `TARGET` env var mapped from the
      `target` input (`all`→`--all`, `api`→the four API stacks,
      `admin`→the four admin stacks — mirror deploy.sh lines 80–89). 9. Parse `outputs.json` with `jq`, write the mobile `.env.deploy`, and
      append client/admin/API URLs to `$GITHUB_STEP_SUMMARY`. 10. `actions/upload-artifact@v4` for both `outputs.json` and
      `apps/mobile/.env.deploy` (retention 14 days). - Depends on (via `needs:`) successful `typecheck`, `lint`, `test`, `e2e`
      from `ci.yml` — either by merging deploy into ci.yml as a gated job, or
      by using `workflow_run` with `conclusion == success`. Prefer the merged
      approach for simplicity; verify it still keeps PR runs from deploying.

- [x] **5. Reproduce the stack-selection logic in a small shell step.**
      Done in the `Resolve CDK stack target` step of `deploy.yml`. Builds a
      stack array from component booleans; emits `--all` only when every
      component is selected.

- [x] **6. Decide the fate of `deploy.sh`.**
      Kept as a local/emergency wrapper (option a). Header comment updated
      to note CI is canonical; body now exports `TARGET` and calls
      `npm run deploy:ci`.

- [x] **7. Dry-run verification — mechanism proven; full-stack deploy
      deferred to WireGuard remediation.**
      Run 24789683294 (push to main) confirmed all pipeline layers:
      `checkout → npm ci → prisma generate → tenant/admin build →
    OIDC assume-role → CDK synth+bundle → CloudFormation change-set
    → resource creation`. Artifacts (`cdk-outputs`, `mobile-env`)
      upload cleanly.
      CloudFormation then failed inside `pegasus-dev-wireguard` with two
      independent bugs: em-dash in an IAM-role description (fixed,
      `6c308f2`) and `AWS::AutoScaling::LaunchConfiguration` being
      disabled on new AWS accounts. `target=api` can't bypass WireGuard
      because `bin/app.ts` wires `wireguard.{hubPublicKey,hubEndpoint,
    tunnelProxyFunction}` into `ApiStack` — CDK drags the stack in.
      Follow-up in `plans/in-progress/fix-wireguard-stack.md`. Once that
      plan lands, re-run `Deploy` with `target=all` from the Actions UI
      to tick the last bullet of `aws-oidc-setup.md` §5.

- [x] **8. Docs + memory updates.**
      `CLAUDE.md` Key Commands section now notes CI is canonical and points
      at the OIDC setup doc. (A feedback memory for the OIDC pattern can be
      added after smoke-test succeeds.) - Update `packages/infra/README.md` (if present; otherwise add a section
      in `CLAUDE.md` Key Commands) to note that `npm run deploy` is now for
      local-only use and CI is canonical. - Add a feedback memory if the user validates the OIDC role approach, so
      future deploys default to this pattern.

## Open questions

- **Single environment or multi?** Plan assumes a single `dev` environment
  matching today's `AWS_PROFILE=admin-dev`. If prod exists or is planned, the
  workflow should be parameterised on environment and the OIDC role per env.
- **Auto-deploy on every main push?** Current CI on main runs tests only. If
  the team prefers manual dispatch (no auto-deploy), drop the `push` trigger
  and keep only `workflow_dispatch`.
- **Mobile `.env.deploy` consumption.** Today the script writes it into the
  repo workspace. In CI it becomes an artifact — who downloads it, and is
  there a downstream mobile build that needs it automatically? If yes, add an
  EAS/Expo build job that depends on `deploy` and consumes the artifact.

## Out of scope

- Migrating other scripts (seed, create-admin-user).
- Prod environment setup.
- Rollback tooling beyond CDK's built-in rollback.
