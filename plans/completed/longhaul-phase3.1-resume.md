# Longhaul Phase 3.1 — Resume / Handoff

_Last updated: 2026-05-24 (session 2, late). origin/main HEAD: `decd033`._

## TL;DR

Phase 3.1 (`/trips/:id` cloud-direct) is **DONE and VERIFIED**. The fix
(`decd033`) is deployed to staging/QA + prod and confirmed green end-to-end:
`e2e-qa-longhaul` run **26457380987** (2026-05-26, after a manual reseed) passed
the full suite, including the previously-500ing `longhaul-qa.spec.ts:297/414/520/563`
(the `@qa-mutating` ones exercise `GET /trips/:id` on freshly-created trips).

**Phase 3 = 14/14 reads cloud-direct. Next is Phase 4 (writes); trip-save is the
hard case.** This plan can move to `plans/completed/`.

- ✅ `GET /trips` (LIST) — cloud-direct, verified in QA.
- ✅ `GET /trips/:id` — cloud-direct with the `pegasus_extra_location` soft-fail
  fix (`decd033`), deployed AND verified green in QA (run 26457380987).

## Root cause (CONFIRMED from live executor CloudWatch) + the fix

The cloud trip-detail handler batched the **optional** `pegasus_extra_location`
lookup into the same multi-statement RT2 as the mandatory shipment/activity/
coverage statements. The QA tenant's DB lacks that table, so the executor raised
`Invalid object name 'pegasus_extra_location'.` and the WHOLE batch aborted →
500 on every trip. Verified in the `mssql-executor` log group
(`pegasus-staging-wireguard-MssqlExecutorFn…`, profile `dolas-pegasus-staging-ro`,
acct 248812875460): the ONLY error was the absent table; RT1 (`statementCount:3`)
and the coverage statement succeeded. The mock-based unit test passed because it
never exercised a missing table.

**Fix (`decd033`):** pull `pegasus_extra_location` out of the RT2 batch into a
separate `executeSql` that `.catch()`es → `[]` — mirroring the on-prem repo
(`shipments.repository.ts` line ~291 `.catch(() => [])`) and the cloud
`shipments-list` handler, both of which already soft-fail this optional table.
Added a regression test (`trip-detail.test.ts`) that rejects the extra-locations
query and asserts 200 + `extra_locations: []`.

**Next:** run `e2e-qa-longhaul` (reseed first, wait for any in-flight deploy to
finish) → expect green on `longhaul-qa.spec.ts:297/414/520/563`. Then Phase 3 =
14/14 reads cloud-direct → Phase 4 (writes; trip-save is the hard case).

## What this session did

1. Re-mounted `/trips/:id` cloud-direct (`a79f14e`), pushed → deployed
   staging+prod → ran `e2e-qa-longhaul` (run **26370258587**) → **still 500**
   on `longhaul-qa.spec.ts:297/414/520/563` (all expected 200, got 500). Both
   the initial attempt AND the retry failed → not a flake.
2. Reverted the re-mount and redeployed (`7c3903a`, app.ts functionally identical
   to the prior proxy baseline `8cbfafc`). Prod restored to the proxy.

## The root cause the LAST handoff got WRONG (read this)

The previous handoff claimed `/trips/:id` only 500'd because the mssql-executor
(which produces per-statement `recordsets`) wasn't in `deploy.yml`'s path filter,
so the API handler deployed without it. **That is not the (whole) story:**

- **`staging` in `deploy.yml` IS the QA env.** `packages/infra/bin/app.ts:81`
  maps `staging → pegasus-qa.dolas.dev`. `e2e-qa-longhaul` targets
  `QA_API_BASE_URL = m4t360o4u6.execute-api.us-east-1.amazonaws.com` — the
  staging API. So a push to `main` DOES deploy the env the QA E2E hits.
- The `api` deploy subset includes WireGuardStack (which CDK-bundles the
  executor). The executor with `recordsets` has been live in staging/QA since
  `8cbfafc`'s deploy. The path-filter fix only matters for pushes that touch
  _only_ `apps/mssql-executor` — not relevant here.
- With the executor confirmed current, `/trips/:id` **still 500'd uniformly**.
  → real bug, not deploy skew.

**Process note:** "wait for deploy then run QA E2E" is still correct (QA == the
staging deploy). But there is NO separate QA deploy — don't go looking for one.

## To actually fix `/trips/:id` — root-cause first, do NOT just re-mount

