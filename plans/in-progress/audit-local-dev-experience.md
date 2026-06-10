# Audit — Local Dev Experience (clone → running stack)

> **Status: SCOPED** — 2026-06-10

Unit 7 of the lean-delivery audit batch. Scope: bootstrap (`scripts/setup.sh`), DB seeding, env files, Docker compose stacks, Node version management. Out of scope (owned by other units): vitest/test infra (Unit 8), e2e (Unit 9), turbo/hooks (Unit 10), Python toolchain (Unit 11).

## Context

### Finding 1 — `db:seed` is definitively broken (CONFIRMED, centerpiece)

`apps/api/prisma/seed.ts` instantiates a **raw, unscoped** `PrismaClient` (`seed.ts:8-14`) and never creates a `Tenant` row, yet every model it writes is tenant-scoped with a **required** `tenantId` column in `apps/api/prisma/schema.prisma`:

| Model seeded  | seed.ts call                       | schema.prisma required `tenantId` |
| ------------- | ---------------------------------- | --------------------------------- |
| LeadSource    | `:23-32` (no tenantId)             | `:453`                            |
| RateTable     | `:38-54`                           | `:724`                            |
| CrewMember    | `:59-69`                           | `:621`                            |
| Vehicle       | `:71-82`                           | `:647`                            |
| Customer      | `:87-107`, `:248-268`              | `:488`                            |
| Move          | `:129-146`, `:290-306`, `:346-361` | `:562`                            |
| Quote         | `:149-165`, `:309-324`             | `:764`                            |
| Invoice       | `:168-177`                         | `:855`                            |
| InventoryRoom | `:189-215`                         | `:811`                            |

Two distinct failure modes, both fatal on the **first** query:

1. **Missing required field.** Every `create` payload omits `tenantId` → Prisma throws `PrismaClientValidationError: Argument 'tenantId' is missing` at runtime.
2. **Wrong unique selector in `upsert.where`.** The seed uses single-column lookups that are not uniques in the schema — the uniques are compound with `tenantId`:
   - `leadSource.upsert({ where: { name: 'Website' } })` (seed.ts:24) vs `@@unique([tenantId, name])` (schema.prisma:463) — must be `where: { tenantId_name: { tenantId, name } }`
   - `rateTable` (seed.ts:39 vs schema.prisma:737, `tenantId_name`)
   - `vehicle.upsert({ where: { registrationPlate } })` (seed.ts:72 vs schema.prisma:662, `tenantId_registrationPlate`)
   - `customer.upsert({ where: { email } })` (seed.ts:88, :249 vs schema.prisma:506, `tenantId_email`)

So `npm run db:seed` (`apps/api/package.json:16`, runs `tsx prisma/seed.ts`) exits 1 immediately. The earlier "appears functional" assessment is wrong — the code never had a chance to run against the current schema.

**Why it rotted silently:** `apps/api/tsconfig.json:7` includes only `"src/**/*"` — `prisma/seed.ts` is excluded from `tsc --noEmit`, and `tsx` does not typecheck. Both failure modes above are **compile-time** errors against the generated client; CI never sees them. Any future schema drift will rot the seed again unless the file enters the typecheck graph.

3. **Bonus defect — false idempotency claim.** The header (`seed.ts:5`) claims "Idempotent — running twice is safe", but `address.create` (`:110`, `:119`, `:271`, `:280`, `:327`, `:336`), `move.create` (`:129`, `:290`, `:346`), `quote.create`, `invoice.create`, `payment.create`, and `inventoryRoom.create` are plain creates → a second run duplicates all of them (would, once the blocking errors are fixed).

**Fix design (detail in Plan):** upsert a deterministic dev `Tenant` first, thread its id through every create, switch the four upserts to compound-unique selectors, give moves/addresses/quotes/invoices deterministic ids + upserts for true idempotency, and align the tenant id with `SKIP_AUTH` local dev: `apps/api/src/middleware/skip-auth.ts:30` resolves the request tenant as `process.env['DEFAULT_TENANT_ID'] ?? 'default-tenant'`, so the seed tenant id must equal `DEFAULT_TENANT_ID` or the seeded data is invisible to a locally-running API. Prior art for the tenant bootstrap exists in `apps/e2e/global-setup.ts:91-105` (raw-SQL tenant + tenant_user upsert).

