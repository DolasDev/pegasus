# Longhaul Phase 4 — migrate writes cloud-direct

_Created 2026-05-26. Follows Phase 3 (reads, 14/14 cloud-direct, complete — see
`plans/completed/longhaul-phase3.1-resume.md`). Master plan:
`plans/in-progress/longhaul-strangler-fig-cloud-migration.md` (§ "Phase 4 —
migrate writes")._

_Branch: `main` (per session start). Changes staged locally; not committed/pushed
until explicitly instructed (team workflow)._

## Progress log

- **2026-05-26 — Unit 0 COMPLETE (gate passed).**
  - **Transaction spike — PASSED** against the real QA SQL Server (Dolios E2E
    tenant `b40b082e-…`, `Server=10.200.0.2,1433 / PegNW`) via direct
    `aws lambda invoke` of the QA executor
    (`pegasus-staging-wireguard-MssqlExecutorFn3A798014-aB7HemkBIwU0`, profile
    `dolas-pegasus-staging`):
    - _Commit + trailing SELECT:_ returned `{recordset:[{n:2}], recordsets:[[{n:2}]]}`
      — the `#spike` temp table survived COMMIT and the trailing SELECT's rows
      land in `recordset` / `recordsets[last]`. ✓
    - _Forced error (1/0):_ returned `{ok:false, code:"QUERY_FAILED",
error:"Divide by zero error encountered."}` → `executeSql` throws
      `MssqlExecError(EXECUTOR_QUERY_ERROR)` with the real message. ✓
    - _Rollback proof:_ a follow-up `SELECT @@TRANCOUNT` on the (pooled,
      reused) connection returned `0` — no partial commit, no dangling TRAN. ✓
    - **Conclusion:** the in-SQL transaction strategy (§ "The blocking
      decision") is validated. No executor change needed. Proceed to Unit 1.
  - **Scaffolding:** `lib/longhaul-cloud-user.ts` (`resolveLonghaulUser`, 422/403/
    401/503 parity with `longhaul-user.ts`, M2M `longhaul:write` scope check)
    - `lib/longhaul-cloud-user.test.ts` (10/10 green, mocked executeSql/prisma)
    - `handlers/longhaul-cloud/_write-template.ts` (compiles, not mounted).
      `tsc --noEmit` clean.

- **2026-05-26 — Unit 1 code COMPLETE (awaiting QA reseed + E2E).**
  Single-row writes #1-#4 migrated cloud-direct, mounted ahead of `/onprem`:
  - `handlers/longhaul-cloud/driver-planning-patch.ts` — `PATCH /driver-planning/:driverId`.
    IF-NOT-EXISTS create (mirrors `ensureConfirmedTable`) + IF EXISTS upsert;
    stamps `resolved.code` on `updated_by`.
  - `handlers/longhaul-cloud/shipments-write.ts` — `PATCH /shipments/:id/weight`
    (UPDATE `longhaul_shipment_weight_link`), `PATCH /shipments/:id/shadow`
    (upsert `sales`), `POST /shipments/:id/coverage` (atomic IF EXISTS upsert
    of `longhaul_shipmentcoverage` + trailing SELECT → returns saved row, 201).
  - `lib/longhaul-cloud-write.ts` — `pickColumns`/`assignments`/`valuePlaceholders`
    reproduce knex's "only write provided keys" so omitted optional columns are
    NOT nulled (the shadow E2E sends only `lng_dis_comments`).
  - Unit tests: `driver-planning-patch.test.ts` (5), `shipments-write.test.ts`
    (9) — all green; `tsc` + eslint clean across the api package.
  - **E2E:** existing `@qa-mutating` specs cover #1 (`:389`) and #2 (`:468`).
    Added specs for #3 (weight — write-only assertion; no read-back projection)
    and #4 (coverage — read-back via `packing_coverage`) to `longhaul-qa.spec.ts`.
  - **NOT committed/pushed/deployed.** Awaiting user verify + QA reseed; then
    commit → push (`main` deploy) → wait `completed:success` → run `e2e-qa-longhaul`.

## Goal

Move the longhaul **write** routes off the on-prem proxy
(`/api/v1/onprem/longhaul/*` → tenant on-prem server) to **cloud-direct**
handlers that author SQL and run it via the in-VPC `mssql-executor` Lambda —
the same pattern Phase 3 established for reads. The headline win is **trip
save** (16–18 MSSQL round trips today over the WAN); target ~6–8 (ideally ~2:
one read for current state, one atomic write batch).

Done when every write route below is cloud-direct, atomic where it mutates >1
row/table, and the `@qa-mutating` E2E specs pass against the cloud handlers.

## The blocking decision (resolve in Unit 0 before any write migration)

**The `mssql-executor` has no transaction support** — it runs a single
`request.query()` per invoke (`apps/mssql-executor/src/index.ts:95`), and pools
are shared/keyed by connection string, so a multi-invoke transaction would need
stateful sessions the current design can't give. Writes that touch >1
row/table (trip-save: trip upsert + activity inserts/updates/deletes + summary
recompute) MUST be atomic.

**Recommendation — author the transaction IN SQL, single invoke (no executor
change):** send the whole mutating step as ONE multi-statement batch wrapped in

```sql
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  -- inserts / updates / deletes …
  -- final SELECT … (OUTPUT or re-read) returns the saved entity
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;  -- surfaces as executor ok:false → executeSql throws → handler 500
END CATCH;
```

One `request.query()` = one connection = atomic. `THROW` propagates the real
error (executor already returns `{ ok:false, error }`). This keeps the executor
unchanged and fits the read-then-compute-then-write shape: **RT1** reads current
state (existing trip + activities) via `executeSql`; compute the diff in JS;
**RT2** is the single atomic batch above, returning the saved row via a trailing
`SELECT`. Confirm in Unit 0 that the executor relays `recordsets`/`rowsAffected`
correctly for a batch whose last statement is a `SELECT` after a `COMMIT`
(it should — `mssql` returns the final SELECT's rows).

_Rejected alternative:_ adding `transaction: true` / multi-invoke transactions
to the executor — more code, fights the shared-pool design, and buys nothing the
in-SQL transaction doesn't. Revisit only if a write genuinely cannot be
expressed as one batch.

## Auth / legacy-user context (prerequisite, shared by all units)

The proxy path resolves the acting legacy user via `longhaulUserMiddleware`
(`apps/api/src/middleware/longhaul-user.ts`): Cognito user → `TenantUser.
legacyWindowsUsername` → `v_longhaul_salesman` by `win_username`. Writes use
that user's `code` for audit columns (`created_by_id` / `updated_by_id` /
`modified_by`). The cloud read handlers don't need it; **cloud writes do.**

- Build a small shared helper (e.g. `lib/longhaul-cloud-user.ts`) that, given
  `tenantId` + the Cognito `userId`, resolves the legacy salesman `code` via one
  `executeSql` against `v_longhaul_salesman` (mirroring `getUserByWindowsUsername`
  in `reference.repository.ts`). Return 422 when `legacyWindowsUsername` is
  unmapped, 403 when the legacy user is missing/inactive — matching the proxy.
- Enforce `longhaul:write` scope for the M2M path (the read handlers check
  `longhaul:read`).

## Write-route inventory (all currently proxied; no cloud write handlers exist)

Ordered easiest → hardest. Each maps to an existing `@qa-mutating` E2E spec
where noted (acceptance harness is already written).

| #   | Route                                                       | Source                                              | Shape                                                                 | E2E spec                  |
| --- | ----------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| 1   | `PATCH /driver-planning/:driverId`                          | `driver-planning.ts:41`                             | single-row upsert                                                     | `longhaul-qa.spec.ts:389` |
| 2   | `PATCH /shipments/:id/shadow`                               | `shipments.ts:198`                                  | single-row update (shadow cols)                                       | `:468`                    |
| 3   | `PATCH /shipments/:id/weight`                               | `shipments.ts:159`                                  | single-row update                                                     | — (add)                   |
| 4   | `POST /shipments/:id/coverage`                              | `shipments.ts:132`                                  | upsert into `longhaul_shipmentcoverage`                               | — (add)                   |
| 5   | `POST /trips/:id/notes` + `PATCH …/notes/:id`               | `trips.ts:591,637`                                  | insert / update `TripNotes`                                           | `:520`                    |
| 6   | `POST /activities` + `PATCH /activities/:id`                | `activities.ts:106,46`                              | insert / update activity                                              | `:563`                    |
| 7   | `PATCH /trips/:id/status`                                   | `trips.ts:383`                                      | validated single-row status change                                    | — (add)                   |
| 8   | `PATCH /trips/:id/summary`                                  | `trips.ts:534`                                      | recompute via `updateTripSummaryInfo`                                 | — (add)                   |
| 9   | `POST /trips/:id/cancel`                                    | `trips.ts:478`                                      | status→cancelled (+ guard)                                            | `:414` (tail)             |
| 10  | `POST /shipment-filters` / `PUT …/default` / `DELETE …/:id` | `filter-options.ts:138,214,252`                     | user-pref CRUD                                                        | — (add)                   |
| 11  | `POST /trips` / `PUT /trips/:id` (**trip save**)            | `trips.ts:284,328` → `saveTripLogic` (trips.ts:680) | read + activity diff + multi-table atomic write + summary recompute   | `:414` (POST→GET→cancel)  |
| 12  | `POST /remote/jump-to-order`                                | `remote.ts:10`                                      | check scope — may be on-prem-only navigation; possibly leave on proxy | —                         |

> `saveTripLogic` (trips.ts:680) is the marquee refactor: `findTripById` (read),
> `buildShipmentActivities` auto-fill, add/update/remove activity diff,
> trip-header upsert (`.insert(data, ['id'])` already uses `OUTPUT INSERTED.id`),
> then `updateTripSummaryInfo` recompute. All the mutating parts belong in ONE
> atomic batch (see Unit 0).

## Units (PR-sized, in order)

- **Unit 0 — executor transaction spike + cloud-write scaffolding.** **No route
  migrated yet.** Two parts:

  **(a) Transaction spike (the gating proof).** The mocked-`mssql` unit tests
  CANNOT prove this — transaction semantics are a property of real SQL Server,
  not the mock. Prove it against a real engine, two probes via one `executeSql`
  (one `request.query()`) each:
  - _Commit + trailing SELECT round-trips:_
    ```sql
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRAN;
      CREATE TABLE #spike (n int);
      INSERT INTO #spike VALUES (1),(2);
      COMMIT TRAN;
      SELECT COUNT(*) AS n FROM #spike;   -- expect recordset/recordsets[last] = [{ n: 2 }]
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW;
    END CATCH;
    ```
    Confirm `executeSql` resolves and the trailing SELECT's rows are in
    `recordset` / `recordsets[last]` (a real temp table survives COMMIT; a table
    _variable_ would not, so use `#spike`).
  - _Error rolls back + surfaces:_
    ```sql
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRAN;
      CREATE TABLE #spike (n int);
      INSERT INTO #spike VALUES (1);
      SELECT 1/0 AS boom;               -- forced error
      COMMIT TRAN;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW;
    END CATCH;
    ```
    Confirm `executeSql` THROWS `MssqlExecError(EXECUTOR_QUERY_ERROR)` carrying
    the real message ("Divide by zero error encountered.") and `@@TRANCOUNT`
    returned to 0 (no partial commit).

  **How to run the probe** (pick one):
  - _Preferred — against the QA executor:_ invoke the executor Lambda directly
    with `aws lambda invoke` using an **invoke-capable** profile —
    `dolas-pegasus-staging` (Admin, acct 248812875460); the `-ro` profile can't
    invoke. Function:
    `pegasus-staging-wireguard-MssqlExecutorFn3A798014-aB7HemkBIwU0`. Payload:
    `{ "connectionString": "<QA tenant mssqlConnectionString from the Neon tenants table>", "sql": "<probe>" }`.
    The probes use only `#temp` tables, so they touch no real data — safe even
    without a reseed.
  - _Alternative — local SQL Server:_ stand up `mcr.microsoft.com/mssql/server`
    in Docker and point a local `executeSql` at it. Heavier (the repo's e2e uses
    Postgres only) but keeps it off AWS.

  **(b) Scaffolding.** Add `lib/longhaul-cloud-user.ts` exporting something like
  `resolveLonghaulUser(tenantId, userId): Promise<{ code: number } | …>` — port
  `getUserByWindowsUsername` (reference.repository.ts) to an `executeSql` query
  against `v_longhaul_salesman`, with the 422 (unmapped `legacyWindowsUsername`)
  / 403 (missing/inactive legacy user) parity from `longhaul-user.ts`. Plus a
  thin cloud-write handler template (validate → resolve user → executeSql →
  return) for Units 1–5 to copy.

  **Acceptance:** both probes behave as specified (documented in the PR/commit),
  the user helper has a unit test (mocked `executeSql`), and the template
  compiles + typechecks. If a probe fails, STOP — the in-SQL transaction
  assumption is wrong and the whole phase's atomicity strategy must be
  reconsidered before Unit 1.

- **Unit 1 — simple single-row writes (#1–#4).** driver-planning, shipment
  shadow/weight/coverage. Establishes the cloud-write pattern (validate →
  resolve user → single parameterized statement → return). Mount each ahead of
  the `/onprem` wildcard, same as reads.
- **Unit 2 — notes + activities (#5–#6).** Insert/update with `OUTPUT` to return
  the written row (the Phase 3 lesson: assert the written row is in the
  response, not just shape).
- **Unit 3 — trip status / summary / cancel (#7–#9).** Port the validation
  guards from `trips.ts` (driver-assigned gate, finalize-requires-actual-dates,
  no-driver-change-on-in-progress).
- **Unit 4 — shipment-filter CRUD (#10).** User-pref writes; low risk.
- **Unit 5 — TRIP SAVE (#11).** The whole point. RT1 read current state; JS
  diff (reuse `buildShipmentActivities`, `sameSlot` logic — consider extracting
  the pure diff from `saveTripLogic` so both on-prem and cloud share it); RT2
  one atomic batch (trip upsert + batched activity insert/update/delete +
  summary recompute + trailing SELECT of the saved trip). Port every guard.
  Measure round trips + P95 against the master-plan budget (~300–400 ms @ 50 ms
  WAN).
- **Unit 6 — remote/jump-to-order (#12).** Decide migrate vs leave-on-proxy.

## Per-route migration checklist (mirror Phase 3 reads)

1. New handler in `apps/api/src/handlers/longhaul-cloud/<name>.ts`; author
   parameterized SQL (named `@params` via `executeSql`'s `params`).
2. Resolve legacy user + tenant connection string up front; 422/403 parity.
3. Mutating step is atomic (single statement, or the in-SQL transaction batch).
4. Optional/absent tables soft-fail to `[]`/`null` — **the Phase 3.1 lesson**
   (`pegasus_extra_location`): never let an optional table abort a batch. Audit
   each write's tables for this.
5. Unit test mocking `executeSql` (happy path + a rejected/`ok:false` path).
6. Re-mount in `app.ts` ahead of `v1.route('/onprem', onpremHandler)`; Hono
   route precedence does the routing.
7. Deploy (push to `main` = staging/QA + prod; `api` filter already covers
   `apps/mssql-executor/**`). **Wait for `completed:success` before E2E.**
8. **Reseed the QA planning DB** (manual snapshot restore — the `reseed_note`
   workflow input is only a reminder, it does NOT reseed), then run
   `e2e-qa-longhaul`; confirm the route's `@qa-mutating` spec green.

## Risks / open questions

- **Atomicity** — the gating item; settle in Unit 0.
- **`OUTPUT` + triggers:** if any target table has an `INSTEAD OF`/`AFTER`
  trigger, `OUTPUT` without `INTO` errors. Verify on the QA schema before relying
  on `OUTPUT`; fall back to re-read inside the same transaction if needed.
- **Audit columns / windows-user parity:** writes must stamp the same
  `created_by`/`modified_by` the proxy does, or reports diverge.
- **Idempotency / double-submit** on POST create — the on-prem behavior is the
  contract; match it.
- **Decommission (Phase 5)** is gated on this phase: only after the last write
  migrates can `handlers/longhaul/`, `repositories/longhaul/`, `longhaul-db.ts`,
  `longhaul-user.ts`, `knex`, and the `/onprem` wildcard be removed.

## Verification & process notes (carried from Phase 3.1)

- QA == the `staging` deploy (`packages/infra/bin/app.ts:81` →
  `pegasus-qa.dolas.dev`). One push to `main` deploys what the QA E2E hits.
- Don't run `e2e-qa-longhaul` while a deploy to that env is in flight (500/
  timeout flakes). Reseed before a full `@qa-mutating` run; don't chain runs.
- QA/staging CloudWatch: profile `dolas-pegasus-staging-ro` (acct 248812875460),
  `dolas` SSO session. Executor errors log as `mssql_exec_failed` with the real
  SQL message — the fastest root-cause path when a write 500s.
- A mock-based unit test cannot prove the SQL works against the real schema
  (the Phase 3.1 500 hid behind a green mock). Each unit's real proof is its
  `@qa-mutating` E2E spec.
