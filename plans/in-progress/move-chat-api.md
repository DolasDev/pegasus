# Move chat — a chat room per move for office staff and assigned drivers

**Branch:** Phase 1 was `feat/move-chat-api` (merged #866). Phase 2 → `feat/move-chat-page`. One worktree + branch + PR per phase.
**Goal:** Each move (legacy order / shipment, keyed by `order_num`) has a chat room. Any tenant employee, and any
longhaul or local driver assigned to that move (employee or contractor, as long as they have a login), can read it
and post to it. It works from a standalone Teams/Slack-style page in tenant-web and from the driver app. The desktop (movemanager) gets
it in a later phase.
**Status:** Phase 0 + Phase 1 DONE and in prod (#866, `034053c6`, 2026-10-19). Phase 2 (tenant-web `/messages`) built 2026-10-20 on `feat/move-chat-page`. Next is Phase 3 (mobile).

---

## Resume here

- **Where:** Phase 2 lands as one PR from `feat/move-chat-page` (worktree `/home/steve/repos/pegasus-move-chat-page`,
  slug `move-chat-page` — `move-chat-web` collided with `pegasus-pulse-memos` on Postgres port 5436). Once it has
  merged, the worktree is torn down with `scripts/rm-worktree.sh move-chat-page`; check `git worktree list`.
- **Status:**
  - [x] Phase 0 — spikes + prod data check (#860, #862).
  - [x] Phase 1 — domain, data, API, push claim, Settings → Users local-driver linker. Merged #866, in prod.
  - [x] Phase 2 — tenant-web `/messages` page + two small API additions. See "Phase 2 as built". Verified
        locally: typecheck + lint clean; domain 440, API (297 files) and tenant-web (153 files) suites green; the
        Playwright spec `apps/e2e/tests/browser/move-chat.spec.ts` passed 4/4 against an e2e-mode build.
  - [ ] Phase 3 — mobile. Not started.
  - [ ] Phase 4 — movemanager desktop. Not started; needs its own approved movemanager plan.
- **Next action:** if the Phase 2 PR is not merged yet, check it: `gh pr list --head feat/move-chat-page` then
  `gh pr checks <N>`. Once merged and deployed, Phase 3 (mobile) per "Mobile" under Design, in a new worktree
  (`scripts/workstream-start.sh feat <slug> plans/in-progress/move-chat-api.md`; rename the seeded copy back to
  `move-chat-api.md` — it is the one plan for all phases). Phase 3 reuses: `GET /api/v1/chat/inbox`,
  `/rooms/shipment/:orderNum/*`, `GET /api/v1/chat/summaries` (header/list names), `userId` on
  `GET /api/v1/me/permissions` (whose messages are mine), and the domain's `splitMentions` / `formatMentionToken`.
  The push tap handler for `{type:'chat.message', orderNum, messageId}` does not exist yet.
- **Uncommitted work:** none intended. `apps/e2e/.env.test` and `package-lock.json` show modified in the worktree
  from provisioning; they are never staged.
- **Decisions & dead ends:**
  - The API must **never** import `expo-server-sdk` (ESM-only → API Lambda INIT crash, #594). Chat posts
    enqueue outbox rows in the transaction, then `kickPushForwarder()` (`apps/api/src/lib/push-forward-invoke.ts`)
    async-invokes `PushForwardFunction`. Guarded by `apps/api/src/__tests__/expo-sdk-import-guard.test.ts`. The
    Design section's "claim and send inline" step is superseded by this.
  - Push-row claim is a Prisma `updateMany` compare-and-set on `nextAttemptAt` (`claimPush`), because
    `db-access-guard` bans `$queryRaw`/`FOR UPDATE SKIP LOCKED`.
  - Two driver mapping fields (`longhaulDriverId`, `localDriverEmployeeId`), never one: at QMM 2 numbers name
    different people in `drivers` vs `crews`.
  - Login/mapping work is **drivers only** (Steve, 2026-10-19); helpers deferred. Ask before widening.
  - `GET .../messages` on a room that doesn't exist returns `[]` **before** the access check, so idle polls never
    hit the legacy tunnel.
  - Move details come from `sales` (`GET /chat/summaries`), **not** `v_longhaul_shipments_v2`: local-only orders
    aren't in that view, and the longhaul read is OPERATIONS_ROLES-scoped while chat's employee scope is wider.
  - Shipper names are **not** joined into `/inbox`: it polls every 15 s, and the poll path must not reach the
    tunnel. Clients fetch `/summaries` once per batch and cache it (10 min).
  - The Playwright spec mocks the chat API (`page.route`): the local e2e stack has one SKIP_AUTH identity and no
    legacy DB, so a real two-session run is impossible there. Server rules stay covered by
    `apps/api/src/handlers/chat.test.ts`.
  - Don't `prisma migrate reset` in a worktree (it needs user consent); add a follow-up migration instead.
- **Gotchas:**
  - Display names are still `crewMember.name` or the email (`TenantUser` has no name field). Kept for Phase 2;
    a profile name is on the "Later" list.
  - Driver-scope users only see their own moves; `/inbox?filter=all` is employee-only.
  - Room ids are legacy `order_num` (positive int ≤ 2147483647); `entityType` is only `shipment` in v1.
  - Posting needs a `clientMessageId` matching `/^[A-Za-z0-9_-]{8,64}$/` (`crypto.randomUUID()` qualifies); a
    retry reuses the same id, so it can't double-post.
  - Coverage-floor files (`*/vitest.config.ts`) get auto-updated by local runs and the pre-push hook — revert
    them, never commit.
  - Local browser specs: `npx playwright install chromium` once; the e2e config's webServer starts the API, which
    needs `npm run build -w @pegasus/domain` first in a fresh worktree.
- **Verification still owed:**
  - Phase 2 PR: CI (incl. the e2e job, floor raised 32 → 33) and the post-merge Deploy.
  - No real-traffic check of chat in prod yet: after deploy, post on one real order as an employee and as a
    mapped driver (checks `/summaries` against real `sales` columns — `shipper_name`, `shipper_city/state`,
    `consignee_city/state`, `pack_date`, `load_date`, `del_date`, taken from movemanager's `RowConverters_Sale.vb`).
  - Steve: set `localDriverEmployeeId` in Settings → Users in prod (QMM's one mapped driver first; 31 local jobs).
  - Steve: Android FCM V1 key + end-to-end iOS push check (`apps/mobile/PUSH_NOTIFICATIONS.md`) — blocks
    background push for Phase 3.
  - RVS was not covered by the prod data check (tunnel timed out); re-run the D2 queries there before relying on
    local-driver access at RVS.
- **Separate follow-up (not chat):** `apps/api/src/handlers/notifications.ts` looks up the push target with
  `{ where: { id: userId } }` and no `tenantId` — same `TenantUser` not-auto-scoped gap; small fix PR.

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

- **D2 — Assigned longhaul drivers and assigned local drivers are in. Local helpers are deferred** (Steve,
  2026-10-19: any login/mapping work is limited to drivers for now).
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
  - **Local driver access rule (driver slots only; helpers deferred):**

    ```sql
    EXISTS (
      SELECT 1 FROM LocalDispatchJobs j
      WHERE j.order_num = @orderNum
        AND @localDriverEmployeeId IN (j.driver_id1, j.driver_id2)
    )
    ```

    - `@localDriverEmployeeId` of `0` or null matches nothing, the same convention as longhaul driver 0.
    - Like the longhaul rule, there's no date window: being on any job for the order grants access.
    - **Helpers (`helper_id1`–`10`) are out of scope for now.** Prod has 213 distinct helper ids at NW and 46 at QMM
      in the last year, so adding them later is the same `EXISTS` widened to the helper columns, plus helper
      logins.

  - **The cloud principal is the source of authority** (Steve, 2026-10-19). Who someone is comes from their
    `TenantUser` row and the mapping an admin sets on it, never from a legacy staff/crew link (`person_id`,
    `salesman`).
  - **Login ↔ local driver mapping:** add **`TenantUser.localDriverEmployeeId Int?`** (= `crews.employee_id` of a
    local driver). An admin sets it in Settings → Users next to `longhaulDriverId`, and `canReadShipment` ORs the
    longhaul and local `EXISTS`.
    - The picker lists active local drivers (`crews` where `active='Y' AND is_local_drv='Y'`, the desktop's "Local
      Drivers" filter).
    - When the admin picks a longhaul driver whose number also names a `crews` row **with the same name**, prefill
      the local field with that number. The admin still confirms it; the system never infers it.
    - **Why two fields, not one** (prod data check, 2026-10-19, below): at NW the numbers are the same person by
      construction. At QMM, 48 of 78 recent local drivers have no longhaul number at all, and 2 numbers name
      **different people** in `drivers` and `crews`. One shared field would let a longhaul driver read another
      person's local jobs.
- **D3 — v1 is `shipment` (legacy order) only.** Any other `entityType` returns 400. The tables stay polymorphic,
  so cloud `move` rooms (crew scope via `handlers/moves.ts` `loadReadableMove`) can be turned on later.
- **D4 — As close to real time as is cheap.**
  - **Open screens:** poll every 3 s while a room is visible, and stop when the tab or app is hidden. Poll the inbox
    and the rail every 15 s.
  - **Rough cost:** 20 open rooms × 10 h/day ≈ 5M requests a month for a busy tenant, which is single-digit
    dollars at HTTP API's list price of about $1 per million requests. Verify against the AWS pricing page.
  - **Push (as built, changed from the draft):** the post enqueues one outbox row per recipient in its
    transaction, then **kicks `PushForwardFunction` asynchronously** (`lib/push-forward-invoke.ts`,
    `InvocationType: 'Event'`). Push latency is seconds, not the next minute. The draft had the API send to Expo
    inline; that would have pulled `expo-server-sdk` (ESM-only) into the CommonJS API bundle and crashed the API
    Lambda at INIT (#594). `src/__tests__/expo-sdk-import-guard.test.ts` now pins the SDK to the forwarder's path.
  - **The claim (built):** the forwarder claims each row before sending — `claimPush`, a compare-and-set on the
    `nextAttemptAt` it read, which pushes the row out by a 2-minute lease. Postgres re-checks an UPDATE's WHERE
    against the latest row version, so of two concurrent claims exactly one wins (real-Postgres test). Plain
    Prisma, no raw SQL (`db-access-guard` forbids it outside the health check). Kicked and scheduled runs, or
    two overlapping runs, never double-send.
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
- **Prod data check — done 2026-10-19** (read-only, via `MssqlExecutorFn`, with Steve's go-ahead; RVS's tunnel
  timed out, so it's unchecked):
  - **`driverall`:**
    - **NW:** `drivers.driver_id` (type `NW`, `LEFT JOIN crews ON crews.employee_id = drivers.driver_id`) ∪
      `crews.employee_id` where `crew_class='D'` and not in `drivers` (type `NWSUB`) ∪ `units` (type `ATLAS`).
      `v_longhaul_drivers` keeps `NW`/`NWSUB`. At NW a driver's longhaul number **is** their crew number, by
      design.
    - **QMM:** `drivers` only.
  - **Both tenants use local dispatch heavily:**
    - **NW:** 2,266 jobs on 1,522 orders in 90 days (2,072 with a driver, 1,411 with a helper).
    - **QMM:** 2,162 jobs on 998 orders in 90 days (1,479 with a driver, 539 with a helper).
    - The `LocalDispatchJobs` columns match the movemanager DAL.
  - **Id overlap** (distinct local-driver ids from the last 365 days):
    - **NW:** 92 ids, all in `crews` and 90 in `drivers`. All 90 are the same person; the 3 name-heuristic misses
      were formatting ("Jr", first/last order).
    - **QMM:** 78 ids, all in `crews` but only 30 in `drivers`. 28 of those 30 are the same person; **2 are
      different people** under the same number.
  - **Cloud mappings today:**
    - **NW:** 4 users with a `longhaulDriverId` (3 of them share one number, probably test logins), all the same
      person in both tables.
    - **QMM:** 2 users with a `longhaulDriverId`. That driver also had 31 local jobs in the last year, so they'll
      see more rooms once the local mapping is set.

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
3. **(Superseded — see D4 "as built".)** The API kicks `PushForwardFunction` asynchronously; it never sends to
   Expo itself. Whatever the forwarder doesn't send stays PENDING/FAILED for the every-minute cron.
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
  - Local assignment = `LocalDispatchJobs.driver_id1-2` (helpers deferred) = `crews.employee_id`.
  - Crew logins use the `driver` role.
  - The Cedar baseline tests move to `SHARED_BASELINE`.
  - M2M callers are rejected.
  - Prod data check done 2026-10-19: two mapping fields (QMM has id collisions), drivers only.
- [x] **Phase 1 — Domain, data and API.** Done 2026-10-19, branch `feat/move-chat-api` (one PR). See
      "Phase 1 as built" below for what changed from this outline. Domain module and tests; Prisma migration (chat tables plus
      `TenantUser.localDriverEmployeeId`, with the Settings → Users field to set it); `canReadShipment` helper (shared with
      document-read-scoping; longhaul OR local driver); handlers; Cedar actions plus the AVP re-sync; push trigger plus the
      outbox **atomic claim** (used by the cron and the inline send); OpenAPI; integration tests for:
  - driver can or can't see a room;
  - an employee sees every room;
  - an idempotent replay;
  - fan-out recipients;
  - a mention getting through a mute;
  - a soft delete;
  - two concurrent drainers never double-sending a push row.
- [x] **Phase 2 — tenant-web.** Built 2026-10-20 (`feat/move-chat-page`); see "Phase 2 as built". The standalone `/messages` page (rail, conversation, composer, search), the nav
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
  - a profile display name for staff (chat shows emails today);
  - server-side shipper-name search for the chat page;
  - a workflow SDK `post_chat_message` + `chat.message.posted` event. When this lands, the SDK discoverability rule
    applies (README, MCP, OpenAPI, the authoring repo's `CLAUDE.md`), and an automation's post is a billable
    action.

## Phase 1 as built (2026-10-19)

**What shipped (one PR, `feat/move-chat-api`):**

- **Domain** `packages/domain/src/chat`: `parseChatRoomRef` (shipment only, positive int ≤ SQL `int`),
  `validateChatBody` (trim, CRLF→LF, 1–4000), `isValidClientMessageId` (8–64 `[A-Za-z0-9_-]`), `parseMentions`
  (`@[Name](userId)`, filtered to the room's mentionable set), `resolveChatScope` (D1), `resolveRecipients`,
  `chatPushContent` (D5).
- **Data** (two migrations: `20261019202100_move_chat`, `20261019202711_move_chat_last_message`): `chat_rooms`
  (with a denormalized `last_message_id` so the inbox reads previews in one query), `chat_messages`,
  `chat_room_members` (follow/mute/read cursor + `access_checked_at`), and
  `tenant_users.local_driver_employee_id`. All three chat models are in `TENANT_SCOPED_MODELS`.
- **Legacy reads** `apps/api/src/lib/chat-access.ts`: driver access (longhaul trip EXISTS OR an active
  `LocalDispatchJobs` driver slot; helpers excluded; fail closed), a one-query driver order-set check for the
  inbox, assigned drivers per order (each side soft-fails), `orderExists` (before the first post creates a room),
  and `listLocalDrivers`.
- **API** `handlers/chat.ts` on the Cognito-only `v1` router at `/api/v1/chat`:
  - `GET  /rooms/:t/:id` — room + membership + unread
  - `GET  /rooms/:t/:id/messages?after|before&limit`
  - `POST /rooms/:t/:id/messages` — idempotent; 201 new / 200 replay / 409 id reused in another room
  - `POST /rooms/:t/:id/read`
  - `PUT  /rooms/:t/:id/membership`
  - `GET  /rooms/:t/:id/mentionable`
  - `DELETE /messages/:id`
  - `GET  /inbox?filter=following|all` (`all` for employees)

  Plus `GET /api/v1/local-drivers` (UpdateUser) for the admin picker. An `apiClient` caller gets 403. All
  documented in `lib/openapi-spec.ts`.

- **Authz:** `ReadChat` / `PostChat` (`chat:read` / `chat:post`) on a new `ChatRoom` resource, granted to every
  principal by `policies/55-chat-shared.cedar`. The shared-baseline tests (`lib/authz.test.ts`, `me.test.ts`,
  e2e `authz-smoke.spec.ts`) include them.
- **Users:** `PATCH /users/:id` takes `localDriverEmployeeId`. tenant-web Settings → Users has a "Local driver"
  linker for driver-role users. It pre-selects the longhaul number only when that number is a local driver with
  the same surname (`features/users/local-driver-suggestion.ts`); the admin still saves.
- **Push:** `enqueueChatMessagePush` in `lib/push-triggers.ts` (dedupe `chat.message:<msg>:<user>`, deep link
  `{type:'chat.message', orderNum, messageId}`). Delivery moved into `lib/push-deliver.ts` with the claim.
  `PUSH_FORWARD_FUNCTION_NAME` and `lambda:InvokeFunction` on the forwarder are granted to the API Lambda in
  `api-stack.ts`, with an infra test.

**Deviations from the outline above:**

- No `canReadShipment` helper shared with document-read-scoping yet. Chat's driver check lives in
  `lib/chat-access.ts` (`driverCanReadOrder`); when document-read-scoping is built it should call that (or
  lift it), not write a second rule.
- The mobile app's deep link for `chat.message` doesn't exist yet. Pushes for it are queued and delivered, but a
  tap needs Phase 3's handler.
- **Display names are `crewMember.name` or the email.** `TenantUser` has no name field. Revisit in Phase 2 if
  the chat page needs real names (Cognito attributes or a profile field).

**Found along the way:**

- `TenantUser` is not auto-scoped by the tenant client. The mention list leaked across tenants until a
  two-tenant test caught it (fixed; GOTCHAS entry).
- **Pre-existing, not fixed here:** `handlers/notifications.ts` checks a push target with
  `{ where: { id: userId } }` and no tenantId.

## Phase 2 as built (2026-10-20)

**API additions (small, both read-only):**

- `GET /api/v1/chat/summaries?entityType=shipment&ids=1,2,3` (≤ 100 ids): shipper, origin/destination
  (`city, ST`), pack/load/delivery dates (`YYYY-MM-DD`) from `sales`, in one legacy query
  (`orderSummaries` in `lib/chat-access.ts`). A driver's request carries the driver-access predicate in the same
  query, so other orders are simply absent. 422 without a legacy DB, 503 `LEGACY_UNAVAILABLE` on a tunnel error.
  In OpenAPI.
- `GET /api/v1/me/permissions` now also returns `userId` (the caller's TenantUser id, null for M2M).

**Domain:** `splitMentions(body)` (render segments) and `formatMentionToken(name, userId)` — the page never
re-implements the mention regex.

**tenant-web:**

- Routes `/messages` and `/messages/shipment/$orderNum` (`routes/messages.tsx`, registered in `router.tsx`, no
  role guard — the API scopes). Two panes at `md`+, two screens below.
- `api/queries/chat.ts` (inbox 15 s poll, room, mentionable, summaries 10 min cache, membership mutation, plain
  calls for the thread).
- `features/chat/`: `thread-state.ts` (pure reducer: merge by id, pending sends keyed by clientMessageId,
  retry/discard, paging), `useChatThread.ts` (first page, 3 s poll after the newest id, paused on
  `document.hidden` with an immediate catch-up, read cursor, send/retry/delete), `mention-input.ts` (composer shows
  `@Name`; picked names become tokens at send), `format.ts`, and components `ConversationList`,
  `ConversationPane` (header: order · shipper, route, dates, assigned drivers from `mentionable`; follow/mute),
  `MessageList` (grouped bubbles, mine on the right, day dividers, a "New" line from the read cursor at arrival,
  load-older, delete for own or tenant_admin), `Composer` (Enter/Shift+Enter, @ picker), `ChatUnreadBadge`.
- Rail filters: All (employees read `filter=all`, drivers `following`), Unread, Mentions, Following. Search
  filters the list by order number or shipper; a typed order number opens that room even with no messages.
- AppShell: a **Messages** nav item (permission `chat:read`, capability `longhaul`) with an unread badge = sum
  of `unreadCount` over followed rooms.
- driver-planning `ShipmentDetail`: a "Chat → Open chat" row linking to `/messages/shipment/:orderNum`.

**Scope cuts (cheap to reverse):**

- Search by shipper name only filters the rooms already listed; there is no server-side shipper search.
- No link from the room header back to a shipment in driver-planning (that module has no per-order URL).
- A message someone else deletes disappears from an open thread only on reload (`after=` polling sees new
  rows, not edits); your own deletes update at once.
- Header drivers are the move's drivers **with logins** (from `mentionable`), not every legacy driver name.

**Tests:** API `chat.test.ts` (+3 summaries cases), `me.test.ts` (+userId); domain (+5); tenant-web
`thread-state`, `mention-input`, `format`, `useChatThread` (poll/pause/catch-up), `chat-page.test.tsx` (list +
pane against a fake API), AppShell (+4 Messages nav), ShipmentDetail (+2); Playwright
`tests/browser/move-chat.spec.ts` (badge → open → read clears badge → post → a colleague's reply polled in).
CI e2e floor 32 → 33 (35 executed).

## Files

- **New:**
  - `packages/domain/src/chat/*`
  - `apps/api/src/handlers/chat.ts` (+ tests)
  - `apps/api/src/repositories/chat.repository.ts`
  - ~~`apps/api/src/lib/shipment-read-access.ts`~~ — not built; the driver rule lives in `apps/api/src/lib/chat-access.ts`
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
  - `apps/api/src/handlers/users.ts` + tenant-web `users.tsx` (`localDriverEmployeeId` mapping)
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
- **Account Lambda concurrency is 10.** Every post with recipients queues one async forwarder run. Posts are human-paced
  and a run takes well under a second, so this is small; a throttled async invoke is retried by Lambda, and a lost
  kick only costs latency (the cron still runs every minute).
- **Reassignment.** A driver who is taken off a trip loses access straight away (once the cache expires) but keeps
  their stored follow row. `resolveRecipients` (push) and `GET /inbox` (preview) both have to filter by current
  access.
- **PII in messages.** Staff will type customer details. Messages stay inside the tenant; push content is D5.
- **`chat_messages.author_user_id` is `ON DELETE RESTRICT` to `tenant_users`.** It's deliberate, so a posted message
  never loses its author. Users are deactivated, never hard-deleted, and no code path hard-deletes a tenant today;
  `api_clients.created_by_id` already restricts the same way, so a future tenant purge has this to handle either way.
  Tests delete messages before users.
