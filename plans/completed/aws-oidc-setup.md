# AWS OIDC + GitHub Setup for CI/CD Deploys

Manual steps the repo owner must perform once before
`.github/workflows/deploy.yml` can run. Everything here happens outside
this repo (AWS console / CLI + GitHub repo settings). When you finish,
tick the boxes and move this file to `plans/completed/`.

> Why this is manual: creating IAM roles and setting repo secrets
> requires credentials/permissions Claude doesn't have in this session.

---

## 0. Prerequisites

- [x] AWS CLI authenticated against the `admin-dev` account
      (`aws sts get-caller-identity --profile admin-dev` returns the
      expected account ID).
- [x] You have `Owner` / `Admin` role on the `dolasllc/pegasus` GitHub repo
      (needed to create Environments and set variables/secrets).
- [x] Record the AWS account ID here once confirmed:
      `AWS_ACCOUNT_ID = 864899848943`

---

## 1. Create the GitHub OIDC identity provider in AWS (one-time per account)

Skip this step if you already have one — check first:

```bash
aws iam list-open-id-connect-providers --profile admin-dev
```

If `token.actions.githubusercontent.com` is **not** listed, create it:

```bash
aws iam create-open-id-connect-provider \
  --profile admin-dev \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

- [x] OIDC provider exists in the account.

> The thumbprint above is the long-standing GitHub Actions value; AWS now
> verifies the cert chain against its own trust store regardless, so the
> thumbprint is effectively a placeholder. If you're paranoid, pull the
> current one from
> <https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/>.

---

## 2. Create the deploy IAM role

Create a role **`pegasus-github-deploy-dev`** that GitHub Actions can
assume via OIDC.

### 2a. Trust policy

Save as `trust-policy.json` (replace `AWS_ACCOUNT_ID`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:DolasDev/pegasus:ref:refs/heads/main",
            "repo:DolasDev/pegasus:environment:dev"
          ]
        }
      }
    }
  ]
}
```

The `sub` claims restrict who can assume the role:

- `ref:refs/heads/main` — auto-deploys from `push` to main
- `environment:dev` — manual `workflow_dispatch` runs scoped to the
  `dev` GitHub environment (set up in step 4)

> **Case matters.** GitHub emits the `sub` claim with the exact case
> of the repo owner, and IAM's `StringLike` is case-sensitive. The
> owner here is `DolasDev` (not `dolasllc`). Double-check the casing
> via `gh repo view --json nameWithOwner` before applying.

### 2b. Create the role

```bash
aws iam create-role \
  --profile admin-dev \
  --role-name pegasus-github-deploy-dev \
  --assume-role-policy-document file://trust-policy.json \
  --description "GitHub Actions OIDC deploy role for Pegasus dev environment"
```

### 2c. Attach permissions

Simplest path — attach the CDK bootstrap-created deploy role trust or
use `AdministratorAccess` scoped to dev. Recommended pragmatic option:

```bash
aws iam attach-role-policy \
  --profile admin-dev \
  --role-name pegasus-github-deploy-dev \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

> **Tighten later.** For dev this is fine. For prod, switch to a
> least-privilege policy that only allows `sts:AssumeRole` into the CDK
> bootstrap roles (`cdk-hnb659fds-deploy-role-*`, `cdk-hnb659fds-file-publishing-role-*`,
> etc.). See <https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html>.

### 2d. Record the role ARN

Run:

```bash
aws iam get-role \
  --profile admin-dev \
  --role-name pegasus-github-deploy-dev \
  --query 'Role.Arn' --output text
```

- [x] Role ARN recorded here:
      `AWS_DEPLOY_ROLE_ARN = arn:aws:iam::864899848943:role/pegasus-github-deploy-dev`

---

## 3. Verify CDK bootstrap is current in the region

The workflow uses the default CDK bootstrap qualifier. Confirm it exists
in `us-east-1`:

```bash
aws cloudformation describe-stacks \
  --profile admin-dev \
  --region us-east-1 \
  --stack-name CDKToolkit \
  --query 'Stacks[0].StackStatus'
```

If the stack is missing or older than CDK v2 bootstrap template v18,
re-bootstrap locally once:

```bash
cd packages/infra
npx cdk bootstrap aws://AWS_ACCOUNT_ID/us-east-1 --profile admin-dev
```

- [x] `CDKToolkit` stack is `CREATE_COMPLETE` or `UPDATE_COMPLETE`.

---

## 4. Create the `dev` GitHub environment

In the GitHub web UI: **Settings → Environments → New environment →
`dev`**.

- [x] Environment created.
- [x] (Optional) Add yourself as a required reviewer under **Deployment
      protection rules** if you want manual approval before each deploy.
- [x] Under **Environment variables**, add: - `AWS_DEPLOY_ROLE_ARN` = the ARN from step 2d - `AWS_REGION` = `us-east-1`

> We use a **variable**, not a **secret**, because role ARNs are not
> sensitive — they're useless without the OIDC trust policy. This lets
> the ARN appear in logs for debugging.

---

## 5. Smoke-test the workflow

Once `.github/workflows/deploy.yml` is merged to main:

- [x] Push-triggered run 24789683294 confirmed OIDC assume-role,
      CDK synth, Lambda bundle, and CloudFormation change-set creation
      all succeed end-to-end. The mechanism is proven; `cdk-outputs`
      artifact uploads correctly.
- [x] `target: all` full-stack deploy succeeded on run 24797230359
      after `plans/completed/fix-wireguard-stack.md` landed
      (commit `40a6c87`). All three stacks (api/tenant-web/admin-web + infra) deployed cleanly end-to-end.
- [x] `cdk-outputs` and `mobile-env` artifacts upload correctly on
      run 24797230359.

---

## 6. When everything works

- [x] Move this file to `plans/completed/aws-oidc-setup.md` (after
      WireGuard remediation closes the last §5 bullet).
- [x] Tick matching checkboxes in `deploy-via-cicd.md` (steps 1, 3, 7).
- [x] ~~Save a feedback memory once full-stack deploy smoke-test lands,
      so the OIDC role pattern becomes the documented canonical path.~~
      Skipped — `CLAUDE.md` Key Commands section already documents CI
      as the canonical deploy path, so a memory would be a duplicate.

---

## Future: staging + prod

When staging and prod environments arrive:

1. Create `pegasus-github-deploy-staging` and `pegasus-github-deploy-prod`
   roles with narrower trust policies (e.g. staging trusts
   `environment:staging`; prod trusts only tag pushes like
   `ref:refs/tags/v*`).
2. Create matching `staging` and `prod` GitHub environments with
   required reviewers on prod.
3. Parameterise `deploy.yml` on environment and pass the role ARN /
   stack name prefix from environment variables.
4. Chain the jobs: `deploy-staging` → `run-smoke-tests` → `deploy-prod`
   (the CI/CD flow you described).
