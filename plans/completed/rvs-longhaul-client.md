# RVS longhaul client — populate Planning Move Types + Dispatchers for Reliable Van and Storage

**Branch:** `fix/rvs-longhaul-client` · **Goal:** add an `rvs` longhaul client so Reliable Van and Storage's Operations → Planning Move Types and Dispatchers filters are no longer blank.

## Context (so any agent can resume)

**Symptom (reported 2026-09-15):** on the Reliable Van and Storage QA tenant, the Move Types dropdown in Operations → Planning is empty.

**Root cause (verified read-only via the prod mssql-executor Lambda, 2026-09-15):**

- Both RVS tenants are tagged `longhaul_client='qmm'`: QA `47addd95-6825-49d9-be5e-008a405cfcf1` (`10.200.0.7,1433`) and prod `2b916653-df32-438d-a885-e9aedae40286` (`10.200.0.4,50207`). Both point at `PegRVS`.
- QMM's `moveTypesWhere` is `move_type in ('C','S','N','M','U')`. RVS's `MoveType` table has 19 **numeric** codes, `0`–`18` (char-padded; e.g. `3 ` AVL IN, `8 ` INTL O.O.A., `18` FINAL MILE), identical on QA and prod. The whitelist matches 0 rows, so `filterOptions.moveType` is `[]`.
- Those same numeric codes are the live `import_export` values on RVS shipments (e.g. `8` has 14,304 rows), so filtering on them works once they are offered.
- **Same cause blanks Dispatchers.** QMM's `dispatcherQuery` is `roles like ('%cpd%')`. On RVS it matches 2 users, both `active='N'`, so it returns 0 after `longhaulSalesmanActiveFilter()`.
- RVS dispatch staff (titles DISPATCH / LOCAL DISPATCHER / ALLIED DISPATCHER) carry the `LO` role. `active='Y' AND roles like '%LO%'` on RVS QA returns Philip Lapilla, Vito Divito, Angie France, Roger Hayford. `LD` is held mostly by account coordinators (managed by Stephen Leo), so it is excluded.
- There is no legacy `config/clients/rvs.js`; the values come from PegRVS data.

## Design

A third entry in `CONFIGS` (`apps/api/src/lib/longhaul-client-config.ts`):

- `moveTypesWhere: '1=1'`. Since #685 the board shows every `import_export` code, so the dropdown must offer every code.
- `dispatcherQuery: "roles like '%LO%'"`

`getLonghaulClientConfigFor` validates with an own-property check on `CONFIGS` instead of the hardcoded `nwi`/`qmm` comparison, so adding a client is a one-place change. The zod enum and tenant-web type/dropdown each get `rvs`.

## Checklist

- [x] `apps/api/src/lib/longhaul-client-config.ts` — `rvs` in the union and `CONFIGS`; `isLonghaulClient` own-property guard; error messages
- [x] `apps/api/src/lib/longhaul-client-config.test.ts` — rvs values, normalization, inherited-key rejection, no-whitelist case
- [x] `apps/api/src/lib/app-settings.ts` — `LONGHAUL_CLIENTS` adds `rvs` (the zod gate on Settings save)
- [x] `apps/api/src/lib/app-settings.test.ts` — accepts nwi/qmm/rvs
- [x] `apps/tenant-web/src/api/queries/app-settings.ts` — `LonghaulClient` type
- [x] `apps/tenant-web/src/routes/settings.app.operations.tsx` — `RVS` dropdown option
- [x] Comments: `apps/api/prisma/schema.prisma` (doc comment only; also drops the stale Is_Trip_Planning mention), `apps/api/.env.example`, `handlers/longhaul-cloud/dispatchers.ts`
- [x] `dolas/agents/project/GOTCHAS.md` — "A longhaul client tag has to match the tenant's lookup DATA"
- [x] Affected API unit tests (31 files / 372 tests), typecheck (api + tenant-web), and lint all pass
- [x] Self-review of the diff: comments only (removed an unverified "ran the QMM build" claim; stale "three states"/"BOTH clients" counts). No logic findings.
- [~] PR through the merge queue
- [ ] After deploy: set **both** RVS tenants (QA and prod) to `RVS` in Settings → App → Operations

## Side effects / risks

- No migration: `longhaul_client` is a free `String?` column; the Prisma change is a `///` comment.
- NWI and QMM behavior is unchanged: their `CONFIGS` values are untouched.
- Until the tenants are flipped, RVS stays broken; deploying the code alone fixes nothing.
- The `LO` dispatcher list is inferred from job titles; the user may want to adjust it.

## Out of scope (noted, not changed)

- `UNBADGED_MOVE_TYPE='H'` means every RVS shipment card shows a numeric badge.
- QMM's own 5-code whitelist has the same defect class since #685: the board shows 18 codes but the dropdown offers 5.
- RVS `move_type_desc` labels are space-padded; harmless in the dropdown.
