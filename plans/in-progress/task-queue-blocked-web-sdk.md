# Task queues — Phase 2b: Blocked (andon), tenant-web bell, SDK notify

**Branch:** `feat/task-queue-blocked-web-sdk` (worktree `../pegasus-task-queue-blocked-web-sdk`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 2 (2a shipped as #971).
**Decided (Steve, 2026-11-18):** a Blocked task notifies the **operations role** (open question 3).

## Resume here

- Status: started 2026-11-18. One PR, three commits: Blocked → web bell → SDK `notify`. The SDK slice can be split into its own PR if needed.

## Steps

- [ ] **Blocked**
  - `TaskState.blockedAt` / `blockReason`.
  - `PUT /me/tasks/state` gains `blocked: { reason } | null`.
  - Blocking requires the driver mapping and checks the key is among the caller's current tasks (one legacy read; fails closed).
  - Notifies (`task.blocked`) only on the not-blocked → blocked transition, sent to active non-service users holding an operations role, excluding the caller. Returns the count.
  - GET shows blocked tasks (blocked beats snoozed/dismissed).
  - Mobile: a Blocked action with a reason modal, a badge, and Unblock.
- [ ] **Web bell**
  - The AppShell bell polls only the unseen count; the panel opens the list (seen / read / read-all; links to the same targets as mobile).
  - A notification settings page.
- [ ] **SDK `notify`**
  - A new Cedar action granted to `workflow_runtime`.
  - `POST /api/v1/notifications/notify` with one fixed type, `workflow.message` (default `feed`). Addressed to users or a role (validated), with capped recipients. Prefixed dedupe keys.
  - SDK method, README, MCP, OpenAPI, CHANGELOG, version bump; the authoring repo's `CLAUDE.md` after merge.
