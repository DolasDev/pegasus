# Task queues — Phase 1: driver To Do, computed when it's read

**Branch:** `feat/task-queue-driver-todo` (worktree `../pegasus-task-queue-driver-todo`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 1 (approved by Steve 2026-11-12..14; "start phase 1" 2026-11-16).
**Goal:** Drivers see a To Do list in the mobile app of tasks computed from their itinerary + documents. A task resolves itself when the data arrives; tapping it opens the screen that satisfies it. Cloud-only, no Workflows, no legacy writes.

## Resume here

- Status: started 2026-11-16.

## Steps

- [ ] **Domain** `packages/domain/src/tasks/`: pure rule type `(facts) => TaskSpec[]`; stable key `task:<rule>:<orderNum>:<itemKey>`; three rules (`submit-arrival-times`, `submit-bol`, `submit-weight-ticket`) with applicability (act codes) declared; unit tests.
- [ ] **Persistence:** `TaskState` (tenantId, userId, taskKey, snoozedUntil, dismissedAt), tenant-scoped, migration.
- [ ] **Tenant settings:** enabled built-in rules in `Tenant.appSettings`; off unless enabled.
- [ ] **API** `GET /api/v1/me/tasks` (+ snooze/dismiss), evaluated over the itinerary read, `ItineraryActFact` and `Document` rows; passes `failedSources` through; same authz scope as the itinerary. Integration tests.
- [ ] **Mobile:** `app/(drawer)/todo.tsx` (Overdue / Today / Upcoming, grouped by order; tap → ETA editor / AddDocumentModal preset; snooze), drawer entry + badge, Dashboard "Top 3" card; hidden for operations-only users. Jest tests for grouping.
- [ ] **Docs:** `apps/mobile/README.md`; parent plan's Phase 1 ticked + Resume updated.

## Out of scope

Activity feed / notify (Phase 2), persistent tasks + Workflows (Phase 3), SDK surface (built-in rules only).
