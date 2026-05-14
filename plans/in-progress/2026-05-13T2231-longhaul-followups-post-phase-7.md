# Longhaul follow-ups — post Phase 7 (resume target)

**Branch:** `main` (all session work is merged, deployed, CI-green).
**Resume with:** `execute plan 2026-05-13T2231-longhaul-followups-post-phase-7`

Read first (so we don't repeat context):

- Memory: `~/.claude/projects/-home-steve-repos-pegasus/memory/project_longhaul_qa_e2e.md` — full session log incl. the staged pivot, Phase 7 triage, and the Workflow WIP commit.
- Triage doc: `plans/todo/longhaul-qa-mutating-triage.md` — verdicts + revised verdicts for every `@qa-mutating` spec.
- Prior session plan (archived): `plans/completed/2026-05-13T1126-longhaul-qa-e2e-completion.md`.
- In-Progress driver-lock backlog item: `plans/todo/longhaul-in-progress-driver-lock.md`.

---

## Status snapshot (end of 2026-05-13)

Everything from the 2026-05-13 staged pivot and Phase 7 triage is merged and pushed. Final commits ascending from `ce0740c`:

| Commit    | What                                                                        |
| --------- | --------------------------------------------------------------------------- |
| `88ee74a` | E2E reload-retry for `trips:23` / `shipments:32`                            |
| `6647210` | Expo SDK 55 patch bumps (unblocked pre-push)                                |
| `e9d254e` | Dropped In-Progress driver-lock fixme + backlog item                        |
| `81db3fd` | Extracted 7 utilities from `Trip/index.tsx` + 39 unit tests                 |
| `0c409ee` | Handler tests for `driver-planning.ts` + `remote.ts`                        |
| `dcbb4cf` | Extracted `fetchAndReshape` from `API.fetchShipments`                       |
| `0a539a4` | Container tests: `ShipmentDetail` + `Shipments`                             |
| `f73a13c` | tsc fix for the missing-user test case                                      |
| `20ac206` | Redux array-coercion dedupe (`coerceListPayload`)                           |
| `951b9ab` | Bumped 4 deprecated GitHub Actions off Node 20                              |
| `063477f` | Reload-retry lifted into beforeEach + 2 more polls                          |
| `582bfa5` | Phase 7a+7b — drop status-change spec + 3 container replacements            |
| `180ae63` | Phase 7c+d+e — qa-api round-trips + new notes spec + browser save→itinerary |
| `1619e94` | Register Workflow in TENANT_SCOPED_MODELS                                   |
| `8a14977` | feat: Workflow feature (CRUD + cedar authz + admin-web wiring)              |
| `5cfea00` | fix(api): on-prem longhaul trip-save 500 — Knex+mssql IDENTITY + triggers   |
| `65ae35f` | test(longhaul-qa): un-fixme the 3 trip-save specs unblocked by `5cfea00`    |
| `caf7830` | fix(e2e): stop double-reading response body in longhaul-qa trip tests       |
| `397eb5d` | fix(e2e): un-fixme'd browser specs — type-to-open + on-prem skip-gate       |
| `1db2fd5` | fix(e2e): also soft-skip openFirstTrip when the Trips list never mounts     |
| `282d671` | fix(e2e): add reload-retry to openFirstTrip — mirror trips.spec.ts pattern  |
| `22f6c74` | fix(e2e): wait on Trips shell sentinel, not the data-dependent laneTitle    |

Test counts: driver-planning vitest **604** (was 528 at session start). All 8 longhaul handlers tested (80 cases). E2E `--grep-invert "@qa-mutating"` verified clean on QA (11/0, 1.2 min). `e2e-qa-longhaul.yml` ran green via `workflow_dispatch` (run `25823001497`, 4m26s).

---

## What's left

### A — Verify the new `@qa-mutating` round-trips on a reseed pass _— DONE 2026-05-14 (run `25886270089` green)_

**Status: closed.** After the on-prem fix landed, `workflow_dispatch` run `25884843787` exposed two follow-on spec-level bugs (not product bugs):

1. `longhaul-qa.spec.ts` POST /trips and POST /activities — the body-read pattern `expect(res.status, await res.text()).toBe(201)` consumed the response body before `(await res.json()).data ?? (await res.json())`, throwing `TypeError: Body is unusable`. Fix: read body once, parse from captured text. (Commit `caf7830`.)
2. `planning.spec.ts:177` — Downshift only opens the menu on input-value change, not focus; `click()`-only left the option list empty. Fix: mirror the passing typeahead spec — `click()`, `fill('a')`, waitFor, skip-gate on `/drivers` 503. (Commit `397eb5d`.)
3. `trip-detail.spec.ts:34` (`@smoke`) — un-fixme'd transitively when the Trips list filled out. Tracer of the failing run showed `/trips/:id` never fired and the detail body never mounted — same on-prem flake other specs in this suite already skip on. Fix: push the gate into `openFirstTrip()` — wait on the back-to-trips button (only renders inside `{trip && (...)}` once fetchTrip resolves), skip if it never appears. Real gantt-missing on a loaded trip still fails loud. (Commit `397eb5d`.)

**Acceptance met:** `e2e-qa-longhaul.yml` `workflow_dispatch` run `25886270089` exits green — 41 pass, 4 skip, 0 fail (4.2 min). The 3 unblocked `@qa-mutating` specs (qa-api POST /trips→cancel, qa-api POST /activities, browser save→itinerary) all PASS where their on-prem preconditions hold.

#### Original "ON-PREM RESOLUTION" notes — kept for context

**On-prem defect diagnosed and fixed (commits `5cfea00` + `65ae35f`).** Reproduced locally against the
Dolios MSSQL host (DOLAB-M70Q-1), grepped the actual service err log, found
two Knex+mssql bugs in the longhaul repository inserts:

1. `saveTrip`, `insertActivity`, `saveSearchFilter`, and `insertOrUpdateShipmentCoverage`
   used bare `.insert(data)` and read `result[0]` for the new IDENTITY. Knex's
   mssql driver returns rowsAffected from bare `.insert()`, not the IDENTITY —
   so `newId` was `undefined` and the read-back `.where('id', undefined).first()`
   threw `Undefined binding(s) detected when compiling FIRST. Undefined column(s): [id]`.
   Fix: pass `['id']` (or `['filter_id']`) as the 2nd arg so Knex emits
   `OUTPUT INSERTED.id` and resolves to `[{id: <new>}]`.
2. `LongDistanceDispatchActivity` has enabled INSERT/UPDATE/DELETE triggers, so
   even with the `OUTPUT INSERTED.id` clause it failed with "the target table
   cannot have any enabled triggers if the statement contains an OUTPUT clause
   without INTO clause." Fix: `{ includeTriggerModifications: true }` as the
   3rd arg to `insertActivity`, which rewrites OUTPUT to use a table variable.

Local verification (commit pending): POST /trips → 201 with trip id 15645,
auto-generated LOAD + RDEL activities; POST /trips/:id/cancel → 200, trip
`internal_status` flips to `canceled`, activities cleared. All 1041 api unit
tests still pass. Specs un-fixme'd:

- `longhaul-qa.spec.ts:199` POST /trips → GET → cancel
- `longhaul-qa.spec.ts:354` POST /activities (via trip-create)
- `planning.spec.ts:177` browser save→itinerary

**Acceptance still pending:** a fresh `e2e-qa-longhaul.yml workflow_dispatch`
run that exits green with the 3 un-fixme'd specs PASSING (not just skipped).
The on-prem service on `DOLAB-M70Q-1` has already been restarted with the new
dist (the cloud Lambda needs no behavioural change — onprem.ts is a pass-through
proxy).

#### Original "ON-PREM DIAGNOSIS PENDING" notes — kept for context

Workflow run `25839871338` (commit `cda3a82`) on the reseeded QA exit-status'd
green (41 pass / 6 skip / 0 fail), but 3 of those "skips" are `test.fixme`'d
specs covering real product flows:

| Spec                                                           | State                                                                   | Reason                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `longhaul-qa.spec.ts` POST /trips/:id/notes → PATCH /notes/:id | ✓ PASS                                                                  | —                                                                        |
| `longhaul-qa.spec.ts` PATCH /shipments/:id/shadow round-trip   | ✓ PASS (after the `lng_dis_comments` flat-key + body `order_num` fixes) | —                                                                        |
| `longhaul-qa.spec.ts:199` POST /trips → GET → cancel           | ✘ fixme                                                                 | Legacy Dolios POST `/longhaul/trips` returns opaque `500 INTERNAL_ERROR` |
| `longhaul-qa.spec.ts:359` POST /activities                     | ✘ fixme                                                                 | Inherits the trip-create 500 (creates a parent trip first)               |
| `planning.spec.ts:177` browser save→itinerary                  | ✘ fixme                                                                 | UI's save POST hits the same 500; snackbar shows error                   |

**Real fixes that landed during this pass (commit `8ca341e`):**

1. `/shipments` filter must be NESTED `{filters:{...},sortBy:{}}` — flat shape
   silently returned the whole DB → `RESULT_LIMIT_EXCEEDED`. Three specs were
   skipping for the wrong reason (now caught by the `planningWindowQuery`
   helper).
2. `PATCH /shipments/:id/shadow` requires `order_num` in the BODY, not just
   the URL `:id` (zod `ShadowBody` at `handlers/longhaul/shipments.ts:39`).
3. `pegasus_shadow` is a client-side reshape only — raw `/shipments` carries
   flat `lng_dis_comments`. Read-back now checks the flat key.

**Open defect — POST /onprem/longhaul/trips returns 500 on the QA path.** Even
with the body mirroring what the UI sends (full shipment from the planning-
window query with server-built activities; non-null driver from `/drivers`;
dispatcher from `/users/me`; `status:{id:1,status_id:1,status:'Pending'}`),
Dolios rejects. The cloud Lambda is a wildcard proxy
(`apps/api/src/handlers/onprem.ts`); CloudWatch only shows
`"onprem proxy forward"` — the actual error is opaque from outside the
on-prem box. May be a real product regression or a missing body field.

**Two viable diagnostic paths (pick one to lift the fixmes):**

1. **Server-side (Dolios logs).** SSH to the Dolios MSSQL host, tail the Node
   service's logs for one of the captured correlation IDs (e.g. the most
   recent: `5aafaeab-ef98-4766-a904-26bdf81cf484`, `97252827-49da-4e41-82fd-17e3efc1d936`).
   Find the actual validation/INSERT error; fix the request body in the
   qa-api spec + the UI if needed; un-fixme.
