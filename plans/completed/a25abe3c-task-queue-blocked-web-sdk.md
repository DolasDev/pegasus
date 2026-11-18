# Task queues — Phase 2b: Blocked (andon), tenant-web bell, SDK notify

**Branch:** `feat/task-queue-blocked-web-sdk` (worktree `../pegasus-task-queue-blocked-web-sdk`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 2 (2a shipped as #971).
**Decided (Steve, 2026-11-18):** a Blocked task notifies the **operations role** (open question 3).

## Resume here

- Status: done 2026-11-18. One PR: Blocked, web bell, API `/notifications/notify`, then SDK 0.67.0.
- **After merge:**
  - Publish the SDK: tag `sdk-python-v0.67.0` on the merge commit.
  - Add `notify` to the authoring repo's `CLAUDE.md` (`~/repos/pegasus-workflows`).
  - Ship a mobile build: the Blocked UI needs one.
- **Not yet verified on a device or on staging.**

## Steps

- [x] **Blocked**
  - `TaskState.blockedAt` / `blockReason`.
  - `PUT /me/tasks/state` gains `blocked: { reason } | null`.
  - Blocking requires the driver mapping and checks the key is among the caller's current tasks (one legacy read; fails closed).
  - Notifies (`task.blocked`) only on the not-blocked → blocked transition, sent to active non-service users holding an operations role, excluding the caller. Returns the count.
  - GET shows blocked tasks (blocked beats snoozed/dismissed).
  - Mobile: a Blocked action with a reason modal, a badge, and Unblock.
- [x] **Web bell**
  - The AppShell bell polls only the unseen count; the panel opens the list (seen / read / read-all; links to the same targets as mobile).
  - A notification settings page.
- [x] **SDK `notify`**
  - A new Cedar action granted to `workflow_runtime`.
  - `POST /api/v1/notifications/notify` with one fixed type, `workflow.message` (default `feed`). Addressed to users or a role (validated), with capped recipients. Prefixed dedupe keys.
  - SDK method, README, MCP, OpenAPI, CHANGELOG, version bump; the authoring repo's `CLAUDE.md` after merge.

## Decisions made while building

1. **Blocking re-checks the task.** It re-evaluates the caller's tasks (one legacy read, fails closed: 503 or 404) because it reaches other people. Snooze and dismiss still accept any well-formed key, since they only touch the caller's own row.
2. **Notify only on the not-blocked → blocked transition.** Re-blocking updates the reason, keeps the original time, and tells no one again. Unblocking tells no one.
3. **Recipients:** active, human users holding an operations role (the API's enforced `OPERATIONS_ROLES`: tenant_admin, operations_admin, long_distance_dispatch, central_planning_dispatch), excluding the driver. `PUT` returns `notified`, and mobile warns when it is 0.
4. **`task.blocked` defaults to push**, a deliberate exception to the push-fatigue rule: a stopped driver should be heard. Each recipient can turn it down.
5. **A blocked task stays on the To Do** even when snoozed or dismissed; the block wins.
6. **Links:** `task.blocked` (and `workflow.message` with an order) open the order's chat on both clients, where the office can reach the driver.
7. **The web bell polls only the unseen count** (every 60 s and on window focus; Postgres-only). The list loads when the panel opens. Settings live at `/notifications/settings`, open to every role.
8. **SDK `notify` uses one fixed type, `workflow.message`, and the server builds `data`.** Authors don't choose registry types. It defaults to Activity only.
9. **Addressing is by login email and/or role.** The SDK exposes no user ids. Unknown email or role → 400 with nothing sent; more than 100 people → 400. Service accounts are never recipients.
10. **Dedupe keys are namespaced** `workflow:<key>:<userId>`, so a Workflow can't claim a system event's key.
11. **`NotifyUsers` is a new Cedar action**, granted to `workflow_runtime` (`tenant_admin` via its blanket policy). It is not billable, being internal-only. The staging E2E suite doesn't pin `workflow_runtime`'s permissions, so nothing goes red after merge.
