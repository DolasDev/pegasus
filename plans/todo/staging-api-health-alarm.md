# Alarm on staging API health, not just deploy-time gate failures

## Context

PR #91 (cedar/AVP foundation, merged 2026-05-03) shipped an api Lambda
that crashed at init with `ENOENT: cedar_wasm_bg.wasm`. The deploy
workflow's E2E gate against staging caught it — the gate failed, the
prod deploy was correctly skipped — and the system did the right thing
in the moment.

What it didn't do is alert anyone afterwards. The next two pushes to
`main` were plan-only (`plans/**` changes), so the deploy workflow's
path filter (`packages/infra/**`, `apps/api/**`, etc.) excluded the api
component, no fresh staging deploy fired, the gate never re-ran, and
nothing else flagged that staging was returning 500 on every request.
The bug sat on staging for ~48 hours until 2026-05-05 when an unrelated
infra change forced an `--all` rebuild and re-surfaced the failure.

The same shape applies to any post-deploy regression that doesn't
depend on a code push to manifest — secret rotation breaking auth,
upstream service deprecation, expired certs, etc.

## Goal

Detect a sustained-5xx or init-failure regression on the staging API
Lambda inside ~5 minutes of it starting, regardless of deploy cadence.

## Plan

- [ ] **1. CloudWatch alarm on Lambda errors — staging api function.**
      Add an alarm in `MonitoringStack` (or wherever per-stage alarms
      live) on the `Errors` metric for the staging api Lambda, with a
      window short enough to catch a stuck-broken Lambda but long
      enough not to false-alarm on a single bad request: - Metric: `AWS/Lambda` `Errors` - Dimension: `FunctionName = pegasus-staging-api-...` - Statistic: Sum - Period: 60 s - Evaluation: ≥ 3 of 5 minutes with `Errors > 0` - Action: existing SNS topic / chatbot wiring used by the other
      Pegasus alarms (find the topic in
      `packages/infra/lib/stacks/monitoring-stack.ts`)

- [ ] **2. Init-failure detection.** When Lambda crashes during init
      (the cedar-wasm case), the failure shows up in Lambda init
      reports but `Errors` does still tick because every invocation
      fails. So (1) covers it. **Verify** by checking historical
      CloudWatch metrics from 2026-05-03–05 to confirm `Errors` was
      non-zero on the staging api Lambda during the outage window
      before committing to the metric choice.

- [ ] **3. Prod alarm parity.** Add the same alarm shape against the
      prod Lambda. Threshold can be the same — prod Errors > 0 for
      3+ minutes is always actionable.

- [ ] **4. Document in `dolas/agents/project/GOTCHAS.md`.** A short
      note that path-filtered deploys can leave a broken stage
      undetected and that the alarm above is the safety net.

## Out of scope

- Re-running the staging E2E gate on plan-only pushes. Cheaper to
  alarm than to re-run a full Playwright suite; (1) covers the same
  signal.
- A separate `staging-health` cron job that hits `/health` every
  5 minutes. The Lambda's own `Errors` metric is the same signal
  without standing up a separate scheduler.

## References

- Outage post-mortem: `plans/completed/2026-05-05T2130-vpn-diagnose-spec-uat.md`
- Existing monitoring stack: `packages/infra/lib/stacks/monitoring-stack.ts`
- The path filter that masked the failure:
  `.github/workflows/deploy.yml` (`changes` job, `paths-filter` step)