2. **Client-side (browser request capture).** Temporarily un-fixme
   `planning.spec.ts:177`; replace its body with a `page.on('request')`
   interceptor that logs the JSON the UI POSTs on a successful (manual or
   browser-spec-driven) save. Diff against the qa-api spec body; restore.

The next session should pick up at one of these paths. Triage doc has the
same details in machine-readable form under "2026-05-14 verification pass":
`plans/todo/longhaul-qa-mutating-triage.md`.

#### Original verification recipe (kept for the next reseed cycle)

The Phase 7c+d+e specs (commit `180ae63`) have NOT been exercised against a clean QA snapshot. Each was written defensively — self-skips when its precondition isn't met, cleans up after itself where possible — but their happy-path assertions are unverified.

The 4 new/un-fixme'd qa-api round-trips:

1. `tests/api/longhaul-qa.spec.ts` — `POST /trips → GET /trips/:id → POST /trips/:id/cancel`
2. `tests/api/longhaul-qa.spec.ts` — `PATCH /shipments/:id/shadow` round-trip with revert
3. `tests/api/longhaul-qa.spec.ts` — `POST /activities then GET /activities` (creates a trip, verifies auto-generated PACK/LOAD/RDEL activities, cancels for cleanup)
4. `tests/api/longhaul-qa.spec.ts` — `POST /trips/:id/notes → PATCH /notes/:id`

