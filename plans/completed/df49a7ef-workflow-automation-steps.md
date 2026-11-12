# Workflows call Automations as steps: `run_automation()`

- **Branch:** `feat/workflow-automation-steps` (worktree `../pegasus-workflow-automation-steps`).
  All changes stay on this branch; plan + code land in one PR via the merge queue.
- **Goal:** a durable Workflow can `await run_automation("name", input)` and
  get the Automation's result. This is the first Phase 4 item left in
  `plans/in-progress/long-running-workflows-and-automations.md`. Signal
  delivery already shipped in #943/#944.
- **Status:** DONE — landed in this PR. Release + staging acceptance are in
  `plans/todo/workflow-automation-steps-followups.md`.

## Resume here (2026-11-12)

Code, tests and docs are done and green locally. Results: API vitest 5254/5254
(incl. `handlers/automation-steps.test.ts`, 21 real-Postgres tests); SDK
pytest 616; runner pytest 161, incl. the dev-server e2e
`test_run_automation_step_against_a_real_server`; tenant-web typecheck + route
tests. `/security-review`: no findings. `/code-review` (medium) raised three,
all fixed in this PR:

- an own durable Workflow named X no longer hides a GLOBAL Automation X (test
  added);
- the start-race edge, where the winner's start failed and released the key
  between P2002 and the re-read, now returns 503 `STEP_START_RACE`
  (retryable) instead of a raw 500;
- a server-hinted `Retry-After` no longer grows the activity's own backoff
  (test added).

Release steps and staging acceptance continue in
`plans/todo/workflow-automation-steps-followups.md`.

**Deviations from the approved design (all small):**

- SDK is **0.65.0**, not 0.64.0: #955 (atlas fetch freshness) took 0.64.0
  while this was in flight.
- Migration renamed to `20261112180000_automation_steps` so it sorts after
  #955's `20261112162521_…`, which is already applied in prod.
- tenant-web: the "Workflow step" badge carries the parent execution id as a
  tooltip, not a link. There is no route that opens an execution by id alone.
  The link is left for the Phase 4 Workflows section.
- The caller check does not require the caller row to be ACTIVE. Requiring an
  OPEN parent execution is stricter (retire refuses rows with open runs).
- The activity is `async` (HTTP via `asyncio.to_thread`), so a step waiting
  for hours does not hold one of the worker's 8 sync-activity threads.
- `run_automation` uses `ActivityCancellationType.WAIT_CANCELLATION_COMPLETED`,
  so the Automation's cancel is sent before the Workflow moves on.
- **SDK version:** 0.65.0. Re-check `git tag | grep sdk-python` and open PRs
  that touch `pyproject.toml` right before the PR: versions collided twice
  this month.

## Decisions (Steve, 2026-11-12)

1. **Authz: narrow step routes.** Add a new Cedar action `RunAutomationStep`
   and grant it to `workflow_runtime`. The handler resolves the caller's
   `apiClient.id` to `Workflow.runtimeApiClientId`, i.e. the calling Workflow
   row. It requires: the caller has `kind=WORKFLOW` and `status=ACTIVE`, the
   target has `kind=AUTOMATION` and `status=ACTIVE`, and both are in the same
   tenant. Automations still can't start each other, and `RunWorkflow` /
   `ReadWorkflow` are NOT granted to the runtime role.
2. **Version: newest live.** A bare name resolves at each call to the newest
   ACTIVE Automation version (semver order). `version=` pins exactly. The
   execution row records which version ran.
3. **"Not now" refusals are retried with backoff.** These are 423
   `WORKFLOWS_DISABLED`, 429 `CONCURRENCY_LIMIT` / `DAILY_QUOTA_EXCEEDED`, and
   409 `TENANT_MIGRATING` / `TENANT_NAMESPACE_PROVISIONING`. The activity keeps
   heartbeating and retrying until the start is accepted or the step's
   `timeout` ends. This keeps 3c's promise: an open Workflow still finishes
   under the kill switch, and its steps wait until the switch is off.
   404 / retired / 422 / validation errors are non-retryable.
4. **Provenance in this PR.** One migration adds three things:
   `WorkflowExecutionTriggerSource.WORKFLOW`, a `parent_execution_id` (the
   open Workflow's execution row, denormalized, not an FK, like
   `triggeredByTriggerId`), and the idempotency `step_key`.

Also settled: the helper is an **activity that goes through the API's run
path**, not a child workflow. Plan §3 explains this with namespaces, and that
reason is stale: since #919 both kinds run in the tenant namespace. The
conclusion still holds for other reasons. The API path gives execution rows,
the runtime token, the daily quota, the concurrency cap and the kill switch
for free, and a child workflow would bypass all of them. Fix §3's wording in
the parent plan.

## Design

### API: new router `apps/api/src/handlers/automation-steps.ts`, mounted at `/api/v1/automation-steps`

It is mounted separately so it can't collide with `/workflows/:id` routes.
All three routes require `RunAutomationStep`, and each scopes to the caller's
Workflow row in the handler. Cedar can't see that scoping, so it needs its
own integration tests.

