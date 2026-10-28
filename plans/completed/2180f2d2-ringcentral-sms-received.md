# Fix: `sms.received` never fires in prod (RingCentral ISync + webhook)

Branch: `fix/ringcentral-sms-received` (worktree `../pegasus-ringcentral-sms-received`). All changes stay on this branch.

## Problem (diagnosed 2026-10-28 on prod, NW tenant `9d869236…`, connection `f69cac01…`)

`domain_events` holds **zero** `sms.received` rows, ever, so EVENT triggers on it (NW `nw_pulse_reply` 0.3.0, trigger `d53b5633`) can never fire. Three RC failures, each visible in the Sync/Renew Lambda logs on every run:

1. **v1 ISync is malformed.** `isyncParams` sends `messageType=SMS` alongside `syncToken`. RC replies `400 CMN-101 "Parameter [messageType] value is invalid"`. `isSyncTokenInvalid` treats _any_ 400 as a stale token, so every run falls back to FSync, and FSync deliberately never emits. Proven by a read-only probe: the same stored token **without** `messageType` returned 200 plus the missed inbound text.
2. **The webhook subscription is never created.** Every hourly renew logs `400 InvalidParameter "Parameter [deliveryMode.verificationToken] value is invalid"`. NW has 0 rows in `ringcentral_subscriptions`, so capture is only the 15-min sync (p50 lag ~8 min). `newVerificationToken()` = `randomBytes(24).hex` = 48 chars. RC's OpenAPI spec (`rc-platform.yml`) documents **no** constraint, so the length cause is **unverified**.
3. **The thread store is off for this extension.** `message-threads/entries/sync` → `403 CMN-428 "Feature [MessageThreads] is turned off"`. This throws out of `syncConnection` after the V1 store, so the connection counts as failed every cron run. On the webhook path (SQS capture worker → `syncConnection`), it would retry every job into the DLQ.
4. **The July backfill re-pages every run.** It is a side effect of 1: each FSync reports `olderRecordsExist` and re-arms the 90-day backfill window, so every run pages 3,000 records (~58 s, 4×/h), even though the re-backfill was deliberately skipped earlier.

## Steps (TDD — failing test first for each)

### 1. ISync request + error classification — `apps/api/src/services/ringcentral/sync.ts`

- [x] Test: ISync request params are exactly `{ syncType: 'ISync', syncToken }` (no `messageType`); FSync keeps `messageType: 'SMS'`.
- [x] Test: ISync records of a non-SMS `type` (Fax, VoiceMail, Pager) are skipped before `captureOne`. They are neither captured nor logged as normalization errors. Inbound SMS in the same page still emits.
- [x] Test: a 400 whose `errorCode` is `CMN-101` with `parameterName` ≠ `syncToken` is NOT a stale token. It rethrows and logs the RC body, with no FSync fallback. A genuine invalid-token 400 still falls back. Use RC's code for that case if the client exposes it, else keep the fallback for 400s that aren't parameter errors on another field.
- [x] Log the RC error code/body on every fallback (today the reason is invisible).

### 2. Webhook verification token — `apps/api/src/services/ringcentral/subscription-manager.ts`

