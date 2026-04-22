# Tighten the `pegasus-github-deploy-dev` IAM policy

## Background

`plans/completed/aws-oidc-setup.md` §2c set the GitHub Actions OIDC
deploy role up with `AdministratorAccess` attached — "simplest path"
for dev. The doc flags this as intentional shortcut:

> **Tighten later.** For dev this is fine. For prod, switch to a
> least-privilege policy that only allows `sts:AssumeRole` into the
> CDK bootstrap roles (`cdk-hnb659fds-deploy-role-*`,
> `cdk-hnb659fds-file-publishing-role-*`, etc.).

This plan does that tightening for the **dev** role now, so when
staging/prod roles are cloned from it they inherit a safe template.

## Goal

Replace `AdministratorAccess` on `pegasus-github-deploy-dev` with a
minimal policy that only lets it assume the four CDK bootstrap roles
plus `cloudformation:DescribeStacks` for pre-flight checks.

## Plan

- [ ] **1. Enumerate the CDK bootstrap roles in the account.** Run
      `aws iam list-roles --profile admin-dev --query 'Roles[?starts_with(RoleName, \`cdk-\`)].RoleName'`
      and record the four role names (deploy, file-publishing,
      image-publishing, lookup).
- [ ] **2. Draft the tight policy.** One statement:
      `sts:AssumeRole` on the four CDK role ARNs. Optional second
      statement: `cloudformation:DescribeStacks` on `*` for
      the pre-deploy smoke-test step in `deploy.yml`.
- [ ] **3. Swap attached policies.** Detach
      `AdministratorAccess`, attach the new inline policy
      `pegasus-github-deploy-dev-assume-bootstrap`.
- [ ] **4. Verify CI still deploys.** Push a trivial infra change
      and confirm the next `Deploy` run succeeds. If CDK needs an
      extra permission (e.g. `sts:TagSession`), widen the policy
      minimally and re-test.
- [ ] **5. Update `aws-oidc-setup.md`.** Replace the §2c
      `AdministratorAccess` snippet with the tight policy so the
      "Future: staging + prod" roles (§Future) clone from a safe
      template, not the shortcut one.

## Out of scope

- Creating the staging/prod roles (tracked separately when those
  environments arrive).
- Rotating / versioning the OIDC provider thumbprint.

## References

- `plans/completed/aws-oidc-setup.md` §2c, §Future
- <https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html>