The 1 new browser spec:

5. `tests/browser/longhaul/planning.spec.ts:177` — `saves a trip and navigates to its itinerary`

**To verify:**

1. Ask the user to reseed the QA planning DB from the known-good snapshot (per `apps/e2e/QA.md`). Claude can't do this.
2. Confirm the on-prem tunnel is healthy:
   ```bash
   cd /home/steve/repos/pegasus/apps/e2e
   TOK=$(python3 -c "import json; print(json.load(open('playwright/.auth/qa-session.json'))['idToken'])")
   set -a && source .env.test.local && set +a
   curl -sS -w "status=%{http_code}\n" -H "Authorization: Bearer $TOK" \
     -H "x-tenant-id: ${QA_TENANT_ID}" \
     "${QA_API_BASE_URL}/api/v1/onprem/longhaul/version"
   ```
   Expect `status=200` with `{"data":{"max":"2.1.1"}}` or similar. If it times out, pause and tell the user (per session-instruction).
3. Trigger the workflow:
   ```bash
   gh workflow run e2e-qa-longhaul.yml --ref main --repo DolasDev/pegasus
   ```
4. Watch the run with `gh run watch <id> --repo DolasDev/pegasus --exit-status`. Or run locally:
   ```bash
   cd apps/e2e && E2E_TARGET=qa npx playwright test --grep "@qa-mutating" --reporter=line
   ```