- [x] **Probe first (needs user OK, writes to NW's RC account):** a scratchpad script mints an access token from the connection's JWT and `POST /restapi/v1.0/subscription`s with the real webhook URL and a 32-char token. If that is accepted, it also tries 48. It records the response and DELETEs any subscription it created. The webhook already answers the validation handshake. Without a stored row, any notification arriving in that window gets rejected (unknown subscription), which is harmless.
- [x] If 32 is accepted and 48 rejected: `randomBytes(16).toString('hex')` (32 chars, 128-bit), with a test pinning length ≤ 32. If the probe shows a different cause, fix that instead and record the evidence here.
- [x] Renew failures already log the body. No change.

### 3. Thread store disabled — `sync.ts`

- [x] Test: a 403 with `errorCode` `CMN-428` from the thread store is a logged skip (info, once per run). The V1 result still returns, and `syncConnection` does not throw. Other thread-store errors still throw.
- [x] Needs `RingCentralOAuthError.errorCode` (already populated by `client.ts` `rcErrorCode`).

### 4. Backfill re-arm — verify, no extra code expected

- [x] Test: an ISync run with a saved backfill window resumes that window and does not re-arm a new 90-day one (pins the existing branch).
- [ ] After deploy, NW's saved window (2026-07-30 → 2026-09-01) drains in one or two runs and then clears itself. Captures are idempotent and never emit. **Decided (user, 2026-10-28): CLEAR it after deploy** — one prod UPDATE nulling `backfill_from`/`backfill_before` on the NW V1 cursor (matches the earlier choice to skip the re-backfill).

### Docs / surfaces

- [x] `dolas/agents/project/GOTCHAS.md`: RC ISync rejects `messageType`; the RC Lambda log groups are custom-named (not `/aws/lambda/…`); "deploy green" ≠ "event observed".
- [x] No SDK/API contract change (the `sms.received` payload is unchanged), so no SDK bump.

## Evidence & implementation notes (2026-10-28)

- **ISync probe (read-only):** the stored NW token with `messageType=SMS` → `400 CMN-101 parameterName=messageType`; the same token without it → `200`, including the missed 17:03:38Z inbound text.
- **Subscription probe (user-approved; create → DELETE, both 204):** 48-char token → `400 CMN-101 deliveryMode.verificationToken`, with either filter set; 32-char → `200 Active`. With both filters RC returned only ONE filter, and a re-probe printed it: `…/extension/541170017/message-store/instant?type=SMS`. RC silently drops threads when the feature is off and KEEPS the SMS filter, so `EVENT_FILTERS` is unchanged.
- `RingCentralOAuthError` gains an optional `parameterName` (from `rcParameterName` in `client.ts`). `isSyncTokenInvalid` = 400 whose `parameterName` is absent or `syncToken`.
- Thread-store CMN-428 is caught in `syncConnection`, so the cron AND the webhook capture worker (SQS → `syncConnection`) both stop failing/retrying on it.
- Item 4 needed no code: the existing test `resumes a saved backfill on a later incremental run` already pins it; the re-arm only ever happened on the FSync fallback.
- Full `apps/api` suite: 309 files / 4630 tests passing.

## Verification after deploy (prod, read-only)

- [ ] Sync log: no "sync token invalid" and no "Reconciliation sync failed"; run duration drops well under 58 s.
- [ ] `ringcentral_subscriptions` has 1 ACTIVE row for NW (within ~1 h of deploy); renew log shows `created: 1`.
- [ ] Send a test text to NW: an `INBOUND` row is captured within seconds (webhook), an `sms.received` row exists with `dispatched_at` set, and a `workflow_executions` row for `nw_pulse_reply` has `trigger_source=EVENT`, `triggered_by_trigger_id=d53b5633…`.
- [ ] Watch the capture-queue DLQ stays empty.
- [ ] The first real notification lands: an `inbound_webhook_events` row plus an INBOUND `messages` row with sub-minute `captured_at - rc_creation_time`.
- [ ] No `v1 sync token invalid` in the sync log. The cron and the webhook capture worker now both ISync the same V1 token for the first time, so a reappearance (now logged with `errorCode`/`parameterName`) points to that race — the next bug, not noise.
- [ ] Clear NW's leftover backfill window (user decision): `UPDATE ringcentral_sync_cursors SET backfill_from=NULL, backfill_before=NULL WHERE connection_id='f69cac01-0461-43a9-a174-175ab6c3aeee' AND store='V1'`.

## Out of scope

- Concurrent webhook-driven and cron syncs sharing one sync token (pre-existing design).
- Back-filling `sms.received` for texts missed since #730 (events are announcements, not history).
