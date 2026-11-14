# Task queues + Activity feed (mobile To Do, web role queues, Workflow-driven human tasks)

**Branch (this plan):** `docs/task-queue-plan` (worktree `../pegasus-task-queue-plan`). Each phase below gets its own worktree and branch.
**Goal:** Give drivers a To Do list and an Activity feed in the mobile app, then give office roles guided task queues on the web that replace legacy reports. Tenants control the tasks through their Workflows and through task definitions they can edit.
**Status:** Design APPROVED by Steve 2026-11-12..14 (Q1–Q3 below). Nothing built. Phase 1 is the next action.

---

## Resume here (2026-11-14)

- **Next action:** start Phase 1 (driver To Do, computed when it's read) in a fresh `feat/` worktree. It needs nothing from legacy and nothing from Workflows.
- **In parallel, two prerequisites unrelated to Phase 1:**
  - Fix the **QMM task-list 500** (§Findings F7). Prerequisite for any QMM switchover; it also breaks SDK `list_tasks(order_id=…)` on QMM today.
  - Ask Steve to run the **SQL measurement script** on PegNW (§Findings, "Still unmeasured"). Needed before Phase 4's NW import, not before.
- **Long-running Workflows:** its Phase 4 is done except the tenant-web section, with signal triggers, `run_automation` and list/query/cancel shipped (SDK 0.66.0). Phase 3 here depends on it and is unblocked.

---

## 1. Decisions

### TQ-D1: To Do and Activity are two different kinds of data

- **To Do = tasks computed from state.** A rule over the current state produces a task under a stable key. The task resolves itself when the state changes; the driver never ticks a box for data entry. Tapping a task opens the screen that completes it (ETA editor, `AddDocumentModal` with the document type preset).
- **Activity = a feed with one row per recipient** (who, what happened, which order), with seen/read state, grouping and a deep link.
- **Push becomes a channel of Activity.** A single `notify()` writes the feed row, then enqueues `PushNotificationOutbox` if the recipient's preferences allow it.
- `PushNotificationOutbox` stays a delivery queue. It has no read state and is never treated as the feed.
- **Messages (chat) stays its own section.** Chat mentions also post to Activity.

### TQ-D2: Human tasks are a platform entity that Workflows create and await (amends long-running plan D2)

- **Why the task isn't Temporal state:**
  - A role queue spans thousands of executions, so it needs a queryable table.
  - Completing a task needs Cedar authorization and an audit trail.
  - Flow metrics (lead time, blocked time, WIP) come from task rows.
  - Built-in rules must produce tasks for tenants that have written no Workflow.
- **How a Workflow uses it:** it creates a task and waits for a completion signal (the `wait_condition` + signal machinery from the long-running plan).
- **Who decides a task is done:** the platform evaluates "done", from facts (a document exists, an ETA fact exists), a form, or an explicit close.
- **Task definitions are data that ops leads edit:** name, owning role, when it applies, when it is done, due offset, escalation and deep link. Workflow code orders the steps; the definitions describe the work. This follows TPS: standard work is written by the people who do it. Long-running D1 rejected declarative _workflows_; declarative _task definitions_ are a smaller step and don't reverse it.
- **Every task can be Blocked with a reason** (andon / amplification), not just Done. A blocked task notifies its owning role, and a Workflow can branch on it.

### TQ-D3 (Q1): Migrate per tenant × role, build in parallel, no sync (Steve, 2026-11-12)

- Driver tasks and Workflow-created tasks are cloud-only from day one. Legacy has no driver tasks, so nothing overlaps.
- **Office tasks:** legacy `Tasks`/`mastertasks` stays authoritative until a tenant moves **one role** to the cloud queue. Switchover per (tenant, role):
  1. Import that role's `mastertasks` as task definitions, and have the tenant review the import.
  2. Set those templates `active='N'` in legacy, so the desktop stops creating tasks from them.
  3. Import the role's open `Tasks` as cloud tasks.
- Switching back means re-activating the templates.
- **No sync in either direction.** For any role, its tasks live in exactly one store at any time.
- **What the desktop shows after switchover** is decided at the first switchover. The recommendation is read-only history.
- Rejected alternatives:
  - Fold into legacy: no drivers, no history, a release per site for every capability.
  - Two-way sync: no task events in legacy, so it means polling and conflicts.
  - Big-bang: all risk on one date.
  - Leave office tasks alone: loses the office half of the goal.

### TQ-D4 (Q2): One SDK noun, routed per (tenant, role) (Steve, 2026-11-13)

- `create_task`, `close_task`, `list_tasks` and `get_task` (shipped for NW pulse, Phase 6, pegII-backed) stay the only task API. `task.gateway.ts` already resolves a gateway per tenant; add a cloud-backed gateway and route by (tenant, role).
- A switchover therefore never requires a Workflow rewrite.
- Guardrails:
  1. **Discoverable store.** Every task response carries `store: "legacy" | "cloud"`. A routing endpoint answers which roles use which store and what each supports, and is exposed in the SDK, MCP, CLI `--help` and OpenAPI.
  2. **Loud failure.** A cloud-only field sent to a legacy-routed role returns `400 UNSUPPORTED_ON_LEGACY_STORE`. Legacy-routed creates still require `due_date`.
  3. **Ids carry their store.** Cloud ids are UUIDs and legacy ids are ints; `get_task`/`close_task` route by id.
  4. **Awaiting works on both stores.** A cloud task signals on completion. For a legacy task the platform polls only the tasks some Workflow is awaiting (about every 15 min) and signals when one closes.
- **Implied movemanager change:** remove the compiled `ApiTaskTypes` allowlist (`Pulse Follow-Up` only). Legacy accepts any type and the cloud validates against definitions. One release per site, not one per type.

### TQ-D5 (Q3): Measure legacy usage before designing the import (Steve, 2026-11-14)

- Done for NW through the tunnel (§Findings).
- Template structure and the `sp_task_*` bodies still need the SQL script.

---

## 2. Findings: NW legacy task usage (measured 2026-11-14)

**Method:** read-only.

- Minted a temporary `workflow_runtime` key, the way `provisionRuntimeServiceAccount` does, and hard-deleted it afterwards (0 usage events).
- `GET /pegii/orders/search?dateField=plan_load` over 2026-08-16..2026-11-14, then `GET /pegii/tasks?orderId=` for each order.
- Results: 1,634 orders, 40,831 active tasks, 0 fetch failures.

|                  | Template (`taskType` "") | Added by hand (`USRDEF`) |
| ---------------- | ------------------------ | ------------------------ |
| Tasks            | 20,630                   | 20,196                   |
| Closed           | 56%                      | 95%                      |
| Open and overdue | 2,970                    | 36                       |
| No due date      | 7,151                    | 531                      |
| Distinct titles  | 79                       | ~4,000                   |

- **F1. The standard work is real.** About 25 core steps appear on 60–80% of orders and close 85–99% of the time. Closed tasks are median 0 days late, p90 1 day, 11% late. **The NW import is worth doing.**
- **F2. Templates that don't apply are the main source of noise.**
  - Auto-hauler and SIT templates are generated on almost every order. "CONFIRM 3RD PARTY AUTO HAULER DRIVER ASSIGNMENT" is on 63% of orders, 0% closed, with no due date.
  - Legacy picks templates by order attributes only. 5,954 open tasks have no due date.
  - ⇒ Definitions need an **"applies when"** condition over order state, plus **auto-cancel when the task no longer applies.**
- **F3. Overdue tasks are concentrated in checks the platform could verify.** 83% of the 3,008 overdue tasks are _CONFIRM ACTUALS WITH PVO AND UPDATE SYSTEMS_ (839), _CONFIRM OA SERVICES_ (801) and _CHECK DELIVERY ETA_ (695). ⇒ These are the first **auto-satisfied** definitions for the NW coordinator pilot.
- **F4. The legacy list is untrustworthy as a queue.** 6,560 open tasks sit on delivered orders. Some assignees hold 500+ overdue tasks each (codes 1603, 2213, 1217), probably people who left, since legacy freezes the assignee at creation. ⇒ Role queues + reassignment.
- **F5. Unexplained: `USRDEF` tasks repeat the template titles** (e.g. "INTRO CALL-UPDATE ACCOUNT" 910×) and 95% are closed. Possibly a copy/rebuild path or a team's private checklist. **Ask NW before designing the import.**
- **F6. Tasks are used as a log.** About 5,000 `USRDEF` tasks carry pasted email bodies. That need belongs to Activity / memos, not tasks; don't import it as tasks.
- **F7 — ROOT CAUSE FOUND 2026-11-14:** PegQMM's `Tasks.task_coord_id` is `smallint` (NW and RVS use `int`), and movemanager `ApiTaskRepository.ReadViews` called `GetInt32` on it. Fixed on movemanager branch `fix/qmm-task-coord-smallint` (worktree `~/repos/movemanager-qmm-task-smallint`), not yet landed on `dev`. After the site update, re-run the probe. Original symptom: **QMM's `GET /orders/{n}/tasks` returns 500 for every order** (site 2026.11.12.1, which advertises `pegii.tasks.v1`). It failed on 25 of 25 orders before the probe stopped. Not yet diagnosed; suspected missing `pegasus_api_task_meta` or `Tasks` column drift on pegQMM. Prerequisite for any QMM switchover; fix it independently.
- **Read-only SQL path (found 2026-11-14):** the prod in-VPC `mssql-executor` Lambda (`pegasus-prod-wireguard-MssqlExecutorFn…`) runs SQL against a tenant's legacy DB, using `tenants.mssql_connection_string`. The items below can be measured through it without Steve running anything: SELECT-only; adapt the script's `DECLARE`/`EXEC` parts.
- **Still unmeasured (needs the SQL script** at session scratchpad `legacy-task-usage.sql`; re-create it from §1–3 of the measurement design if the scratchpad is gone):
  - template selectors and base dates (`mastertasks`);
  - hand-edited due dates (`did_edit_target`);
  - the bodies of `sp_task_coord`, `sp_task_ops`, `sp_task_noncompleted`, `sp_task_ALL` and `TriggerTasksUpdate`. They differ per site and their filters become the first role-queue rules.
  - Also ask NW coordinators/ops: _"Which reports do you open every day to know what to work on?"_

### Legacy model being ported (movemanager, read-only reference)

- **`mastertasks` template:**
  - Which orders it applies to: wildcard selectors on move type, shipment type, payment type, account/relocation company, guaranteed pricing, mode, service type and packing type. The rule is the pure function `Pegasus/Pegasus.Domain/Task/MasterTaskSelection.cs`, with tests: the parity reference for the TS port.
  - Due date: a base date (one of 25 `KeyDates` planned dates, a documentation date, or the order date) plus an offset in days.
  - Owner: a role type (`CSR`, `FC`, …), resolved to an employee code at generation (`Pegasus/Pegasus.DataTypes/_Task/Task.vb`, `New Task(Master, Order)`).
- **Generation:** `FormSupport.GetTasksForOrder` creates tasks only when the order has no non-API tasks. `FormSupport.UpdateTasks` re-dates on every order save (skipping completed, `USRDEF` and hand-edited rows).
- **Completion:** manual (checkbox or actual date). Edit is allowed for every role (`TaskRules.CanEdit`).
- **Cloud bridge (shipped, pulse Phase 6):** pegII `POST/GET /orders/{n}/tasks`, `GET /tasks/{id}`, `GET /tasks?taskType=`, `POST /tasks/{id}/close`, with the `pegasus_api_task_meta` sidecar. The cloud side is `apps/api/src/gateways/{task.gateway,pegii-task.gateway,task-gateway.factory}.ts` and the SDK `create_task`/`close_task`/`list_tasks`/`get_task`.
- **Identity:** legacy owners are `salesman.code` values. Cloud identity already maps a login to its employee code (`pegii-token.ts` attribution `emp`), so imported tasks can land in the right person's queue.

---

## 3. Phases

Each phase is one `feat/` worktree and one PR (plan and code together). YAGNI applies: each phase adds only the tables it uses.

### Phase 1: Driver To Do, computed when it's read (cloud-only, no Workflows)

- [ ] **Domain** `packages/domain/src/tasks/`: a pure rule type `(facts) => TaskSpec[]`. `TaskSpec` has a stable key `task:<rule>:<orderNum>:<itemKey>`, title, due, priority, a deep-link target and a satisfied flag. Three built-in driver rules, with unit tests:
  - `submit-arrival-times`: an itinerary act whose day is past or today, with no `DONE` act fact and no legacy `actual`.
  - `submit-bol`: a delivery act done, and no `bol` `Document` on the order.
  - `submit-weight-ticket`: a load act done, and no `weight_ticket` `Document`. The v1 "done" signal is that the document exists, **not** that a weight was entered; the legacy weight write path is deliberately absent.
  - Rules must declare which move types / act codes they apply to (F2's lesson), and stay off unless the tenant enables them.
- [ ] **API** `GET /api/v1/me/tasks`: evaluated over the driver's itinerary read (`lib/itinerary/fetch.ts`), `ItineraryActFact` (`lib/itinerary/act-facts.ts`) and `Document` rows. `failedSources` from the itinerary passes through, so a partial list says it is partial. Cedar: same scope as the itinerary.
- [ ] **Persistence:** only `TaskState` (tenantId, userId, taskKey, `snoozedUntil`, `dismissedAt`), for snooze and dismiss. Tenant-scoped, added to `TENANT_SCOPED_MODELS`.
- [ ] **Tenant settings:** which built-in rules are on, kept in `Tenant.appSettings` like existing operations settings.
- [ ] **Mobile:**
  - `app/(drawer)/todo.tsx`: sections Overdue / Today / Upcoming, grouped by order. Tap opens `EtaEditorModal` or `AddDocumentModal` with the type preset. Swipe to snooze.
  - A drawer badge, and a "Top 3 tasks" card on the Dashboard (`app/(drawer)/index.tsx`).
  - Operations-only users don't see To Do (driver rules only, for now).
- [ ] **Tests:** domain unit tests, an API integration test (`apps/api`), mobile jest tests for the screen's grouping.
- [ ] **Docs:** `apps/mobile/README.md`. No SDK surface in this phase (built-in rules only).

### Phase 2: Activity feed + notify()

- [ ] **Prisma:**
  - `Notification` (tenantId, recipientUserId, type, actorUserId?, entityType, entityId, title, body, data/deepLink JSON, groupKey, createdAt, seenAt?, readAt?).
  - `NotificationPreference` (userId, type, `feed`/`push`/`off`).
  - Both tenant-scoped.
- [ ] **`lib/notify.ts`:** writes the feed row and, if preferences allow, `enqueuePush()` in the same transaction, then kicks the forwarder (`push-forward-invoke.ts`).
- [ ] **Move the existing pushes onto `notify()`:** `trip.assigned`, `move.assigned`, `chat.message` mentions (`lib/push-triggers.ts`), and staff `POST /notifications/send`.
- [ ] **API:** `GET /api/v1/me/activity` (cursor, filter all/unread/mentions), `POST …/seen` (clears the badge), `POST …/:id/read`, `POST …/read-all`, and preferences GET/PUT.
- [ ] **Blocked (andon):** `POST /api/v1/me/tasks/:key/block {reason}` stores the reason on `TaskState` and calls `notify()` to the order's coordinator / operations role.
- [ ] **Mobile:** `app/(drawer)/activity.tsx`, a header bell with the unseen count, grouping ("3 updates on #4242"), and push taps that open the item.
- [ ] **Web (tenant-web):** a bell and Activity panel reading the same endpoints.
- [ ] **SDK `notify(user_or_role, type, title, body, order_id=…)`** so Workflows can post Activity. Discovery surfaces as required by CLAUDE.md.

### Phase 3: Persistent task store, definitions as data, Workflow integration

- [ ] **Prisma:**
  - `TaskDefinition` (tenant-scoped, versioned): key, title, owningRole, appliesWhen (rule ref + params), satisfiedWhen (fact predicate ref | form | explicit), dueBase + offset, escalation, deepLink.
  - `WorkItem`: id, definitionKey + version, orderNum, owningRole, assigneeUserId?, status `open|blocked|done|cancelled`, dueAt, timestamps for each transition, `awaitingExecutionId?`, store.
  - Phase 1's `TaskState` folds into `WorkItem`.
- [ ] **Sweeper (EventBridge schedule):**
  - Re-evaluate `appliesWhen`/`satisfiedWhen` for open items: auto-done, auto-cancel (F2).
  - Overdue reminders through `notify()`.
  - Signal the awaiting Workflow on completion.
  - Poll legacy tasks that a Workflow is awaiting (TQ-D4 guardrail 4).
- [ ] **Cloud `TaskGateway` + per-(tenant, role) routing** in `task-gateway.factory.ts`, with a routing setting per tenant.
- [ ] **SDK:**
  - `create_task` gains optional `role`, `definition`, `satisfied_when`.
  - Add `await_task` (a Temporal helper: `wait_condition` on the completion signal).
  - Add `block_task`.
  - Responses gain `store`. Add the routing introspection endpoint.
  - SDK version = next free at the time. MCP `pegasus://reference/*`, CLI `--help`, OpenAPI, README, and the authoring repo's `CLAUDE.md`.
- [ ] **Cedar:** reuse `ReadTask`/`CreateTask`/`CloseTask`; add `ManageTaskDefinitions` (ops lead) and `BlockTask`. Metering: `CreateTask` is already billable; check the pinned list test.
- [ ] **tenant-web:** a task-definition editor for ops leads (list, edit due offset / role / applies-when params, version history).
- [ ] **`workflows-stdlib`:** a default longhaul Workflow + definition set as the baseline tenants customize (answers long-running open question 4).

### Phase 4: Web role queues + NW coordinator switchover pilot

- [ ] **movemanager (separate plan in that repo):**
  - Remove the `ApiTaskTypes` allowlist.
  - Add a read endpoint for `mastertasks` and for open `Tasks` per role (for the import).
  - Ship under capability `pegii.tasks.v2`.
- [ ] **Import tool:** `mastertasks` → `TaskDefinition` drafts, which the tenant reviews.
  - Map `coordinator_type` → role.
  - Selectors → `appliesWhen`, ported from `MasterTaskSelection` with a C#-parity test table.
  - Drop never-applicable templates (F2).
  - Exclude log-style `USRDEF` rows (F6).
- [ ] **Switchover runbook:** import → review → set legacy templates `active='N'` → import open tasks → flip the routing for (NW, coordinator). Switch-back path documented.
- [ ] **NW coordinator pilot definitions:** the F3 three as auto-satisfied:
  - actuals entered ⇒ CONFIRM ACTUALS done;
  - OA services recorded ⇒ CONFIRM OA SERVICES done;
  - delivery ETA known ⇒ CHECK DELIVERY ETA done.
  - The exact fact sources are decided in this phase from the `sp_task_*` bodies and the NW interview.
- [ ] **tenant-web role queue:** Overdue / Today / Upcoming / Blocked, claim/assign/reassign, filter by role or person, WIP and age per queue.
- [ ] **Flow metrics:** lead time per definition, % late, blocked-reason Pareto, WIP per role, compared by definition version (PDCA).

### Phase 5: QMM / RVS switchovers

- [ ] Prerequisite: the F7 fix is deployed on QMM, and the probe is re-run (same method as §2).
- [ ] The same runbook as Phase 4, per role.

---

## 4. Files (by phase, so far as known now)

- **Phase 1:**
  - `packages/domain/src/tasks/*` (new)
  - `apps/api/src/handlers/me-tasks.ts` (new), `apps/api/src/app.ts` (route)
  - `apps/api/prisma/schema.prisma` + migration (`TaskState`)
  - Cedar policy for the route
  - `apps/mobile/app/(drawer)/todo.tsx`, `_layout.tsx`, `index.tsx`, `src/services/taskService.ts` (new), `src/components/DrawerContent.tsx`
- **Phase 2:**
  - `apps/api/src/lib/notify.ts` (new), `lib/push-triggers.ts`, `handlers/notifications.ts`, `handlers/chat.ts` (mentions), schema + migration
  - `apps/mobile/app/(drawer)/activity.tsx`, the mobile header
  - tenant-web AppShell (bell)
  - SDK `api.py`, README, MCP resources, OpenAPI spec
- **Phase 3:**
  - schema + migration, `gateways/cloud-task.gateway.ts` (new), `gateways/task-gateway.factory.ts`, `handlers/pegii-runtime.ts` (task routes), a sweeper Lambda + `packages/infra` schedule
  - SDK (`api.py`, Temporal helper module), tenant-web definitions editor, `packages/workflows-stdlib`
- **Phase 4:** movemanager endpoint + allowlist removal (that repo's plan), the import tool, tenant-web queue pages.
- **This plan PR:** this file, `plans/in-progress/long-running-workflows-and-automations.md` (D2 amendment note), `dolas/agents/project/DECISIONS.md` (one bullet).

## 5. Risks

- **Hot files:** `schema.prisma`, `app.ts`, Cedar schema, `task-gateway.factory.ts` and SDK version numbers collide with the long-running Workflows streams. Take the next free SDK version when landing; relock `uv.lock`; the CHANGELOG conflict is the only visible one (see the 0.59.0 collision lesson).
- **Phase 1 reads legacy through the tunnel on every To Do load,** via the itinerary. Keep it to one itinerary read; never poll it on a timer.
- **Push fatigue:** default preferences send to the feed only, except assignment and mention, which also push.
- **Legacy awaited-task poller (Phase 3) loads the tunnel.** Poll only awaited tasks, batch per order, at ≥ 15 min intervals.
- **The switchover leaves old tasks visible on the desktop.** Decide read-only vs hidden at the first switchover.
- **Weight-ticket rule:** a document can exist with a wrong weight. Accepted for v1 (no weight write path).

## 6. Open questions

1. F5: why NW's `USRDEF` tasks repeat the template titles (ask NW).
2. Does an office-scanned BOL (legacy imaging) count as done for `submit-bol`? v1: cloud documents only.
3. Which roles see a driver's Blocked task: the order's coordinator, operations, or a configurable role?
4. Is "WorkItem" an internal name only? The proposal is that users and the SDK always say "task".
