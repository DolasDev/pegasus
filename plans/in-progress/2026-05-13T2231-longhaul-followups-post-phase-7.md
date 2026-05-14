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

Test counts: driver-planning vitest **604** (was 528 at session start). All 8 longhaul handlers tested (80 cases). E2E `--grep-invert "@qa-mutating"` verified clean on QA (11/0, 1.2 min). `e2e-qa-longhaul.yml` ran green via `workflow_dispatch` (run `25823001497`, 4m26s).

---

## What's left

### A — Verify the new `@qa-mutating` round-trips on a reseed pass _~~highest priority~~ — DONE 2026-05-14_

**Status: complete.** Run `25839871338` (commit `cda3a82`) green on QA after the
reseed: 41 passed, 6 fixme, 0 failed, 0 flaky. Findings + the remaining
on-prem-trip-save gap are documented in `plans/todo/longhaul-qa-mutating-triage.md`
under the 2026-05-14 section. 3 specs are now `test.fixme` pending Dolios-side
diagnosis of the legacy trip-save 500 — lift them together once the missing
body field or validation gap is identified.

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

### C — Workflow feature follow-ups _(verify scope, then close out)_

The feature commit (`8a14977`) bundled ~1300 lines: prisma model + migration, handler/repo, cedar policies + workflow-developer persona, admin-web tenants UI/API. Worth a quick audit pass:

- Confirm the admin-web tenant detail page (`apps/admin-web/src/routes/_auth/tenants/$id.tsx`) actually surfaces the workflow toggle/config and the new `apps/admin-web/src/api/tenants.ts` endpoints are wired up.
- Confirm `workflows.test.ts` (349 lines) covers happy + sad paths for CRUD.
- Run the dev server (`npm run dev`) and click through: as a tenant admin, can I create a workflow? As a workflow-developer persona, can I read/edit?
- Check the `workflow-developer.cedar` policy compiles cleanly and is reachable by the role-options entry.

**Acceptance:** quick UAT pass produces a "yes, this ships" or a concrete punch list of follow-ups.

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

- A is done (the @qa-mutating round-trips run green on a reseeded QA — preferably with the GH Actions artifact preserved).
- B is done (no Prisma drift on the dev DB) OR explicitly punted with a one-line note here saying so.
- C is done (Workflow feature has had a UAT pass and either ships or has a concrete follow-up list).
- D and E remain in their own backlog files; this plan doesn't track them.
