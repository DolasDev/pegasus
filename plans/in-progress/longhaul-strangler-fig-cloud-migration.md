# Strangler-fig migration: on-prem longhaul → cloud Hono Lambda

## Context

The on-prem Hono server (`apps/api/src/app.server.ts`) currently serves three slices: pegii (~2.2k LOC, zero cloud callers today), efwk (~360 LOC, depends on pegii's factory, zero cloud callers), and longhaul (the only slice with cloud callers — reached via the `/onprem/longhaul/*` proxy at `apps/api/src/handlers/onprem.ts:98`).

We considered three options before landing here:

- **Extract pegII to a separate .NET on-prem server on a different port.** Real work for limited benefit — pegII has no cloud callers, so the extraction wouldn't actually unblock anything.
- **Collapse the on-prem servers entirely and connect cloud Lambdas directly to tenant MSSQL.** Technically feasible (Lambdas already reach the WG overlay; `mssql` is pure-JS so no native-driver problem). But profiling 5 representative handlers showed longhaul trip-save fires **16–18 MSSQL round trips per request inside one transaction** (`apps/api/src/handlers/longhaul/trips.ts:680` → `saveTripLogic`). Over a 50 ms WAN that's ~900 ms added per save — and lock-duration scales with the same WAN latency, so concurrent edits start contending in ways they don't on-prem today. Pegii reads/writes by contrast are 1 and 3–4 round trips — fine over WAN. The bottleneck is longhaul query shape, not the architecture.
- **Strangler-fig: migrate longhaul endpoints to the cloud Hono Lambda one at a time, refactoring each query for round-trip count as part of the migration.** ← Chosen.

Why this shape wins:

- **Reversible per endpoint.** Each migration is one PR. If something regresses, revert that route — the wildcard proxy fallback at `apps/api/src/handlers/onprem.ts:98` catches it again automatically.
- **Hono mount precedence does the routing for free.** A specific route mount (e.g. `/onprem/longhaul/trips/:id`) on the cloud app wins over the `/longhaul/*` wildcard, with zero changes to the proxy code. Un-migrated endpoints keep flowing through to on-prem.
- **Refactor is forced.** Slow endpoints don't go live until they're not slow. That's exactly the discipline the round-trip profile demanded.
- **No commitment to pegII's fate.** PegII stays on-prem in Hono indefinitely. The .NET-server question is deferred, not skipped.
- **No Knex in the cloud bundle.** Migrated endpoints author raw SQL via the `mssql` package — same library pegii already uses, pure JS, no new dependency. Knex stays on-prem for un-migrated longhaul endpoints and gets deleted when the last one moves.

Intended outcome: every longhaul endpoint with a cloud caller (i.e. reachable today via `/onprem/longhaul/*`) is served directly by the cloud Hono Lambda using optimized raw `mssql`, with the on-prem longhaul tree deleted once the last one migrates.

## Done target

Every longhaul endpoint currently reachable through `/onprem/longhaul/*` is migrated to cloud-direct, with a per-endpoint P95 latency budget enforced at merge. Once met, `apps/api/src/handlers/longhaul/`, `apps/api/src/repositories/longhaul/`, `apps/api/src/lib/longhaul-db.ts`, and `knex` in `apps/api/package.json` are deleted in one cleanup PR.

P95 budget per endpoint, **set from Phase 0 measurements** (2026-05-18, Dolios
QA tenant, `SELECT 1` over WG — see "Phase 0 results" below):

- **Reads ≤ 300 ms**, **writes ≤ 800 ms**, **trip save ≤ 1.2 s**.
- These are warm-path P95 figures. The measured floor is ~80 ms per MSSQL
  round trip warm; a cold Lambda context adds ~500 ms (TDS handshake + first
  query) and lands in the P99 tail — acceptable, since the cloud API Lambda is
  warm-dominated under real traffic and `getPool` caches the pool across warm
  reinvocations.

## Bugfix policy during the dual-state period

- **Backlog short (< 10 unmigrated endpoints):** migrate as the fix. The bug becomes the forcing function for the migration.
- **Backlog long (≥ 10):** fix both places. The transition point is judgment-based — re-evaluate at the start of each PR.

The threshold isn't sacred. Use it to avoid the failure mode where a tiny on-prem fix turns into an unbounded migration scope creep, or conversely where bugs pile up on already-deprecated on-prem code.

## Architecture

```
cloud API Gateway → cloud Hono Lambda
   ├── specific route mount: /api/v1/onprem/longhaul/version    (migrated)
   ├── specific route mount: /api/v1/onprem/longhaul/trips/:id  (migrated)
   ├── …
   └── wildcard fallback: /api/v1/onprem/longhaul/*  → tunnelFetch → on-prem Hono (un-migrated)

migrated handler → getPool(tenantId) (apps/api/src/lib/mssql.ts)
                 → mssql.Request().input(...).query("SELECT … FROM …")  (raw SQL, authored per-endpoint)
                 → MSSQL on tenant overlay IP (10.200.x.y:1433) via WG VPC
```

The cloud Lambda is already in (or trivially placeable in) the WG VPC — the tunnel-proxy Lambda lives there today (`packages/infra/lib/stacks/wireguard-stack.ts`), and the overlay route 10.200.0.0/16 → hub is configured. Phase 0 verifies this for raw TCP, not just HTTP.

## Phase 0 — feasibility validation (one PR, no production traffic)

Before committing to the migration cadence, prove the unknowns:

- **Cloud Lambda → tenant MSSQL reach over WG.** Write a one-shot diagnostic Lambda (or temporary handler) that connects to a single dev tenant's `mssqlConnectionString` (overlay IP) and runs `SELECT 1`. Confirm it succeeds; record cold-start time-to-first-byte (TDS handshake dominates) and warm latency.
- **Connection pool survival across warm invocations.** Verify that `getPool(tenantId)` in `apps/api/src/lib/mssql.ts` caches the pool on the Lambda execution context such that warm reinvocations skip the handshake. If not, decide between fixing the cache, accepting per-invoke handshake cost, or provisioned concurrency.
- **Tenant `mssqlConnectionString` coverage.** Confirm every active tenant in Prisma has `mssqlConnectionString` populated and uses the overlay IP (not a LAN IP that only works from on-prem). Some tenants may need their connection string updated.
- **Bundle size delta.** Add `mssql` to the cloud Lambda bundle (it may already be in the build for shared use; check). Confirm cold-start time doesn't degrade meaningfully.

Deliverable: a short measurement note in the PR description with cold/warm latency numbers from one real tenant. Sets the P95 budget for Phase 3+.

### Phase 0 results (2026-05-18 — PR #109, merged)

A one-shot diagnostic Lambda (`MssqlDiagnosticFn`, in `wireguard-stack.ts`,
PRIVATE_ISOLATED subnet, reuses `proxySg`) connected to the Dolios QA tenant's
MSSQL at overlay IP `10.200.0.2` and ran `SELECT 1`. Findings:

- **Raw MSSQL TCP from a cloud Lambda over WG works.** TDS handshake + query
  succeeded. Cold: connect 331 ms, first query 295 ms, total 626 ms. Warm
  (pool cached): query 80–85 ms, connect 0 ms. The WG round-trip floor is
  **~80 ms** — higher than the 50 ms the round-trip profile assumed, so the
  trip-save refactor matters more, not less (16–18 trips × 80 ms ≈ 1.3–1.4 s).
- **The cloud API Lambda is NOT in the WG VPC.** It reaches on-prem only via
  the HTTP tunnel-proxy Lambda. Raw MSSQL TCP needs a VPC-attached Lambda. The
  Architecture section's "trivially placeable in the WG VPC" is wrong — Phase 3
  must decide: VPC-attach the main API Lambda (ENI cost, slower cold start) or
  route migrated handlers through a dedicated VPC-attached query Lambda.
- **Named instances do not resolve over the tunnel.** `Server=10.200.0.2\DOLAS`
  timed out (SQL Browser UDP 1434 unanswered). Migrated handlers and tenant
  connection strings MUST use an explicit port: `Server=10.200.0.2,1433`.
- **Tenant connection-string data quality is a Phase 3 prerequisite.** The
  stored Dolios `mssqlConnectionString` had a LAN hostname (`DOLAB-M70Q-1\DOLAS`)
  and a placeholder password — unusable from the cloud as-is. Every active
  tenant's string must be audited and rewritten to overlay-IP + explicit-port
  - real credentials before its endpoints migrate.
- **No bundle-size concern.** `mssql` is already an `apps/api` dependency; the
  diagnostic Lambda bundles to ~1.6 MB.
- **`getPool` pool cache survives warm reinvocations** — confirmed
  (`connectMs: 0`, `poolWasCached: true` on warm invokes). No fix needed.

Follow-up: `MssqlDiagnosticFn` and `apps/api/src/longhaul-mssql-diagnostic.ts`
are temporary tooling — delete them in a small PR now that Phase 0 is recorded.

## Phase 1 — canary: migrate `GET /longhaul/version`

The lowest-stakes endpoint. Health-check style, single query, no business logic.

- Implement cloud-side handler at `apps/api/src/handlers/longhaul-cloud/version.ts` (new directory — keeps cloud-side cleanly separated from the to-be-deleted on-prem tree).
- Mount it specifically on the cloud Hono app at `/api/v1/onprem/longhaul/version` so it wins over the wildcard proxy via Hono mount precedence.
- Use `getPool(tenantId)` from `apps/api/src/lib/mssql.ts` for the connection. Author the SQL by hand (probably one row from a version table — confirm by reading the current on-prem implementation).
- Identity: today the on-prem proxy at `apps/api/src/handlers/onprem.ts:126-143` requires `legacyWindowsUsername` and forwards it as `X-Windows-User`. The cloud handler can look up the same field from Prisma via `c.get('userId')` directly — no header round-trip. The proxy's 422 for unmapped users moves into the cloud handler (or is dropped if `/version` doesn't actually need it).
- Tests: unit test with mocked pool + e2e spec in `apps/e2e/tests/` against the real dev MSSQL.
- Deploy, watch metrics for at least one full day (real tenant cold starts spread across timezones). Record P95.

