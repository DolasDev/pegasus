# Migrate `logRetention` → explicit `logs.LogGroup` in WireGuardStack

## Background

`aws-cdk-lib.aws_lambda.FunctionOptions#logRetention` is deprecated —
it provisions a Custom Resource Lambda to patch log-group retention
after the function's log group is auto-created. CDK emits a warning
on every `cdk synth` / `cdk deploy`:

```
[WARNING] aws-cdk-lib.aws_lambda.FunctionOptions#logRetention is deprecated.
  use `logGroup` instead
  This API will be removed in the next major release.
```

`ApiStack` already uses the new pattern (`packages/infra/lib/stacks/api-stack.ts:120`)
— explicit `logs.LogGroup` created before the function, passed in via
`logGroup:` instead of `logRetention:`. `WireGuardStack` still has
two holdouts.

## Goal

Remove both `logRetention:` usages in `WireGuardStack` so the
deprecation warning disappears and the stack survives the next
`aws-cdk-lib` major.

## Sites

- `packages/infra/lib/stacks/wireguard-stack.ts:284` — `HubKeyBootstrapFn`
- `packages/infra/lib/stacks/wireguard-stack.ts:309` — `HubKeyBootstrapProvider`

## Plan

- [ ] **1. Replace `logRetention` with `logGroup`** on both sites.
      Follow the ApiStack pattern: create a `new logs.LogGroup(this,
    'HubKeyBootstrapFnLogGroup', { retention: ONE_MONTH,
    removalPolicy: RETAIN })` **before** the function, pass in via
      `logGroup:`. The CR Provider's `logRetention` option maps to
      `providerFunctionEnvEncryption`-free `logGroup:` on its
      internal functions — check the `customResources.Provider` API.
- [ ] **2. `cdk synth` and confirm warning is gone.**
- [ ] **3. Deploy.** Because the existing stack's auto-created log
      groups (`/aws/lambda/...`) are managed by the deprecated CR,
      the switch to explicit LogGroup may try to create a new
      resource that collides with the existing one. Two options:
      a) Import the existing log groups into the stack via
      `cdk import` once the template matches.
      b) Delete the orphaned log groups manually, then deploy.
      Prefer (a); there is no per-tenant data in these logs but it
      avoids a gap in audit trail.
- [ ] **4. Verify.** Run `cdk diff` post-deploy — should be clean.
      Confirm the CR helper Lambda (`LogRetention*`) is gone from
      the stack.

## Out of scope

- Changing retention periods.
- Migrating logs to a different destination (CloudWatch Logs vs.
  S3 archival — separate decision).

## References

- `packages/infra/lib/stacks/api-stack.ts:120-123` (already-migrated
  pattern)
- CDK issue: <https://github.com/aws/aws-cdk/issues/33612>
