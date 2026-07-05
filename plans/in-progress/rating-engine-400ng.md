# Tariff Rating Engine — 400NG Slice 1

Branch: `feat/rating-engine`

Goal: rate a shipment against the military 400NG tariff via a standalone API, with an extensible tariff abstraction (van-line tariffs later) and a keep-tariffs-updated mechanism.

## Context

Pegasus has no rating capability today: `RateTable`/`Rate` in the Quoting context (`packages/domain/src/quoting/index.ts`) is a flat per-serviceCode price list; quote prices are entirely client-supplied (`calculateQuoteTotal` just sums line items). This adds a real rating engine, starting with the 400NG (DP3 domestic household-goods) tariff — the only one of the four tariffs asked about (400NG, Atlas, Allied, United) that is publicly published. Van-line tariffs are proprietary (Atlas gates behind an access request, United's UVL1 is review-only, Allied publishes only a rules PDF) — no programmatic source exists, so they're out of scope for now but the design doesn't preclude adding one later.

**⚠ ustranscom.mil is bot/WAF-gated** — confirmed 403/404 from curl and WebFetch across multiple user agents and mirrors (media.defense.gov included), even for direct PDF links search engines index. Automated fetching of the tariff PDF/XLSX is not currently possible; manual download + import is the reliable path. This also means the 400NG numeric constants and fuel-surcharge bands in this slice are **structurally correct but unverified against the current published tariff** — see Risks.

## Architecture

Rating is a pure function of `(RatingInput, TariffData) → RatingResult` in `packages/domain`. The API layer (not yet built) will resolve the active tariff version, fetch the few matching rate rows from global Prisma tables, and call the domain function. Tariff data is platform-global (no `tenantId`) since it's identical government reference data for every tenant. Money is integer cents (millicents for per-cwt-mile rates) internally; conversion to dollar `Money` happens only at the API boundary.

## Checklist

### PR1 — Domain rating module (this PR)

- [x] `packages/domain/src/rating/index.ts` — tariff-agnostic types (`TariffCode`, `RatingInput`, `RatedLineItem`, `RatingResult`, `TariffSeason`)
- [x] `packages/domain/src/rating/mileage.ts` — `MileageEstimator` interface + `createZip3CentroidEstimator` (haversine × 1.17 road factor), always flagged `approximate: true`
- [x] `packages/domain/src/rating/data/zip3-centroids.ts` — 896-row generated table (land-area-weighted zip3 centroids from the 2023 Census ZCTA Gazetteer, public domain)
- [x] `scripts/generate-zip3-centroids.ts` — dev-only regeneration tool (not wired into CI/build)
- [x] `packages/domain/src/rating/tariff400ng.ts` — pure 400NG rating functions: `rateCycleFor`, `isPeakSeason`, `billedWeight`, `cwt`, `fuelSurcharge`, `fscPercentForDieselPrice`, orchestrator `rate400ng`
- [x] `packages/domain/src/rating/__tests__/mileage.test.ts` + `tariff400ng.test.ts` — 48 tests, all passing. **400NG fixtures are synthetic/illustrative, clearly flagged** — see Risks.
- [x] Registered in `packages/domain/src/index.ts` barrel
- [x] `npx tsc --noEmit`, `npx vitest run`, `npx eslint src/rating` all green for `packages/domain`

### PR2 — Schema + import + read API (not started)

- [ ] Prisma models: `TariffVersion`, `Tariff400ngZip3`, `Tariff400ngServiceArea`, `Tariff400ngLinehaulRate`, `Tariff400ngShorthaulRate`, `Tariff400ngFullPackRate`, `Tariff400ngFullUnpackRate`, `TariffFuelSurcharge` — global (no `tenantId`), additive migration
- [ ] `apps/api/src/lib/__tests__/prisma-tenant-isolation.test.ts` — verify/update `INTENTIONALLY_UNSCOPED` handling for the new models
- [ ] `apps/api/src/repositories/tariff.repository.ts` — targeted lookups (zip3, service area, linehaul/shorthaul band, FSC)
- [ ] `apps/api/src/rating/import-schema.ts` — zod canonical JSON import format
- [ ] `apps/api/src/handlers/rating.ts` — `GET /rating/tariffs`, `GET /rating/tariffs/:id`, `POST /rating/tariffs/import`, `POST /rating/tariffs/:id/activate`; mount `v1.route('/rating', ratingHandler)` in `app.ts`
- [ ] Cedar: `Tariff` resource type, `RateShipment`/`ReadTariff`/`ImportTariff` actions in `authz/actions.ts` + `cedar.schema.json` + `policies/` (import/activate admin-gated, on the tenant API per user decision)
- [ ] `scripts/parse-400ng-xlsx.ts` — dev tool converting the downloaded Baseline Rates workbook to canonical JSON
- [ ] Seed fixture in `apps/api/prisma/seed.ts` + `src/__tests__/seed.test.ts`
- [ ] Integration tests (`rating.test.ts`, skip without `DATABASE_URL`)

### PR3 — Rate endpoint (not started)

- [ ] `POST /rating/rate` in `handlers/rating.ts` + repository lookups + integration tests

### PR4 — Update mechanism + infra (not started)

- [ ] `apps/api/src/lambda-tariff-fsc-update.ts` (weekly, EIA diesel price → FSC row)
- [ ] `apps/api/src/lambda-tariff-check.ts` (monthly, coverage-days gauge + best-effort artifact-detection probe)
- [ ] `packages/infra/lib/stacks/api-stack.ts` cron wiring (copy `lambda-ringcentral-renew.ts` pattern) + `monitoring-stack.ts` alarms
- [ ] Runbook: browser-download XLSX → `tsx scripts/parse-400ng-xlsx.ts <file> > 400ng-<yr>.json` → POST import → review → activate

## Files touched (PR1)

- `packages/domain/src/rating/index.ts` (new)
- `packages/domain/src/rating/mileage.ts` (new)
- `packages/domain/src/rating/tariff400ng.ts` (new)
- `packages/domain/src/rating/data/zip3-centroids.ts` (new, generated)
- `packages/domain/src/rating/__tests__/mileage.test.ts` (new)
- `packages/domain/src/rating/__tests__/tariff400ng.test.ts` (new)
- `packages/domain/src/index.ts` (barrel export added)
- `scripts/generate-zip3-centroids.ts` (new dev tool)

No hot files touched in PR1 (`schema.prisma`, `actions.ts`, `cedar.schema.json`, `app.ts`, `router.tsx`, `AppShell.tsx` are all untouched — they land in PR2).

## Risks / open questions

1. **Rule fidelity unverified**: min billable weight (500 lb, `MIN_BILLABLE_WEIGHT_LBS`), the 800-mile shorthaul/linehaul boundary (`SHORTHAUL_THRESHOLD_MILES`), peak season window (May 15–Sep 30), FSC bands, and "FSC applies to linehaul/shorthaul only" are all standard-shape-but-unverified against the actual current 400NG PDF — ustranscom.mil could not be fetched programmatically (see Context). **Before PR1 merges or PR2 seeds real data, someone needs to download the current 400NG tariff PDF + Baseline Rates XLSX in a browser** and reconcile these constants and the test fixtures against its Appendix A worked examples.
2. **Test fixtures are synthetic**, not transcribed from the real tariff — `tariff400ng.test.ts` says so prominently at the top of the file. They validate the arithmetic/branching is correct, not that the numbers match reality.
3. **Estimate ≠ invoice**: zip3-centroid haversine × 1.17 will diverge from official DTOD mileage; every `RatingResult.meta.mileage` carries `approximate: true`.
4. **XLSX layout drift** across tariff years is expected — the converter (PR2) is a maintained annual dev tool, not a one-time build.
5. **Auto-fetch is best-effort only** (WAF-blocked) — PR4's reliable signal is the coverage-days alarm + manual runbook, not automated ingestion.
6. Out of scope for this slice: accessorial items, SIT, zip5 rate-area overrides, van-line tariffs, tenant-web UI, quote-context integration.

## Verification (PR1)

```
cd packages/domain && npx tsc --noEmit && npx vitest run && npx eslint src/rating
```

All green: 48 new tests passing (321 total in the domain package), clean typecheck, clean lint.