If P95 looks ugly, this is the place to address it — by mitigation choice (provisioned concurrency, connection-pool tuning) or by abandoning the migration before sinking more effort in.

### Phase 1 results (2026-05-19 — PR #113, merged & deployed to staging)

**Gate 1 resolved → Option B.** Phase 0 showed the main API Lambda is not in
the WG VPC, so the original "use `getPool` directly in the cloud handler" plan
was unworkable. The chosen architecture (see `dolas/agents/project/DECISIONS.md`):
migrated handlers stay in the main Hono app and invoke a **dedicated
`mssql-executor` Lambda** (`apps/mssql-executor`) that lives in the WG VPC and
runs the raw SQL — mirroring the existing `tunnel-proxy`. The handler does the
Neon connection-string lookup and passes the string in the invoke payload.

Delivered:

- `apps/mssql-executor` — VPC Lambda, `mssql` driver, module-level pool cache.
- `apps/api/src/lib/mssql-executor-client.ts` — `executeSql()` invoke client.
- `apps/api/src/handlers/longhaul-cloud/version.ts` — the migrated handler,
  mounted in `app.ts` before the `/onprem` wildcard. `onprem.ts` untouched.
- `MssqlExecutorFn` in WireGuardStack; ApiStack grants invoke + injects
  `MSSQL_EXECUTOR_FUNCTION_NAME`.