- `POST /` with body `{ automation: string, version?: string, input?: object,
parentTemporalWorkflowId: string, parentTemporalRunId: string, activityId: string }`.
  - The parent is resolved as the open (`QUEUED|RUNNING`) execution row with
    `tenantId` + `temporalWorkflowId = parentTemporalWorkflowId` (the index
    already exists), where `workflowId` is the caller's Workflow row. If no
    such row exists, return 404 `PARENT_NOT_OPEN`. This stops a token from
    starting steps for an instance that isn't its own or is already closed.
  - The step key is built server-side:
    `${parentTemporalWorkflowId}/${parentTemporalRunId}/${activityId}`. It is
    unique per tenant. A replay with the same key returns **200 with the
    existing row** and does not start the Automation again (activity retry
    after a crash). A race on the unique index is caught (P2002), and the
    winner's row is returned.
  - Target resolution follows decision 2, using the same visibility rules as
    `POST /workflows/:id/run`; check which rows a tenant can run (own rows and
    TENANT forks). Durable targets are refused: 422 `STEP_TARGET_NOT_AUTOMATION`.
  - It starts through the existing `startWorkflowExecution` with
    `triggerSource: 'WORKFLOW'`, `parentExecutionId` and `stepKey`. That gives
    the cap, quota, kill switch, namespace states and the dry-run refusal
    unchanged. Outcomes map to the same HTTP codes as `/run`
    (`startResultToResponse`), so the SDK's existing error classes apply.
  - 201 returns `WorkflowExecutionResponse` plus `{ automation, version }`.
- `GET /:executionId` returns that execution when its `parentExecutionId`
  belongs to the caller's Workflow (otherwise 404). It includes `status`,
  `result` and `errorMessage`. Verified: the runner's terminal write-back
  (`workflow-internal.ts` PATCH) sets `status` and `result` in ONE update, so
  a poller never sees COMPLETED with a missing result.
- `POST /:executionId/cancel` has the same scoping and reuses the existing
  cancel helper.

### Prisma migration `…_automation_steps`

- `ALTER TYPE "WorkflowExecutionTriggerSource" ADD VALUE 'WORKFLOW'`
- `workflow_executions.parent_execution_id TEXT NULL` and
  `step_key TEXT NULL`, with `UNIQUE (tenant_id, step_key)` (NULLs don't
  collide).
- Additive only; existing rows are unaffected.

### SDK (`packages/workflows-sdk-python`)

- `pegasus_workflows/steps.py` is the **workflow-side** part. It must be
  importable in the sandbox, so no httpx at import time: follow the
  `_LAZY_EXPORTS` rule, and the activity body imports `PegasusClient` lazily.
  - `async def run_automation(name, input=None, *, version=None,
timeout=timedelta(hours=6)) -> Any` calls
    `workflow.execute_activity("pegasus.run_automation", …)` with
    `schedule_to_close_timeout=timeout`, `heartbeat_timeout=60s` and a retry
    policy of unlimited attempts within the timeout, with the non-retryable
    types listed.
  - `AutomationStepFailed` is a non-retryable `ApplicationError` type carrying
    `execution_id`, `status` (FAILED / TIMED_OUT / CANCELLED) and
    `error_message`. The Workflow can catch it as an `ActivityError` cause.
  - `BUILTIN_ACTIVITIES = [run_automation_activity]` is exported for the
    driver.
- The activity `pegasus.run_automation`:
  1. Read `activity.info()` to get the parent workflow id, run id and
     activity id.
  2. POST the step. On a retryable refusal (decision 3), heartbeat, back off
     from 5 s to 60 s, and loop.
  3. Poll `GET /:executionId`, heartbeating on each poll, backing off from
     2 s to 15 s. COMPLETED returns `result`. Anything else terminal raises
     `AutomationStepFailed`.
  4. On `asyncio.CancelledError` (the Workflow cancelled the step), call the
     step cancel endpoint best-effort, then re-raise.
- `PegasusClient` gets `start_automation_step`, `get_automation_step` and
  `cancel_automation_step`. `testing.FakeClient` gets matching stubs so
  authors can unit-test Workflows that call steps.
- `run_automation` and `AutomationStepFailed` are added to `__all__` and the
  lazy exports.
- Bump to 0.65.0 and update the CHANGELOG.

### Tenant runner (`apps/tenant-runner`)

- `workflow_worker_driver.py`: after `collect_activities(module)`, also
  register `pegasus_workflows.steps.BUILTIN_ACTIVITIES` when the tenant
  venv's SDK has it (`ImportError`/`AttributeError` means an older SDK, so
  skip). De-duplicate by activity name. This change needs a new runner image,
  and Deploy builds it.

### tenant-web

- In execution history, `triggerSource: 'WORKFLOW'` shows "Started by
  Workflow" with a link to the parent execution. Add the type to
  `apps/tenant-web/src/api/workflows.ts`. Keep the change small.

### Discovery surfaces (CLAUDE.md rule)

- SDK README: a "Calling an Automation from a Workflow" section covering
  semantics, timeouts, retries under the kill switch / quota, idempotency,
  and newest-live resolution.
