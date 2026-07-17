# 400NG Tariff Import — platform-admin upload UI + backend

Status: **not started.** Builds the "load a real tariff into the DB" capability that
`plans/completed/b280811-rating-engine-400ng.md` deliberately left as a manual CLI + curl step.
Sibling of `plans/todo/rating-engine-pr4-update-mechanism.md` (the FSC/coverage cron) — this plan is
the human-driven import half; PR4 is the automated-monitoring half. They can ship independently.

## Problem

The 400NG rating engine (domain math, Prisma tables, `importTariff400ng`/`activateTariffVersion`
repository, `POST /api/v1/rating/tariffs/import` + activate) is live in prod, but **prod holds no real
tariff rows** (confirmed by the user). Today the only way to load one is: run
`scripts/parse-400ng-xlsx.ts` locally against a downloaded workbook to emit canonical JSON, then hand-
POST it. There is no UI, and the existing endpoint is on the wrong authorization surface.

Goal: a **platform-admin** who has the year's `400NG-BASELINE-RATES.XLSX` in hand can upload it,
preview what parsed, import it (STAGED), and activate it — entirely from `apps/admin-web`, no CLI.

## Key decisions (from codebase research — not open questions)

1. **UI lives in `apps/admin-web`, not tenant-web.** Tariff tables are platform-global (no `tenantId`);
   per CLAUDE.md, global stores are managed from the platform admin app. Confirmed: `admin-web` auth is
   the `PLATFORM_ADMIN` Cognito-group gate over `/api/admin/**` (`adminAuthMiddleware`, unscoped
   `basePrisma`, **no Cedar**) — the correct home for tenant-less reference data.

2. **New backend on `/api/admin/tariffs`, reusing the existing repository.** `importTariff400ng`,
   `activateTariffVersion`, `listTariffVersions`, `getTariffVersionById` in
   `apps/api/src/repositories/tariff.repository.ts` already take a plain `PrismaClient` and touch only
   tenant-less tables → they work verbatim with `basePrisma`. We wrap them in a new
   `handlers/admin/tariffs.ts` router. No new DB models, no migration.

3. **Parsing happens in the browser** (client-side), following the driver-availability CSV import
   precedent (`apps/tenant-web/src/features/settings/app/DriverImport/` parses with Papa Parse in-page
   and never uploads the raw file). We port the calibrated parse logic from `scripts/parse-400ng-xlsx.ts`
   into an admin-web module and POST the resulting **canonical JSON** to the existing JSON contract.
   Consequences: **no `exceljs` in the API Lambda** (it's a client dep only), no new multipart pattern
   (the codebase has none), and the server still re-validates the whole document with the existing
   `Tariff400ngImportSchema` (zod) — the trust boundary is unchanged.

4. **Input format = `.xlsx` (+ `.json` escape hatch).** The government ships the 400NG Baseline Rates
   as a multi-tab workbook, so a single CSV can't represent it — this is why the "CSV-only" DriverImport
   shape doesn't transfer directly. We accept the real `.xlsx` and, as a low-cost robustness hatch,
   also accept a pre-parsed canonical `.json` (e.g. the CLI script's output) for the year a workbook's
   layout drifts past the in-browser parser. **Legacy binary `.xls` is out of scope** — `exceljs` can't
   read BIFF; it'd need SheetJS and a parser rewrite. Flagged as an optional follow-up, not built here.

5. **Lock down the tenant-facing mutation routes.** `POST /api/v1/rating/tariffs/import` and
   `/:id/activate` are reachable by _any tenant's_ `tenant_admin` (via the blanket
   `10-tenant-admin.cedar` grant) and mutate the one shared global table — a cross-tenant blast radius
   that was a side effect, never an intentional grant. Once the `/api/admin` path exists, remove those
   two mutation routes + the `ImportTariff` Cedar action, keeping `RateShipment`/`ReadTariff` so tenants
   can still rate and read. **← the one item worth an explicit sign-off before PR3 (see Risks).**

## Architecture

```
admin-web (browser)                         apps/api  (/api/admin, PLATFORM_ADMIN gate, basePrisma)
─────────────────────                       ──────────────────────────────────────────────────────
pick .xlsx ──► parse-400ng-xlsx.ts (exceljs, ported)
             │  → { doc: canonical JSON, warnings[] }
             ▼
review: counts + effective window + warnings
             │  POST /api/admin/tariffs/import  (JSON body)
             ▼                                  ─► Tariff400ngImportSchema.safeParse (re-validate)
                                                ─► importTariff400ng(basePrisma, doc, adminEmail)
                                                     → TariffVersion STAGED (+ child rows), checksum-idempotent
activate  ──► POST /api/admin/tariffs/:id/activate ─► activateTariffVersion(basePrisma, id)
                                                     → ACTIVE, supersedes overlapping active version
list/status ► GET /api/admin/tariffs, GET /api/admin/tariffs/:id
```

## PR1 — Backend: `/api/admin/tariffs` namespace

- [ ] `apps/api/src/handlers/admin/tariffs.ts` — new `adminTariffsRouter` (`Hono<AdminEnv>`), mirroring
      `handlers/admin/workflows.ts` (uses `db` from `../../db`, i.e. `basePrisma`; inherits the blanket
      `adminAuthMiddleware`, so **no `requirePermission`**):
  - `GET /` → `listTariffVersions(db, c.req.query('tariffCode'))`, map via the same summary shape as
    `rating.ts`'s `mapVersionSummary` (id, tariffCode, label, effective window, status, checksum,
    importedBy, counts). Factor that mapper into a small shared helper so both handlers use one copy.
  - `GET /:id` → `getTariffVersionById(db, id)`, 404 when null.
  - `POST /import` → validate body with `Tariff400ngImportSchema` (import from `../../rating/import-schema`);
    on failure `400 VALIDATION_ERROR`; else `importTariff400ng(db, body, c.get('adminEmail'))`; return
    `{ id, status, created }` with `201`/`200` (created vs idempotent) — same as `rating.ts`.
  - `POST /:id/activate` → `activateTariffVersion(db, id)` → `{ id, status }`.
