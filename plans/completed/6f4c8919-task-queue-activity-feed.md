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

- Status: 2a implementation done 2026-11-17 (domain, API, mobile). Lands as one PR.
- **Not yet verified on a device.** After deploy and an app build, check that a trip assignment and an @mention arrive as a push AND as an Activity row, and that tapping either opens the same screen.
- **Next: 2b.** The tenant-web bell, SDK `notify`, and Blocked (the last waits on open question 3).

## Steps

- [x] **Domain:** a notification type registry (type, label, default channel) in `packages/domain/src/notifications/`.
- [x] **Prisma:**
  - `Notification` (tenantId, recipientUserId, type, actorUserId?, entityType?, entityId?, title, body, data JSON, groupKey?, dedupeKey?, createdAt, seenAt?, readAt?), unique on (tenantId, dedupeKey).
  - `NotificationPreference` (tenantId, userId, type, channel).
  - Both tenant-scoped.
- [x] **`lib/notify.ts`:**
  - Uses the caller's client or transaction; never opens a transaction or kicks the forwarder. Returns `{ notificationId, pushId }`.
  - A crew member with no login gets the push only, no feed row.
  - Feed rows dedupe by key.
- [x] **Move the senders onto `notify()`:** `trip.assigned`, `move.assigned`, `chat.message` (feed row for mentions only; non-mention messages stay push-only), and `POST /notifications/send`.
  - Push payloads stay byte-identical, and so does who gets a push.
- [x] **API:** `GET /api/v1/me/activity` (cursor; all/unread filter), `GET …/unseen-count`, `POST …/seen`, `POST …/:id/read`, `POST …/read-all`, `GET/PUT /api/v1/me/notification-preferences`.
- [x] **Mobile:**
  - The Activity screen, plus a header bell with the unseen count, from one shared context refreshed on focus, foreground and push receipt.
  - Feed taps and push taps share one route function.
- [x] **Tests + docs.**

## Decisions made while building

1. **Notification has its own `dedupeKey`**, unique per tenant, the same key as the push. A trip re-saved twenty times keeps one row and one push, and a re-notify never resets seen/read.
2. **`notify()` runs on the caller's client or transaction**, never opens one, and never kicks the forwarder (chat kicks after commit, as before). It returns `{ notificationId, pushId }`.
3. **Who gets a push hasn't changed.** The four existing types default to `push`, and the push payload is byte-identical (`{ title, body, data }`), so builds already on phones route as before.
4. **Chat:** an @mention is `notify(type 'chat.mention')`, a feed row grouped by order plus the push. A plain message stays push-only (`enqueuePush`), so the bell doesn't double-count Messages.
5. **A crew member without a login** gets the push (resolved at drain time, as before) and no feed row.
6. **`POST /notifications/send`** goes through `notify(type 'staff.message')` with the sender as actor. The response keeps `id` (the push row, else the feed row) and adds `notificationId` and `pushId`.
7. **Activity reads are Postgres only.** The bell refreshes on launch, foreground and received push, never on a timer.
8. **Notification settings live on the Activity screen** (mobile only for now). tenant-web gets its own in 2b.
