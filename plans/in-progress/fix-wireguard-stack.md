# Fix WireGuardStack for CI deploys

## Background

The WireGuard multi-tenant VPN stack (`packages/infra/lib/stacks/wireguard-stack.ts`,
introduced in `2ab8000` and `0b2e71f`) has never successfully deployed. It was
first exercised end-to-end by the CI deploy workflow (see
`plans/in-progress/deploy-via-cicd.md`), which surfaced three layered blockers.

`ApiStack` depends on WireGuardStack via `bin/app.ts`:

```ts
wireguardHubPublicKey: wireguardStack.hubPublicKey,
wireguardHubEndpoint: wireguardStack.hubEndpoint,
tunnelProxyFunction: wireguardStack.tunnelProxyFunction,
```

So CDK drags WireGuard into any `cdk deploy` that targets `PegasusDev-ApiStack`
— `target=api` in the deploy workflow cannot bypass it. Until WireGuard
deploys cleanly, the full-stack CI smoke-test (`target=all`) stays red.

## Known blockers (in order of discovery)

### 1. Em-dashes in resource descriptions ✅ fixed

Commit `6c308f2`. IAM Role descriptions only allow characters in
`[

-~¡-ÿ]`(ASCII + Latin-1 Supplement),
not General Punctuation. The HubRole description contained a U+2014 em-dash
and was rejected with`InvalidRequest`. Normalised every `—`→`-` in the
file. Leave this item ticked; included here for context.

### 2. `AWS::AutoScaling::LaunchConfiguration` is disabled on new accounts

```
The Launch Configuration creation operation is not available in your account.
Use launch templates to create configuration templates for your Auto Scaling
groups.
```

AWS retired LaunchConfiguration for new accounts in late 2023. CDK's
`autoscaling.AutoScalingGroup` defaults to LaunchConfiguration unless given
a `launchTemplate`. The HubAsg construct (approx. `wireguard-stack.ts:417`)
must be rewritten to:

- Build an `ec2.LaunchTemplate` with the same AMI, instance type
  (`t4g.nano`), security group, IAM instance profile, key name (if any),
  user-data, and IMDSv2 config.
- Pass it into `autoscaling.AutoScalingGroup` via the `launchTemplate`
  property instead of the inline `machineImage` / `userData` / `role` props.
- Keep the EIP association script in user-data (still works — IMDSv2 and
  AWS CLI are available in AL2023 base AMI).

CDK reference:
<https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_autoscaling.AutoScalingGroup.html#launchtemplate>

### 3. Orphan `pegasus-vpn-agent-*` S3 bucket

Earlier failed deploys left
`pegasus-vpn-agent-864899848943-us-east-1` in the account. The next
deploy fails ChangeSet validation:

```
Resource of type 'AWS::S3::Bucket' with identifier
  'pegasus-vpn-agent-864899848943-us-east-1' already exists.
  (at /Resources/AgentArtifactsBucketC2AF7D2A)
```

Options:

- **Import the bucket** into the stack via `cdk import` once the template
  matches (preferred if any artifacts already live there).
- **Delete the orphan** if the bucket is empty (quick path):
  ```
  aws s3 rb s3://pegasus-vpn-agent-864899848943-us-east-1 --profile admin-dev
  ```
  The CDK stack will then create it fresh on next deploy.

Check contents first:

```
aws s3 ls s3://pegasus-vpn-agent-864899848943-us-east-1 --profile admin-dev
```

## Plan

- [ ] **1. Inventory the orphan bucket.** `aws s3 ls` — empty ⇒ delete; non-empty ⇒ import.
- [ ] **2. Rewrite HubAsg to use `ec2.LaunchTemplate` + `launchTemplate:` prop.**
      Keep IAM instance profile, user-data, SG, IMDSv2 config identical.
      `cdk synth` locally and diff the template to confirm only the ASG
      construct changes.
- [ ] **3. Deploy WireGuard stack in isolation** via `AWS_PROFILE=admin-dev` +
      `cdk deploy pegasus-dev-wireguard` from a developer machine. Iterate
      locally to avoid the long CI loop.
- [ ] **4. Re-enable full CI smoke-test.** Once WireGuard is green,
      trigger `Deploy` workflow with `target=all` from the Actions UI.
      Confirm client/admin/API URLs land in the `Deployed URLs` summary
      and artifacts upload cleanly.
- [ ] **5. Close out parent plans.** Tick the `target: all` bullet in
      `plans/completed/aws-oidc-setup.md` (moved there by
      deploy-via-cicd) and the deferred smoke-test note in
      `deploy-via-cicd.md` § 7.

## Out of scope

- Tightening the IAM deploy-role policy (tracked under deploy-via-cicd §8
  follow-ups).
- Migrating `logRetention` → `logGroup` (deprecation warning seen in CI;
  cosmetic).
- Any WireGuard runtime/agent bugs — this plan only gets the stack to
  `CREATE_COMPLETE`.
