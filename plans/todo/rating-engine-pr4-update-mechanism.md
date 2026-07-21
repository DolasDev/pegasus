# Tariff Rating Engine — PR4: Update mechanism + infra

Status: not started. Picks up after PR1-3 (merged: #406, #410, #411 — see `plans/completed/b280811-rating-engine-400ng.md` for full history of what shipped).

## Context

The 400NG rating engine (domain math, Prisma schema, import pipeline, `POST /rating/rate` + tariff CRUD API) is live in production, verified against the real 2026 tariff data end-to-end. What's missing is the "keep tariffs up to date" half of the original ask: a mechanism that notices when the fuel surcharge or the tariff itself needs refreshing, since `ustranscom.mil` is confirmed bot/WAF-gated (Akamai edge denial, verified across curl/WebFetch/multiple user agents/mirrors) — there is no automated way to fetch the source documents themselves. The realistic scope here is a **checker + FSC auto-update**, not full auto-ingestion; the reliable signal is an alarm plus a manual runbook.

## Checklist

- [x] `apps/api/src/lambda-tariff-fsc-update.ts` — weekly cron. **DONE (this PR).** Diverged from the original note on secret handling: instead of an `EIA_API_KEY` env var, it reads the key from Secrets Manager AT RUNTIME by the name in `EIA_API_KEY_SECRET_NAME` (`pegasus/<env>/eia-api-key`), so creating the secret activates it with **no redeploy** (the repo has no CDK-placeholder-secret pattern; deploy-time injection would have required the secret to pre-exist). Inert no-op when the secret is missing/empty. Uses the EIA v2 seriesid route for `PET.EMD_EPD2D_PTE_NUS_DPG.W`, converts $/gal→cents, upserts via the new `upsertTariffFuelSurcharge` helper (`source: 'EIA_AUTO'`, effectiveFrom = EIA survey week), publishes `Pegasus/Rating` `FscUpdateSuccess`/`FscUpdateFailure`.
- [ ] `apps/api/src/lambda-tariff-check.ts` — monthly cron. **STILL PENDING** (separate follow-up). Two duties:
  - DB-only (reliable): compute days of remaining `ACTIVE` 400NG coverage (`TariffVersion.effectiveTo - now`), publish a `TariffCoverageDays` gauge metric.
  - Best-effort: probe the next-rate-year USTRANSCOM artifact URL pattern; expect it to fail (WAF-gated) — log at WARN if it ever unexpectedly succeeds with an unknown checksum (`TariffArtifactDetected` metric). No auto-import.
- [x] `packages/infra/lib/stacks/api-stack.ts` — **DONE (this PR)** for the FSC-update Lambda (log group → `cronLogGroupNames`, weekly `Schedule.rate(days(7))` rule, `dbSecret.grantRead`, EIA-secret `grantRead`, `cloudwatch:PutMetricData` scoped to `Pegasus/Rating`). The `lambda-tariff-check` wiring remains for its follow-up.
- [x] `packages/infra/lib/stacks/monitoring-stack.ts` — **DONE (this PR)** `FscUpdateFailureAlarm` (Sum, threshold 0, NOT_BREACHING, wired to the alarm topic). `TariffCoverageDaysAlarm` (< 45 days) remains with the `lambda-tariff-check` follow-up.
- [x] CDK assertion tests for the FSC function/rule/alarm — **DONE (this PR)** (bumped the Lambda-count + alarm-count assertions).
- [ ] **Operator step to activate the cron**: register a free EIA key at eia.gov/opendata, then `aws secretsmanager create-secret --name pegasus/<env>/eia-api-key --secret-string '<key>'` in each account. The next weekly run picks it up automatically.
- [ ] Runbook (add to this plan doc or a docs page once written): the primary path is now the platform-admin UI — a PLATFORM_ADMIN opens **admin-web → Tariffs**, uploads the current year's 400NG Baseline Rates `.xlsx` (parsed in-browser), reviews the counts + warnings, imports (STAGED), then activates. The endpoints behind it are `POST /api/admin/tariffs/import` → review via `GET /api/admin/tariffs/:id` → `POST /api/admin/tariffs/:id/activate` (see the shipped tariff-import plan). The offline CLI (`npx tsx scripts/parse-400ng-xlsx.ts <file> ... > 400ng-<yr>.json`) remains the fallback for a year whose workbook layout drifts past the in-browser parser — its `.json` output is accepted by the same UI.

## Smaller open items (not their own PR, but worth tracking)

- **TSP linehaul discount has no persistence.** `RatingInput.linehaulDiscountPercent` is a per-request input only (see `packages/domain/src/rating/tariff400ng.ts`'s calibration notes for why — it's a per-TSP negotiated value, not published in the tariff). A tenant that always negotiates the same discount currently has to pass it on every `POST /rating/rate` call. Would need a small tenant-level config table + a repository/handler change to default it if this becomes annoying in practice.
- **Mileage is still the zip3-centroid haversine approximation** (`createZip3CentroidEstimator` in `packages/domain/src/rating/mileage.ts`), not official DTOD/BPC-to-BPC mileage. The real "400NG Rating Tool" spreadsheet (if still available — ask the user, they provided it once during PR2's implementation) does contain the authoritative mileage matrix, but its lookup scheme is a genuinely non-trivial triangular Table-Code matrix requiring min/max direction resolution between origin and destination — worth scoping as its own small research spike before attempting, not a quick swap.

## Explicitly out of scope (by design, confirmed against the real tariff — not oversights)

Crating/uncrating (Item 105B), debris removal (105D), inspection fee (105J), SIT (Storage-in-Transit, Items 17/185/210) and its own `dSIT` discount, Alaska/waterhaul shipments (Section 6/7, the one place peak/non-peak actually matters in the real 2026 data), Volume Move / One-Time-Only bid-rate procurement (Section 3/5 of the tariff), van-line tariffs (Atlas/Allied/United — confirmed no public data source exists for any of them), tenant-web UI for rating, and wiring rating results into the Quote-context flow.

## Verification

Same layered approach as PR1-3: domain unit tests for any new pure functions (e.g. the coverage-days calculation), API integration tests behind `DATABASE_URL` gating for the repository upsert, CDK assertion tests for the infra wiring, and a manual QA pass invoking both Lambdas directly (`aws lambda invoke`) to confirm inert-safe behavior when env vars are unset and correct behavior when they are.
