# Task queues — Phase 3b: a Workflow awaits a task, end to end (both stores)

**Branch:** `feat/task-queue-await` (worktree `../pegasus-task-queue-await`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 3 (TQ-D2, TQ-D4 guardrail 4). 3a shipped as #985 (`plans/completed/8cde70bf-task-queue-cloud-store.md`).
**Status:** APPROVED 2026-11-23: Steve said yes to S1–S5 as recommended. Steps 1–6 done; step 7 next.

## Resume here (2026-11-23, end of session)

- **Where:** worktree `/home/steve/repos/pegasus-task-queue-await`, branch `feat/task-queue-await` (off `origin/main` at `376062a2`, #985). Last commit: step 6, `feat(api): task-await sweeper` (step 5 `ec126f31`, step 4 `708d92ef`, step 3 `934e2906`, step 2 `d886c068`, step 1 `e28b885f`). Nothing is pushed and no PR exists.
- **Status:** steps 1–6 `[x]`, steps 7–10 `[ ]` (see Steps).
- **Next action — step 7 (infra, D8), in `packages/infra/lib/api-stack.ts`:** add a `NodejsFunction` for `apps/api/src/lambda-task-sweeper.ts` (export `handler`) beside the reconciler, in the Temporal-configured branch.
  - **Permissions and env:**
    - the same Temporal env and secret, and `workflowTokenKey.grantDecrypt`;
    - the DB secret;
    - tunnel-proxy invoke permission, because the legacy poll goes through `tunnelFetch`;
    - `cloudwatch:PutMetricData`.
  - **Schedule:** an EventBridge rule, `rate(5 minutes)`.
  - **Timeout:** ≥ 5 min. The sweep's own time budget is 4 min (`DEFAULT_BUDGET_MS`).
  - **Reserved concurrency 1**, so two ticks never overlap.
  - **Logging and alarms:**
    - its own log group;
    - an alarm on Lambda `Errors`;
    - optionally an alarm on `TaskAwaitLegacyPollFailed`.
  - **Metrics:** add the four names in `TASK_AWAIT_METRICS` (`TaskAwaitDelivered`, `TaskAwaitAbandoned`, `TaskAwaitDeliveryFailed`, `TaskAwaitLegacyPollFailed`, namespace `Pegasus/Workflows`) to `packages/infra/lib/metrics.ts`. Keep both sides in sync, as the comment says.
  - **Infra tests:** the rule, the permissions, and the timeout and concurrency settings.
  - **Check how the reconciler gets its tunnel / pegII env.** The sweeper builds a legacy gateway through `resolveTaskGateway`, then `resolvePegiiOverlayTarget`, then `tunnelFetch`. Copy whatever env the API Lambda gives those (tunnel-proxy function name/ARN, pegII token signing key) — grep the API function's environment for `TUNNEL` / `PEGII`.
- **Uncommitted work:** only `apps/e2e/.env.test`. It's the worktree's isolated-DB wiring, written by `scripts/new-worktree.sh`. Never stage or commit it.
- **In flight:** nothing.
  - #985 is merged and deployed.
  - SDK 0.68.0 is published (tag `sdk-python-v0.68.0`).
  - `pegasus-workflows` `c8a7c1f` is pushed.
  - Android vcode 26 (EAS `75915c4b`) is SUBMITTED to the Play `alpha` track (closed testing), 2026-11-23 19:24Z.
- **Decisions (this session):**
  - S1–S5: Steve said YES to all five as recommended. See below.
  - D7 changed: the sweeper acts as the **awaiting Workflow's runtime service account**, not an anonymous service principal. `lib/pegii-token.ts` refuses a token with no `tenantUserId` (`PEGII_PRINCIPAL_UNRESOLVED`).
  - The runtime ApiClient is `wf-runtime-<workflowId>`: one per **workflow**, not per execution (`lib/start-workflow-execution.ts` `provisionRuntimeServiceAccount`; `lib/usage/billable-actions.ts` `workflowIdFromClientName`). So the server can't tell which run is calling. The register activity sends `activity.info().workflow_id`, which the server maps to the run via `WorkflowExecution.temporalWorkflowId` (indexed with `tenantId`), then checks the run belongs to the caller's workflow.
- **Gotchas:**
  - `buildPegiiCaller(tenantDb, …)` MUST get a `createTenantDb`-scoped client. `company.repository` `getDefaultTarget()` has no `tenantId` filter of its own.
  - Prisma 7 `migrate dev` does NOT regenerate the client: run `npm run db:generate`.
  - The worktree-isolated shell refuses long or compound commands, and any command mentioning `.github` or several `git` calls. Put scripts in files under `$CLAUDE_JOB_DIR/tmp` and run them, or split the commands.
  - Test runs rewrite the coverage floors in `apps/api/vitest.config.ts` and `packages/domain/vitest.config.ts`. `git checkout --` both before committing.
  - Full-suite flakes that pass alone: `workflow-executions.test.ts` (terminate cases) and `automation-steps.test.ts` (429 `CONCURRENCY_LIMIT`).
  - Run the Python suites the way CI does: `uv run --extra dev python -m pytest -q` in `apps/tenant-runner` and `apps/temporal-worker`; for stdlib, `uv run --project ../workflows-sdk-python --extra dev python -m pytest -q` from `packages/workflows-stdlib`. A plain `uv run` gives false failures. Delete any `uv.lock` those runs create.
  - The tenant runner registers `pegasus_workflows.steps.BUILTIN_ACTIVITIES` only (`apps/tenant-runner/pegasus_tenant_runner/workflow_worker_driver.py`). The new await activity must be added to that list.
- **Verification still owed:**
  - Steps 7–10 are unbuilt.
  - The device check of 1–3a on vcode 26: block a task, see the dispatcher's push and Activity row, and the tap opening `/chat/<order>`.

## Steve's calls (all five: YES, as recommended, 2026-11-23)

- **S1. Re-cut 3b/3c (recommended).**
  - **The problem with the current split:** 3b's sweeper would ship with nothing to sweep. Nothing sets an awaiter until 3c's `await_task`, and no `appliesWhen`/`satisfiedWhen` predicates exist until 3c.
  - **New 3b, "await a task, end to end":** SDK `await_task`, an awaiter registry for both stores, signal-on-close, and the sweeper limited to what that needs: redelivery, the legacy poll and abandoned awaiters.
  - **New 3c:** definitions as data with predicates, auto-done/cancel from them, `block_task`, Cedar `ManageTaskDefinitions` / `BlockTask`.
  - **3d is unchanged:** the editor, routing UI and stdlib longhaul Workflow.
- **S2. Keep the driver To Do computed; don't fold `TaskState` into `WorkItem` (recommended).**
  - The approved Phase 3 text says it folds, but folding means rows a sweeper keeps in step with each driver's itinerary.
  - That means reading every driver's itinerary through the tunnel on a timer, which the plan's own risks forbid ("never poll it on a timer").
  - `TaskState` stays the per-user overlay (snooze, dismiss, blocked) on computed tasks.
- **S3. Defer overdue reminders to Phase 4 (recommended).**
  - Cloud tasks have no human screen until the Phase 4 role queue, so a reminder would point at nothing.
  - No tenant routes a role to cloud yet anyway.
- **S4. Defer re-assigning `operations` tasks when the move's dispatcher changes (recommended).**
  - Each check is a legacy read per open task; that's Phase 4 queue work.
- **S5. Defer the legacy `operations` replay 409 (recorded on #985) to Phase 4 (recommended).**
  - Fixing it means storing which `assigneeCode` each legacy `dedupKey` got, which is a table just for retries.
  - It only bites when a dispatcher changes inside a retry window, and no tenant routes `operations` yet.

## Design (decisions made while drafting; veto here)

1. **`await_task` is an SDK helper, like `run_automation`** (`pegasus_workflows/tasks.py`):
   - A built-in activity, `pegasus.await_task_register`, registers the wait. It sends the Temporal workflow id (`activity.info().workflow_id`), so authors pass no ids.
   - It returns the task's **current** state. A task that's already closed returns at once, so no wake-up is missed.
   - Otherwise the helper installs a handler for the built-in signal `pegasus.task_closed` (`workflow.set_signal_handler`) and waits on `workflow.wait_condition`.
   - It returns the closed task, or raises `TaskAwaitTimeout` after `timeout=` (default: none; the Workflow's lifetime cap applies).
   - The tenant runner registers the activity through `BUILTIN_ACTIVITIES`.
2. **The server checks who is waiting.**
   - The runtime key is per **workflow** (`wf-runtime-<workflowId>`), not per execution. The server resolves the execution by its Temporal workflow id and checks four things:
     - it is in the caller's tenant;
     - it is a durable `WORKFLOW`;
     - it is RUNNING;
     - it belongs to the calling workflow.
   - Anything else is 404, like the broker's cross-tenant rule.
   - Route: `POST /api/v1/pegii/tasks/:taskId/await`, gated on `ReadTask` (it changes nothing outside the caller's own run). Not billable. Idempotent per (execution, task).
3. **`pegasus.`-prefixed signal names are reserved for the platform.**
   - The public signal route (`POST …/executions/:id/signal`) and event-routed delivery refuse them. That stops a forged `task_closed`.
   - Platform delivery skips the manifest's declared-signals check for these names.
4. **One awaiter table for both stores: `TaskAwait`.**
   - Columns: `tenantId`, `executionId`, `store`, `taskId` (string), `orderNum` (for batching legacy polls), `status` (`waiting | delivered | abandoned`), `attempts`, `lastError`, `nextPollAt`, timestamps.
   - Unique on (`executionId`, `store`, `taskId`). Many-to-many: one task can have several waiters, and one execution can wait on several tasks.
   - 3a's unused `WorkItem.awaitingExecutionId` column is **dropped**. Nothing ever wrote it, and the table replaces it.
5. **A cloud close signals its waiters after the commit,** best-effort and inline:
   - A failed signal never fails the close; the awaiter stays `waiting` and the sweeper redelivers.
   - `TERMINAL`, `NOT_RUNNING` or `NOT_DURABLE` → `abandoned`.
6. **The sweeper is a Lambda on an EventBridge schedule every 5 minutes** (`lambda-task-sweeper.ts`). It runs on the root client and binds `tenantId` everywhere. Each tick:
   - **(a) Redelivery:** `waiting` cloud awaiters whose task is closed get signalled.
   - **(b) Legacy poll:** `waiting` legacy awaiters with `nextPollAt <= now`, grouped by (tenant, order), at most 50 orders per tick. One `listOrderTasks` per order; closed tasks get signalled; the rest get `nextPollAt = now + 15 min`.
   - **(c) Cleanup:** awaiters whose execution is terminal become `abandoned`.
7. **A pegII caller without a request.** Extract `buildPegiiCaller(tenantDb, { tenantId, tenantUserId, correlationId, companyId? })` from `resolvePegiiCaller`, which keeps its signature.
   - `tenantDb` MUST be scoped to `tenantId` (`createTenantDb`). The default-company lookup has no `tenantId` of its own, so on the root client it would pick any tenant's default company. The sweeper builds a scoped client per tenant.
   - **The sweeper acts as the awaiting Workflow's own runtime service account** (its ApiClient's acts-as `TenantUser`). Minting refuses a subject-less principal (`PEGII_PRINCIPAL_UNRESOLVED`), and this attributes each poll to the Workflow that is waiting. It only reads.
   - pegII goes through `tunnelFetch` (the in-VPC tunnel-proxy Lambda), so the sweeper needs no VPC, just invoke rights.
8. **Infra:** a `NodejsFunction` in `api-stack.ts` beside the reconciler, in the Temporal-configured branch.
   - Same Temporal env, secret and `workflowTokenKey.grantDecrypt`.
   - Tunnel-proxy invoke permission and the DB secret.
   - Its own log group; an alarm on errors.
   - Infra tests for the rule and the permissions.
9. **SDK:** next free version (0.69.0 if still free at landing).
   - `await_task(task_id, *, timeout=None)` and `TaskAwaitTimeout`.
   - The activity in `BUILTIN_ACTIVITIES`.
   - Testing-harness classification for the activity, plus an offline fake that resolves from a staged task.
   - README, MCP, CHANGELOG and OpenAPI; then the authoring repo's `CLAUDE.md` after publishing.
10. **The runner ships with the API, so there's no deploy-order risk.** Checked 2026-11-23:
    - The tenant-runner image builds the SDK from `packages/workflows-sdk-python` in the monorepo (Dockerfile), so the same deploy carries the new activity.
    - The runner registers `pegasus_workflows.steps.BUILTIN_ACTIVITIES` (`workflow_worker_driver.py`). The new activity must be added to **that** list, or the worker never registers it.

## Steps

- [x] 1. `buildPegiiCaller` extracted (no behaviour change; own commit). Done 2026-11-23: `resolvePegiiCaller` is now a thin wrapper; two direct tests (service account + correlation id; a user outside the tenant does not resolve). Full API suite green.
- [x] 2. Prisma: `TaskAwait` + drop `WorkItem.awaitingExecutionId`; migration; `TENANT_SCOPED_MODELS`. Done 2026-11-23: migration `20261123231442_task_awaits` (enums `TaskStore`, `TaskAwaitStatus`; table `task_awaits`; `DROP COLUMN awaiting_execution_id`), applied to the worktree DB; client regenerated; tsc clean; tenant-isolation + cloud-task gateway tests green.
- [x] 3. Reserved `pegasus.` signal prefix (public route + event routing) + platform delivery bypass; tests. Done 2026-11-23: `lib/signal-workflow-execution.ts` has `RESERVED_SIGNAL_PREFIX`, `TASK_CLOSED_SIGNAL`, `isReservedSignalName` (case-insensitive) and `signalPlatformExecution`, which skips the declared-signals check and throws on a non-reserved name. Three tenant paths refuse reserved names: the signal route (400 `SIGNAL_NAME_RESERVED`, checked before the regex), manifest `signals`, and `signalBindingError` (trigger create/patch, re-run at dispatch). The tests declare the reserved name in the manifest, so they prove the explicit check and not the regex; dotted names already failed `SIGNAL_NAME_REGEX`. OpenAPI signal-route text updated. **Owed in step 8:** the SDK's `manifest.py` validator refuses dotted names only through the regex; add the explicit `pegasus.` check there too.
- [x] 4. `POST /tasks/:taskId/await` (D2) + repository; tests (cross-tenant, wrong workflow, terminal, already closed, idempotent). Done 2026-11-24.
  - **What was built:** `repositories/task-await.repository.ts` (`registerWaiting`, `markDelivered`, `findOne`) and the route in `handlers/pegii-runtime.ts`. Body `{ temporalWorkflowId }`; the response is the task plus `awaiting`. The OpenAPI entry `awaitPegiiTask` is done now, not in step 9.
  - **Tests:** 22 Postgres integration tests in `handlers/pegii-runtime-await.test.ts`. A mutation check confirmed that the `workflowId` scope and the cloud re-read are each caught by a test.
  - **The caller is resolved like `automation-steps`.** `findByRuntimeApiClientId` must give a `WORKFLOW`; this is stronger than parsing the `wf-runtime-` name.
  - **Deviations from D2:**
    - A caller that isn't a durable Workflow's token (an Automation's, or a human session) gets **403 `AWAIT_CALLER_NOT_WORKFLOW`**, matching `STEP_CALLER_NOT_WORKFLOW`.
    - Every run mismatch (another tenant's, another Workflow's, a closed or an unknown run) is one indistinguishable **404 `EXECUTION_NOT_OPEN`**.
    - The run may be **QUEUED or RUNNING** (D2 said RUNNING), the same as `PARENT_NOT_OPEN` and `signalDurableExecution`.
  - **Pre-stamp race, closed on the server.** A manual run's `temporalWorkflowId` is stamped by `markStarted` only AFTER Temporal's start returns, so a Workflow that awaits first could call too early. The default id `wf/<tenant>/<name>/<executionId>` contains the execution id, so the route also matches that id on an unstamped row (same tenant, the caller's workflow, open). Keyed `wfl/…` and trigger ids are written at insert.
  - **`run_automation` has the same latent race and it is NOT fixed.** It treats `PARENT_NOT_OPEN` as final (`steps.py`), and `automation-steps` has no fallback. It's a candidate follow-up; record it in GOTCHAS in step 9.
  - **Closed task:** answers `awaiting: false` and marks any earlier `waiting` row for this run `delivered`.
  - **Open task:** `registerWaiting` creates or re-arms the row (`attempts` 0, `lastError` null, `deliveredAt` null; legacy `nextPollAt` = now, cloud null). A unique-key race re-arms the winner's row.
  - **Cloud close race:** a cloud task is re-read once after the row write, so a close in between answers `awaiting: false` and leaves the row `delivered`. A legacy task is read once; the sweeper polls it.
- [x] 5. Cloud close → post-commit signal to waiters (D5); tests. Done 2026-11-24.
  - **Delivery module:** `lib/task-await-delivery.ts`.
    - `deliverTaskClosed(db, tenantId, awaiter, task)` handles one waiter. The sweeper reuses it.
    - `notifyTaskWaiters(db, tenantId, task)` fans out to every waiter of a task. It runs sequentially and never throws.
    - The payload is the task's wire shape. `toTaskResponse` moved to `lib/task-response.ts`, so `await_task` gets the same shape from the route and from the signal.
  - **Outcomes:**
    - `SIGNALLED` → `delivered`.
    - `TERMINAL`, `NOT_RUNNING`, `NOT_DURABLE`, or a missing run or workflow row → `abandoned`, with the reason in `lastError`.
    - `NOT_STARTED`, `SIGNAL_FAILED`, or a thrown error → stays `waiting`, with `attempts + 1` and `lastError`.
  - **Hook point:** `cloud-task.gateway` gained an `onClosed` option. It fires once, after the update, and only when this call did the close (`count === 1`). A hook that throws is logged and the close stands. `resolveCloudTaskGateway` wires it to `notifyTaskWaiters`, so every cloud close through the gateway signals its waiters, including Phase 3c's and Phase 4's.
  - **Only one close path exists today:** `/tasks/close`. No other code writes `WorkItem.status`.
  - **Repository methods added:** `listWaitingForTask`, `markDeliveredById`, `markAbandoned`, `recordFailure`. All are conditional on `waiting`, so two racing deliveries never regress a row.
  - **Tests:**
    - 14 Postgres tests in `lib/task-await-delivery.test.ts`, three of them end to end through the factory gateway's `closeTask`.
    - 2 gateway hook tests: it fires once and post-commit, and a throwing hook doesn't fail the close.
    - The full API suite passes (345 files, 5566 tests).
- [x] 6. Sweeper Lambda (D6) + tests on Postgres with a fake signaller and a fake legacy gateway. Done 2026-11-24.
  - **What was built:** `src/lambda-task-sweeper.ts`.
    - `sweepTaskAwaits(opts)` does the work; `handler` runs it and then emits CloudWatch counts.
    - Root client, with `tenantId` named on every per-tenant query.
    - A 4-min time budget: no new work starts after it.
  - **Lane order** — cleanup first, so the sweeper never polls or signals for a dead run:
    - **(c) Cleanup:** `waiting` awaiters whose run has ended → `abandoned` / `EXECUTION_ENDED`. One cross-tenant `updateMany`; each row is judged through its own foreign key.
    - **(a) Cloud backstop:** up to 100 due cloud awaiters.
      - Their WorkItems are looked up by (`tenantId`, id).
      - Closed → `deliverTaskClosed`.
      - Still open → re-checked in 15 min. This makes open waits rotate, so they never starve the batch.
      - Closed less than 60 s ago → left to the close's own delivery.
      - Not in its own tenant → `abandoned` / `TASK_NOT_FOUND`.
    - **(b) Legacy poll:** due legacy awaiters, grouped by (tenant, order), at most 50 orders, one `listOrderTasks` per order.
      - Closed → delivered.
      - Open → re-polled in 15 min.
      - Missing → `abandoned` (`TASK_NOT_FOUND`, or `ORDER_NOT_FOUND` when the whole order is gone).
      - A failed poll → `attempts + 1` and re-polled in 15 min.
  - **Decisions made in this step:**
    - **Cloud also uses `nextPollAt`.** It now means "when the sweeper next checks this awaiter" for both stores. Only the schema doc comment changed, so no migration.
      - **Why:** `db-access-guard` allows raw SQL only in the health check and one advisory lock, each addition with a security review.
      - The closed-task join was replaced by reading due awaiters first, then their WorkItems.
    - **A legacy task that disappears is abandoned.** The Workflow's `await_task` timeout or its lifetime cap ends its wait.
      - **Possible follow-up:** a "task gone" signal, so the Workflow learns of it at once.
    - **No cap on attempts.** At 12 or more (`STUCK_ATTEMPTS`), each tick logs an error ("Task await stuck") and the row is never abandoned. Once Temporal or the tunnel recovers, the next attempt succeeds.
  - **Identity (D7):**
    - Each legacy poll acts as the first waiter's Workflow runtime account: Workflow → `runtimeApiClientId` → an ApiClient in **this** tenant, not revoked → `actsAsUserId`.
    - The caller is built on `createTenantDb(db, tenantId)`.
    - If no account resolves, the result is `RUNTIME_ACCOUNT_UNRESOLVED` (`attempts + 1`). The sweeper never guesses an identity.
    - This applies to a GLOBAL Workflow row too, whose client lives in the platform tenant. The `automation-steps` caller check has the same limit already.
  - **New option `onlyTenantIds`.** It restricts every lane to the listed tenants.
    - The sweeper is cross-tenant, so in the shared test database a sweep from one suite touched another suite's rows; the first parallel run failed that way.
    - The tests always pass this option. It also works as an operator's one-tenant sweep.
  - **Tests:** 19 Postgres tests in `src/lambda-task-sweeper.test.ts`.
    - The pegII caller is built for real, and the tests assert the poll acted as the runtime service account.
    - Mutation checks are caught: the cloud tenant scope, the ApiClient tenant scope, and legacy delivery.
    - The full API suite passes (346 files, 5585 tests).
- [ ] 7. Infra (D8) + infra tests.
- [ ] 8. SDK `await_task` (D1, D9) + harness + docs; tenant-runner registration check (D10).
- [ ] 9. OpenAPI; parent plan (re-cut, S2 fold decision, TQ-D4 guardrail 4 as built); DECISIONS; GOTCHAS.
- [ ] 10. Gate: typecheck, lint, API/domain/mobile/infra tests, SDK + stdlib + runner + worker pytest; restore coverage floors.

## Open questions for Steve

S1–S5 above.
