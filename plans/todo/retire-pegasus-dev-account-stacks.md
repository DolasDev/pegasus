# Retire `PegasusDev-*` from the dev AWS account

## Background

The Pegasus GH Actions deploy pipeline is now landing in two new
AWS accounts via OIDC:

| Env     | Account        | Stack prefix      |
| ------- | -------------- | ----------------- |
| staging | `248812875460` | `PegasusStaging-` |
| prod    | `331145994639` | `PegasusProd-`    |

First end-to-end staging+prod deploy succeeded on 2026-04-26 in run
[24947792475](https://github.com/DolasDev/pegasus/actions/runs/24947792475);
both APIs return `{status:ok, db:ok}` on `/health?deep=true` and both
CloudFront frontends serve 200s.

That makes the existing `PegasusDev-*` footprint in the legacy shared
"dev" AWS account redundant. This plan tears it down. It's split out
of `plans/completed/add-staging-prod-deploy-environments.md` step 7
because it's gated on _staging+prod being stable for several
iterations_ — not something to do in the same PR that introduced them.

The dev account stays as a shared sandbox for other DolasDev
projects; only Pegasus's footprint comes out.

## Goal

Remove every Pegasus-owned resource from the dev account. After this
lands, `cdk list -c env=dev` should fail (or the `dev` env should be
removed entirely from the CDK app), and the dev `AWS_DEPLOY_ROLE_ARN`
GitHub environment should not exist.

## Pre-conditions

- [ ] Staging + prod have been stable through at least 3–5 deploy
      cycles with no rollbacks.
- [ ] No CI workflow still references `pegasus-dev-*` resources for
      anything load-bearing. (`publish-vpn-agent.yml` and
      `deploy.sh`'s local-deploy default both still target dev today —
      decide whether they migrate, retire, or repoint at staging.)
- [ ] Anyone still pointing local development tools at dev-account
      resources (Cognito user pools, S3 buckets) has been notified
      and migrated.

## Plan

- [ ] **1. Inventory dev-account Pegasus resources.** From a
      maintainer laptop with dev-account creds:
      ``     AWS_PROFILE=admin-dev npx cdk list -c env=dev
    AWS_PROFILE=admin-dev aws cloudformation list-stacks \
      --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
      --query 'StackSummaries[?starts_with(StackName,`PegasusDev`)].StackName'
    ``
      Cross-check against `bin/app.ts` to confirm the list matches
      what CDK thinks should exist. Note any drift (manually-created
      stacks, orphaned resources).

- [ ] **2. Snapshot anything worth keeping.** Specifically: - Cognito user pools — export user lists if any non-test
      accounts exist there. - DynamoDB tables (none today, but check). - S3 buckets with `RemovalPolicy.RETAIN` — `pegasus-documents-*`,
      any tenant-uploaded content. Empty or copy elsewhere as
      appropriate. - Secrets Manager — `pegasus/dev/database-url` (just delete; the
      Neon DB it points at can stay or be deleted at the Neon side).

- [ ] **3. Decide `publish-vpn-agent.yml` + `deploy.sh`.** Both still
      target the dev account today. Options: - Migrate `publish-vpn-agent.yml` to publish to a staging or
      prod artifacts bucket (cleaner; matches the rest of the
      pipeline). - Retire `publish-vpn-agent.yml` if VPN agent publishing has
      moved elsewhere. - Leave `deploy.sh` aimed at dev as a "dev account = local
      sandbox" affordance, OR delete it (CI is the canonical
      deploy path).
      Whatever's chosen, don't leave references to the dev
      account hanging in workflows that would silently break.

- [ ] **4. Tear down `PegasusDev-*`.** From a maintainer laptop:
      `     AWS_PROFILE=admin-dev npx cdk destroy 'PegasusDev-*' \
      --app "npx tsx bin/app.ts" -c env=dev --force
    `
      Run in dependency order if `--force` doesn't sort it out
      (typically: `Monitoring → Api → Frontend → AdminFrontend →
    Documents → WireGuard → Cognito → FrontendAssets →
    AdminFrontendAssets`). Watch for `RETAIN` resources that
      survive — those need manual deletion.

- [ ] **5. Manual cleanup pass on the dev account.** Looking for: - S3 buckets that survived (`RemovalPolicy.RETAIN`). - CloudWatch log groups (the API + converter Lambdas use
      retention `ONE_MONTH` + `RemovalPolicy.DESTROY`, so these
      should clean up automatically — but double-check). - IAM roles created outside the CDK app (none expected). - Any Route53 records or ACM certs created during early
      bring-up that weren't part of CDK.

- [ ] **6. Remove `dev` from the CDK app.** In
      `packages/infra/bin/app.ts`, remove the `dev` env config and
      its account/region defaults. `cdk list -c env=dev` should now
      fail with a clear error. Update `package.json`'s `deploy:ci`
      to drop the `:-dev` fallback if it still has one.

- [ ] **7. Delete the dev GitHub environment.** Repo settings →
      Environments → delete `dev`. Removes the
      `vars.AWS_DEPLOY_ROLE_ARN` for that env and any orphaned
      reviewer / branch policy rules.

- [ ] **8. Update DolasInfra to retire dev OIDC trust.** The
      `pegasus-github-actions-deploy-dev` role (if it exists in the
      dev account's `dolas-infra` deploy stack) can be deleted in a
      sibling PR. File as a follow-up in the dolas-infra repo if so.

- [ ] **9. Search-and-destroy lingering `dev` references.** ripgrep
      the repo for `pegasus-dev`, `PegasusDev`, `pegasus/dev/`, and
      decide for each hit: delete, repoint, or document why it
      stays.

## Out of scope

- Tearing down the dev AWS account itself. It's shared with other
  DolasDev projects.
- Migrating off Cognito / Neon / etc. — this is purely a footprint
  cleanup, not an architectural change.

## References

- Predecessor (now completed):
  `plans/completed/add-staging-prod-deploy-environments.md`
- Multi-env CDK app entrypoint:
  `packages/infra/bin/app.ts`
- Workflows that still touch the dev account:
  `.github/workflows/publish-vpn-agent.yml`,
  `packages/infra/deploy.sh`
