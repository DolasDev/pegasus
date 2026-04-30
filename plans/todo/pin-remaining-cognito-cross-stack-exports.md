# Pin remaining CognitoStack cross-stack exports

## Background

CFN cross-stack auto-exports between CognitoStack and its consumers
(`api-stack`, `frontend-assets-stack`, `admin-frontend-assets-stack`)
have repeatedly bitten the deploy pipeline. The auto-generated output
logical ID (e.g. `ExportsOutputRefUserPoolAdminAppClientCD59D22143082BED`)
is derived from a hash that is **not a stable contract** — it can drift
across CDK minor versions or when the consumer-side import changes
shape, and once it drifts CFN refuses to delete the old export while
the consuming stack still imports it. That manifests as:

```
Cannot delete export pegasus-<env>-cognito:ExportsOutputRef… as it is
in use by pegasus-<env>-<consumer>.
```

We have already hit this twice and applied the same fix both times:

- `b88d9c3` — pinned the FrontendStack ↔ FrontendAssetsStack and
  AdminFrontendStack ↔ AdminFrontendAssetsStack exports for bucket
  arn / bucket ref / distribution ref.
- `dbda2dd` — pinned the CognitoStack → AdminFrontendAssetsStack
  export for `adminAppClient.userPoolClientId`.

Four CognitoStack auto-exports are still construct-ref-based and
equally fragile. The next CDK bump (or any change that nudges the
auto-hash) can reproduce the same outage on a different export. This
plan finishes the pinning so the cognito-stack export contract is
fully owned by us instead of CDK's auto-gen.

## Goal

Move every CognitoStack → consumer cross-stack ref off construct
tokens and onto explicit `CfnOutput`s with `overrideLogicalId` +
`Fn::ImportValue`. After this lands:

- `cdk synth` for staging produces a CognitoStack template whose
  Outputs section is byte-identical to the deployed exports (same
  logical IDs, same export names, same values).
- No consumer holds a construct-level ref into CognitoStack — they
  resolve everything via `cdk.Fn.importValue` against the pinned
  names.
- A future CDK bump cannot silently rename any of the cognito
  cross-stack exports.

## Auto-exports to pin

Captured from the current synth (`cdk.out.staging`). Names must be
preserved verbatim — they are the deployed contract.

| Auto-generated logical ID                                 | Producer ref                                | Consumer(s)                                                   |
| --------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `ExportsOutputRefUserPool6BA7E5F296FD7236`                | `userPool.userPoolId`                       | api-stack, frontend-assets-stack                              |
| `ExportsOutputRefUserPoolTenantAppClientA86A3129C4F3A42A` | `tenantAppClient.userPoolClientId`          | api-stack, frontend-assets-stack                              |
| `ExportsOutputRefUserPoolMobileAppClient2650C7F34B844422` | `mobileAppClient.userPoolClientId`          | api-stack                                                     |
| `ExportsOutputRefUserPoolHostedUiDomainE021B0B644BA1D58`  | `hostedUiBaseUrl` (Refs the UserPoolDomain) | api-stack, frontend-assets-stack, admin-frontend-assets-stack |

`hostedUiBaseUrl` is a JS string template `https://${domain}.auth.<region>.amazoncognito.com`
— the auto-export is on the inner `Ref` only. Consumers reconstruct
the full URL on their side via `Fn::Join`. The pinned consumer code
must do the same so the rendered URL is unchanged.

`jwksUrl` is similarly a string template around `userPool.userPoolId`
— no separate export, just reuses the UserPool ref.

## Plan

- [ ] **1. Pin the four remaining CognitoStack outputs.** In
      `packages/infra/lib/stacks/cognito-stack.ts`, add explicit
      `CfnOutput` declarations modelled on the existing
      `AssetsAdminClientRefExport` block (introduced in `dbda2dd`)
      for: UserPool ref, TenantAppClient ref, MobileAppClient ref,
      HostedUiDomain ref. Each must call
      `overrideLogicalId('<exact-auto-id>')` and set
      `exportName: ${this.stackName}:<exact-auto-id>`. Keep the
      existing human-readable outputs (`UserPoolId`,
      `TenantClientId`, etc. with `PegasusCognito*` export names)
      untouched — those are a different contract.

- [ ] **2. Switch consumers to `Fn::ImportValue`.** In each consumer
      stack, replace the construct-ref prop with a `cognitoStackName:
    string` prop and resolve the value via `cdk.Fn.importValue`.
      Files: - `apps/.../frontend-assets-stack.ts` — userPoolId,
      tenantClientId, hostedUiDomain. - `apps/.../admin-frontend-assets-stack.ts` — hostedUiDomain
      (admin client already pinned). - `apps/.../api-stack.ts` — userPoolId, tenantClientId,
      mobileClientId, hostedUiDomain, plus the derived
      `cognitoJwksUrl` (rebuild from the imported userPoolId).

- [ ] **3. Reconstruct hostedUi URL on the consumer side.** Wherever
      a consumer used the `hostedUiBaseUrl` string token, replace
      with `cdk.Fn.join('', ['https://', cdk.Fn.importValue(
    '<cognito-stack>:Exports…HostedUiDomain…'),
    `.auth.${region}.amazoncognito.com`])`. Same for `jwksUrl`
      built from the imported userPoolId.

- [ ] **4. Wire `cognitoStackName` from `bin/app.ts`.** Pass
      `cognitoStack.stackName` to each consumer instead of construct
      tokens. Add `addDependency(cognitoStack)` on every consumer
      that no longer holds any construct ref into CognitoStack so
      deploy ordering is preserved.

- [ ] **5. Verify byte-identical synth.** Run `cdk synth -c
    env=staging` before/after and diff the Outputs section of
      `PegasusStaging-CognitoStack.template.json` plus the rendered
      `Fn::ImportValue` strings in the consumer templates. Target:
      Outputs section sorted-JSON-equal to the current synth, and
      every consumer Fn::ImportValue string verbatim-equal to the
      currently-deployed import string. CFN should treat the next
      deploy as a no-op for the export contract.

- [ ] **6. Update affected stack tests.** Each consumer stack test
      that previously fed construct refs (or string tokens
      generated from them) needs to be rewritten to pass
      `cognitoStackName: 'pegasus-test-cognito'` and assert against
      the literal Fn::ImportValue strings.

- [ ] **7. Deploy through staging → prod.** The change is
      contract-preserving so the CI pipeline should pass without
      manual intervention. Confirm staging Cognito stack updates
      with no resource-level diff (only metadata), then let the
      prod gate run.

## Out of scope

- The `Pegasus<Resource>` human-readable exports (`PegasusCognitoUserPoolId`
  etc.) are already pinned by name and used by external scripts /
  ops; leave them as-is.
- Other producer→consumer pairs (DocumentsStack, WireGuardStack →
  ApiStack) still use construct refs but have not drifted yet. If a
  future failure hits them, repeat this pattern; don't preempt
  them in this plan.

## Why now

Each occurrence of this bug has blocked staging deploys for a deploy
cycle. The fix is mechanical and well-understood. Doing it
preemptively for the four remaining cognito refs costs ~half a day,
versus the recurring debug-and-hotfix cost the next time CDK bumps
or a consumer changes shape.
