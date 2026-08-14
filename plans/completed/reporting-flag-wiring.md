# Wire `REPORTING_ENABLED` through CDK (staging first)

## Problem

Reporting phases 1 and 2 (#620 / #623 / #626) shipped to prod and the code is
live, but the surface is unreachable and there is **no lever to reach it**. The
API reads the flag at `apps/api/src/lib/reporting-feature.ts:12`:

```ts
return env['REPORTING_ENABLED'] === 'true'
```

…and `REPORTING_ENABLED` appears **nowhere** in `packages/infra`. It was never
added to the `ApiFunction` environment block, so every `/api/v1/reporting/*`
route 404s in every environment. Downstream of that 404: the catalog probe fails,
`AppShell` hides the nav entry, and `/reporting` renders its "not available"
state. The feature is not merely off — it cannot be turned on.

## Approach

Env-gated, **not** a `-c` context flag. This is the repo's own documented
reasoning on `ringcentralEnabled` (`bin/app.ts:95`) and
`integrationConfigPublishEnabled` (`bin/app.ts:104`): `deploy:ci` runs a fixed
`cdk deploy` that passes no extra context, so a context flag would silently
switch the feature back off on the next routine main-push deploy. `sesEmailEnabled`
is the lone context flag and only because of an external ordering constraint
(SES identity must verify first) that does not apply here.

**Staging only.** `integrationConfigPublishEnabled`'s "QA first" rollout is the
exact precedent. Two prerequisites are recorded as deliberate deferrals in both
reporting PR bodies and must be satisfied before prod:

1. the three legacy datasets copy their SQL verbatim from `dashboard-pegii.ts`
   (`v_dashboard1/2/3`) and have never been re-checked against a live view, and
2. there is no e2e spec for the surface.

Staging is where both get done. The later prod flip is then a one-word change
(`envName === 'staging'` → `=== 'staging' || envName === 'prod'`).

## Changes

1. `packages/infra/bin/app.ts` — `const reportingEnabled = envName === 'staging'`,
   with a house-style comment recording the env-gating rationale and the two
   prerequisites blocking prod.
2. `packages/infra/lib/stacks/api-stack.ts` — `readonly reportingEnabled?: boolean`
   on `ApiStackProps`; pass it at the `bin/app.ts` call site alongside
   `ringcentralEnabled`.
3. `api-stack.ts` — `if (props.reportingEnabled) apiFunction.addEnvironment('REPORTING_ENABLED', 'true')`.
   Only `apiFunction` reads this flag (no crons, no executor). Do **not** put a
   `'false'` entry in the main `environment` block: the handler tests
   `=== 'true'`, so absent is the off state.
4. `packages/infra/lib/stacks/__tests__/api-stack.test.ts` — mirror the
   `describe('ApiStack — RingCentral master switch')` block: env var present when
   the prop is true, **absent** when the prop is omitted.

## Out of scope

- Flipping prod (blocked on the two prerequisites above).
- Verifying the `v_dashboard1/2/3` column names — the next task, done against
  staging once this lands.
- Any SDK / OpenAPI work. Reporting is session-plane only by decision, and the
  flag's 404 behavior is already documented at `lib/openapi-spec.ts:482`.
- Replacing the home dashboard at `routes/index.tsx`. Reporting is a separate
  route by decision; the legacy/pegII dashboard stays.

## Verification

- `npm run typecheck` + `npm test` in `packages/infra` (expect CDK snapshot churn
  on the staging stack; let the normal snapshot update absorb it).
- Confirm via `cdk synth -c env=staging` that the api Lambda carries
  `REPORTING_ENABLED=true`, and that `-c env=prod` does **not**.
- Deploy: infra changes force a full `--all` deploy (`deploy.yml:8`), so this
  reaches the staging api Lambda without a component filter.

## Expected post-deploy state

Staging's `/api/v1/reporting/*` goes from 404 to live during the post-deploy E2E
gate. Nothing in `apps/e2e` pins the 404 (the `reporting` hits there are an
unrelated m2m service-account role name), so the gate is unaffected. The three
**legacy** dataset cards will error until the QA tunnel is up — per-slot errors
degrade them individually, and that is exactly where the deferred column
verification happens.
