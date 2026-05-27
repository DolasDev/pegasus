# Longhaul Phase 4 — migrate writes cloud-direct

_Created 2026-05-26. Follows Phase 3 (reads, 14/14 cloud-direct, complete — see
`plans/completed/longhaul-phase3.1-resume.md`). Master plan:
`plans/in-progress/longhaul-strangler-fig-cloud-migration.md` (§ "Phase 4 —
migrate writes")._

_Branch: `main` (per session start). Changes staged locally; not committed/pushed
until explicitly instructed (team workflow)._

---

## ▶ RESUME HERE (updated 2026-05-27)

**Status: Phase 4 COMPLETE. Units 0–5 migrated & E2E-verified on `main`
(deployed to QA + prod); Unit 6 resolved as leave-on-proxy (no migration —
not a DB write). Next: Phase 5 decommission (separate effort, partial).**

Migrated cloud-direct (all behind the `/onprem` wildcard via Hono
precedence): driver-planning PATCH, shipment shadow + coverage, trip notes
(POST/PATCH), activity save (POST /activities/:id), trip status/cancel/summary,
shipment-filter CRUD, and **trip save (POST /trips + PUT /trips/:id)** — the
16–18-round-trip WAN write, now 2 round trips. Commits: a2feae5, 4495d11,
a5f1d9a, 6435b5f, 630c180, 4dbeea9, cdd53ea, 45e014f.

**Left on the proxy deliberately (not bugs):**

- `POST /remote/jump-to-order` (Unit 6, #12) — **not a DB write.** See the
  2026-05-27 Unit 6 log entry below; it's a WinForms native-IPC navigation
  shell-out (501 stub), and the UI doesn't even call it (client-side stub).
- `PATCH /shipments/:id/weight` — dead route, no UI caller, on-prem broken vs
  the real `longhaul_shipment_weight_link` schema (no scalar `weight` column).
- `POST /activities` (create, no `:id`) — no UI caller; creation happens inside
  trip-save.

### Next: Phase 5 — decommission (separate effort, gated on Phase 4 — now PARTIAL)

Phase 4 migrated every cloud-reachable longhaul **DB write** off the proxy. But
`POST /remote/jump-to-order` legitimately stays on the proxy (Windows-only
desktop navigation, no cloud equivalent), so the on-prem proxy path must stay:
**the `/onprem` wildcard + `handlers/onprem.ts` + tunnel infra + the on-prem
server's `handlers/longhaul/remote.ts` CANNOT be removed.** Decommission is
therefore partial — the cloud Lambda's own longhaul read/write code is fully
self-sufficient for everything except jump-to-order, but the proxy pipe remains
for that single feature until a cloud-native order-navigation story exists.
What _can_ still be retired safely (none of it is hit anymore for migrated
routes): the unused on-prem write paths the migrated routes superseded. Scope
this carefully in the Phase 5 plan — don't assume "remove everything."

### How to ship a unit (the established loop)

1. Build handler + unit tests; `cd apps/api && npx tsc --noEmit && npx vitest run <files> && npx eslint <files>`; `cd apps/e2e && npx tsc --noEmit`.
2. **Pre-verify schema via the executor** before writing SQL (this caught the
   weight + `idc_break` bugs). Probe pattern: `aws lambda invoke` the QA executor
   with `{connectionString, sql}`.
3. Pause for the user to **reseed** the QA planning DB + review.
4. On their go: commit only this unit's files (`git reset -q -- .` then
   `git add <files>`), push `main` (pre-push runs `turbo typecheck test`;
   auto-deploys QA **and prod**).
5. Watch deploy: `gh run watch <id> --exit-status`; wait `success`.
6. `gh workflow run e2e-qa-longhaul.yml`; watch; confirm the unit's `@qa-mutating`
   specs green. On a 500, CloudWatch `mssql_exec_failed` has the real SQL error.

### Environment / handles (verify AWS SSO not expired — re-auth rolls daily)

- Re-auth: `aws sso login --sso-session dolas --use-device-code` (interactive —
  ask the user to run via `! …`).
- QA executor fn: `pegasus-staging-wireguard-MssqlExecutorFn3A798014-aB7HemkBIwU0`
  (region us-east-1). Invoke profile: `dolas-pegasus-staging` (Admin, 248812875460).
  Read-only/CloudWatch: `dolas-pegasus-staging-ro`.
- QA tenant MSSQL conn string lives in the QA Neon `tenants` table (Dolios E2E
  tenant `b40b082e-1932-4182-a081-47b7df363276`, `Server=10.200.0.2,1433 / PegNW`).
  QA `DATABASE_URL` is on the staging API Lambda env (read via `aws lambda
get-function-configuration`). Cached locally at `/tmp/qa_mssql.txt` this session
  (regenerate next session).
- Shared cloud-write libs already built and reusable: `lib/longhaul-cloud-user.ts`
  (`resolveLonghaulUser`), `lib/longhaul-cloud-write.ts` (`pickColumns`/
  `assignments`/`valuePlaceholders`), `lib/longhaul-cloud-trip-summary.ts`
  (`computeTripSummary` w/ `superVipField` option, `recomputeTripSummaryCloud`),
  `lib/longhaul-filter-query-transform.ts`, `lib/longhaul-trip-save.ts`.

---

## Progress log

- **2026-05-26 — Unit 0 COMPLETE (gate passed).**
  - **Transaction spike — PASSED** against the real QA SQL Server (Dolios E2E
    tenant `b40b082e-…`, `Server=10.200.0.2,1433 / PegNW`) via direct
    `aws lambda invoke` of the QA executor
    (`pegasus-staging-wireguard-MssqlExecutorFn3A798014-aB7HemkBIwU0`, profile
    `dolas-pegasus-staging`): - _Commit + trailing SELECT:_ returned `{recordset:[{n:2}], recordsets:[[{n:2}]]}`
    — the `#spike` temp table survived COMMIT and the trailing SELECT's rows
    land in `recordset` / `recordsets[last]`. ✓ - _Forced error (1/0):_ returned `{ok:false, code:"QUERY_FAILED",
error:"Divide by zero error encountered."}` → `executeSql` throws
    `MssqlExecError(EXECUTOR_QUERY_ERROR)` with the real message. ✓ - _Rollback proof:_ a follow-up `SELECT @@TRANCOUNT` on the (pooled,
    reused) connection returned `0` — no partial commit, no dangling TRAN. ✓ - **Conclusion:** the in-SQL transaction strategy (§ "The blocking
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
  - Committed (a2feae5 Unit0, 4495d11 Unit1), pushed → deploy 26468194928
    `completed:success` → E2E run 26468674886.

- **2026-05-26 — Unit 1 E2E results + fixes (run 26468674886).**
  - ✅ #1 driver-planning (`:389`) and ✅ #2 shadow (`:468`) PASS cloud-direct
    against the real QA schema. (Browser flakes #48/#62 passed on retry — the
    known pre-existing flakes, not ours.)
  - ✘ #3 weight + ✘ #4 coverage 500'd. CloudWatch (`mssql_exec_failed`) gave the
    real cause:
    - **weight:** `Invalid column name 'updated_at'`. Schema check:
      `longhaul_shipment_weight_link` = (id, order_num, survey_weight_id,
      initial_weight_id, billable_weight_id, reweight_id) — NO scalar `weight`,
      NO `updated_at`. The on-prem `patchWeight` is **broken against the real
      schema** and **no tenant-web caller invokes the route**. → DROPPED from
      the migration; left on the proxy untouched. Removed handler/route/spec.
    - **coverage:** `Cannot insert NULL into 'created_by_id'` (NOT NULL, no
      default). Handler is faithful (on-prem fails identically); the UI always
      sends `created_by_id` (`…created_by_id || user.code`). → fixed the **E2E
      spec** to send `created_by_id: me.code`. Handler unchanged.
  - Re-verify pending: 11 unit tests green, tsc/eslint clean. Re-deploy + re-run
    e2e for #4 coverage (and #1/#2 regression).
  - **Unit 1 final scope:** #1 driver-planning, #2 shadow, #4 coverage migrated;
    #3 weight deferred (dead route).

- **2026-05-26 — Unit 1 COMPLETE ✅ (verified, run 26470971180).**
  Commit a5f1d9a deployed (26469491200 `success`). Full e2e-qa-longhaul run
  GREEN — all three migrated specs pass cloud-direct against the real schema:
  #1 driver-planning (`:389`), #2 shadow (`:468`), #4 coverage (`:524`).
  Next: Unit 2 — notes + activities (#5-#6).

- **2026-05-26 — Unit 2 code COMPLETE (awaiting verify + E2E).**
  Notes + activity-save migrated cloud-direct (schemas pre-verified via executor
  probes to avoid a 500 cycle):
  - `lib/longhaul-cloud-trip-summary.ts` — `computeTripSummary` (pure) +
    `recomputeTripSummaryCloud` (read activities → read shipments → UPDATE
    TripMaster). Reusable by Units 3 + 5. Faithfully replicates on-prem quirks:
    `v_longhaul_shipments_v2` exposes `vip`/`total_est_wt`/`line_haul` but NOT
    `total_actual_wt`/`supervip`/state objects, so those roll up to 0/null.
  - `handlers/longhaul-cloud/trip-notes.ts` — `POST /trips/:id/notes` (INSERT
    TripNotes, createdBy = resolved code ?? 0) + `PATCH /notes/:id` (UPDATE by
    tripId+id).
  - `handlers/longhaul-cloud/activities-write.ts` — `POST /activities/:id`
    (saveActivity): RT1 read prev TripMaster_id, RT2 dynamic UPDATE + audit,
    then recompute summary for next+prev trip (Set-dedup). 404 if missing.
  - **POST /activities (CREATE) NOT migrated** — no tenant-web caller (creation
    is server-side in trip-save); left on the proxy.
  - Mounted in app.ts ahead of `/onprem`. Unit tests: summary (3), notes (8),
    activity-save (5) — all green; tsc + eslint clean.
  - **E2E:** notes covered by `:589`. Extended the activities spec (`:618`) to
    exercise `POST /activities/:id` (edit a generated activity's city →
    recompute → verify via GET /trips/:id).
  - Triggers note: activity UPDATE has no OUTPUT clause, so the table's enabled
    triggers don't bite (the OUTPUT-without-INTO constraint only affects the
    create path, which we didn't migrate).
  - **Not committed.** Awaiting user verify + reseed → commit/push/deploy/E2E.

- **2026-05-26 — Unit 2 COMPLETE ✅ (verified, run 26472798306).**
  Commit 6435b5f deployed (deploy `success`). Full e2e-qa-longhaul GREEN:
  #5 notes (`:575` POST + PATCH), #6 activity-save (`:618` now exercises
  `POST /activities/:id` → summary recompute → city verified via GET /trips/:id).
  `recomputeTripSummaryCloud` proven against the real schema. Next: Unit 3 —
  trip status / summary / cancel (#7-#9).

- **2026-05-26 — Unit 3 code COMPLETE (awaiting verify + E2E).**
  `handlers/longhaul-cloud/trips-write.ts` (status/cancel/summary), mounted ahead
  of `/onprem`. Schemas pre-verified via executor probes.
  - **#7 PATCH /trips/:id/status** — RT1 reads header + activity actual_dates +
    status name in one 3-statement batch; ports all 3 guards (404; 403 advance-
    past-pending-without-driver; 403 finalize-without-actual-dates); RT2 is ONE
    atomic batch (UPDATE TripMaster.TripStatus_id + UPDATE activities' status,
    in-SQL TRAN) with a trailing SELECT returning the re-read trip.
  - **#9 POST /trips/:id/cancel** — 404 + 403 (status_id>=4 == TripStatus_id);
    atomic batch: touch + DELETE activities, set internal_status='canceled'.
  - **#8 PATCH /trips/:id/summary** — RECOMPUTES via recomputeTripSummaryCloud.
    Resolution of the earlier discrepancy: checked the ORIGINAL backend per user
    direction. The legacy fn is `updateTripSummaryInfo` (the recompute; mapping
    in dolas-modules-migration.md:185) and the UI calls it on trip-detail load
    to refresh the roll-up before display (Trip/index.tsx:43 — "await
    updateTripSummaryInfo(id); fetchTrip(id)"). The on-prem port wired the wrong
    repo fn (`updateTripSummary`, a direct field write) — a porting bug. We
    follow the original recompute behavior, not the bug.
  - Unit tests: trips-write.test.ts (10) green; tsc + eslint clean.
  - **E2E:** cancel (#9) already covered by `:414`. Added a status (#7) +
    summary (#8) spec: create driver-assigned trip → PATCH status 2 → verify
    TripStatus_id → PATCH summary {} → cancel cleanup.
  - Committed 630c180, deployed `success`, E2E run 26474... → #7/#8 spec failed
    (403). Root cause: TEST DATA, not the handler — the handler correctly blocked
    advancing a trip with no driver. saveTripLogic derives driver_id from
    `driver.id`/top-level `driver_id`, but GET /drivers returns `driver_id`, so
    the created trip had a null driver. Fixed the spec to send `driver_id` +
    `driver.id`. Cancel (#9, `:414`) + all Unit 1/2 regressions stayed green.
  - **E2E spec fix pushed (e2e-only, no redeploy); re-run pending.**

- **2026-05-26 — Unit 3 COMPLETE ✅ (verified).** Spec fix 4dbeea9; full
  e2e-qa-longhaul GREEN. #7 status (`:692`), #8 summary-recompute (`:692`), #9
  cancel (`:414`) all pass cloud-direct. Next: Unit 4 — shipment-filter CRUD.

- **2026-05-26 — Unit 4 code COMPLETE (awaiting verify + E2E).**
  `handlers/longhaul-cloud/shipment-filters-write.ts` (POST/PUT-default/DELETE),
  mounted ahead of `/onprem`. Schemas pre-verified (filter table has no triggers
  → OUTPUT INSERTED.\* safe).
  - **POST /shipment-filters** — INSERT longhaul_shipment_filter OUTPUT
    INSERTED.\* (owner_code = BODY user_code, faithful; name trimmed; query date
    fields → day offsets via new lib/longhaul-filter-query-transform.ts). If
    is_default, upsert longhaul_user_preferences.
  - **PUT /shipment-filters/default** — upsert prefs keyed by resolved code;
    403 when no legacy user (proxy parity).
  - **DELETE /shipment-filters/:id** — DELETE by filter_id.
  - lib/longhaul-filter-query-transform.ts holds the forward (dates→offsets)
    transform, ported verbatim from filter-options.ts. (Read handlers keep their
    inline inverse copy — left untouched to avoid scope creep.)
  - Unit tests: shipment-filters-write.test.ts (10) green; tsc + eslint clean.
  - **E2E:** added a CRUD round-trip spec (POST → appears in list → set default
    → read-back → DELETE → gone).
  - **Not committed.** Awaiting user verify + reseed.

- **2026-05-27 — Unit 4 COMPLETE ✅ (verified).** Commit cdd53ea deployed
  `success`; full e2e-qa-longhaul GREEN incl. the CRUD round-trip (`:754`).
  POST/PUT-default/DELETE all cloud-direct. Next: Unit 5 — TRIP SAVE (#11), the
  marquee refactor.

- **2026-05-27 — Unit 5 code COMPLETE (awaiting AWS re-auth + verify + E2E).**
  TRIP SAVE migrated cloud-direct — 2 round trips (was 16-18 on the WAN):
  - `lib/longhaul-trip-save.ts` — pure `computeTripSavePlan`: buildShipmentActivities
    auto-fill + sameSlot add/update/remove diff + guards (driver-change-on-in-
    progress, remove-with-actual-date) + dispatcher cascade + trip-row upsert.
    Activity writes restricted to real columns (ACTIVITY_COLUMNS) so joined
    aliases can't leak (safe refinement over on-prem).
  - `handlers/longhaul-cloud/trip-save.ts` — POST /trips + PUT /trips/:id.
    RT1 reads existing trip+activities (update) + shipment summary fields;
    JS diff + computeTripSummary (reused from Unit 2); RT2 ONE in-SQL
    transaction (trip upsert via SCOPE_IDENTITY/UPDATE → dispatcher shadow
    cascade → DELETE removed → INSERT added → UPDATE changed → summary UPDATE →
    COMMIT → trailing SELECT). Dynamic statement builder (variable activity
    counts) with indexed params.
  - Response = re-read TripMaster header (UI only consumes `.id`).
  - Unit tests: longhaul-trip-save.test.ts (8 pure-diff) + trip-save.test.ts
    (6 handler) green; tsc + eslint clean.
  - **E2E:** no new spec needed — existing POST /trips specs (`:414`, `:618`,
    `:692`) + browser trip-save/edit specs (`:189`, `:127`) will now exercise the
    CLOUD handler (create + update/remove diff). Strongest possible proof: the
    same specs that passed on the proxy must pass on cloud.
  - **Schema verified (post re-auth):** all 24 TripMaster TRIP_COLUMNS present;
    TripMaster has 1 trigger → we use SCOPE_IDENTITY (not OUTPUT), which is
    trigger-safe and returns the correct scope's id. **`idc_break` DOES exist on
    the view** (earlier "absent" reading was the stale-file blip). So the
    summary is NOT equivalent: saveTripLogic counts super-VIPs via `idc_break`,
    while updateTripSummaryInfo (Unit 2/3) uses `supervip`. FIXED:
    `computeTripSummary` now takes `{ superVipField }` (default `supervip`);
    trip-save passes `idc_break` and selects it in RT1. Units 2/3 unchanged.
    34 unit tests green, tsc + eslint clean.

- **2026-05-27 — Unit 5 COMPLETE ✅ (verified).** Commit 45e014f deployed
  `success`; full e2e-qa-longhaul GREEN. Trip save proven cloud-direct on BOTH
  paths: create (`:414`, `:618`, browser `:189`) and update/activity-diff
  (browser `:127`); no-shipments 403 (`:371`). The schema pre-check caught the
  `idc_break` summary bug mocks couldn't. Round trips: 16-18 → 2. Next: Unit 6 —
  remote/jump-to-order (migrate vs leave-on-proxy).

- **2026-05-27 — Unit 6 RESOLVED: leave-on-proxy (no migration). PHASE 4 COMPLETE.**
  Decision confirmed by reading the source, not just the hypothesis:
  - **`apps/api/src/handlers/longhaul/remote.ts:10`** (the on-prem server's
    handler, reached via the `/onprem` proxy pipe) authors **no MSSQL**. It
    returns 501 `NOT_IMPLEMENTED` on non-Windows, and on `win32` it's an
    unimplemented native-IPC placeholder ("implement native IPC call here when
    needed"). It is a WinForms desktop navigation shell-out, not a
    cloud-reachable DB write — so there is nothing to author cloud-direct.
  - **The UI never calls it.** `jumpToOrder` (`apps/tenant-web/src/features/
driver-planning/utils/api/index.ts:81`) is stubbed client-side: it logs a
    warn and `notifyError(...)` ("not yet supported in the cloud … future
    phase") and **never issues the HTTP request.** The `resolveRoute`
    `'pegasusRemoteFunctionCall' → POST /remote/jump-to-order` mapping
    (`routes.ts:106`) exists but is dead from the UI's side.
  - **Conclusion:** Unit 6 = documented no-op. Nothing to migrate, no E2E spec
    to add (`#12` was always `—` for E2E). Phase 4's mandate — move every
    cloud-reachable longhaul **write** off the on-prem proxy — is satisfied.
  - **Phase 5 consequence:** the `/onprem` wildcard + `handlers/onprem.ts` +
    tunnel infra + on-prem `remote.ts` must STAY for jump-to-order. Decommission
    is partial (see RESUME HERE).
  - No code change, no commit, no deploy this unit — plan doc update only.

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