5. Expected: all 5 new specs either PASS or self-`test.skip()` with a precondition reason (no unassigned shipment, no drivers, etc.). Any genuine failure is a real find — diagnose, fix, push, re-verify.
6. On green, update `plans/todo/longhaul-qa-mutating-triage.md` "Status" line: change "executed" to "executed + verified-on-QA YYYY-MM-DD".

**Acceptance:** the `e2e-qa-longhaul.yml` `workflow_dispatch` run after the reseed shows 0 unexpected failures across the @qa-mutating specs; only `test.skip` for unmet preconditions is acceptable.

### B — Reconcile Prisma migration drift _~~medium priority~~ — DONE 2026-05-14_

**Status: complete** (commit `c7d44c9`). `prisma migrate dev` runs clean now —
`prisma migrate diff --from-config-datasource --to-schema` returns empty, and
a `--create-only` probe yields no drift warnings. All 1041 API tests pass.

What landed: schema edits to declare what the DB already has (GIN index on
`Tenant.emailDomains`, `onDelete: Cascade` on `TenantSsoProvider.tenant`,
`@db.Timestamptz(6)` on its createdAt/updatedAt); a new migration
`20260514052310_drop_redundant_customers_email_idx` (IF EXISTS so it's a
no-op on the dev DB); shadow-DB support in `prisma.config.ts`. Plus a
metadata-only update to `_prisma_migrations` to fix the historic 0001_init
checksum mismatch and remove the rolled-back 0004 row.

#### Original detail (kept for next time something drifts)

During Phase 7's pre-push, `prisma migrate dev` flagged drift on the Neon dev DB:

- `0001_init` and `0004_sso_providers` were "modified after applied" — someone edited the migration SQL after it had landed in the DB.
- A `customers.email` index is in the migration history but missing on the live schema.

We worked around it with `prisma migrate deploy` (non-destructive — only applies pending). The drift itself is still there.

**To resolve:**

- Diff the file vs the applied state to see what changed:
  ```bash
  cd apps/api && npx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datasource prisma/schema.prisma \
    --script
  ```
