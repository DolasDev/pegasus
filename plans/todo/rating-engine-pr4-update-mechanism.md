# Tariff Rating Engine — PR4: Update mechanism + infra

Status: not started. Picks up after PR1-3 (merged: #406, #410, #411 — see `plans/completed/b280811-rating-engine-400ng.md` for full history of what shipped).

## Context

The 400NG rating engine (domain math, Prisma schema, import pipeline, `POST /rating/rate` + tariff CRUD API) is live in production, verified against the real 2026 tariff data end-to-end. What's missing is the "keep tariffs up to date" half of the original ask: a mechanism that notices when the fuel surcharge or the tariff itself needs refreshing, since `ustranscom.mil` is confirmed bot/WAF-gated (Akamai edge denial, verified across curl/WebFetch/multiple user agents/mirrors) — there is no automated way to fetch the source documents themselves. The realistic scope here is a **checker + FSC auto-update**, not full auto-ingestion; the reliable signal is an alarm plus a manual runbook.

## Checklist

- [ ] `apps/api/src/lambda-tariff-fsc-update.ts` — weekly cron. Env-gated on `EIA_API_KEY` (inert/no-op when absent, matching `lambda-ringcentral-renew.ts`'s pattern). Fetches the EIA weekly US on-highway diesel price, computes the surcharge via the domain's `fscPercentForDieselPrice` (packages/domain/src/rating/tariff400ng.ts — linear formula, $3.50 baseline, 1% per $0.13), upserts a `TariffFuelSurcharge` row via the existing `tariff.repository.ts` (add an upsert helper if one doesn't exist yet — the current repository only supports import/activate for `TariffVersion`, not standalone FSC writes). Publish `Pegasus/Rating` CloudWatch metrics `FscUpdateSuccess`/`FscUpdateFailure` (pattern: `lambda-avp-store-count.ts`).
- [ ] `apps/api/src/lambda-tariff-check.ts` — monthly cron. Two duties:
  - DB-only (reliable): compute days of remaining `ACTIVE` 400NG coverage (`TariffVersion.effectiveTo - now`), publish a `TariffCoverageDays` gauge metric.
  - Best-effort: probe the next-rate-year USTRANSCOM artifact URL pattern; expect it to fail (WAF-gated) — log at WARN if it ever unexpectedly succeeds with an unknown checksum (`TariffArtifactDetected` metric). No auto-import.
- [ ] `packages/infra/lib/stacks/api-stack.ts` — wire both Lambdas following the `lambda-ringcentral-renew.ts` cron block (~line 1136): dedicated `logs.LogGroup` pushed to `cronLogGroupNames`, `events.Rule` with `Schedule.rate(...)`, `dbSecret.grantRead`, `cloudwatch:PutMetricData` grant.
- [ ] `packages/infra/lib/stacks/monitoring-stack.ts` — `TariffCoverageDaysAlarm` (< 45 days) and `FscUpdateFailureAlarm`, wired via the existing `alarmTopic`/`wire(alarm)` pattern.
- [ ] CDK assertion tests for the new functions/rules/alarms (existing test style in `packages/infra`).
- [ ] Runbook (add to this plan doc or a docs page once written): the primary path is now the platform-admin UI — a PLATFORM_ADMIN opens **admin-web → Tariffs**, uploads the current year's 400NG Baseline Rates `.xlsx` (parsed in-browser), reviews the counts + warnings, imports (STAGED), then activates. The endpoints behind it are `POST /api/admin/tariffs/import` → review via `GET /api/admin/tariffs/:id` → `POST /api/admin/tariffs/:id/activate` (see the shipped tariff-import plan). The offline CLI (`npx tsx scripts/parse-400ng-xlsx.ts <file> ... > 400ng-<yr>.json`) remains the fallback for a year whose workbook layout drifts past the in-browser parser — its `.json` output is accepted by the same UI.

## Smaller open items (not their own PR, but worth tracking)

- **TSP linehaul discount has no persistence.** `RatingInput.linehaulDiscountPercent` is a per-request input only (see `packages/domain/src/rating/tariff400ng.ts`'s calibration notes for why — it's a per-TSP negotiated value, not published in the tariff). A tenant that always negotiates the same discount currently has to pass it on every `POST /rating/rate` call. Would need a small tenant-level config table + a repository/handler change to default it if this becomes annoying in practice.
- **Mileage is still the zip3-centroid haversine approximation** (`createZip3CentroidEstimator` in `packages/domain/src/rating/mileage.ts`), not official DTOD/BPC-to-BPC mileage. The real "400NG Rating Tool" spreadsheet (if still available — ask the user, they provided it once during PR2's implementation) does contain the authoritative mileage matrix, but its lookup scheme is a genuinely non-trivial triangular Table-Code matrix requiring min/max direction resolution between origin and destination — worth scoping as its own small research spike before attempting, not a quick swap.

## Explicitly out of scope (by design, confirmed against the real tariff — not oversights)

Crating/uncrating (Item 105B), debris removal (105D), inspection fee (105J), SIT (Storage-in-Transit, Items 17/185/210) and its own `dSIT` discount, Alaska/waterhaul shipments (Section 6/7, the one place peak/non-peak actually matters in the real 2026 data), Volume Move / One-Time-Only bid-rate procurement (Section 3/5 of the tariff), van-line tariffs (Atlas/Allied/United — confirmed no public data source exists for any of them), tenant-web UI for rating, and wiring rating results into the Quote-context flow.

## Verification

Same layered approach as PR1-3: domain unit tests for any new pure functions (e.g. the coverage-days calculation), API integration tests behind `DATABASE_URL` gating for the repository upsert, CDK assertion tests for the infra wiring, and a manual QA pass invoking both Lambdas directly (`aws lambda invoke`) to confirm inert-safe behavior when env vars are unset and correct behavior when they are.
