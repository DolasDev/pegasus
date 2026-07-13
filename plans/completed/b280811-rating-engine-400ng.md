# Tariff Rating Engine — 400NG Slice 1

Branch: `feat/rating-engine`

Goal: rate a shipment against the military 400NG tariff via a standalone API, with an extensible tariff abstraction (van-line tariffs later) and a keep-tariffs-updated mechanism.

## Context

Pegasus has no rating capability today: `RateTable`/`Rate` in the Quoting context (`packages/domain/src/quoting/index.ts`) is a flat per-serviceCode price list; quote prices are entirely client-supplied (`calculateQuoteTotal` just sums line items). This adds a real rating engine, starting with the 400NG (DP3 domestic household-goods) tariff — the only one of the four tariffs asked about (400NG, Atlas, Allied, United) that is publicly published. Van-line tariffs are proprietary (Atlas gates behind an access request, United's UVL1 is review-only, Allied publishes only a rules PDF) — no programmatic source exists, so they're out of scope for now but the design doesn't preclude adding one later.

**ustranscom.mil is bot/WAF-gated** (confirmed Akamai edge denial across curl/WebFetch, multiple user agents and mirrors including media.defense.gov) — automated fetching of the tariff PDF/XLSX is not possible from this environment; manual download + import is the reliable path. The user manually downloaded and provided three real source documents mid-implementation, which is why the numeric model below is fully verified rather than best-guess (see "Calibration" below).

## Calibration — PR1's initial model had real, now-corrected errors

PR1 shipped a structurally-plausible but **unverified** 400NG formula (synthetic test fixtures, explicitly flagged as such). Partway through PR2, the user supplied three real source documents — the actual 2026 400NG tariff PDF (`docs/2026-400ng.pdf`), the official "400NG Rating Tool" spreadsheet (mileage/transit-time calculator — not used for rates, kept for a possible future official-mileage-source swap), and the actual 2026 "400NG Baseline Rates" spreadsheet (`docs/400NG-BASELINE-RATES.XLSX`, effective 15 May 2026) — which corrected several real mistakes:

1. **Minimum billing weight is 1,000 lbs** (Item 25), not 500.
2. **BLHS (base linehaul) always applies**, looked up from a mileage x weight band matrix, regardless of distance. **Shorthaul (SH) is additive on top of BLHS** — not an either/or alternative — only when total mileage is ≤ 800 miles. SH is itself a **banded flat-dollar lookup by cwt-miles** (weight-in-cwt × total miles), not a per-unit rate.
3. **A TSP-specific negotiated linehaul discount (`InvdLHS = 1 - dLHS`)** applies to the combined linehaul charge (BLHS+OLF+DLF+SH), the origin/destination service charges (135A/135B), and full pack/unpack (105A). This discount is won per-TSP through a separate bid/rate-filing process and is **not published in the tariff** — modeled as an optional `RatingInput.linehaulDiscountPercent`, defaulting to 0 (published baseline).
4. **Fuel surcharge (Item 16, "FRA") is a simple linear formula**, not a banded table: 1% of the (already-discounted) linehaul charge per $0.13 the EIA diesel price exceeds a $3.50 baseline, floor-divided. Verified against the tariff's own worked example ($5.15/gal → 12%).
5. **Full pack is banded by Service Schedule (1-4) × weight bracket; full unpack is flat per Service Schedule**, regardless of weight. Both keyed by Schedule (a Service Area maps to exactly one Schedule via "Geographical Schedule"), not directly by Service Area.
6. **Peak/non-peak season does not split any table this engine models.** Checked every sheet in the real 2026 Baseline Rates workbook — the _only_ Peak/NonPeak split anywhere is on the Alaska Waterhaul accessorial (out of scope, CONUS-domestic only). The `TariffSeason`/`isPeakSeason` concept from PR1 was removed entirely rather than left as unused dead weight.

All of this is now verified end-to-end against real data: `packages/domain/src/rating/tariff400ng.ts`'s tests use a real Appendix A-derived fixture (SA 672 Philadelphia / SA 736 Abilene, real 2026 dollar amounts), the seed fixture in `prisma/seed.ts` uses the same real numbers, and `scripts/parse-400ng-xlsx.ts` was run against the actual 2026 Baseline Rates workbook end-to-end (921→913 deduped ZIP3s, 227 service areas, 5,076 linehaul cells, 6 shorthaul bands, 16 pack bands, 4 unpack rates — all schema-valid and successfully imported through `importTariff400ng`, idempotently).

## Architecture

Rating is a pure function of `(RatingInput, TariffData) → RatingResult` in `packages/domain`. The API layer resolves the active tariff version, fetches the few matching rate rows from global Prisma tables, and calls the domain function. Tariff data is platform-global (no `tenantId`) since it's identical government reference data for every tenant. Money is integer cents (millicents for the fractional-cent full-unpack rate) internally; conversion to dollar `Money` happens only at the API boundary.

## Checklist

### PR1 — Domain rating module (merged, PR #406) — since corrected in this branch

- [x] `packages/domain/src/rating/{index,tariff400ng,mileage}.ts` — rewritten per the Calibration section above
- [x] `packages/domain/src/rating/data/zip3-centroids.ts` + `scripts/generate-zip3-centroids.ts` — unchanged from PR1
- [x] `packages/domain/src/rating/__tests__/{tariff400ng,mileage,index}.test.ts` — rewritten with real 2026 numbers, 48 tests, all passing; coverage 98%+
- [x] `npx tsc --noEmit`, `npx vitest run --coverage`, `npx eslint src/rating` all green

### PR2 — Schema + import + read/rate API (this PR — complete)

- [x] Prisma models: `TariffVersion`, `Tariff400ngZip3`, `Tariff400ngServiceArea` (+`schedule`), `Tariff400ngLinehaulRate`, `Tariff400ngShorthaulRate` (flat cwt-miles bands), `Tariff400ngFullPackRate` (keyed by schedule), `Tariff400ngFullUnpackRate` (new, keyed by schedule) — global (no `tenantId`), additive migration `20260713165356_add_rating_tariff_tables`
- [x] `apps/api/src/lib/__tests__/prisma-tenant-isolation.test.ts` — verified no change needed; its guard only fires on models with a `tenantId` field, which these have none of
- [x] `apps/api/src/repositories/tariff.repository.ts` — active-version resolution, real rate-cell lookups (BLHS always, SH conditional, schedule-based pack/unpack, FSC), import (checksum-idempotent) + activate (transactional supersede)
- [x] `apps/api/src/rating/import-schema.ts` — zod canonical JSON import format, matches the real workbook's shape
- [x] `apps/api/src/handlers/rating.ts` — `POST /rating/rate` (+ optional `linehaulDiscountPercent`), `GET /rating/tariffs`, `GET /rating/tariffs/:id`, `POST /rating/tariffs/import`, `POST /rating/tariffs/:id/activate`; mounted at `v1.route('/rating', ratingHandler)` in `app.ts`
- [x] Cedar: `Tariff` resource type, `RateShipment`/`ReadTariff`/`ImportTariff` actions in `authz/actions.ts` + `cedar.schema.json` + `policies/20-viewer.cedar` (rate/read open to standard roles; import/activate admin-only via `tenant_admin`'s blanket policy — no persona file grants it explicitly)
- [x] `scripts/parse-400ng-xlsx.ts` — rewritten against the _real_ workbook structure (Base Point City / Geographical Schedule / Linehaul / Additional Rates tabs); handles the workbook's own documented 2-digit leading-zero-loss quirk, flags genuinely ambiguous concatenated-ZIP3 cells for manual review, and dedupes benign multi-BPC ZIP3 rows (all seen so far are Alaska's 995-999)
- [x] Seed fixture in `apps/api/prisma/seed.ts` (real SA 672/736 data) + `src/__tests__/seed.test.ts` (dedicated fixture assertions + idempotency)
- [x] Integration tests: `apps/api/src/handlers/rating.test.ts` (17 tests, mocked repository + real domain math + real mileage estimator) and `apps/api/src/repositories/__tests__/tariff.repository.test.ts` (17 tests, real DB, real seeded data)
- [x] Full verification green: domain (98%+ coverage), api (2206 tests / 174 files, coverage above ratcheted threshold), migration additive-only, real 2026 workbook imports end-to-end and idempotently

### PR3 — (folded into PR2) `POST /rating/rate` — done above

### PR4 — Update mechanism + infra (not started)

- [ ] `apps/api/src/lambda-tariff-fsc-update.ts` (weekly, EIA diesel price → FSC row)
- [ ] `apps/api/src/lambda-tariff-check.ts` (monthly, coverage-days gauge + best-effort artifact-detection probe)
- [ ] `packages/infra/lib/stacks/api-stack.ts` cron wiring (copy `lambda-ringcentral-renew.ts` pattern) + `monitoring-stack.ts` alarms
- [ ] Runbook: browser-download XLSX → `tsx scripts/parse-400ng-xlsx.ts <file> --label "..." --effective-from ... --effective-to ... > 400ng-<yr>.json` → POST import → review counts → activate

## Files touched (PR1 + PR2, this branch)

- `packages/domain/src/rating/{index,tariff400ng,mileage}.ts` (corrected)
- `packages/domain/src/rating/__tests__/*.test.ts` (rewritten, real data)
- `packages/domain/src/index.ts` (barrel, `TariffSeason` removed, `invdLHS` added)
- `apps/api/prisma/schema.prisma` (Rating context section)
- `apps/api/prisma/migrations/20260713165356_add_rating_tariff_tables/`
- `apps/api/prisma/seed.ts` (real 400NG fixture)
- `apps/api/src/__tests__/seed.test.ts` (fixture assertions)
- `apps/api/src/rating/import-schema.ts`
- `apps/api/src/repositories/tariff.repository.ts` + `__tests__/tariff.repository.test.ts`
- `apps/api/src/handlers/rating.ts` + `rating.test.ts`
- `apps/api/src/authz/actions.ts`, `cedar.schema.json`, `policies/20-viewer.cedar`
- `apps/api/src/lib/authz.test.ts`, `src/handlers/me.test.ts` (fixture updates for the 2 new viewer permissions)
- `apps/api/src/app.ts` (route mount)
- `scripts/parse-400ng-xlsx.ts` (rewritten against real workbook structure)

Hot files touched: `schema.prisma`, `actions.ts`, `cedar.schema.json`, `app.ts` — all in this one PR, coordinate before merging alongside any concurrent work on those files.

## Risks / open questions

1. **Estimate ≠ invoice**: zip3-centroid haversine × 1.17 will diverge from official DTOD mileage; every `RatingResult.meta.mileage` carries `approximate: true`. The official "400NG Rating Tool" spreadsheet _does_ contain the real mileage-lookup matrix (ZIP3 → Table Code/Sheet → BPC-to-BPC distance) — not wired up in this slice, but a documented future upgrade path if official mileage becomes worth the reverse-engineering effort (its lookup scheme is non-trivial: a triangular Table-Code matrix requiring min/max direction resolution).
2. **XLSX layout drift** across tariff years is expected — `parse-400ng-xlsx.ts` is a maintained annual dev tool. Two ambiguity classes are already handled defensively: 2-digit ZIP3/Service-Area codes losing their leading zero (workbook's own documented quirk, fixed), and concatenated multi-ZIP3 cells where one code's leading zero was lost (genuinely ambiguous — flagged to stderr for manual verification, not silently guessed-and-trusted).
3. **Auto-fetch is best-effort only** (WAF-blocked) — PR4's reliable signal is meant to be the coverage-days alarm + manual runbook, not automated ingestion.
4. **TSP linehaul discount has no persistence yet** — `linehaulDiscountPercent` is a per-request input with no per-tenant default/storage. Fine for slice 1 (baseline/undiscounted is a reasonable default), but a tenant that always negotiates the same discount will have to pass it on every call until a future PR adds tenant-level configuration.
5. Out of scope for this slice: accessorial items beyond full pack/unpack (crating, debris removal, inspection fee), SIT (Storage-in-Transit) and its own `dSIT` discount, Alaska/waterhaul shipments, Volume Move / One-Time-Only bid-rate procurement, van-line tariffs, tenant-web UI, quote-context integration.

## Verification

```
cd packages/domain && npx tsc --noEmit && npx vitest run --coverage && npx eslint src/rating
cd apps/api && npx tsc --noEmit && npx vitest run --coverage && npx eslint src prisma/seed.ts
```

Both green. Additionally verified live against the real 2026 workbook:

```
npx tsx scripts/parse-400ng-xlsx.ts <real-baseline-rates.xlsx> --label "2026 400NG Baseline Rates" \
  --effective-from 2026-05-15 --effective-to 2027-05-15 > 400ng-2026.json
# -> 913 zip3s, 227 service areas, 5076 linehaul cells, 6 shorthaul bands, 16 pack bands, 4 unpack rates
# validated against Tariff400ngImportSchema (VALID) and imported via importTariff400ng (idempotent re-import confirmed)
```
