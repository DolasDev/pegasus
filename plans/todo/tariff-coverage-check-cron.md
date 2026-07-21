# Tariff coverage-check cron (`lambda-tariff-check`)

Status: **not started.** The remaining half of the old PR4 update-mechanism plan
(`plans/todo/rating-engine-pr4-update-mechanism.md`). The **FSC-update** half shipped
in #488 (`apps/api/src/lambda-tariff-fsc-update.ts` + its infra + `FscUpdateFailureAlarm`);
this is the **coverage/staleness monitor** that was intentionally deferred. See
[[project_400ng_rating_data_loading]] for the whole rating data-loading picture.

## Problem

The 400NG tariff is loaded manually once a year (admin-web → Tariffs; #472). Each
`TariffVersion` has an `effectiveTo` (e.g. the 2026 version expires 2027-05-15). When the
active version's window lapses with no successor imported, `findActiveTariffVersion` throws
`NO_ACTIVE_TARIFF_VERSION` and **all rating breaks** — with no advance warning. USTRANSCOM
publishes the next year's workbook behind a WAF (confirmed unfetchable; see the PR4 plan),
so there is no auto-ingest. The realistic safeguard is a **coverage-days alarm** that pages
the team well before expiry, plus a best-effort probe that flags if the next artifact ever
becomes reachable.

## Scope — mirror the shipped FSC cron

### `apps/api/src/lambda-tariff-check.ts` — monthly cron

Bare `handler(): Promise<void>` like `lambda-tariff-fsc-update.ts` / `lambda-avp-store-count.ts`.
Uses the `db` singleton + a module-level `CloudWatchClient`.

- [ ] **Coverage-days gauge (reliable, DB-only).** Find the ACTIVE 400NG version covering
      "now" (reuse/extend `tariff.repository.ts`), compute
      `daysRemaining = floor((effectiveTo - now) / 1 day)`, publish a `TariffCoverageDays`
      **gauge** (Maximum) to `Pegasus/Rating`. Publish `0` (not a gap) when nothing is
      ACTIVE, so the alarm fires on lapse rather than going missing-data. Consider a
      repository helper `getActiveTariffCoverageDays(db, tariffCode)` so the math is unit-tested.
- [ ] **Best-effort artifact probe (optional, never fails the run).** GET the next-rate-year
      USTRANSCOM Baseline Rates URL pattern; **expect it to fail** (WAF-gated). If it ever
      unexpectedly `200`s, log at WARN and emit `TariffArtifactDetected=1`. **No auto-import**
      — this is only a "hey, the new tariff might be fetchable now" signal. Wrap so a
      probe error is swallowed (the coverage gauge is the reliable duty).
- [ ] Metric constants: add `TARIFF_COVERAGE_DAYS_METRIC_NAME` (+ `TARIFF_ARTIFACT_DETECTED_METRIC_NAME`)
      to `packages/infra/lib/metrics.ts` under `PEGASUS_RATING_METRIC_NAMESPACE` (already added in #488),
      duplicated literally in the Lambda per the file's apps/api-can't-import-@pegasus/infra convention.

### `packages/infra/lib/stacks/api-stack.ts`

- [ ] New cron block modeled on the `TariffFscUpdateFunction` block (256MB / 30s, log group →
      `cronLogGroupNames`, `dbSecret.grantRead`, scoped `cloudwatch:PutMetricData` on
      `Pegasus/Rating`). Schedule **monthly** — `events.Schedule.rate(cdk.Duration.days(30))`
      (house style is `rate`, not cron expressions). No secret needed (DB + a public probe).

### `packages/infra/lib/stacks/monitoring-stack.ts`

- [ ] `TariffCoverageDaysAlarm` — `TariffCoverageDays < 45` (`LESS_THAN_THRESHOLD`),
      `treatMissingData: BREACHING` (unlike the FSC failure alarm's NOT_BREACHING — here a
      _missing_ gauge means the cron isn't running, which is itself alarm-worthy once the
      feature is on). Wire via the existing `wire(alarm)`/`alarmTopic`. 45 days ≈ a comfortable
      window to download + import the next workbook before rating breaks.

### Tests

- [ ] Handler unit test (mock db/repo + CloudWatch + fetch): coverage-days math (incl. the
      no-active-version → 0 case), probe stays best-effort (a probe throw doesn't fail the run
      or block the gauge), metric emission.
- [ ] Repository test for the coverage helper (real DB, DATABASE_URL-gated) against the seed
      version's window.
- [ ] CDK assertion tests: new function (256/30) + monthly rule (disambiguate by Description,
      since `rate(30 days)` may collide) + scoped IAM + the alarm props/wiring. **Bump the
      hardcoded resource counts** — `AWS::Lambda::Function` (13 → 14 in
      `api-stack.test.ts`) and `AWS::CloudWatch::Alarm` (18 → 19, plus the
      `toHaveLength`/DLQ-absent/worker variants) in `monitoring-stack.test.ts`. These are the
      known count assertions that always need bumping when adding a cron/alarm.

## Verification

- api: `npx tsc --noEmit && npx vitest run --coverage && npx eslint src` (new handler +
  repo tests green, DATABASE_URL-gated).
- infra: `npx vitest run` (function/rule/IAM/alarm assertions + bumped counts).
- Manual: `aws lambda invoke` the function and confirm the `TariffCoverageDays` datapoint
  in CloudWatch matches `(seed effectiveTo − today)`.

## Notes / gotchas (from the FSC-cron build)

- Weekly-cron rate collides on `rate(...)` ScheduleExpression in CDK tests → disambiguate the
  rule assertion by `Description`.
- The recurring worktree churn: `apps/e2e/.env.test` port + `apps/api/vitest.config.ts`
  coverage-autoUpdate ratchet — `git checkout origin/main --` / skip-worktree them per commit.
- Publishing `0` for the no-active-version case is deliberate: it lets `LESS_THAN 45` fire on
  a real lapse instead of the alarm going INSUFFICIENT_DATA.

## Explicitly out of scope

Auto-import of the next tariff (WAF-gated, no data source — the manual admin-web upload
remains the path), and the FSC-update cron (shipped, #488).
