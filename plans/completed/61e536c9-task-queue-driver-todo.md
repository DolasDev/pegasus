# Task queues — Phase 1: driver To Do, computed when it's read

**Branch:** `feat/task-queue-driver-todo` (worktree `../pegasus-task-queue-driver-todo`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 1 (approved by Steve 2026-11-12..14; "start phase 1" 2026-11-16).
**Goal:** Drivers see a To Do list in the mobile app of tasks computed from their itinerary + documents. A task resolves itself when the data arrives; tapping it opens the screen that satisfies it. Cloud-only, no Workflows, no legacy writes.

## Resume here

- Status: implementation done 2026-11-16 (domain, API, tenant-web setting, mobile). Lands as one PR.
- **Not yet verified on a device or on staging.** After deploy: enable the rules for a test tenant (tenant-web Settings → App → Operations → Driver To Do), log in on the mobile app as a mapped driver, and check that the list matches the itinerary.

## Steps

- [x] **Domain** `packages/domain/src/tasks/`: `evaluateDriverTasks(facts) => TaskSpec[]`, `taskBucket`, three rules with declared act codes, 15 unit tests.
- [x] **Persistence:** `TaskState` (tenantId, userId, taskKey, snoozedUntil, dismissedAt), unique on (tenantId, userId, taskKey), in `TENANT_SCOPED_MODELS`; migration `20261116200024_task_states`.
- [x] **Tenant settings:** `appSettings.operations.driverTaskRules` (off when unset or empty) + the tenant-web "Driver To Do" card.
- [x] **API** `GET /api/v1/me/tasks?today=` + `PUT /api/v1/me/tasks/state`; 19 handler tests.
- [x] **Mobile:** `app/(drawer)/todo.tsx`, `TasksContext` (one load for the screen, the badge and the card), drawer entry + badge, Dashboard "To Do" card (top 3), `AddDocumentModal` `initialType`; hidden for Operations-only users. Jest tests.
- [x] **Docs:** `apps/mobile/README.md`. The parent plan's Phase 1 is ticked when this archives.

## Decisions made while building (deviations from the parent plan's Phase 1 text)

1. **`submit-arrival-times` is satisfied by "Mark done", not the ETA editor.** The rule clears on a DONE fact or a legacy actual, and the ETA editor writes neither (and answers 409 for trip activities). The fact stores a **day, not a time**, so in practice this task means "confirm the act was done". A real arrival _time_ would need a new fact shape. Ask Steve whether that's wanted.
2. **Fail closed.** A failed act-fact or document read suppresses the rules that depend on it and is reported in `meta.unavailable`. The itinerary screen does the opposite (shows items without facts); here an unread fact must not look like a missing one, or every past act would ask to be marked done.
3. **Document tasks are per order** (`task:<rule>:<orderNum>:order`), not per act. Two deliveries need one BOL, and the key survives a dispatcher retyping a local job's services.
4. **Window = the last 14 days (`TASK_LOOKBACK_DAYS`), ending on the driver's day.** Unfinished acts older than that drop off. The client sends `today` (its local day), and the API accepts it only within a day of the server's.
5. **No upcoming tasks yet.** All three rules look backward (done/past), so the Upcoming section stays empty until a forward-looking rule (e.g. "send your ETA") exists.
6. **Weight ticket = longhaul sources only** (`longhaul-activity`, `order-assigned`); a local job's LOAD is not weighed. Delivery codes `RDEL`/`XDEL`, load codes `LOAD`/`R19O`.
7. **Not Cedar:** the same self-scoped gate as `/me/itinerary` (403 `DRIVER_NOT_MAPPED`). No `satisfied` flag on `TaskSpec`: a satisfied task just isn't returned.
8. **Snooze is a "Later" button** (until 6 am tomorrow), not a swipe. Dismiss exists in the API (`dismissed: true`) but isn't in the UI yet.
9. **No legacy read when no rule is enabled.** The API returns an empty list with `enabledRules: []` and never touches the tunnel.

## Out of scope

Activity feed / notify (Phase 2), persistent tasks + Workflows (Phase 3), SDK surface (built-in rules only; `/me/*` is not reachable with a `vnd_` key).
