# Task queues — Phase 2a: Activity feed + notify()

**Branch:** `feat/task-queue-activity-feed` (worktree `../pegasus-task-queue-activity-feed`)
**Parent plan:** `plans/todo/task-queue-and-activity-feed.md` §3 Phase 2 (approved by Steve 2026-11-12..14; "start phase 2" 2026-11-17).
**Goal:** One `notify()` writes a per-recipient Activity row and, if the recipient's preferences allow it, the push. The existing pushes go through it. Drivers get an Activity screen with an unseen-count bell.

## Split (decided 2026-11-17)

Phase 2 lands as two PRs:

- **2a (this one):** the tables, `notify()`, the existing senders moved onto it, the `/me/activity` and preferences API, and mobile Activity.
- **2b:** the tenant-web bell, SDK `notify` (needs an SDK version bump, its discovery surfaces and a publish), and Blocked (andon).
  - Blocked waits on open question 3 (who gets a driver's Blocked task).

## Resume here

- Status: started 2026-11-17.

## Steps

- [ ] **Domain:** a notification type registry (type, label, default channel) in `packages/domain/src/notifications/`.
- [ ] **Prisma:**
  - `Notification` (tenantId, recipientUserId, type, actorUserId?, entityType?, entityId?, title, body, data JSON, groupKey?, dedupeKey?, createdAt, seenAt?, readAt?), unique on (tenantId, dedupeKey).
  - `NotificationPreference` (tenantId, userId, type, channel).
  - Both tenant-scoped.
- [ ] **`lib/notify.ts`:**
  - Uses the caller's client or transaction; never opens a transaction or kicks the forwarder. Returns `{ notificationId, pushId }`.
  - A crew member with no login gets the push only, no feed row.
  - Feed rows dedupe by key.
- [ ] **Move the senders onto `notify()`:** `trip.assigned`, `move.assigned`, `chat.message` (feed row for mentions only; non-mention messages stay push-only), and `POST /notifications/send`.
  - Push payloads stay byte-identical, and so does who gets a push.
- [ ] **API:** `GET /api/v1/me/activity` (cursor; all/unread filter), `GET …/unseen-count`, `POST …/seen`, `POST …/:id/read`, `POST …/read-all`, `GET/PUT /api/v1/me/notification-preferences`.
- [ ] **Mobile:**
  - The Activity screen, plus a header bell with the unseen count, from one shared context refreshed on focus, foreground and push receipt.
  - Feed taps and push taps share one route function.
- [ ] **Tests + docs.**
