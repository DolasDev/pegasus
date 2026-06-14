# Lambda nodejs20.x → nodejs24.x runtime migration

**Branch:** `chore/lambda-nodejs24-runtime`
**Goal:** Move every Lambda off the retiring `nodejs20.x` runtime to `nodejs24.x` before AWS's hard cutoff.

## Why (deadline)

AWS EOL'd the Lambda `nodejs20.x` runtime on **2026-04-30**. New functions can't be created since
**2026-06-01**; **existing functions can no longer be updated after 2026-07-01**. Any CDK deploy
touching these functions after July 1 fails. Target = **`nodejs24.x`** (parity with repo toolchain:
`.nvmrc` 24.16.0, `engines >=24 <25`; supported until Apr 2028). `lambda.Runtime.NODEJS_24_X`
already exists in the installed `aws-cdk-lib` — no CDK upgrade needed.

## Checklist

- [x] Bump all 20 `lambda.Runtime.NODEJS_20_X` → `NODEJS_24_X` across the 4 CDK stacks
- [x] Bump WireGuard hub AMI dnf package `nodejs20` → `nodejs22` (AL2023 has no `nodejs24` pkg; agent runs fine on 22)
- [x] Update 4 CDK fine-grained assertion tests `'nodejs20.x'` → `'nodejs24.x'`
- [x] Verify: `npm run typecheck` clean, `npm test` green (283/283), `npm run synth` OK
- [x] Verify synthesized templates: dev + prod each = 20 `nodejs24.x` runtimes, **zero** `nodejs20`
- [x] PR → merge to `main` → watch `deploy.yml` (infra path filter rolls affected stacks) — merged via **#254** (`0015873`); `deploy.yml` run `27449089347` succeeded (15m47s real rollout): staging → E2E gate → prod.
- [x] Post-deploy spot-check (2026-06-13, read-only profiles) — both envs clean, **zero `nodejs20.x`**:
  - staging (`248812875460`): 21 × `nodejs24.x`, 5 × `nodejs22.x` (CDK-internal providers only).
  - prod (`331145994639`): 21 × `nodejs24.x`, 5 × `nodejs22.x` (CDK-internal providers only).
  - The 5 `nodejs22.x` per env are CDK custom-resource/provider-framework Lambdas (runtime pinned by `aws-cdk-lib`, not our `lambda.Runtime` decls) → correctly out of scope. Count is 21 (not the planned 20) because later PRs (#253, #257) added Lambdas that inherited `nodejs24.x` from the migrated source.

## Files modified

- `packages/infra/lib/stacks/api-stack.ts` — 12 runtime decls (main API fn + reconcile, dispatch-triggers, avp-store-count, ringcentral-token-refresh, inline fns). _(2 are prod/staging-only conditionals → dev synth shows 10, prod shows 12.)_
- `packages/infra/lib/stacks/cognito-stack.ts` — 3 (pre-auth, pre-token, custom-message triggers)
- `packages/infra/lib/stacks/wireguard-stack.ts` — 4 Lambda fns (hub/agent key bootstrap, tunnel-proxy, mssql-executor) **+** the EC2 hub user-data `dnf install … nodejs22` line
- `packages/infra/lib/stacks/documents-stack.ts` — 1 (converter fn)
- `packages/infra/lib/stacks/__tests__/{api-stack,cognito-stack,documents-stack}.test.ts` — runtime string assertions

## Notes / risks

- `NodejsFunction` infers the esbuild `target` from `runtime`; **no explicit `target:` set anywhere**, so esbuild auto-targets node24 once runtime is bumped — nothing else to edit. Bundling verified clean in `npm test`.
- WireGuard hub genuinely needs node (`pegasus-vpn-agent` runs `npm install --omit=dev` + systemd service). Agent has no `engines` constraint and only standard `node:` imports → runs on 22. Chose `nodejs22` because AL2023 default repos don't ship `nodejs24` yet.
- nodejs24.x ships a newer AWS SDK v3 minor, but the API Lambda bundles its own deps via esbuild, so runtime-provided SDK is largely irrelevant. Low risk — smoke an API endpoint post-deploy.
- Deploy gotcha: commit any plans-only change separately/first so a trailing plans commit doesn't cancel the infra `deploy.yml` run (concurrency `cancel-in-progress: false`); re-dispatch `target=api|all` if cancelled.
- Use the Node 24 PATH-pin (`/home/steve/.nvm/versions/node/v24.16.0/bin`) for all local infra commands; default shell node v25 is unsupported.