The unit test (`trip-detail.test.ts`) mocks `executeSql` and passes, so the bug
is in the **real** executor round trip. The handler catches all errors and
returns a generic 500 (`code: INTERNAL_ERROR`) — the real cause is only in
CloudWatch. Two batched statements are issued (see `handlers/longhaul-cloud/trip-detail.ts`):
RT1 = TripMaster header + activities + notes; RT2 = shipments + activities +
coverage + extra-locations.

**Step 1 — get the real error (needs AWS creds for the Pegasus account):**
The Pegasus QA/staging stacks are NOT in the `dolas-staging`/`dolas-admin`
accounts (checked — empty). They're in the account behind the **`admin-dev`**
profile, whose SSO token is **expired**. Re-auth, then read the executor's own
error log (it logs the exact MSSQL message as `mssql_exec_failed`):

`aws sso login --profile admin-dev`

Then (executor log group is under WireGuardStack; the handler log is the API
Lambda). Tail the executor for the failing window / `mssql_exec_failed`, or the
API Lambda for `longhaul cloud trip detail failed`. The executor message is the
actual SQL error and is the fastest path.

**Suspects already ruled out by code reading:**

- All tables/views exist & names match the on-prem repos (TripMaster,
  MasterTripStatus, v_longhaul_drivers, v_longhaul_states, v_longhaul_salesman,
  TripNotes, LongDistanceDispatchActivity, Longhaul_ActivityType,
  v_longhaul_shipments_v2, longhaul_shipmentcoverage, pegasus_extra_location).
- Header SELECT columns are a subset of the working on-prem `findTripById`.
- The `at` alias (T-SQL) is used by the on-prem Knex queries too (bracketed),
  and `AT` is not actually a reserved word that breaks a bare alias.

**Still-open suspects (check against the real error):**

- The multi-statement parameterized batch: a single `@id` referenced across 3
  statements in one `request.query()` — confirm `mssql` returns `recordsets`
  (plural) for this, not just `recordset`. If `recordsets` is undefined the
  handler does `recordsets[0]` on undefined → TypeError → 500. (The executor
  has a fallback `recordsets ?? [recordset]` — verify it actually populates.)
- A column in the activities/notes/shipment statements that differs from the
  on-prem query (the header was compared; the child statements were not fully
  diffed against `activities.repository.ts` / `shipments.repository.ts`).
- `sales` join in RT2 shipment SQL (`LEFT JOIN sales ps ON s.order_num =
ps.order_num`) — verify `sales` and its `order_num` exist.

**Step 2 —** fix the handler (or executor), add a test that would have caught
it (ideally an integration test that exercises a real multi-statement batch, not
a mock), re-mount in `app.ts`, push, wait for deploy `completed:success`, reseed
QA, run `e2e-qa-longhaul`, confirm green on :297/:414/:520/:563.

## Branch / WIP state (IMPORTANT — concurrent activity this session)

- `origin/main` = `main` = **`7c3903a`** (the revert). Clean, deployed.
- **`feat/cognito-ses-email`** (local only, NOT pushed) holds an unrelated
  cognito/SES workstream: `a295949` (SES invite emails) + **`a63158f`** — the
  latter is the SAME `/trips/:id` revert that also went to main via `7c3903a`.
  `a63158f` landed on this branch by accident (the working tree was checked out
  here when the revert was committed). **When `feat/cognito-ses-email` is
  rebased/merged, drop `a63158f`** (it's already on main) to avoid a redundant
  commit/conflict.
- The working tree still has ~19 staged cognito files (more WIP, uncommitted).
- Old safety stash `stash@{0}` ("user-wip-during-js-cookie-merge") may still
  exist — drop once the tree is confirmed good.

## Other open items (unchanged)

- **js-cookie (real fix):** `plans/in-progress/mobile-cognito-js-cookie-fix.md`.
  Remove the orphan `amazon-cognito-identity-js@6.3.16` dep in `apps/mobile` →
  drops `js-cookie` → delete the GHSA-qjx8-664m-686j allowlist from
  `audit-ci.jsonc`.

## Process lessons (this session)

- `staging` deploy == the QA env the longhaul E2E hits (`app.ts:81`). One push
  covers it; there is no separate QA deploy pipeline.
- A handler that catches all errors into a generic 500 hides the cause — for
  the next attempt, surface the executor error (at least behind a debug flag /
  correlationId) so root-cause doesn't require CloudWatch spelunking.
- A passing unit test that mocks the executor does NOT prove the SQL works —
  the recordsets bug is invisible to mocks. Need a real-DB integration layer.
