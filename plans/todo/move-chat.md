# Move chat — a chat room per move for office staff and assigned drivers

**Branch:** none yet. One worktree + branch + PR per phase (`scripts/new-worktree.sh feat move-chat-<phase>`).
**Goal:** Each move (legacy order / shipment, keyed by `order_num`) has a chat room. Any tenant employee, and any
driver or local crew member assigned to that move (employee or contractor, as long as they have a login), can read it
and post to it. It works from a standalone Teams/Slack-style page in tenant-web and from the driver app. The desktop (movemanager) gets
it in a later phase.
**Status:** TODO — D1–D6 approved 2026-10-16; Phase 0 done 2026-10-16; next is Phase 1 (plus the optional prod data check).

---

## Decisions already made (2026-10-16, Steve)

- **Build it in-house. Don't use a chat SaaS (Stream/Sendbird/CometChat) or make Teams the hub.** The rooms are
  per move, so they live next to the move inside our tenant isolation, permissions, reporting and SDK. A tenant has
  tens to low hundreds of users, so we have no scale problem to buy our way out of. Drivers are often contractors who
  aren't in the tenant's M365, so Teams can't be the hub. Revisit Stream only if v1 grows into general Slack-style
  chat.
- **Internal chat only.** SMS and customer messaging are out of scope.
- **v1 surfaces: tenant-web and the mobile driver app.** The movemanager desktop panel is Phase 4.
- **Notifications: followers and @mentions.** These people follow a room automatically:
  - assigned drivers;
  - anyone who has posted in it;
  - anyone who has been @mentioned in it.

  Anyone can follow, unfollow or mute a room. Everyone with access still sees unread badges.