Verified end-to-end: the QA longhaul e2e suite (`e2e-qa-longhaul.yml`) passed
**47/47** against the deployed QA API — including `GET /version` returning
`{ data: { max: "2.1.1" } }` cloud-direct — and every un-migrated longhaul
endpoint still proxies through the tunnel unchanged (no regression). The
executor leg measured ~80 ms warm per MSSQL round trip (Phase 0 floor holds).
Per-endpoint P95 to be confirmed from CloudWatch over a day of real traffic.

Identity: `/version` needs none — `middleware/longhaul-user.ts` already exempts
it as a pure system smoke test. Handlers that _do_ need identity will look up
`legacyWindowsUsername` from Prisma via `c.get('userId')` (no `X-Windows-User`).

## Phase 2 — pattern lock-in

The per-endpoint migration template, locked in from Phase 1. Each migration is
one PR and should be mechanical:

1. Read the current on-prem implementation in `apps/api/src/handlers/longhaul/<area>.ts` and its Knex repo in `apps/api/src/repositories/longhaul/<area>.repository.ts`. Note the round-trip count.
2. Author optimized raw SQL: collapse fanouts to JOINs, replace post-write re-reads with `OUTPUT` clauses, batch loops where MSSQL allows. Target the smallest round-trip count that preserves semantics.
3. Implement the cloud handler under `apps/api/src/handlers/longhaul-cloud/<area>.ts`. The handler: looks up `tenant.mssqlConnectionString` from Prisma (422 `MSSQL_NOT_CONFIGURED` if absent — see `version.ts`), resolves identity from `c.get('userId')` if the endpoint needs it, then calls `executeSql(connectionString, sql, { params })` from `apps/api/src/lib/mssql-executor-client.ts`. Parameters are bound in the executor via `request.input(name, value)`.
4. Mount the specific path in `app.ts` before `v1.route('/onprem', onpremHandler)` so Hono precedence routes it cloud-direct. Do not touch `onprem.ts`.
5. Add tests: handler unit tests (mock `executeSql` + Prisma) + coverage in the QA e2e suite (`apps/e2e/tests/api/longhaul-qa.spec.ts`), asserting correctness and the new round-trip count.
6. Verify the per-endpoint P95 budget, then deploy via the standard CI path.
7. Log the migration (endpoint, old vs new round-trip count, measured P95) in the PR description.