- The SDK's MCP reference resources (`pegasus://reference/*`) get the same
  content.
- OpenAPI: register the three routes; the coverage test gates CI.
- Authoring repo `~/repos/pegasus-workflows/CLAUDE.md`: a short note, added
  only AFTER 0.65.0 is on PyPI. Commit only my hunk.

## Checklist

- [x] Migration + Prisma schema + `db:generate`
- [x] Cedar: `RunAutomationStep` in `cedar.schema.json`, `actions.ts`,
      `workflow-runtime.cedar`, and policy tests
- [x] `startWorkflowExecution` accepts `triggerSource: 'WORKFLOW'`,
      `parentExecutionId` and `stepKey` (TDD: unit tests first)
- [x] `automation-steps.ts` router + mount + integration tests:
      Automation caller → 403/404; target is a Workflow → 422; retired /
      unknown → 404; newest-live + pinned resolution; parent not open → 404;
      step-key replay → 200 same row; P2002 race; kill switch → 423;
      cap → 429; GET/cancel scoped to the caller
- [x] OpenAPI registration
- [x] SDK: client methods, `steps.py`, activity, FakeClient stubs, tests
      (pytest: retry-on-refusal loop, poll → result, failure → error,
      cancel path, sandbox import has no httpx)
- [x] Runner driver registers built-ins + unit test; extend the gate e2e
      (`apps/tenant-runner/tests/test_workflow_worker_e2e.py`, dev server):
      a Workflow calls `run_automation` against a stub API and gets the result
- [x] tenant-web WORKFLOW trigger source in history
- [x] Docs: README, MCP reference, CHANGELOG, SDK 0.65.0
- [x] Parent plan: tick the Phase 4 items done by #943/#944 and this PR;
      correct §3's child-workflow rationale; Status line
- [x] DECISIONS.md: "Workflow steps go through the API, newest-live, retry
      not-now refusals"
- [x] `/security-review` (required for every Phase 4 PR, parent plan §5),
      `/code-review`, then the PR via the merge queue
- [ ] (moved to the follow-ups plan) After merge: Deploy green → tag `sdk-python-v0.65.0` on the real merge
      commit → PyPI → authoring-repo CLAUDE.md note
- [ ] (moved to the follow-ups plan) **Staging acceptance (AVP Smoke, scratch project, always `name@version`):**
      Workflow `accept_steps` calls Automation `ns_canary`-style `step_echo`
      → result returned; a failing Automation surfaces as `AutomationStepFailed`;
      kill switch ON while a step is pending → step waits, switch OFF → completes;
      runner `stop-task` mid-step → no duplicate execution row (step key);
      tenant-web shows "Started by Workflow". Retire the scratch rows afterwards
      and verify the switch is OFF.

## Files

New: `apps/api/src/handlers/automation-steps.ts` (+ `.test.ts`),
`apps/api/prisma/migrations/<ts>_automation_steps/migration.sql`,
`packages/workflows-sdk-python/pegasus_workflows/steps.py`,
`packages/workflows-sdk-python/tests/test_steps.py`.

Modified: `apps/api/prisma/schema.prisma`, `apps/api/src/authz/cedar.schema.json`,
`apps/api/src/authz/actions.ts`, `apps/api/src/authz/policies/30-personas/workflow-runtime.cedar`,
`apps/api/src/lib/start-workflow-execution.ts` (+ test), `apps/api/src/app.ts`
(or wherever routers mount), `apps/api/src/lib/openapi-spec.ts`,
`packages/workflows-sdk-python/pegasus_workflows/{__init__,api}.py`,
`…/testing/__init__.py`, `…/README.md`, `…/CHANGELOG.md`, `…/pyproject.toml`,
the MCP reference module, `apps/tenant-runner/pegasus_tenant_runner/workflow_worker_driver.py`
(+ tests), `apps/tenant-web/src/api/workflows.ts` + the history component,
`plans/in-progress/long-running-workflows-and-automations.md`,
`dolas/agents/project/DECISIONS.md`.

## Risks / side effects

- **Hot files:** the Cedar schema, `actions.ts` and persona files. Rebase
  before the PR. `authz-smoke` runs AFTER merge, and handler scoping is
  invisible to Cedar, so the integration tests are the gate.
- **Runtime-role grant widens what a `vnd_` token can do**, but only for
  rows whose caller is a WORKFLOW. An Automation's token gets 404/403 from
  the handler. Needs a security-review focus.
- **Steps count against the concurrency cap (5) and the daily quota.** A
  Workflow fan-out of more than 5 steps queues behind the cap via the retry
  loop. This is intended; document it.
- **The runner image changes**, and every tenant runner picks it up on next
  launch. The registration is a no-op for SDKs older than 0.65.0.
- **Enum `ADD VALUE`** can't run inside a transaction on older Postgres.
  Check that Prisma generates it standalone (PG ≥ 12 allows it in a txn
  when the value isn't used in the same txn).
- **Long polls cost Temporal actions** (heartbeats). Heartbeats are
  throttled by the SDK, and the poll backoff caps at 15 s. Fine for D4's
  action budget; Phase 5's metrics will show it.