- Decide per-divergence: is the file or the live DB authoritative? If the file (intended state): write a _new_ migration that brings the DB to the file's expectation. If the DB: re-edit the migration file to match what's actually there (and document why).
- For the `customers.email` missing index: likely a "create new migration that adds it back" if the original intent was to have it.
- Avoid `migrate reset` unless this Neon DB really is disposable (it's the _dev_ DB shared across the team — most likely NOT disposable).

**Acceptance:** `prisma migrate dev` runs clean (no drift complaint) against the Neon dev DB.

### C — Workflow feature follow-ups _~~verify scope~~ — static audit DONE 2026-05-14_

**Status: static audit clean.** All test suites green (api 1041, admin-web 26,
tenant-web 713) and typechecks pass. Coverage breakdown:

- `workflows.test.ts` — 23 cases (RBAC 5 / `POST /upload-url` 5 / `POST /` 7 /
  GET 6). Happy + sad paths comprehensive.
- `admin/workflows.test.ts` — 4 cases for the cross-tenant admin browse
  endpoint added in `e70d61a`.
- `workflow-developer.cedar` — clean; loaded via `authz/load.ts` 30-personas
  glob. `role-options.ts` declares the persona; `cedar.schema.json` declares
  the `Workflow` resource + `ReadWorkflow`/`UploadWorkflow` actions.
- `admin-web /tenants/$id.tsx` surfaces the GLOBAL-tenant toggle; `/workflows`
  cross-tenant browse table mounts cleanly.
- `tenant-web /settings/workflows` Platform-library + Your-workflows sections
  with download buttons.
- `TENANT_SCOPED_MODELS` story: `1619e94` added Workflow, `e70d61a` removed it
  (GLOBAL needs cross-tenant visibility) + acknowledged in `INTENTIONALLY_UNSCOPED`.

**Remaining for manual UAT (needs the dev server + your hands):**

1. Admin-web tenant detail → Promote to platform tenant → Demote; verify
   `isPlatformTenant` flips and the GLOBAL banner appears.
2. Admin-web `/workflows` route loads (empty table is fine — verifies auth).
3. Tenant-web `/settings/workflows` renders both sections under auth.
4. (Optional) Run `POST /api/v1/workflows/upload-url` as a user with the
   `workflow_developer` role; confirm 201 + `{workflowId,uploadUrl}`; commit
   via `POST /api/v1/workflows`; verify the row appears in /settings/workflows.

**Open follow-up surfaced by the audit (non-blocking):** the Workflow SDK/CLI
for actually uploading isn't in this commit set — the UI renders an empty list
until the SDK ships. Plan already called this out.

#### Original spec (kept for the manual UAT)

The feature commit (`8a14977`) bundled ~1300 lines: prisma model + migration, handler/repo, cedar policies + workflow-developer persona, admin-web tenants UI/API. Worth a quick audit pass:

- Confirm the admin-web tenant detail page (`apps/admin-web/src/routes/_auth/tenants/$id.tsx`) actually surfaces the workflow toggle/config and the new `apps/admin-web/src/api/tenants.ts` endpoints are wired up.
- Confirm `workflows.test.ts` (349 lines) covers happy + sad paths for CRUD.
- Run the dev server (`npm run dev`) and click through: as a tenant admin, can I create a workflow? As a workflow-developer persona, can I read/edit?
- Check the `workflow-developer.cedar` policy compiles cleanly and is reachable by the role-options entry.

**Acceptance:** quick UAT pass produces a "yes, this ships" or a concrete punch list of follow-ups.

### F — `trip-detail.spec.ts:34` gantt flake _— DONE 2026-05-14 (5 consecutive runs green)_

**Root cause: test was waiting on the wrong sentinel.** The audit (`Trip/index.tsx` + `ActivityGantt.tsx`) showed the back-to-trips button and the `[data-target="activity-gantt"]` div live in the same `{trip && (...)}` block — they render or don't together. The flake wasn't a gantt-render race; it was upstream in `openFirstTrip()`:

1. `await expect(trips.laneTitle).toBeVisible({ timeout: 30_000 })` was a hard assertion on `<h5>Trips (N)</h5>` — but the lane title depends on the `/longhaul/trips` data fetch resolving (the count is in the text). On a slow AppGuard bootstrap the data fetch lags the shell mount by 30+ s, so the assertion threw before reaching the trip-detail goto. (Matches the pattern: trace from run `25885361077` showed `/longhaul/trips/:id` **never** fired — we hadn't reached `detail.goto()` yet.)
2. Other specs in this suite already solve this — `trips.spec.ts` beforeEach waits on `newTripButton` (which renders with the `<Trips>` shell, before the data fetch), with a one-shot reload-retry on stall.

**Fix landed in commits `1db2fd5` + `282d671` + `22f6c74`:**

- Convert the laneTitle hard-expect into a `waitFor + skip` pattern (caught run `25886270089`'s alternate flake mode).
- Switch the sentinel from `laneTitle` to `newTripButton` (shell-mount, not data-bound).
- Add a one-shot `page.reload({ waitUntil: 'domcontentloaded' })` retry on stall.
- Add a cards-streamed-in wait before the `firstTripId()` empty-check.
- Keep the existing back-to-trips button gate as the second-tier guard for genuine `/trips/:id` outages.

**Acceptance met:** 5 consecutive `workflow_dispatch` runs after `22f6c74`, trip-detail `@smoke` PASSED every time (durations 3.0s / 4.6s / 3.7s / 20.9s / 2.9s):

| Run           | trip-detail @smoke | Workflow conclusion            |
| ------------- | ------------------ | ------------------------------ |
| `25888283080` | ✓ 3.0s             | success                        |
| `25888590173` | ✓ 4.6s             | failure (planning.spec.ts:115) |
| `25888866950` | ✓ 3.7s             | success                        |
| `25889060544` | ✓ 20.9s            | success                        |
| `25889275199` | ✓ 2.9s             | failure (planning.spec.ts:115) |

The on-prem-stall skip-gate inside `openFirstTrip()` stays — the upstream `/longhaul/trips` fetch genuinely flakes and the gate gives honest "skipped because infra, not product" signal. Don't tighten it back to a hard fail until the on-prem proxy is stabilised.

### G — `planning.spec.ts:115` flake — NEW follow-up 2026-05-14

Surfaced during the F-acceptance runs. The "add an activity, delete one, and deleting the last removes the shipment from the trip" spec failed both first attempt and retry on runs `25888590173` and `25889275199` (~40s timeout each, same 40s on retry — not a momentary stall). Other planning specs in the same runs passed. The test sequence is heavy: add-shipment, add-activity, delete-activity ×2, verify shipment removal — all hitting on-prem write paths.

**Likely candidates:**

- One of the activity-mutation calls (POST / DELETE `/activities`) takes >30s under load, blowing a per-step timeout inside the spec.
- A redux-thunk / optimistic-update race where the UI's "last activity deleted → shipment removed" reconciliation doesn't fire on the on-prem latency profile.
- A selector that worked on the local Dolios reseed but is flake-prone against the real QA box.

**To investigate:** download the trace from `25888590173` (Playwright report artefact `playwright-report-qa-longhaul`); look at the network panel for slow on-prem writes and the action panel for which step hit the 40s wall. If it's the same pattern as F (wrong sentinel + on-prem-data race), the fix shape is the same.

**Acceptance:** 5 consecutive `workflow_dispatch` runs with 0 first-attempt fails of `planning.spec.ts:115`.

### D — _Optional_ — Phase 6 (repository integration tests)

Deferred per the original staged-pivot plan. Only worth doing if a schema-drift bug recurs (the `v_longhaul_drivers` UPPERCASE issue class). If you do it, the right shape is snapshot/golden-file SQL — the queries are MSSQL-specific so SQLite-in-memory won't work; capture the Knex query string and assert against a committed `.snap`.

### E — _Backlog_ — `plans/todo/longhaul-in-progress-driver-lock.md`

Missing parity feature: the legacy app gated driver-edit on In-Progress trips; the port doesn't. Backlog item documents the acceptance criteria for when product wants it.

---

## Workflow / commands

```
# Read-only sanity (safe any time)
cd apps/e2e && E2E_TARGET=qa npx playwright test --grep-invert "@qa-mutating" --reporter=line

# @qa-mutating subset (NEEDS A RESEED)
cd apps/e2e && E2E_TARGET=qa npx playwright test --grep "@qa-mutating" --reporter=line

# Trigger the CI workflow
gh workflow run e2e-qa-longhaul.yml --ref main --repo DolasDev/pegasus
gh run watch <id> --repo DolasDev/pegasus --exit-status

# Pre-commit gates
npm run typecheck --workspace=@pegasus/api
npm run typecheck --workspace=@pegasus/tenant-web
npm run typecheck --workspace=@pegasus/e2e
cd apps/api && npm test            # 1037 tests, needs local Neon DB current
cd apps/tenant-web && npx vitest run src/features/driver-planning/

# Probe on-prem tunnel directly (skip Playwright)
cd apps/e2e
TOK=$(python3 -c "import json; print(json.load(open('playwright/.auth/qa-session.json'))['idToken'])")
set -a && source .env.test.local && set +a
curl -sS -w "status=%{http_code}\n" -H "Authorization: Bearer $TOK" \
  -H "x-tenant-id: ${QA_TENANT_ID}" \
  "${QA_API_BASE_URL}/api/v1/onprem/longhaul/version"
```

---

## Files of interest

| Path                                                               | Why                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `apps/e2e/tests/api/longhaul-qa.spec.ts`                           | The 4 new qa-api round-trips live here                       |
| `apps/e2e/tests/browser/longhaul/planning.spec.ts:177`             | The new save→itinerary browser spec                          |
| `apps/api/prisma/migrations/20260513120000_add_workflows/`         | The applied workflows migration                              |
| `apps/api/src/lib/prisma.ts`                                       | TENANT_SCOPED_MODELS — Workflow registered (`1619e94`)       |
| `apps/api/src/handlers/workflows.ts` + `.test.ts`                  | Workflow CRUD handler                                        |
| `apps/api/src/repositories/workflow.repository.ts`                 | Tenant-scoped repo                                           |
| `apps/api/src/authz/policies/30-personas/workflow-developer.cedar` | New persona                                                  |
| `apps/admin-web/src/routes/_auth/tenants/$id.tsx`                  | Admin tenant detail wiring                                   |
| `.github/workflows/e2e-qa-longhaul.yml`                            | The QA E2E workflow (env `qa`, schedule + workflow_dispatch) |

---

## Things to NOT do (lessons from this session)

- Don't `prisma migrate dev` on the Neon DB without checking the prompt — it will offer `migrate reset` and silently nuke shared dev data if anyone accepts. Use `prisma migrate deploy` for non-destructive applies of pending migrations.
- Don't take the on-prem tunnel's reported "back up" status at face value — probe `/api/v1/onprem/longhaul/version` directly via curl with the captured ID token before running browser specs. A `504 TUNNEL_TIMEOUT` masquerades as a passing setup probe but skips every browser spec.
- Don't bypass pre-push hooks with `--no-verify` to escape unrelated test failures. The Workflow tenant-scope registration was a real correctness issue surfaced by the meta-test; bypassing would have shipped tenant-leak risk.
- When the on-prem tunnel is down, **pause and ask** the user before any E2E retry loop — per their explicit session instruction.

---

## When to archive this plan

Move to `plans/completed/` once:

- A is **actually** done — the 3 `test.fixme`'d trip-write specs are
  un-fixme'd and passing on QA, OR the underlying on-prem 500 is filed as a
  separate tracked defect and the plan acknowledges those specs were deferred
  to that issue (not merely marked fixme as a CI workaround).
  **(Closed 2026-05-14 — workflow run `25886270089` green; 3 specs PASS.)**
- B is done (no Prisma drift on the dev DB) OR explicitly punted with a
  one-line note here saying so. **(Closed 2026-05-14 in `c7d44c9`.)**
- C is done — static audit clean (2026-05-14); manual click-through pending.
  Plan acknowledges the SDK/CLI as a separate follow-up.
- F is closed — `trip-detail.spec.ts:34` runs cleanly on 5 consecutive
  `workflow_dispatch` runs with 0 first-attempt fails on the gantt assertion,
  OR the spec is split (fast-path keeps the `@smoke` tag; flake-prone path
  moved to a separate spec gated explicitly on on-prem stability).
  **(Closed 2026-05-14 — runs `25888283080` / `25888590173` / `25888866950`
  / `25889060544` / `25889275199` all pass.)**
- G is closed — `planning.spec.ts:115` runs cleanly on 5 consecutive
  `workflow_dispatch` runs OR the on-prem activity-mutation latency is
  characterised + the spec's timeouts adjusted accordingly.
- D and E remain in their own backlog files; this plan doesn't track them.

## Session boundary: 2026-05-14 (second pass) → next

Pause point for handoff:

- A: on-prem defect (Knex+mssql `.insert()` IDENTITY return + trigger output
  clause) diagnosed and fixed in the longhaul repos; all 3 specs un-fixme'd;
  local end-to-end save+cancel verified. **Remaining:** push, trigger the
  `e2e-qa-longhaul.yml workflow_dispatch` on a reseeded QA, confirm 0
  unexpected failures + 3 specs now PASS (not skip). The on-prem Windows
  Service on `DOLAB-M70Q-1` was rebuilt + restarted this session.
- B: closed.
- C: static audit clean; manual UAT click-through pending user driving the
  dev server.

## Session boundary: 2026-05-14 (third pass) → next

- A: **closed.** `workflow_dispatch` run `25886270089` green (41/4/0). Three
  follow-on spec bugs surfaced and fixed in commits `caf7830` + `397eb5d`:
  Body-already-read double-`.json()` in qa-api trip specs, Downshift
  type-to-open in `planning.spec.ts:177`, and an `openFirstTrip()`
  on-prem-stall skip-gate for `trip-detail.spec.ts:34`.
- F: **closed 2026-05-14.** Root cause was the wrong wait sentinel in
  `openFirstTrip()` (`laneTitle` is data-bound; `newTripButton` is shell-
  bound). Fix landed in `1db2fd5` + `282d671` + `22f6c74`; 5 consecutive
  `workflow_dispatch` runs after the fix had trip-detail `@smoke` PASSING
  every time. See item F for the run table.
- G: **new follow-up.** `planning.spec.ts:115` ("add an activity, delete
  one") failed first attempt AND retry on 2 of the 5 F-acceptance runs.
  Same on-prem latency profile, different surface. See item G.