## Phase 3 — migrate reads

One PR per endpoint. Start with low-volume single-query reads, escalate to multi-query reads (trip detail, planning). The order is judgment-based; prioritise endpoints whose on-prem version is slow today or whose query refactor is genuinely valuable independent of the migration.

## Phase 4 — migrate writes

Saves are where the WAN-latency math bites hardest. Trip save (16–18 round trips today) is the worst case and the highest-value refactor. Save it for last — by then the pattern is well-rehearsed and the refactor is the whole point.

Realistic targets for trip save based on the profile: post-write re-read removed via `OUTPUT` (–3), `findShipmentsByIds` fanout collapsed to a JOIN (–3), initial `findTripById` fanout collapsed (–2), batched activity inserts/deletes (–2). Aim for ~6–8 round trips; at 50 ms WAN that's ~300–400 ms — acceptable for a save action.

## Phase 5 — decommission

Once the last cloud-caller-facing longhaul endpoint migrates and meets its P95 budget:

- Delete `apps/api/src/handlers/longhaul/` and `apps/api/src/repositories/longhaul/`.
- Delete `apps/api/src/lib/longhaul-db.ts` and remove its import + `closeAllLonghaulPools` call from `apps/api/src/server.ts:23`.
- Delete `apps/api/src/middleware/longhaul-user.ts` (now unreferenced — the cloud handlers don't need `X-Windows-User` header pass-through).
- Drop `knex` from `apps/api/package.json:44`. Verify no other consumer (`grep -rn "from 'knex'\|require('knex')" apps/api/src`).
- Remove the `/longhaul/*` wildcard from `apps/api/src/handlers/onprem.ts:98` (or keep it as a 404 sentinel — judgment call; deletion is cleaner). With longhaul fully migrated, the on-prem proxy serves no one.
- The on-prem Hono server now only serves pegii/efwk. Open question: kill the on-prem server entirely (and revisit pegii's fate then), or keep it running for any on-prem-local consumers. Defer to a separate plan.

## Critical files

- `apps/api/src/handlers/onprem.ts` — wildcard proxy fallback; **do not modify** until Phase 5. Hono mount precedence does the routing for free.
- `apps/api/src/app.ts` — where new cloud-side specific routes mount. Reference: `app.ts:204` already mounts `onpremHandler` under `/api/v1/onprem`; new specific routes mount alongside.
- `apps/api/src/lib/mssql.ts` — existing `getPool(tenantId)` is the connection pool entry point for both pegii (today) and migrated longhaul (going forward). Reuse, don't fork.
- `apps/api/src/handlers/pegii/middleware.ts:7-31` — reference pattern for attaching the MSSQL pool to Hono context. Cloud-side longhaul handlers should use the same shape (or just call `getPool(tenantId)` directly inside the handler if middleware adds nothing).
- `apps/api/src/handlers/longhaul/` and `apps/api/src/repositories/longhaul/` — source of truth for current behavior. Read, don't copy. Each migration authors fresh raw SQL.
- `apps/api/src/handlers/longhaul-cloud/` — new directory for cloud-side handlers. Keeps the to-be-deleted on-prem tree visually separate.
- `apps/api/package.json:44` — `knex` dep; deleted in Phase 5.
- `apps/e2e/tests/` — where migration e2e specs land. Tests run against real MSSQL via the existing global-setup.

## Existing utilities to reuse

- `getPool(tenantId)` (`apps/api/src/lib/mssql.ts`) — per-tenant `mssql` ConnectionPool with caching.
- `mssqlMiddleware` (`apps/api/src/handlers/pegii/middleware.ts:7-31`) — pattern for attaching pool to Hono context; copy verbatim or call `getPool` inline.
- `mssql.Request().input(name, type, value).query(sql)` — parameter-binding pattern, used throughout `apps/api/src/repositories/pegii/generic.repository.ts`. Adopt for every migrated endpoint.
- `closeAllPools` (`apps/api/src/lib/mssql.ts` → wired in `apps/api/src/server.ts:22`) — shutdown hook; nothing to add, just keep it intact.

## Verification

**Phase 0:**

- One real tenant: `SELECT 1` from cloud Lambda succeeds.
- Cold latency and warm latency recorded in PR description.
- Per-endpoint P95 budget set based on Phase 0 numbers.

**Per migration (Phases 1, 3, 4):**

- Unit tests pass (handler + mocked pool).
- E2E test passes against real MSSQL.
- Round-trip count for the new handler ≤ documented target (asserted in e2e via a counting wrapper or MSSQL profiler).
- Manual smoke: cloud endpoint returns expected data; un-migrated peer endpoints still flow through the proxy unchanged.
- P95 measured in dev meets the per-endpoint budget before merge to main.

**Phase 5:**

- `npm run typecheck` and `npm test -w apps/api` green after deletions.
- `grep -rn "from.*handlers/longhaul[^-]\|from.*repositories/longhaul\|longhaul-db\|longhaul-user\|from 'knex'" apps/api/src` returns nothing.
- E2E suite green with on-prem `/longhaul/*` no longer reachable.

## Open questions

- **Per-endpoint P95 budget value.** ✅ Resolved by Phase 0 — see "Done target".
- **Pool cache lifetime under Lambda execution context churn.** ✅ Resolved —
  `getPool` pools survive warm reinvocations (Phase 0 results). No fix needed.
- **`mssql` package bundle weight.** ✅ Resolved — already an `apps/api`
  dependency; no cold-start delta of concern.
- **Provisioned concurrency** for the cloud API Lambda — cold connect is
  ~330 ms (handshake) + ~295 ms (first query). Tolerable for a warm-dominated
  Lambda; revisit only if cold-start P99 proves unacceptable in Phase 1.
- **VPC attachment strategy for migrated handlers.** ✅ Resolved (Phase 1) —
  Option B: a dedicated VPC-attached `mssql-executor` Lambda; the main API
  Lambda stays out of the VPC. See `dolas/agents/project/DECISIONS.md`.
- **Tenant connection-string remediation.** Every active tenant's
  `mssqlConnectionString` must be rewritten to overlay-IP + explicit `,1433`
  port + real credentials before its endpoints migrate. Dolios was remediated
  in Phase 1; remaining tenants are Phase 3 entry criteria.