- [ ] `apps/api/src/handlers/admin/index.ts` — `adminRouter.route('/tariffs', adminTariffsRouter)`.
- [ ] `apps/api/src/handlers/admin/__tests__/tariffs.test.ts` — DATABASE_URL-gated integration tests:
      import creates STAGED + child rows; byte-identical re-import is a `200` no-op (checksum);
      activate flips STAGED→ACTIVE and supersedes an overlapping ACTIVE; malformed body → `400`;
      **request without a PLATFORM_ADMIN JWT → `401/403`** (the whole point of the new surface).
      Reuse the real numbers from the seed fixture / `docs/400NG-BASELINE-RATES.XLSX`.

## PR2 — admin-web: parser + upload wizard

- [ ] Add `exceljs` to `apps/admin-web/package.json` dependencies (browser build; it's isomorphic).
- [ ] `apps/admin-web/src/lib/parse-400ng-xlsx.ts` — port the pure parsing from
      `scripts/parse-400ng-xlsx.ts` (the four-tab reader: Base Point City / Geographical Schedule /
      Linehaul / Additional Rates). Signature `parseWorkbook(buf: ArrayBuffer): { doc, warnings[] }` —
      the ambiguous-concatenated-ZIP3 cases that the script logs to `stderr` become structured
      `warnings` surfaced in the UI instead of silently guessed. Keep the canonical shape identical to
      `Tariff400ngImportSchema`; the server remains the authority. (The standalone CLI script stays for
      offline/CI use — feature-local duplication matches DriverImport's local `csv.ts`, which is
      deliberately not shared; note both in a header comment so a future tariff-year edit touches both.)
- [ ] `apps/admin-web/src/lib/__tests__/parse-400ng-xlsx.test.ts` — parse the real
      `docs/400NG-BASELINE-RATES.XLSX` fixture and assert the known counts (913 zip3s, 227 service
      areas, 5076 linehaul cells, 6 shorthaul, 16 pack, 4 unpack — from the completed-plan calibration),
      plus leading-zero padding, concatenated-ZIP3 dedupe, and that an ambiguous cell yields a warning.
- [ ] `apps/admin-web/src/api/tariffs.ts` — client module (mirrors `api/workflows.ts` for GETs and
      `api/tenants.ts` for POSTs via `adminFetch`): `listTariffVersions()`, `getTariffVersion(id)`,
      `importTariff(doc)`, `activateTariffVersion(id)`.
- [ ] `apps/admin-web/src/routes/_auth/tariffs/index.tsx` — `TariffsPage`, a 3-step wizard modeled on
      `DriverImport/ImportDialog.tsx` but for the whole-document contract (single import call, not a
      per-row loop):
  - **Pick**: `<input type="file" accept=".xlsx,.json">` + `label`, `effective-from`, `effective-to`
    fields (the CLI flags become form inputs; `.json` uploads carry their own values and skip these).
    Parse on Next; show parse errors inline.
  - **Review**: parsed counts, effective window, and the `warnings[]` list; "Import" → `importTariff`
    → shows returned STAGED id + `created` vs idempotent.
  - **Activate**: the staged version's counts + an explicit "Activate" button → `activateTariffVersion`;
    plus a table of existing versions with STATUS badges (STAGED/ACTIVE/SUPERSEDED) from `listTariffVersions`,
    so an operator sees what's live before flipping.
- [ ] Wire routing: add a `createRoute({ getParentRoute: () => authLayout, path: '/tariffs', component:
    TariffsPage })` in `apps/admin-web/src/router.tsx` (into `authLayout.addChildren([...])`), and a
      `NAV_ITEMS` entry in `apps/admin-web/src/routes/_auth.tsx`.
- [ ] Component test for the wizard (RTL): pick fixture → preview asserts counts/warnings → import calls
      the client with the parsed doc → activate calls with the returned id.

## PR3 — Lock down the tenant-facing mutation surface (needs sign-off — see Risks)

- [ ] Remove `POST /tariffs/import` and `POST /tariffs/:id/activate` from
      `apps/api/src/handlers/rating.ts` (keep `POST /rate`, `GET /tariffs`, `GET /tariffs/:id`).
- [ ] Remove the `ImportTariff` action from `apps/api/src/authz/actions.ts` +
      `apps/api/src/authz/cedar.schema.json`, and drop its reference/comment from
      `policies/20-viewer.cedar`. `10-tenant-admin.cedar` needs no edit (blanket permit). Re-sync any
      Cedar snapshot fixtures (the SSO/permission-set snapshots + `apps/e2e/tests/api/authz-smoke.spec.ts`
      enumerate actions — expect to update them; see the merge-queue coverage-floor gotcha before landing).
- [ ] Update `rating.test.ts` (drop the import/activate cases now covered by the admin tests) and the
      PR4 runbook's step list to point at `/api/admin/tariffs/*`.

## Files touched

- `apps/api/src/handlers/admin/{tariffs.ts (new), index.ts}`, `handlers/admin/__tests__/tariffs.test.ts (new)`
- shared version-summary mapper (extract from `handlers/rating.ts`)
- `apps/admin-web/package.json` (+exceljs), `src/lib/parse-400ng-xlsx.ts (new)` + test,
  `src/api/tariffs.ts (new)`, `src/routes/_auth/tariffs/index.tsx (new)`, `src/router.tsx`,
  `src/routes/_auth.tsx`
- PR3 only: `handlers/rating.ts`, `authz/actions.ts`, `authz/cedar.schema.json`,
  `authz/policies/20-viewer.cedar`, Cedar snapshot fixtures, `authz-smoke.spec.ts`, `rating.test.ts`

## Risks / open questions

1. **PR3 tenant-route removal is a behavior change — confirm before landing.** It's the right security
   posture (global data mutated only by PLATFORM_ADMIN), but if any existing caller/script hits the
   tenant import route it will break. Safe fallback if we want zero-churn: ship PR1+PR2 only and leave
   PR3 as a follow-up. Recommendation: do PR3, but as its own PR so it can be reverted cleanly.
2. **exceljs bundle size in admin-web.** exceljs is sizeable; it lands in the admin-web SPA bundle, not
   the Lambda, so cold-start is unaffected, but lazy-import the parser module so it only loads when the
   operator opens the wizard.
3. **Annual workbook drift.** `parse-400ng-xlsx.ts`'s header already warns the layout shifts year to
   year. The `.json` escape hatch (decision 4) is the mitigation: if the browser parser chokes on a new
   year, run the CLI `--describe`/parse offline and upload the JSON. Keep the two parsers in sync.
4. **Legacy `.xls`** ("nice to have"): needs SheetJS + a parser rewrite (different cell API). Out of
   scope here; revisit only if the source is ever published as legacy `.xls` (it currently ships `.xlsx`).
5. **No infra/CDK change** — reuses the existing API Lambda + admin gate, no S3, no new function.

## Verification

- API: `cd apps/api && npx tsc --noEmit && npx vitest run --coverage && npx eslint src` — new admin
  tariff tests green (DATABASE_URL-gated), including the non-admin-403 case.
- admin-web: `cd apps/admin-web && npx tsc --noEmit && npx vitest run && npx eslint src` — parser test
  asserts real-workbook counts; wizard component test green.
- Manual: log into admin-web as a PLATFORM_ADMIN, upload `docs/400NG-BASELINE-RATES.XLSX`, confirm the
  review counts match the calibration numbers, import → STAGED, activate → ACTIVE, then hit
  `POST /api/v1/rating/rate` for a real lane and confirm a priced result (no `NO_ACTIVE_TARIFF_VERSION`).
- No SDK/MCP/OpenAPI surface change required: platform-admin reference-data management, not an
  integrations/workflows capability; `/api/admin/*` is not part of the pegasus-workflows SDK.