### Finding 2 — Node version management is a recurring footgun

- Root `package.json:108-111` declares `"engines": { "node": ">=18.0.0" }` — loose enough to admit node 25, which (per project history) corrupts `node_modules` and breaks the husky pre-push hook (`.husky/pre-push` execs turbo from `node_modules/.bin`).
- **No `.nvmrc` anywhere** in the repo (verified by `find`), no `.npmrc`, so `engine-strict` is off and nothing fails fast on a wrong node.
- CI hardcodes **Node 20** in 10 places: `.github/workflows/ci.yml:49,76,119,204`, `deploy.yml:174`, `_deploy.yml:61,108`, `e2e-qa-longhaul.yml:49`, `mobile-build.yml:65`, `_publish-vpn-agent.yml:51` — while the known-good local toolchain is nvm **v24.16.0** (per project memory; some deps' engines exclude 20/25). Local and CI disagree, and neither matches the documented working version.

**Fix design:** standardize on Node **24 LTS**: add `.nvmrc` (`24.16.0`), tighten root `engines` to `>=24 <25`, add root `.npmrc` with `engine-strict=true`, and align all 10 CI `node-version` pins from `'20'` → reading `.nvmrc` (`node-version-file: .nvmrc`) so the pin lives in exactly one file.

### Finding 3 — `scripts/setup.sh` stops far short of a running stack

`scripts/setup.sh` does: copy `.env.example` → `.env` (`:49-59`), copy SPA `config.json.example` (`:63-69`), `prisma generate` (`:73-80`), WSL2 chmod fixes (`:84-88`). It does **not** start Docker postgres, run migrations, or seed — the developer must read `docker-compose.yml:1-14`'s comment block and execute 3-4 manual steps, plus _manually re-uncomment_ `DATABASE_URL` because `comment_out_default_db_url` (`:40-47`) deliberately disables the working local default. Dead code: the dual-layout loops for the pre-restructure tree — `packages/api` (`:51`, `:74`), `packages/web` (`:54`, `:64`), `apps/admin` (`:57`, `:67`) — none of these directories exist.

`DEV-WORKFLOW.md` (root) is similarly stale: `:29` and `:41` still reference `packages/api`.

### Finding 4 — env files, admin user, compose stacks (mostly fine)

- `.env.example` locations (contents not read — treat as read-restricted): `apps/api/.env.example`, `apps/tenant-web/.env.example`, `apps/admin-web/.env.example`, `apps/mobile/.env.example`, `apps/e2e/.env.test.example` (live `apps/e2e/.env.test` also present). `setup.sh` handles api/tenant-web/admin-web only; mobile and e2e are manual. Acceptable — but `apps/api/.env.example` must gain/keep a `DEFAULT_TENANT_ID` matching the seed tenant (verify during implementation; file is readable to the implementer).
- `scripts/create-admin-user.ts` (423 lines, interactive Cognito+TOTP): **correct tool for prod ops, unnecessary locally** — `SKIP_AUTH=true` (`apps/api/src/app.ts:228`, `apps/api/src/middleware/skip-auth.ts`) injects a synthetic `tenant_admin` principal, so local dev never needs Cognito. It already supports non-interactive env vars (`PEGASUS_COGNITO_POOL_ID`, etc., `:14-18`). **No change needed**; just document "you don't need this for local dev" in the bootstrap output.
- `docker-compose.yml` (postgres:16 + healthcheck + `docker/postgres/init.sql` creating the `platform` schema and `uuid-ossp`) is solid. `docker-compose.temporal.yml` is a well-documented opt-in workflow-dev aid — no changes (Python flow = Unit 11).
- **EditorConfig: not worth adding.** Prettier (`.prettierrc` + lint-staged in root `package.json:38-46`) already normalizes everything that matters; an `.editorconfig` would be a third place to keep in sync. Recommendation: skip.

### AI integration assessment

**No AI needed for this unit.** Every fix here is deterministic automation (version pinning, shell scripting, Prisma calls). The one optional spot — generating richer seed fixture data with an LLM — adds review burden for no recurring payoff at current scale; the hand-written two-customer dataset is adequate. Revisit only if demo-data realism becomes a sales need.

## Plan

### Phase 1 — Kill the Node-version footgun (quick wins, ~30 min total)

- [x] **Add `.nvmrc` at repo root containing `24.16.0`** (~2 min). Matches the known-good local toolchain. `nvm use` / `nvm install` then resolve from one file.
- [x] **Add root `.npmrc` with `engine-strict=true`** (~2 min). Makes `npm install` on a wrong node fail loudly instead of corrupting `node_modules`.
- [x] **Tighten root `package.json` `engines` to `"node": ">=24 <25", "npm": ">=10"`** (~5 min). Keep `packageManager: npm@10.8.2` as-is (node 24 bundles npm 11 — verify `>=10` admits it; it does).
- [x] **Switch all 10 CI `setup-node` pins from `node-version: '20'` to `node-version-file: .nvmrc`** (~20 min incl. CI watch). Files/lines: `ci.yml:49,76,119,204`, `deploy.yml:174`, `_deploy.yml:61,108`, `e2e-qa-longhaul.yml:49`, `mobile-build.yml:65`, `_publish-vpn-agent.yml:51`. Land this as its own PR and watch a full CI run before merging anything else (a dep that misbehaves on 24 would surface here; project memory says 24.16.0 is the proven local version, so risk is low). Coordinate with Unit 10 if it also touches workflows — this change is mechanical and conflict-light.

### Phase 2 — Fix the seed (TDD; ~2-3 h)

- [ ] **Test first: add `apps/api/src/__tests__/seed.test.ts`** (~45 min). Vitest integration test following the repo convention (skips when `DATABASE_URL` unset). Refactor `seed.ts` to export `main(db)` (keep the CLI entry guard via `import.meta` check or a separate `prisma/seed-run.ts` wrapper referenced by `db:seed`). Assertions:
  - `await main(db)` resolves (no PrismaClientValidationError);
  - a Tenant with the dev tenant id exists; every seeded `customer/move/quote/invoice/leadSource/rateTable/crewMember/vehicle/inventoryRoom` row has `tenantId` = dev tenant id;
  - **idempotency**: run `main(db)` twice, assert counts unchanged (3 moves, 2 customers, 6 addresses, 2 quotes, 1 invoice, etc.).
- [ ] **Implement the seed fix in `apps/api/prisma/seed.ts`** (~1 h):
  - At top of `main`: `const tenantId = process.env['DEFAULT_TENANT_ID'] ?? 'dev00000-0000-0000-0000-000000000001'`; `db.tenant.upsert({ where: { id: tenantId }, create: { id: tenantId, name: 'Dev Tenant', slug: 'dev' }, update: {} })`. Also upsert one `TenantUser` (`dev-admin@example.com`, `roleNames: ['tenant_admin']`, status ACTIVE) mirroring `apps/e2e/global-setup.ts:97-105`.
  - Thread `tenantId` into every create payload listed in Finding 1's table.
  - Fix the four upsert selectors to compound uniques: `tenantId_name` (LeadSource:24, RateTable:39), `tenantId_registrationPlate` (Vehicle:72), `tenantId_email` (Customer:88, :249).
  - True idempotency: give addresses, moves, quotes, invoices, payment, and inventory rooms deterministic ids (`seed-move-001` pattern already used for crew at seed.ts:60) and convert `create` → `upsert(where:{id}, update:{})`. Replace the `inventoryItem.createMany` with `skipDuplicates`-safe deterministic-id upserts or guard on existing-count.
  - Print the tenant id + "set DEFAULT_TENANT_ID=<id> in apps/api/.env (SKIP_AUTH dev)" in the success summary.
- [ ] **Bring `prisma/seed.ts` into the typecheck graph** (~15 min). Change `apps/api/tsconfig.json:7` include to `["src/**/*", "prisma/seed.ts"]` (confirm `tsc` build output isn't polluted — `typecheck` is `--noEmit`, and `build`'s `tsc` honors the same include, so either add a `tsconfig.typecheck.json` or set `"noEmit"`-safe excludes for build; simplest: keep `build` on a dedicated `tsconfig.build.json` that includes only `src`, point `typecheck` at the widened config). This is the regression guard that prevents the seed rotting again.
- [ ] **Ensure `apps/api/.env.example` documents `DEFAULT_TENANT_ID`** matching the seed default id, alongside the (uncommented) local-docker `DATABASE_URL` (~10 min).

### Phase 3 — One-command bootstrap (`npm run setup` → running stack; ~2 h)

- [ ] **Extend `scripts/setup.sh` to finish the job** (~1.5 h). After the existing env/prisma steps, append (each step skippable + idempotent, fail-soft with a clear warning when Docker is absent — same graceful degradation as `apps/e2e/global-setup.ts:24-47`):
  1. `docker info` probe → if available, `docker compose up -d postgres` + `pg_isready` wait loop (reuse the compose healthcheck params from `docker-compose.yml:28-32`);
  2. **stop commenting out `DATABASE_URL`** — invert `comment_out_default_db_url` (`setup.sh:40-47`): the local-docker default should be _active_ out of the box; Neon users are the exception who edit `.env` (print a one-line hint). Also un-comment an already-commented default when postgres comes up;
  3. `npx prisma migrate deploy` from `apps/api` (deploy, not `migrate dev` — non-interactive, no shadow DB prompt);
  4. `npm run db:seed --workspace=@pegasus/api` (or `cd apps/api && npm run db:seed`);
  5. final banner: "Stack ready → npm run dev (API on :3000 with SKIP_AUTH, tenant-web :5173, admin-web :5174). Admin-user creation (scripts/create-admin-user.ts) is NOT needed locally."
- [ ] **Prune dead dual-layout code from `setup.sh`** (~15 min): drop `packages/api` (`:51`, `:74`), `packages/web` (`:54`, `:64`), `apps/admin` (`:57`, `:67`) loop branches; straight-line the script.
- [ ] **Refresh `DEV-WORKFLOW.md` §1-2** (~15 min): replace the manual chmod/cp litany with "run `npm run setup`", fix stale `packages/api` references (`:29`, `:41`).

### Phase 4 — `npm run doctor` (~1 h)

- [ ] **Add `scripts/doctor.sh` + root script `"doctor": "bash scripts/doctor.sh"`** (~1 h). Read-only checks, one line each, exit non-zero if any FAIL:
  - node version satisfies `.nvmrc` (compare `node -v` major.minor.patch prefix; on mismatch print `nvm install $(cat .nvmrc)`);
  - npm major ≥ 10;
  - docker daemon reachable (`docker info`), postgres container healthy (`docker compose ps --format json postgres` or `pg_isready -h localhost -p 5432 -U pegasus`);
  - `.env` present in `apps/api`, `apps/tenant-web`, `apps/admin-web`; `config.json` present in both SPAs' `public/`;
  - `DATABASE_URL` uncommented in `apps/api/.env`;
  - Prisma client generated (`[ -d node_modules/.prisma/client ]` or `node -e "require('@prisma/client')"`);
  - migrations up to date (`npx prisma migrate status` from `apps/api`, tolerate DB-down with a WARN);
  - turbo/esbuild binaries executable (the WSL2 issue `setup.sh:84-88` guards against).
    Each FAIL line prints the exact fix command. This converts every "weird local breakage" debugging session into a 5-second triage.

### Phase 5 — Explicit non-actions (decided, no work)

- [ ] **Record in `dolas/agents/project/DECISIONS.md`** (~10 min, during implementation session): (a) no `.editorconfig` — prettier owns formatting; (b) `create-admin-user.ts` unchanged — prod-ops tool, SKIP_AUTH covers local; (c) `docker-compose.temporal.yml` unchanged — opt-in workflow-dev aid; (d) no AI integration in local-dev tooling — deterministic automation suffices.

## Files to Modify / Create

| Path                                                                                                                         | Action                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.nvmrc`                                                                                                                     | **create** (`24.16.0`)                                                                                                |
| `.npmrc`                                                                                                                     | **create** (`engine-strict=true`)                                                                                     |
| `package.json`                                                                                                               | modify (`engines` → `>=24 <25`; add `doctor` script)                                                                  |
| `.github/workflows/ci.yml`, `deploy.yml`, `_deploy.yml`, `e2e-qa-longhaul.yml`, `mobile-build.yml`, `_publish-vpn-agent.yml` | modify (`node-version: '20'` → `node-version-file: .nvmrc`, 10 sites)                                                 |
| `apps/api/prisma/seed.ts`                                                                                                    | modify (tenant bootstrap, tenantId threading, compound-unique upserts, deterministic-id idempotency, exported `main`) |
| `apps/api/src/__tests__/seed.test.ts`                                                                                        | **create** (integration test, DATABASE_URL-gated)                                                                     |
| `apps/api/tsconfig.json` (and possibly a new `apps/api/tsconfig.build.json`)                                                 | modify (seed.ts into typecheck graph)                                                                                 |
| `apps/api/.env.example`                                                                                                      | modify (`DEFAULT_TENANT_ID`, active local `DATABASE_URL`)                                                             |
| `scripts/setup.sh`                                                                                                           | modify (docker up + migrate + seed; remove dead layouts; stop commenting out DATABASE_URL)                            |
| `scripts/doctor.sh`                                                                                                          | **create**                                                                                                            |
| `DEV-WORKFLOW.md`                                                                                                            | modify (point at `npm run setup`, fix `packages/api` staleness)                                                       |
| `dolas/agents/project/DECISIONS.md`                                                                                          | modify (Phase 5 record)                                                                                               |

## Side Effects & Risks

- **CI node 20 → 24** is the only change with blast radius: a transitive dep could behave differently on 24. Mitigation: dedicated PR, full CI + one QA e2e run before merging the rest; local toolchain has run 24.16.0 for months. Rollback = revert one commit. Note `deploy.yml` is on the path — merge when not racing another deploy (see the rapid-main-pushes gotcha).
- **`engine-strict=true`** will hard-fail `npm install` on any machine/agent still on node 25 or 20 — that is the _intended_ behavior, but stale worktrees (which need their own `npm install`) will need `nvm use` first. The doctor script's mismatch message covers this.
- **Lambda runtime vs CI node**: confirm `packages/infra` Lambda runtimes during the CI bump (if functions are on `nodejs20.x`, building with 24 is still fine for CJS bundles, but flag any runtime upgrade as a separate, deliberate change — do NOT bundle it here).
- **Seed `update: {}` upserts** never refresh drifted dev data; `docker compose down -v` + re-setup is the documented reset path (already in `docker-compose.yml:6`).
- **setup.sh now mutates DB state** (migrate + seed). Both steps are idempotent (`migrate deploy`, upsert-based seed), and the script remains safe to re-run — preserve the existing "safe to re-run at any time" contract (`setup.sh:4`).
- Widening `apps/api` typecheck to include `prisma/seed.ts` may surface latent type errors in the current seed immediately — that is the point; the Phase 2 rewrite fixes them in the same change.

## Acceptance Criteria / Verification

All commands from repo root on a machine with Docker, after `nvm use`:

1. **Node gate works:** with node 25 active, `npm install` fails fast citing engines (`engine-strict`); `node -v` equals `v$(cat .nvmrc)` after `nvm use`.
2. **Fresh-clone bootstrap:** `docker compose down -v && npm run setup` exits 0 and ends with the "Stack ready" banner — postgres container healthy, migrations applied, seed succeeded, `.env`s + `config.json`s in place, no manual DATABASE_URL editing required.
3. **Seed is fixed and idempotent:** `cd apps/api && npm run db:seed` exits 0 on a fresh docker DB; running it a second time exits 0 with unchanged row counts. `psql postgresql://pegasus:pegasus@localhost:5432/pegasus -c "select count(*) from public.customers where tenant_id is null"` returns 0.
4. **Seed regression guard:** `cd apps/api && npm run typecheck` now fails if a required field is removed from a seed payload (spot-check by temporarily deleting one `tenantId`).
5. **Seed test:** `cd apps/api && DATABASE_URL=postgresql://pegasus:pegasus@localhost:5432/pegasus npx vitest run src/__tests__/seed.test.ts` passes.
6. **Doctor:** `npm run doctor` exits 0 on a healthy stack; stopping docker (`docker compose stop`) makes it exit non-zero with a `docker compose up -d postgres` hint; restoring fixes it.
7. **Seeded data visible in the running app:** `SKIP_AUTH=true DEFAULT_TENANT_ID=<seed tenant id> npm run dev`, then `curl -s localhost:3000/api/v1/customers | grep -c alice.johnson` ≥ 1.
8. **CI green on 24:** the node-bump PR's full CI run (typecheck, tests, synth) passes; `gh run list --workflow ci.yml` shows success.
