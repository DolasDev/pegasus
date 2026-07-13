# Retire the pegII + efwk on-prem MSSQL-executor routes

Branch (when started): `chore/retire-pegii-efwk-onprem-routes` (this file lands first as a draft).
Goal: delete the two unused legacy on-prem HTTP surfaces — the pegII generic
MSSQL-entity router and the efwk router — and unwind whatever becomes dead once
they're gone, **without** touching the MSSQL-executor path that live cloud
handlers still depend on.

## Context

`apps/api` has two ways to reach a tenant's legacy SQL Server:

1. **The MSSQL-executor Lambda path (STAYS).** `lib/mssql-executor-client.ts`
   invokes an in-VPC executor Lambda over the WireGuard tunnel. ~35 live
   consumers: every `handlers/longhaul-cloud/*` handler, `handlers/dashboard-pegii.ts`,
   `handlers/settings.ts`, `services/ringcentral/onprem-merge.ts`, and
   `lib/pegii-api-client.ts` (the new customer/order gateway transport). **This
   whole path, the executor Lambda, and the WireGuard infra must survive.**

2. **The generic on-prem entity router (RETIRE).** `handlers/pegii/` (an
   MSSQL-entity CRUD router, ~2.2k LOC) + `handlers/efwk/` (~360 LOC, depends on
   pegII's factory), backed by `repositories/pegii/` (query-builder / generic
   repository / search-criteria / column-utils). These open **direct** `mssql`
   connection pools (`lib/mssql`) rather than going through the executor Lambda,
   and are mounted **only** on `app.server.ts` — the standalone on-prem Hono
   server (`server.ts`, run as a Windows Service via `service/install.js`).
   They are **never bundled into the CDK-deployed Lambda** (`lambda.ts` → `app.ts`).

### Evidence they're unused (verified 2026-07-13)

- Mounted only in `app.server.ts:14-15,48-49` (`onprem.route('/pegii', pegiiRouter)`,
  `onprem.route('/efwk', efwkRouter)`); `app.server.ts` is imported only by
  `server.ts`. `app.ts` (the bundled Lambda entry) never imports either.
- Zero callers across the repo: no `tenant-web`, `admin-web`, `apps/e2e`, or
  Python SDK code calls any `/api/v1/pegii/{domain}/{entity}/…` or `/api/v1/efwk/…`
  path. Repo-wide grep for `/efwk/` = 0 hits outside the handler's own source.
- Import graph: `repositories/pegii/*` is imported only by `handlers/pegii/factory.ts`
  (the reference to it in `services/pegii-tasks.ts` is a **comment**, not an import).
  `handlers/pegii/` and `handlers/efwk/` are imported only by `app.server.ts`.
- `plans/completed/longhaul-strangler-fig-cloud-migration.md` (2026-05-28) logged
  "**zero cloud callers**" for both slices and explicitly deferred their removal
  to "a separate pegii/efwk plan" — this is that plan.
- **Owner confirmation (2026-07-13):** the developer confirmed nothing uses the
  pegII + efwk on-prem routes, clearing the "an on-prem Windows Service instance
  might still be live in the field" caveat.

### NOT in scope — do not confuse or delete