- **Live updates: polling, plus an immediate push (D4 below).** This keeps `DECISIONS.md` ("polling, not
  WebSockets") true for now. A managed pub/sub (AppSync Events / Ably) can be added later without changing the data
  model.

## Decisions D1–D6 (approved 2026-10-16, Steve)

- **D1 — Access goes by role, not employment status.** Drivers can be employees or independent contractors. Either
  way they have a user account and an app login, and either way they get **driver scope**.
  - **Driver scope:** a user whose only role is `driver`, or who has no roles at all. They see only the moves
    they're assigned to.
  - **Employee scope:** any user with any other role. They see every room.

  Employee scope is wider than `OPERATIONS_ROLES` (`lib/longhaul-read-scope.ts`), so sales and billing can chat too.

- **D2 — Assigned drivers and assigned local crew are both in.**
  - **Longhaul:** the same rule as the longhaul shipment read. A shipment is the driver's when a
    `LongDistanceDispatchActivity` on it has `a.assigned_driver_id` or `t.driver_id` equal to the caller's
    `TenantUser.longhaulDriverId` (`handlers/longhaul-cloud/shipments-list.ts`, the restricted-caller `EXISTS`).
  - **Local crews:** crew members are often not employees but can be. A crew member who has a user account and app
    login gets access to the moves whose **local dispatch jobs** they're assigned to. One without a login just
    isn't in the chat.
  - **Where local crew assignment lives** (Phase 0, verified in movemanager source 2026-10-16):
    - The live table is **`LocalDispatchJobs`**: one row per local job, with `order_num` (= `sales.order_num`), up
      to two drivers in `driver_id1`–`driver_id2` and up to ten helpers in `helper_id1`–`helper_id10`. There are
      also display-name columns `driver_desc*` / `helper_desc*`.
      - Writer: `LocalDispatchJobOldMaintenanceForm` → `IO_LocalDispatchJobOld.Write`. The converter is in
        `LoHiConverters_LocalDispatchJobOld.vb:379` (drivers) and `:399-408` (helpers).
    - The ids are **`crews.employee_id`**. The crew picker is `IO.Crew.ReadCodeAndDescriptionList`, whose code field
      is `employee_id` (`IO_Crew.vb:14,135`), filtered to `is_local_drv='Y'` for drivers.
    - **Don't use `LocalDispatchJobDrivers` / `LocalDispatchJobHelpers` / `LocalDispatchJobMaster` /
      `LocalDispatchJobsDetail`.** They were filled once by a conversion script
      (`Conversions Scripts/CopyLocalDispatchJobsToLocalDispatchJobsMasterDetail.sql`). The app doesn't write them
      (`IO_LocalDispatchJobNew.Write` is broken and only a test form calls it), so they're stale.
    - No pegasus code reads `LocalDispatchJobs` today. Chat would be the first.
  - **Crew access rule:**

    ```sql
    EXISTS (
      SELECT 1 FROM LocalDispatchJobs j
      WHERE j.order_num = @orderNum
        AND @crewEmployeeId IN (j.driver_id1, j.driver_id2, j.helper_id1, …, j.helper_id10)
    )
    ```

    - `@crewEmployeeId` of `0` or null matches nothing, the same convention as longhaul driver 0.
    - Like the longhaul rule, there's no date window: being on any job for the order grants access.

  - **Login ↔ crew mapping:** add **`TenantUser.localCrewEmployeeId Int?`** (= `crews.employee_id`). An admin sets
    it in Settings → Users next to `longhaulDriverId`, and `canReadShipment` ORs the longhaul and crew `EXISTS`.
    - Keep it as a separate field even though the numbers may overlap. `v_longhaul_drivers` reads `driverall`,
      whose definition isn't in any repo; it probably unions `drivers.driver_id` with `crews.employee_id`
      (GOTCHAS: NWSUB drivers are `crews` rows). QMM's `fix-drivers-crew.sql` renumbered crew ids to match driver
      numbers. So the two ids are _often_ the same person's number, but nothing guarantees it.
    - Two fields are correct either way. A Phase 1 data check (below) can show whether one field would do.
- **D3 — v1 is `shipment` (legacy order) only.** Any other `entityType` returns 400. The tables stay polymorphic,
  so cloud `move` rooms (crew scope via `handlers/moves.ts` `loadReadableMove`) can be turned on later.
- **D4 — As close to real time as is cheap.**
  - **Open screens:** poll every 3 s while a room is visible, and stop when the tab or app is hidden. Poll the inbox
    and the rail every 15 s.
  - **Rough cost:** 20 open rooms × 10 h/day ≈ 5M requests a month for a busy tenant, which is single-digit
    dollars at HTTP API's list price of about $1 per million requests. Verify against the AWS pricing page.
  - **Push:** after the post commits, the post handler **sends that message's push rows to Expo straight away**
    (about 100–300 ms added to the post response). The every-minute `PushForwardFunction` stays as the retry
    backstop. That puts push latency in seconds, with no new infrastructure.
  - **Prerequisite:** `listPendingPush` (`repositories/push-outbox.repository.ts`) doesn't claim rows today. A
    second concurrent drainer would double-send. Add an atomic claim (`UPDATE … SET status='SENDING', claimedUntil
… WHERE status IN ('PENDING','FAILED') … FOR UPDATE SKIP LOCKED … RETURNING`) and use it from **both** the cron
    and the inline path. That also fixes double-sends if a slow cron run overlaps the next one.
  - **Not doing true real time (AppSync Events) in v1:** it's a new stack, auth handlers and cost, for a gain from
    ≤3 s to ~instant. Revisit if users ask for it.
- **D5 — A push shows no message text.** Title "#<orderNum>", body "New message from <author>" (or "<author>
  mentioned you"). Customer details typed into chat never reach a lock screen.
- **D6 — A standalone chat page in the style of Teams, Slack or WhatsApp,** open to every employee (and to drivers
  and crew for their own moves). This is the main way into chat, not a panel tucked inside driver-planning.

**Phase 0 findings on authz and roles (2026-10-16):**

- **Local crew logins use the existing `driver` role.** No new role. `authz/role-options.ts` already describes
  `driver` as "Crew member login — sees only their own assigned trips". D1's driver scope keys on that name.
- **The Cedar shared-baseline tests must move.** `lib/authz.test.ts` pins every persona's allowed set to include
  `DOC_BASELINE = [ReadDocument, UploadDocument]`, and it pins **exactly** that set for invariant (f) (placeholder
  persona `operations_admin`) and invariant (d) (empty roles).
  - An unconstrained `55-chat-shared.cedar` permit for `ReadChat` / `PostChat` is fine; it follows the
    `50-documents-shared.cedar` pattern.
  - In the same PR, rename `DOC_BASELINE` → `SHARED_BASELINE` and add the two chat actions. This is an expected
    test change, not a weakened invariant: a stray persona permit still shows up as an extra id.
- **Machine principals are in the shared permit too:** the permit is unconstrained, so `workflow-runtime`,
  integration clients and service accounts all match it. The chat handler must **reject callers with an
  `apiClient` (M2M)** with 403 in v1. Automation posting is the later SDK item, and it's metered.
- **Before or in Phase 1, a read-only data check on prod.** Use the GOTCHAS ad-hoc read pattern
  (`MssqlExecutorFn`), and only with Steve's go-ahead. For NW and QMM:
  1. `OBJECT_DEFINITION(OBJECT_ID('driverall'))`;
  2. confirm the `LocalDispatchJobs` columns exist and how many rows were written in the last 90 days (whether a
     tenant uses local dispatch at all);
  3. whether the people with logins have the same `crews.employee_id` and longhaul `driver_id`.

  It doesn't block the design; it decides whether `localCrewEmployeeId` can ever collapse into `longhaulDriverId`.

---

## Context (enough to resume without re-reading the code)

- **Documents is the model to copy.** `Document` uses polymorphic `(entityType, entityId)` and indexes
  `[tenantId, entityType, entityId]` (`schema.prisma` → `model Document`). The mobile shipment screen already has a
  `DocumentsTab` keyed by `orderNum` (`apps/mobile/app/shipment/[orderNum].tsx`).
  `plans/todo/document-read-scoping.md` is moving document access to "the parent's own read rule." **Chat should use
  the same parent check, so build one `canReadShipment(c, orderNum)` helper that both can use.** Whichever lands
  first, the other reuses it.
- **Driver scope.** `resolveLonghaulReadScope(c)` → `all | driver(driverId) | none`. Driver 0 means "unassigned"
  and matches nothing. Handler-level, not Cedar (the dispatcher personas are deliberate placeholders; see
  PATTERNS.md "Longhaul reads are driver-scoped server-side").
- **Push.** `enqueuePush(tx, tenantId, { userId | crewMemberId, dedupeKey, payload })`
  (`repositories/push-outbox.repository.ts`). Notification text and deep links live in `lib/push-triggers.ts`; add
  `enqueueChatMessagePush` there. Deep link: `{ type: 'chat.message', orderNum, messageId }`.
- **Push credentials are still a blocker for mobile** (`apps/mobile/PUSH_NOTIFICATIONS.md`): Android needs the FCM
  V1 server key (Step 1.6), and iOS hasn't been verified end-to-end. Without both, mobile chat only works while the
  app is open.
- **tenant-web anchor:** `features/driver-planning/containers/ShipmentDetail/` (it already hosts `DispatchNote`,
  `Coverage`, `Weight`).
- **Lambda concurrency is throttled to 10.** Polling has to stay cheap: one indexed query and no tunnel round trip
  on the poll path (see Risks).

---

## Design

### Domain (`packages/domain`, a new `chat` module, pure and test-first)

- `MessageBody`: trimmed, 1–4000 characters, not whitespace-only.
- `parseMentions(body, mentionable)`: tokens `@[Display Name](userId)` from the composer → the list of mentioned
  user ids. Unknown ids are dropped.
- `resolveRecipients({ authorId, followers, mutedIds, mentionedIds, assignedUserIds })` → the users to push
  to. The rule: (followers ∪ mentioned ∪ assigned drivers and crew) − author − muted. A mention gets through a mute; muting
  only silences messages that don't mention you.
- `autoFollowOnPost` / `autoFollowOnMention` rules.

### Data (`apps/api/prisma/schema.prisma`, `public` schema)

- `ChatRoom` `{ id, tenantId, entityType, entityId, lastMessageAt, createdAt }`, unique on
  `(tenantId, entityType, entityId)`. Created on the first post; a read on a room that doesn't exist yet returns an
  empty room.
- `ChatMessage` `{ id, tenantId, roomId, authorUserId, clientMessageId, body, mentionedUserIds String[], createdAt,
deletedAt? }`.
  - Unique on `(tenantId, authorUserId, clientMessageId)`, so resends from the offline queue don't duplicate.
  - Index `(roomId, createdAt)`.
  - Deletes are soft: the body is blanked and the row kept for audit.
- `ChatRoomMember` `{ roomId, tenantId, userId, following Boolean, muted Boolean, lastReadAt?, accessCheckedAt?,
updatedAt }`, PK `(roomId, userId)`. The row is written on the user's first read, post or mention, or a follow
  change. Unread count = messages with `createdAt > lastReadAt`.
- `accessCheckedAt` is the **persisted** access cache for drivers. An in-memory cache doesn't survive Lambda's
  instance model: a poll that lands on a fresh instance would go to the tunnel every time.
  - `GET /rooms/...` runs the tunnel check and stamps `accessCheckedAt`.
  - `messages?after=` and `read` accept a member row stamped within the last 5 minutes, and re-check otherwise.
  - Employees never need it.
- Messages are business records: no purge, and a tenant cascade on delete.

### API (`apps/api/src/handlers/chat.ts`, mounted under `/api/v1/chat`)

Every route resolves access through `canReadShipment` (D1/D2). Posting is allowed exactly when reading is. Cedar
gets `ReadChat` / `PostChat` actions granted to every principal (the `50-documents-shared.cedar` pattern), and the
handler does the per-room check.

| Route                                                                  | Purpose                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rooms/:entityType/:entityId`                                     | Room summary, my membership (following, muted, unread)                                                                                                                                                                                                                                                                                             |
| `GET /rooms/:entityType/:entityId/messages?after=&before=&limit=`      | Poll forward (`after`) or page back (`before`)                                                                                                                                                                                                                                                                                                     |
| `POST /rooms/:entityType/:entityId/messages` `{clientMessageId, body}` | Idempotent post. 201 when new; 200 with the same row on a replay                                                                                                                                                                                                                                                                                   |
| `DELETE /messages/:id`                                                 | Soft-delete your own message (tenant_admin can delete any)                                                                                                                                                                                                                                                                                         |
| `POST /rooms/:entityType/:entityId/read` `{at}`                        | Advance `lastReadAt`                                                                                                                                                                                                                                                                                                                               |
| `PUT /rooms/:entityType/:entityId/membership` `{following, muted}`     | Follow, unfollow or mute                                                                                                                                                                                                                                                                                                                           |
| `GET /inbox`                                                           | Rooms I follow, plus rooms where I have unread mentions, with unread counts and the last message, newest first. For a **driver**, intersect with their current order set: one tunnel query returning `order_num`s (the `shipments-list.ts` `EXISTS`), not one per room. A driver taken off a trip must stop seeing the room's last-message preview |
| `GET /rooms/:entityType/:entityId/mentionable`                         | Employees plus that move's assigned drivers, for @ autocomplete                                                                                                                                                                                                                                                                                    |

What a post does:

1. In one transaction: insert the message, upsert the room's `lastMessageAt`, auto-follow the author and the
   mentioned users.
2. After the commit, best effort, in four steps:
   1. Resolve the move's assigned drivers and crew through the tunnel (D2's queries, without the per-caller
      filter).
   2. Map `driver_id` / crew key → `TenantUser`.
   3. Run `resolveRecipients`.
   4. Enqueue one push per recipient with `dedupeKey = chat:<messageId>:<userId>`.
3. Still in the request: **claim and send those rows to Expo immediately** (D4). Whatever doesn't send stays
   PENDING/FAILED for the every-minute cron.
4. If step 2 or 3 fails, log `chat.fanout_failed` with the room and message ids. The post itself still succeeds.

OpenAPI: add every route to `lib/openapi-spec.ts` (the coverage test gates CI).

### tenant-web — a standalone chat page (D6), laid out like Teams/Slack

- **Route:** `/messages` and `/messages/shipment/:orderNum` (`routes/messages.tsx`), plus a top-level **Messages** nav
  item in `AppShell` with an unread badge. Open to every signed-in user; the API does the scoping.
- **Left rail:**
  - the conversation list, newest activity first: order number, shipper name, a one-line last-message preview and
    time, an unread count, and an @ marker for mentions;
  - filters: All / Unread / Mentions / Following;
  - a search box that takes an order number or shipper name. A hit opens that move's room even if it has no
    messages yet. For employees that's any order; for drivers and crew, only their own.
- **Conversation pane:**
  - **Header:** order number, shipper, origin → destination, key dates, assigned driver and crew, a link to the
    shipment in driver-planning (Operations roles only), and follow/mute.
  - **Message list:** bubbles grouped by author with avatar or initials, day dividers, an "unread" line, and
    infinite scroll back through history.
  - **Composer:** Enter to send, Shift+Enter for a newline, @ autocomplete. Optimistic send with the
    `clientMessageId`; a message that failed shows a retry control.
- **Mobile width:** below the breakpoint, the rail and the conversation become two screens.
- **Polling:** the open room every 3 s and the rail/badge every 15 s, both paused on `document.hidden`. The badge
  re-polls the moment the tab comes back into focus.
- **Shortcut:** driver-planning `ShipmentDetail` gets a "Chat" button that deep-links to
  `/messages/shipment/:orderNum`, rather than a second embedded chat UI.
- **Header data:** the header needs a small shipment summary. Reuse the existing longhaul shipment read
  (driver-scoped since #852) or add `GET /chat/rooms/shipment/:orderNum/summary`, whichever avoids a second tunnel
  round trip.

### Mobile (`apps/mobile`)

- Drawer: a **Messages** screen laid out like WhatsApp or a phone's texting app. It lists conversations (order
  number and shipper, last-message preview, time, unread badge) and opens into a full-screen thread with bubbles
  and the composer. It's the same API and the same rail filters as tenant-web.
- `shipment/[orderNum].tsx`: a **Chat** tab next to Documents opens the same thread component.
- Offline send queue: persisted with AsyncStorage, flushed on reconnect or foreground. A replay is safe because of the
  `clientMessageId`.
- Push tap on `chat.message` → open the shipment with the Chat tab selected.

---

## Phases (one PR each)

- [x] **Phase 0 — Spikes.** Done 2026-10-16; findings are recorded under D2 and "Phase 0 findings on authz and
      roles" above.
  - Crew assignment = `LocalDispatchJobs.driver_id1-2/helper_id1-10` = `crews.employee_id`.
  - Crew logins use the `driver` role.
  - The Cedar baseline tests move to `SHARED_BASELINE`.
  - M2M callers are rejected.
  - Open: the read-only prod data check (needs Steve's go-ahead).
- [ ] **Phase 1 — Domain, data and API.** Domain module and tests; Prisma migration (chat tables plus
      `TenantUser.localCrewEmployeeId`, with the Settings → Users field to set it); `canReadShipment` helper (shared with
      document-read-scoping; longhaul OR local crew); handlers; Cedar actions plus the AVP re-sync; push trigger plus the
      outbox **atomic claim** (used by the cron and the inline send); OpenAPI; integration tests for:
  - driver can or can't see a room;
  - an employee sees every room;
  - an idempotent replay;
  - fan-out recipients;
  - a mention getting through a mute;
  - a soft delete;
  - two concurrent drainers never double-sending a push row.
- [ ] **Phase 2 — tenant-web.** The standalone `/messages` page (rail, conversation, composer, search), the nav
      badge, the `ShipmentDetail` deep-link button, unit tests, and one Playwright browser spec (post → appears in a
      second session → unread clears).
- [ ] **Phase 3 — Mobile.** The Messages screen, the shipment Chat tab, the offline queue and the push deep link. Ships in the next
      driver app build. Blocked for background delivery until the FCM key and the iOS verification are done (a human,
      in a browser).
- [ ] **Phase 4 — Desktop (movemanager).** A chat panel on the order form calling the cloud API with the
      cloud-issued token. Needs its own approved movemanager plan first, per that repo's CLAUDE.md.
- [ ] **Later, not planned yet:**
  - attachments (reuse Documents);
  - message edit;
  - true real-time delivery via AppSync Events (if ≤3 s polling isn't enough);
  - a Teams bot that mirrors rooms;
  - an email digest for unread mentions;
  - a workflow SDK `post_chat_message` + `chat.message.posted` event. When this lands, the SDK discoverability rule
    applies (README, MCP, OpenAPI, the authoring repo's `CLAUDE.md`), and an automation's post is a billable
    action.

## Files

- **New:**
  - `packages/domain/src/chat/*`
  - `apps/api/src/handlers/chat.ts` (+ tests)
  - `apps/api/src/repositories/chat.repository.ts`
  - `apps/api/src/lib/shipment-read-access.ts` (`canReadShipment`)
  - `apps/tenant-web/src/features/chat/*`
  - `apps/tenant-web/src/routes/messages.tsx`
  - `apps/mobile/src/components/chat/*` (thread, composer, list rows)
  - `apps/mobile/src/services/chat*.ts`
  - `apps/mobile/app/(drawer)/messages.tsx`
- **Modified:**
  - `apps/api/prisma/schema.prisma` + a migration
  - `apps/api/src/app.ts`
  - `apps/api/src/lib/push-triggers.ts`
  - `apps/api/src/repositories/push-outbox.repository.ts` + `lambda-push-forward.ts` (atomic claim)
  - `apps/api/src/handlers/users.ts` + tenant-web `users.tsx` (`localCrewEmployeeId` mapping)
  - `apps/api/src/lib/openapi-spec.ts`
  - `apps/api/src/authz/actions.ts`, `authz/cedar.schema.json`, a new `authz/policies/55-chat-shared.cedar`
  - `apps/tenant-web/.../ShipmentDetail/index.tsx` (the deep-link button), `AppShell.tsx` (nav item and badge)
  - `apps/mobile/app/shipment/[orderNum].tsx`, the push tap handler
  - `dolas/agents/project/DECISIONS.md` (build vs buy, and polling for chat)

## Risks

- **Polling load against the Lambda concurrency limit (10).** 50 open rooms at 3 s is ~17 rps at roughly 30–50 ms
  each, about 1 concurrent Lambda: fine. But the poll path must **not** reach the on-prem tunnel. That's what the
  persisted `ChatRoomMember.accessCheckedAt` is for; employees never touch the tunnel.
- **The tunnel is down while someone posts.** Drivers' access checks fail closed (they can't read). Office posts
  still succeed, but drivers who don't already follow the room miss that push (logged). Drivers follow
  automatically after their first open, which shrinks this gap.
- **The inline push send slows the post.** It adds about 100–300 ms; cap the Expo call at ~2 s, after which the cron
  takes over.
- **Reassignment.** A driver who is taken off a trip loses access straight away (once the cache expires) but keeps
  their stored follow row. `resolveRecipients` (push) and `GET /inbox` (preview) both have to filter by current
  access.
- **PII in messages.** Staff will type customer details. Messages stay inside the tenant; push content is D5.
