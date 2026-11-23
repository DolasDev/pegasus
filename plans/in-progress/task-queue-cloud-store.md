# Task queues — Phase 3a: cloud task store, per-(tenant, role) routing, SDK `role=`/`store`

**Branch:** `feat/task-queue-cloud-store` (worktree `../pegasus-task-queue-cloud-store`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 3 (TQ-D2, TQ-D3, TQ-D4). Phases 1, 2a and 2b shipped (#969, #971, #975).
**Status:** drafted 2026-11-19; step 1 in progress 2026-11-20. Steve's answers (2026-11-19/20): D1 revised (OPS → the move's dispatcher), D3 = an unconfigured role falls back to **legacy** (the desktop), and Blocked notifies the move's dispatcher (step 4b). Remaining D-decisions can still be vetoed.

## Phase 3 split (re-cut 2026-11-19)

The parent plan suggested 3a = tables + gateway, with every SDK change in 3c. That doesn't work: guardrail 1 (TQ-D4) and CLAUDE.md's SDK rule require the routing endpoint, `store` and `role=` to ship with their SDK, MCP, CLI, OpenAPI and README surfaces in the same change. So:

- **3a (this plan):** `WorkItem` + a minimal `TaskDefinition`, a store-neutral `TaskGateway`, the cloud gateway, routing per (tenant, role), the routing introspection endpoint, guardrails 1–3, and the SDK surface for exactly those (`role=`, `store`, `get_task_routing()`).
- **3b:** the sweeper Lambda + `packages/infra` EventBridge schedule (auto-done/cancel, overdue `notify()`, signal awaiting Workflows, legacy awaited-task poll ≥ 15 min). Decides whether `TaskState` folds into `WorkItem`.
- **3c:** SDK `definition=` / `satisfied_when=`, `await_task`, `block_task`, Cedar `ManageTaskDefinitions` / `BlockTask`. Fixes the `TaskDefinition` predicate/escalation columns.
- **3d:** tenant-web definition editor + routing UI, `workflows-stdlib` default longhaul Workflow.

## Resume here

- Status: not started.
- **Deploy is a prod no-op by design:** no tenant has a routing entry, and a role-less create behaves exactly as today (Pulse is live at NW).
- **After merge:** tag `sdk-python-v<ver>` on the merge commit (verify `git merge-base --is-ancestor` first); update `~/repos/pegasus-workflows/CLAUDE.md` (`role=`, `store`, `get_task_routing`) and bump its pin.

## Decisions (made while drafting — veto here)

1. **Role noun (revised after Steve's answer, 2026-11-19):**
   - **`operations` (OPS) is a task owner that resolves per move.** **Steve:** "OPS tasks should go to the user that is the dispatcher on the move." The move's dispatcher is `sales.operations_id`, a salesman code: the column the trip save cascades and the shipments/activities lists filter on. `CompanyMembership` (cloud identity I3, `LINKED` rows) maps that code to a `TenantUser`.
   - **Every other role key** is a Cedar role-group name from `ROLE_OPTIONS` (`coordinator`, `driver`, …), the same vocabulary `/notifications/notify` validates. Unknown key → 400 `UNKNOWN_ROLE`, listing the valid ones (`operations` + `ROLE_OPTIONS`).
   - Legacy `coordinator_type` OPS → `operations`. The rest of that mapping (CSR/FC) is a Phase 4 import concern.
2. **Routing lives in `Tenant.appSettings.operations.taskRouting`**: `Record<role, 'legacy' | 'cloud'>`, patched through the existing settings handler (zod-validated; keys are `operations` + `ROLE_OPTIONS`). No UI until 3d.
3. **Resolution order:**
   - **No `role`** → **legacy**, exactly today's contract. Pulse and every existing caller are untouched. **Confirmed by Steve, 2026-11-19.**
   - **`role` with a routing entry** → that store.
   - **`role` without an entry** → **legacy** (the desktop). **Steve, 2026-11-20:** a role uses the cloud only once its routing entry says `cloud`. This reverses the draft's cloud default. A tenant with no pegII target that creates a task for an unconfigured role therefore gets today's 503 `PEGII_API_NOT_CONFIGURED`, and the routing endpoint says how to route that role to the cloud.
   - **Consequence:** the cloud store is opt-in per (tenant, role). Until Phase 4's role queue ships, a cloud task has no human-facing screen, so routing a role to `cloud` is meant for Workflow-to-Workflow tasks until then.
4. **Assignment by role:**
   - **`operations`, both stores:** create reads the order's `sales.operations_id` (one SELECT through the existing legacy SQL path).
     - **Legacy-routed:** that code is sent as `assigneeCode`, so the desktop task lands on the dispatcher, not the coordinator. No dispatcher on the order → 409 `ASSIGNEE_UNRESOLVED`; the Workflow can pass `assignee_code` explicitly. It never silently falls back to the coordinator.
     - **Cloud-routed:** the code → `CompanyMembership` (`LINKED`, the order's company) → `assigneeUserId`. If there's no dispatcher, or the dispatcher has no linked cloud user, the task is still created, owned by `operations` and unassigned, with `assigneeUnresolved: "NO_DISPATCHER" | "DISPATCHER_NOT_LINKED"` on the row and in the response, so Phase 4's queue can surface it.
     - The dispatcher is resolved **at create**. A later dispatcher change (the trip-save cascade) doesn't re-assign it; 3b's sweeper can.
   - **Any other role, legacy-routed:** the role only chooses the store. Legacy assigns `assignee_code` or else the order's coordinator, as today.
   - **The routing endpoint lists each owner's assignment rule** (e.g. `operations: "move dispatcher (sales.operations_id)"`).
5. **Loud failure in both directions (guardrail 2):**
   - Cloud-only inputs sent to a legacy-routed create → 400 `UNSUPPORTED_ON_LEGACY_STORE`. 3a has none yet (`role` only chooses the store), so the check is wired with an empty list; 3c adds `definition` / `satisfied_when` to it.
   - Legacy creates still require `dueDate`; it is optional on cloud. A **role-less** create without it keeps today's 400 `VALIDATION_ERROR` (unchanged contract). A legacy-routed create **with** a role and without `dueDate` → 400 `DUE_DATE_REQUIRED`.
   - Legacy-only inputs on a cloud-routed create: `assigneeCode` → 400 `UNSUPPORTED_ON_CLOUD_STORE`. A cloud task's assignee comes from its owner (D4: the dispatcher for `operations`; unassigned for group roles). Manual assignment is Phase 4's queue.
6. **Per-route routing:**

   | Route                                          | Routes by                                                                                                                                                                                                          |
   | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `POST /tasks`                                  | `role` (D3).                                                                                                                                                                                                       |
   | `GET /tasks/:id`, `POST /tasks/close {taskId}` | id shape (guardrail 3): UUID → cloud, digits → legacy, else 404.                                                                                                                                                   |
   | `GET /tasks?orderId=`                          | **both** stores, merged; each row carries `store`. Legacy is skipped only when the tenant has **no pegII target configured**; a configured-but-failing legacy read fails as today (503), never a silent half-list. |
   | `GET /tasks?taskType=` (cross-order search)    | optional `role`, resolved like create (no role → legacy, today's sidecar search). Single store per call, so keyset cursors stay simple.                                                                            |
   | `POST /tasks/close {orderId, taskType}`        | both stores; more than one open match across them → 409 `TASK_AMBIGUOUS` with `candidateIds` (mixed id shapes).                                                                                                    |
   | `GET /tasks/routing` (new)                     | — returns the tenant's routing, the default rules (D3) and per-store capabilities.                                                                                                                                 |

7. **Legacy resolution is lazy.** The factory no longer throws `PEGII_API_NOT_CONFIGURED` up front; a cloud-routed call never needs a pegII target. A legacy-routed call without one still gets that 503.
8. **Cloud contract parity:** `dedupKey` → `alreadyExists: true` (same request, 200, not billed) or 409 `IDEMPOTENCY_KEY_REUSED` (different request; compared by a stored request hash). Repeat close → `alreadyClosed`. Cloud create validates the order through the existing order gateway (one tunnel read per create, none per read) → 404 `ORDER_NOT_FOUND`; a tenant with no pegII target skips that check. One shared contract test table runs against both gateways (pegII via its stub client).
9. **`TaskDefinition` is created but has no reader or writer in 3a** (Steve named it for 3a). It carries only the columns 3a can settle: `id`, `tenantId`, `key`, `version`, `title`, `owningRole`, `createdAt`, unique `(tenantId, key, version)`. `appliesWhen` / `satisfiedWhen` / due base + offset / escalation / deep link are added in 3b/3c, once the sweeper fixes their shapes. `WorkItem.definitionKey` / `definitionVersion` are nullable and unused in 3a.
10. **`TaskState` does not fold into `WorkItem` in 3a.** Computed driver tasks can't become rows without the sweeper; 3b decides. `WorkItem` has `blockedAt` / `blockReason` / `awaitingExecutionId` columns, but blocking and signalling behaviour arrive in 3b/3c.

## Steps

- [x] **1. Store-neutral `TaskGateway` (no behaviour change; its own commit).** Done 2026-11-20: `TaskRecord` + `TaskCreateInput` in `task.gateway.ts`; `pegiiTaskToRecord` + `isPegiiInt` exported from the pegII gateway, which answers null for non-int ids without calling the site. The only visible change is `store: "legacy"` on every task response. Full api suite green.
  - String ids; a neutral `TaskRecord` (adds `store`); pegII gateway adapts `PegiiTaskDto` → `TaskRecord`.
  - Handlers in `pegii-runtime.ts` work on `TaskRecord`; `toTaskResponse` gains `store: "legacy"`.
  - All existing task tests green, unchanged apart from the added `store` field.
- [x] **2. Prisma:** Done 2026-11-20, migration `20261120235538_work_items_task_definitions` (two new tables + `WorkItemStatus` enum, nothing else). `WorkItem` also carries `assigneeEmployeeCode` and `assigneeUnresolved` (D4). Neither model is used by `notify()` or the push triggers yet, so the hand-mocked dbs are unchanged. `WorkItem` + `TaskDefinition` (D9), both tenant-scoped and in `TENANT_SCOPED_MODELS`; migration; add to the hand-mocked dbs (`app.test.ts`, `push-triggers.test.ts`) if anything there touches them.
  - `WorkItem`: `id` uuid, `tenantId`, `orderNum`, `taskType`, `title`, `description?`, `priority`, `owningRole`, `assigneeUserId?`, `status` (`open|blocked|done|cancelled`), `dueDate?` (date), `dedupKey?` + `requestHash?` (unique `(tenantId, dedupKey)`), `definitionKey?`, `definitionVersion?`, `closeReason?`, `closedByUserId?`, `blockedAt?`, `blockReason?`, `awaitingExecutionId?`, `createdAt`, `updatedAt`, `doneAt?`, `cancelledAt?`. Indexes: `(tenantId, orderNum)`, `(tenantId, owningRole, status, dueDate)`, `(tenantId, taskType, status)`.
- [x] **3. `cloud-task.gateway.ts`** implementing `TaskGateway` over `WorkItem` (D8), with the shared contract table. Done 2026-11-21.
  - The `orderExists` check is injected (the factory wires it in step 4). It runs once per new create, never on a replay or a read.
  - `TaskRecord` gains `role` and `assigneeUnresolved` (null on legacy); the response emits them in step 5.
  - `TaskStoreError(code, status)` is the cloud store's refusal. The legacy gateway throws it too, for `DUE_DATE_REQUIRED`. The router's `onError` maps it in step 5.
  - The cloud search keyset is over `(createdAt, id)`; an unrecognized cursor → 400 `INVALID_CURSOR`. The default page is 100.
  - Tests: `task-gateway.contract.test.ts` (7 cases × both stores; legacy runs against an in-memory fake site) and `cloud-task.gateway.test.ts`.
- [x] **4a. Dispatcher resolver:** `resolveMoveDispatcher(tenant, orderNum)` → `{ employeeCode, tenantUserId | null } | null`, from `sales.operations_id` + `CompanyMembership` (D4). Unit tests: no row, a null/0 code, linked, unlinked, and a code linked in a different company. `TenantUser`/`CompanyMembership` queries bind `tenantId` explicitly. Done 2026-11-22 (`lib/move-dispatcher.ts`).
  - The legacy read (`SELECT TOP (1) operations_id FROM sales`) is injected; `legacyOperationsIdReader` is the production reader.
  - `operations_id` is parsed whether it's varchar or int. Empty, 0 or non-numeric means no dispatcher.
  - Only a `LINKED` membership to an active, human user counts.
  - The company is the tenant's default target, which is what the task routes use today.
- [x] **4b. Blocked → the move's dispatcher** (changes 2b, `handlers/me-tasks.ts`). `task.blocked` goes to the dispatcher on the blocked task's order, resolved through 4a. It falls back to today's recipients (active non-service users holding an operations role, excluding the driver) when the order has no dispatcher, the dispatcher has no linked cloud user, or the lookup fails. The response's `notified` count is unchanged in meaning, plus a `notifiedVia: "dispatcher" | "operations-roles"`. Update the 2b tests and the mobile warning copy if it names "operations". Done 2026-11-22.
  - The lookup runs before the transaction. It also falls back to the operations roles when the dispatcher is the driver, and when the lookup throws (logged as a warning), so a stopped driver always reaches someone.
  - Mobile copy now names the dispatcher (`BlockTaskModal`, the "Nobody was notified" alert). That only ships with the next mobile build.
- [x] **4. Routing:** `taskRouting` in `app-settings.ts` (D2); `resolveTaskStore(settings, role?)` (D3) + unit tests; the factory resolves per store, legacy lazily (D7). Done 2026-11-22.
  - `lib/task-routing.ts`: `TASK_ROLES`, `resolveTaskStore`, `taskStoreForId`, and `TASK_ASSIGNMENT_RULES` for the routing endpoint.
  - `appSettings.operations.taskRouting`, settable through the existing `PATCH /settings/app` (`UpdateSettings`).
  - Factory: `resolveTaskGatewayForStore(store, ctx)` and `resolveCloudTaskGateway`. The cloud order check skips tenants with no pegII peer and fails loudly on an inactive one. `hasLegacyTaskStore` is for step 5's merged list. `resolveTaskGateway` (legacy) is unchanged, so the handlers still use only legacy until step 5.
- [x] **5. Handlers** (`pegii-runtime.ts`): `role` on create and search, guardrail 2 errors (D5), id-shape routing, merged order list, cross-store close-by-type (D6), `GET /tasks/routing` (`ReadTask`). **Register `/tasks/routing` before `/tasks/:taskId`** and test it, or the param route shadows it (this repo has been bitten by route shadowing before, #447/#526). Cedar unchanged (`ReadTask`/`CreateTask`/`CloseTask`); metering unchanged (`CreateTask`/`CloseTask` billable on both stores; Steve confirmed 2026-11-20). Done 2026-11-23. Decisions made while building:
  - **`lib/task-store-context.ts`** holds the request-side helpers: routing read, the merged order list, the `operations` dispatcher, and the cloud assignee. Tests stub only `taskRoutingFor` and `moveDispatcherFor`.
  - **An explicit `assigneeCode` on a legacy `operations` create wins**, and skips the dispatcher read.
  - **Dispatcher read failure → 503 `DISPATCHER_UNAVAILABLE`**, with nothing created. A tenant with no legacy DB has no dispatchers, so it gets `NO_DISPATCHER`.
  - **Legacy `operations` with no dispatcher → 409 `ASSIGNEE_UNRESOLVED`.** The message also says "or there is no such order": an unknown order has no `sales` row, and the dispatcher check runs before the site's 404.
  - **`role` is accepted on the cross-order search only.** `role` with `orderId` → 400. `meta.store` names the searched store.
  - **Cursor:** now an opaque string. A non-numeric cursor on a legacy search → 400 `INVALID_CURSOR` (it was a coerce error before).
  - **Close-by-type "none open":** the newest cloud task first (by `createdAt`), else the highest legacy id.
  - **`/tasks/routing` is registered before `/tasks/:taskId`**, with a test proving it isn't shadowed.
  - **Unchanged:** Cedar (`ReadTask`/`CreateTask`/`CloseTask`) and metering.
- [x] **6. OpenAPI** (`lib/openapi-spec.ts`): `role`, `store`, the new errors, `/tasks/routing`. Done 2026-11-23.
  - `TASK_SHAPE` gains `store`, `role` and `assigneeUnresolved`; a shared `TASK_STORES_NOTE` is used on every task route.
  - New `getPegiiTaskRouting`; create no longer requires `dueDate` in the schema; all the new error codes are listed.
- [x] **7. SDK** (next free version, 0.68.0 if still free — re-check `origin/main` at landing): Done 2026-11-23 as **0.68.0**. `origin/main` was merged in first: it had moved to 0.67.1 (#983).
  - **`create_task(role=)`:** `due_date` is optional in the signature. No role and no `due_date` → `ValueError` before any request.
  - **Dry run:** the captured result has `store: None`, because the tenant's routing decides the store server-side.
  - **`list_tasks(role=)`:** cross-order search only; `role` with `order_id` → `ValueError`.
  - **`get_task_routing()`** is classified as a READ in `testing._READS`.
  - **Parity matrix** gains a role-routed create.
  - **Docs:** the README "Tasks" section is rewritten for two stores; the MCP section is "Tasks — two stores, one API"; the CHANGELOG has a 0.68.0 entry.
  - **CLI:** no task-specific `--help` exists. The MCP api-reference introspects public methods, so it picks up `get_task_routing` without changes.
  - **Format:** `ruff format --check` flags `tests/test_api.py` and `cli/mcp_server.py` on `origin/main` too, so I didn't reformat them.
  - **After merge:** tag `sdk-python-v0.68.0` on the merge commit, then update `~/repos/pegasus-workflows/CLAUDE.md` and its pin.
  - `create_task(..., role=None)`; `due_date` becomes optional in the signature (the server enforces it for legacy).
  - `list_tasks(..., role=None)` for the cross-order search.
  - `get_task_routing()`.
  - Every task dict documents `store`.
  - `uv lock`, CHANGELOG, README, `cli/mcp_server.py` (`pegasus://reference/*`), CLI `--help` where tasks appear, `testing/__init__.py` `_MUTATIONS`, `tests/test_testing_harness.py` parity.
- [x] **8. Docs:** parent plan updated (split, Resume; amend TQ-D3's "Workflow-created tasks are cloud-only from day one": per Steve 2026-11-20 the cloud is opt-in per role, and an unconfigured role uses the desktop); `dolas/agents/project/DECISIONS.md` one bullet (routing resolution D3); GOTCHAS if anything bites. Done 2026-11-23.
  - **`DECISIONS.md`:** routing sub-bullets under the existing task-queue decision (cloud opt-in per role; id shape picks the store; `operations` = the move's dispatcher; Blocked → dispatcher; cloud tasks billable).
  - **`GOTCHAS.md`:** Prisma 7 `migrate dev` no longer regenerates the client.
  - **Parent plan:** TQ-D3 amended, Phase 3 cloud-gateway item checked, Resume rewritten.
  - **`apps/mobile/README.md`:** Blocked now goes to the dispatcher.
- [ ] **9. Gate:** `npm run typecheck`, api + domain tests, SDK tests; restore coverage floors (`git checkout` the two `vitest.config.ts`) before committing.

## Out of scope (3b–3d, Phase 4)

Sweeper, auto-done/cancel, overdue reminders, signalling, legacy awaited-task poll, `await_task`, `block_task`, definitions as data (predicates, editor), new Cedar actions, role queue UI, per-user assignment, `TaskState` fold, the `coordinator_type` mapping.

## Open questions for Steve

1. ~~Is a cloud `CreateTask` billable?~~ **Yes (Steve, 2026-11-20):** `CreateTask`/`CloseTask` stay billable on both stores, with the same not-billed rule for `alreadyExists`/`alreadyClosed`.
2. ~~D1: which role key owns an OPS task?~~ **Answered (Steve, 2026-11-19):** the move's dispatcher (D1, D4).
3. ~~Should 2b's Blocked notification follow the same rule?~~ **Yes (Steve, 2026-11-20):** step 4b.
4. ~~D3's default~~ **Answered (Steve, 2026-11-20):** an unconfigured role falls back to legacy (the desktop).