- **`handlers/pegii-runtime.ts`** (mounted at `/api/v1/pegii/orders` + `/tasks` on
  the **cloud** Lambda via `app.ts`) is LIVE — the Python SDK's `get_order` /
  `list_orders` / task methods hit it, and single-order reads were just bridged to
  the pegII serialized endpoint (PR #415). It shares the `/api/v1/pegii/*` prefix
  but is a completely different handler. \*\*Keep it and its `services/pegii-orders.ts`
  - `services/pegii-tasks.ts` stubs.\*\*
- `handlers/dashboard-pegii.ts`, `handlers/settings-pegii.ts` — cloud handlers that
  query MSSQL **views** via the executor Lambda; unrelated to the generic router.
- `lib/mssql-executor-client.ts` and the executor Lambda / WireGuard stacks.

## Ordered plan

### Sub-PR A — delete the routers + their repository layer (safe; on-prem-only)

1. Delete `apps/api/src/handlers/pegii/` (index, factory, types, entity domains)
   and `apps/api/src/handlers/efwk/` (index + `domains/*`).
2. Delete `apps/api/src/repositories/pegii/` (generic.repository, query-builder,
   search-criteria, column-utils) and its `__tests__/` (generic.repository,
   query-builder, search-criteria, **sql-injection** — the injection-safety tests
   die with the query-builder they cover; note this explicitly in the PR).
3. Delete `handlers/pegii/__tests__/factory.test.ts`.
4. In `app.server.ts`, remove the `pegiiRouter` / `efwkRouter` imports + the two
   `onprem.route(...)` mounts. After this, `app.server.ts` adds only
   `tenantMiddleware` to the base `app` — see Sub-PR B for its fate.
5. Typecheck + lint + `vitest run` (needs local Postgres — see the pre-push
   gotcha below). Confirm no dangling imports.

### Sub-PR B — decide the fate of the on-prem server shell

After Sub-PR A, `server.ts` → `app.server.ts` serves nothing beyond the base
`app` (longhaul on-prem was already deleted in the strangler-fig migration). Two
options — **pick one during execution, with the developer**:

- **B1 (recommended): remove the on-prem server entirely.** Delete `server.ts`,
  `app.server.ts`, `apps/api/service/` (install/uninstall) and its
  `start`/`start:dev`/`service:*` package scripts; drop `lib/mssql` (raw pool) and
  the `mssql` + `@types/mssql` deps **iff** no other module imports `lib/mssql`
  (verify — the executor path uses `mssql-executor-client`, not `lib/mssql`).
- **B2: keep a thinned `server.ts`** if it's still wanted as a non-Lambda local-run
  target for the base cloud app. Then it should import `./app` directly and
  `app.server.ts` + `lib/mssql` + the `mssql` dep still go.

**Verify before deleting either:** `.github/workflows/_deploy.yml` and
`e2e-qa-longhaul.yml` matched a grep for `server.ts`/`app.server`/`on-prem` —
confirm what they reference and that removing the on-prem server doesn't break a
deploy step or the longhaul QA E2E job (likely just longhaul terminology, but
check). Neither on-prem file is a branch-protection required check — confirm.

### Sub-PR C — docs + dep cleanup

1. Update `apps/api/README.md` — remove the on-prem Windows-Service /
   `pegii`/`efwk` route sections (README lines ~119-145).
2. Update root `CLAUDE.md` package map if the on-prem server is removed.
3. Grep `plans/` + `.planning/` for stale references and note this plan as the
   closure of the strangler-fig's deferred pegii/efwk removal.
4. `npm install` to update the lockfile if deps were dropped.

## Hazards (do not skip)

1. **Do not delete `lib/mssql-executor-client.ts` or the executor Lambda.** 35+
   live cloud consumers (all of longhaul-cloud, dashboard-pegii, settings,
   ringcentral, the new pegII API client). Retiring the generic router does NOT
   retire the executor path.
2. **Do not touch `handlers/pegii-runtime.ts` or the `pegii-orders`/`pegii-tasks`
   services** — the live SDK order/task surface (PR #415).
3. **`lib/mssql` vs `lib/mssql-executor-client` are different things.** The former
   is the raw on-prem connection pool (on-prem-server-only); the latter is the
   cloud Lambda client (stays). Confirm the raw-pool module has no cloud importer
   before removing it in Sub-PR B.
4. **Pre-push runs `vitest --coverage` needing local Postgres + `DATABASE_URL`.**
   Bring up `docker compose up -d postgres`, `prisma migrate deploy`, and export
   `DATABASE_URL`/`DIRECT_URL` to the local DB before pushing, or the DB-dependent
   suites fail in `beforeAll` (they don't skip cleanly) and the coverage floor
   trips. The coverage `autoUpdate` may rewrite `vitest.config.ts` thresholds
   during the hook — discard that artifact rather than committing DB-inclusive
   thresholds.

## Verification

- **Sub-PR A:** `apps/api` typecheck + lint clean; full `vitest run` green against
  local Postgres; grep confirms zero remaining imports of the deleted modules.
- **Sub-PR B:** `cdk synth`/deploy unaffected (these routes were never in the
  Lambda bundle, so the CDK diff should be empty for the API stack); the longhaul
  QA E2E job (`e2e-qa-longhaul.yml`) still green; a normal deploy through CI
  succeeds.
- **Sub-PR C:** docs build/links OK; lockfile consistent after any dep drop.

## Open questions to resolve with the developer during execution

- B1 vs B2: fully remove the on-prem server, or keep a thinned local-run entry?
- Are any customer/legacy machines still running the `@pegasus/api` Windows
  Service? (Owner says no — proceeding on that basis; note it in the PR so it's
  auditable.)
