# Add `staging` and `prod` deploy environments to the Pegasus GH Actions pipeline

> **Branch:** `main` · code-only steps (2, 4) implemented; remaining steps
> (1, 3, 5, 6, 7) require AWS admin creds and GitHub repo settings access
> and are owner-driven.

## Background

The `dolas-infra` repo just provisioned per-account GitHub Actions OIDC
deploy roles in the new Pegasus AWS accounts (PR
[DolasDev/dolas-infra#3](https://github.com/DolasDev/dolas-infra/pull/3),
merged 2026-04-25). Each role has the same CDK-deploy permission surface
as the legacy `pegasus-deploy-{env}` IAM user, and trust scoped to a
specific GitHub environment so the staging account cannot be deployed to
from a prod-environment job (and vice versa).

| Env     | Account        | Role ARN                                                               | SSM discovery                           |
| ------- | -------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| staging | `248812875460` | `arn:aws:iam::248812875460:role/pegasus-github-actions-deploy-staging` | `/pegasus/staging/github-oidc-role-arn` |
| prod    | `331145994639` | `arn:aws:iam::331145994639:role/pegasus-github-actions-deploy-prod`    | `/pegasus/prod/github-oidc-role-arn`    |

Trust subject patterns (per role):

- `repo:DolasDev/pegasus:ref:refs/heads/main`
- `repo:DolasDev/pegasus:pull_request`
- `repo:DolasDev/pegasus:environment:{staging|prod}` ← the load-bearing one

This Pegasus repo already has a working `Deploy` workflow that targets a
`dev` environment using OIDC (see `.github/workflows/deploy.yml`), and
CDK stacks named `PegasusDev-*` under `packages/infra/`. The legacy
`pegasus-deploy-{staging,prod}` IAM users (in dolas-infra's
`PegasusDeployInfraStack`) are currently consumed by an Azure DevOps
pipeline that deploys to the new staging/prod accounts. **The Azure
DevOps pipeline stays in place for legacy purposes** — both it and the
new GH Actions pipeline will coexist for the foreseeable future. Make
sure the GH Actions pipeline doesn't deploy CDK stacks that the Azure
DevOps pipeline also owns; if there's overlap, divide responsibility
explicitly (per-stack, or per-component) before the first staging deploy.

## Goal

Move the Pegasus GH Actions pipeline off `dev` and onto a `staging →
prod` flow in the new accounts (via the OIDC roles above). After this
lands, Pegasus has no presence in the dev account; the dev account
remains a shared sandbox for other projects but is no longer a Pegasus
deploy target.

The Azure DevOps pipeline (and its `pegasus-deploy-{staging,prod}`
IAM-user identities in dolas-infra) stays in place alongside — this
work adds a parallel deploy path _for the GH Actions pipeline_; it
does not retire AzDO.

**Sequencing note:** the prod deploy in this plan auto-runs after
staging (subject to the prod environment's required-reviewer rule).
The follow-up plan
`gate-prod-deploy-on-staging-e2e.md` inserts an E2E test gate
between them; design step 4 below so that gate is easy to slot in
later (i.e. don't pile prod-deploy logic into the staging job).

## Plan

- [x] **1. ~~Bootstrap CDK in the new accounts.~~** Already done —
      both accounts are on bootstrap version 30 with the default
      `hnb659fds` qualifier. Verified 2026-04-25 via
      `aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version`
      against `dolas-pegasus-staging-ro` and `dolas-pegasus-prod-ro`.
      The OIDC role's policy is already shaped to assume
      `cdk-hnb659fds-{deploy,file-publishing,image-publishing,cfn-exec}-role-*`
      in its own account, so deploys will work out of the box.

- [x] **2. Refactor `packages/infra/` for multi-env stack naming.**
      Stacks are currently hardcoded as `PegasusDev-*`. Parameterise
      so the env name comes from CDK context (or env var), producing
      `PegasusStaging-*` and `PegasusProd-*`. Mirror the
      `dolas-infra` convention: env-specific config object
      (account/region/domain/etc.) keyed by an `envName: 'staging' |
  'prod'`. The existing `PegasusDev-*` stacks remain in the dev
      account untouched until step 7 below — do not break them yet,
      so a rollback of this PR doesn't strand the dev environment
      mid-refactor.

- [x] **3. Configure GitHub environments.** In the Pegasus repo
      settings → Environments, create: - **staging** — no protection rules; auto-deploys on push to
      main. - **prod** — `Required reviewers: steve` (and kevin once added),
      plus a wait timer of 0–5 min. Restrict deploy branches to
      `main`.
      In each environment, set a _variable_ (not secret) named
      `AWS_DEPLOY_ROLE_ARN` to the corresponding ARN from the table
      above. The workflow already reads `vars.AWS_DEPLOY_ROLE_ARN` —
      using environment-scoped vars means the same expression resolves
      to the right ARN per job.

- [x] **4. Replace the `deploy` job in `deploy.yml`.** The existing
      `deploy` job targets the dev account; replace it with two new
      jobs: - `deploy-staging`: `needs: changes`, `environment: staging`,
      `if: github.event_name == 'push' && github.ref ==
    'refs/heads/main'`. Same steps as the old `deploy` job but
      with `PegasusStaging-*` stack names (or pass the env via
      `cdk deploy -c env=staging` if you wired it that way in
      step 2). - `deploy-prod`: `needs: deploy-staging`, `environment: prod`,
      same `if`, `PegasusProd-*` stack names.
      Keep the `Resolve CDK stack target` bash logic but parameterise
      the prefix via a per-job env var
      (e.g. `STACK_PREFIX=PegasusStaging`). Leave room between the
      two jobs for the future E2E gate (see the sibling plan).

- [x] **5. First deploy to staging.** Done 2026-04-26 in run
      [24947792475](https://github.com/DolasDev/pegasus/actions/runs/24947792475).
      Required two prerequisite ops: (a) creating the
      `pegasus/staging/database-url` secret in account `248812875460`
      (the stack code now reads `pegasus/${envName}/database-url`,
      previously hardcoded to `dev`), and (b) deleting the retained
      empty `pegasus-documents-248812875460-us-east-1` bucket left
      over from the prior failed run (`RemovalPolicy.RETAIN`).
      Validate URLs from the step summary as a follow-up.

- [x] **6. First deploy to prod.** Same run also deployed to prod
      successfully (no required-reviewer gate yet — deferred per
      "automated tests in staging will be the gate" decision; that's
      what the sibling `gate-prod-deploy-on-staging-e2e.md` plan
      adds). Required `pegasus/prod/database-url` secret created in
      account `331145994639`. Validate URLs from the step summary as
      a follow-up; confirm no disturbance to AzDO-owned resources.

- [ ] **7. Retire `PegasusDev-*` from the dev account.** Split out
      into its own todo plan since it's gated on staging+prod being
      stable for several iterations and shouldn't ride in the same
      change set: see `plans/todo/retire-pegasus-dev-account-stacks.md`.

## Implementation notes (steps 2 + 4)

- `packages/infra/bin/app.ts` now reads `envName` from CDK context
  (`-c env=...`) or the `PEGASUS_ENV` env var, defaulting to `dev`.
  Construct IDs use `Pegasus{Dev,Staging,Prod}-` and stack names use
  `pegasus-{env}-`. Staging/prod accounts are pinned in the env config
  (CDK refuses to deploy if assumed creds don't match — defense in
  depth against cross-account misfires). `dev` inherits from the
  ambient account, preserving the original behaviour.
- `packages/infra/package.json`: `deploy:ci` now passes
  `-c env=${ENV_NAME:-dev}` so `npm run deploy:ci` works with or
  without the env var (deploy.sh stays on `dev`; CI sets it explicitly).
- `.github/workflows/_deploy.yml` (new) is a `workflow_call` reusable
  workflow holding the deploy steps. `.github/workflows/deploy.yml`
  now calls it once for staging and once for prod, with `deploy-prod`
  needing `[changes, deploy-staging]`. The future `e2e-staging` job
  (sibling plan) slots between them by flipping `deploy-prod`'s
  `needs:` to include it.
- Workflow concurrency group is now `deploy-${{ github.ref }}` (was
  `deploy-dev`). The `infra` path filter also watches `_deploy.yml`.
- Per-env artifact names: `cdk-outputs-{env}` and `mobile-env-{env}`
  so staging and prod runs don't clobber each other (and so the gate
  plan can fetch staging's outputs).
- `publish-vpn-agent.yml` and `deploy.sh` still target `pegasus-dev-*`
  on purpose (per "Out of scope" — non-deploy workflows aren't being
  migrated, and deploy.sh's local-deploy path is still aimed at the
  dev account until step 7 retires it).

Verified: `npm run typecheck`, `npm run lint`, `npm test`, and
`npx cdk list -c env={dev,staging,prod}` all succeed; an invalid env
(`-c env=bogus`) fails fast with a clear error.

## What still needs the owner

Steps 1, 3, 5, 6, 7 require AWS admin creds and/or GitHub repo
settings access and cannot run from this session:

- Step 1: `cdk bootstrap` against staging (`248812875460`) and prod
  (`331145994639`). Run with the new `-c env=...` so the bootstrap
  qualifier matches what deploys will look for.
- Step 3: create `staging` and `prod` GitHub environments in repo
  settings; set `vars.AWS_DEPLOY_ROLE_ARN` per env to the ARNs in
  the table above; required reviewers + branch restriction on prod.
- Steps 5–6: trigger the workflow (push to main or `workflow_dispatch`);
  approve the prod gate; validate URLs from the step summary.
- Step 7: only after staging + prod are stable for several iterations.

## Out of scope

- Tightening the OIDC role's policy further than the shared
  `pegasusCdkDeployPolicyStatements` already provides. (Tracked
  separately under `tighten-deploy-role-policy.md` if relevant.)
- Migrating any non-deploy workflows (`ci.yml`,
  `publish-vpn-agent.yml`).
- DNS / domain wiring for staging/prod Pegasus (separate work,
  depends on whether Pegasus gets `staging.dolas.dev` /
  `pegasus.dolas.dev` or its own domain).

## References

- `dolas-infra` PR that created these roles:
  <https://github.com/DolasDev/dolas-infra/pull/3>
- Construct source:
  `dolas-infra/lib/pegasus/constructs/pegasus-github-oidc-role.ts`
- Stack: `dolas-infra/lib/pegasus/pegasus-deploy-infra-stack.ts`
- Existing dev workflow this extends:
  `.github/workflows/deploy.yml`
- Sibling plan that influenced policy shape:
  `plans/todo/tighten-deploy-role-policy.md`
- Follow-up plan that depends on this one:
  `plans/todo/gate-prod-deploy-on-staging-e2e.md`
- GitHub OIDC sub-claim shapes:
  <https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#example-subject-claims>
