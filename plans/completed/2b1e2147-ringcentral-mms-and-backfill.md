# RingCentral: forward MMS attachment references on-prem + fix the truncated backfill

**Status:** COMPLETE — PR 1 (backfill, #734) 2026-09-28; PR 2 (MMS references) 2026-09-29 · **Type:** feat (+ fix) · **Opened:** 2026-09-25

## Findings (prod, Nelson Westerberg, probe 2026-09-25)

Read-only probe of the tenant's v1 message-store (last 90 days, `messageType=SMS`) plus Neon checks:

| Fact                                           | Value                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| SMS-type messages in RingCentral, 90 days      | 5,100 (2,182 inbound, 2,918 outbound)                               |
| Captured into Pegasus since connect            | ~405, earliest 2026-09-18                                           |
| Rows created in the first minute after connect | exactly 250                                                         |
| FSync with `dateFrom` = 90 days                | 250 records, `olderRecordsExist: true`                              |
| Messages carrying `MmsAttachment`              | 30 (0.6%), all inbound; every one also has text                     |
| MMS files                                      | 47: 40 `image/jpeg`, 6 `image/png`, 1 `video/3gpp`; 1–4 per message |
| MMS file size                                  | min 92 KB · p50 231 KB · p90 825 KB · max 1.07 MB                   |
| MMS captured today                             | 2 of the 3 recent ones landed on-prem **text-only**; image lost     |

1. **MMS arrives as `type: 'SMS'`**, passes the normalizer, and `attachments[]` is ignored end to end.
   pegII gets the caption; the picture is silently dropped. No error, no log.
2. **Backfill is truncated.** RingCentral message-sync FSync returns at most 250 records and does
   not paginate; `syncV1Store` treats that page as the whole backfill. The original plan promised a
   paginated 90-day backfill. The paginated `message-store` list endpoint returns all 5,100.

## PR 1 — fix: paginate the v1 backfill — DONE (2026-09-28)

Shipped as specified: FSync keeps the sync token; `olderRecordsExist` → page `message-store` (1,000 ×
3 pages per run) with progress in `ringcentral_sync_cursors.backfill_from/backfill_before`. Re-run for
a connection by setting those two columns (runbook "Backfill beyond 250 messages") — no token reset.

- On FSync (first run or `SYNC_TOKEN_INVALID`), keep the FSync call to obtain the sync token, and
  when `syncInfo.olderRecordsExist` is true, page `GET …/extension/~/message-store` (`messageType=SMS`,
  `dateFrom` = backfill window, `perPage=1000`, follow `navigation.nextPage`) and capture every
  record through the existing `captureMessage` (idempotent on `(tenant, source, external_id)`).
- Respect RingCentral rate limits (existing client 429 handling) and cap total pages per run; resume
  on the next sync run if the cap is hit (persist a backfill-progress marker on the cursor).
- Tests: FSync with `olderRecordsExist` pages the list endpoint; records captured once; token still
  stored; cap + resume.
- **Ops after deploy:** re-run the backfill for Nelson Westerberg (set its V1 cursor's backfill
  window; the next sync run pages it). Expect ~4,700 more rows on-prem, oldest first by `rc_created_at`
  interleaving with live traffic; the forwarder drains them at 100/tenant/5 min (~4 h).

## PR 2 — feat: MMS attachment references forwarded on-prem (no bytes stored) — DONE (2026-09-29)

Shipped as below, with these deviations from the design that follows:

- **Lookup does not read Neon.** Cloud `Message` rows (and their `MessageAttachment` rows, by
  cascade) are deleted 30 days after forwarding, so the endpoint builds RingCentral's content path
  from the tenant's connection (`/account/{rcAccountId}/extension/{rcExtensionId}/message-store/
{externalId}/content/{attachmentId}`), trying each connection until one answers non-404. It works
  for as long as RingCentral keeps the message.
- **Transport:** a base64 JSON envelope by default (the proven path, like `pegii-reports`);
  `?format=raw` returns bytes with a passive-media content-type allowlist + `nosniff`. Raw binary
  through the hono/aws-lambda adapter is untested in a deployed environment — smoke it before relying
  on it. Files over 3.3 MB → `502 ATTACHMENT_TOO_LARGE` (observed max 1.07 MB).
- **Auth:** new Cedar action `ReadRingCentralAttachment` (resource `Setting`), granted to the
  `integrations` persona; tenant admins have it implicitly.
- **Missing on-prem attachments table** parks the whole forward (message re-MERGE is idempotent), so
  plain SMS are unaffected and MMS drain once the table exists.
- **Not built (follow-ups):** the one-off to back-fill references for MMS already on-prem (only 3
  since connect; the historic backfill was also deferred); `sms.received` payloads carrying
  attachments (a workflow-SDK surface change); thread-store attachments.

**Decision (2026-09-28):** store only the references needed to look an attachment up; neither
Pegasus nor on-prem stores the file. The file stays in RingCentral and is fetched on demand.

**Capture.** Extend the v1 raw shape + domain with
`attachments: { id, contentType, size, width?, height?, uri }[]` for `type === 'MmsAttachment'`
(skip the `Text` part — it is the body). New Prisma model `MessageAttachment` (FK → `Message`,
cascade), written in the same `captureMessage` transaction. Metadata only.

**Forward.** After the message `MERGE`, the forwarder `MERGE`s one metadata row per attachment into
`dbo.inbound_message_attachments` in the same run. No RingCentral call, no binary params, no
executor change. A missing attachments table parks the attachment rows (alarm) and never
dead-letters the message text.

**Lookup.** RingCentral attachment `uri`s need a RingCentral access token, and the tenant's
credentials live only in Pegasus. So pegII fetches through a new streaming proxy:
`GET /api/v1/integrations/ringcentral/messages/{source}/{externalId}/attachments/{attachmentId}`
→ Pegasus resolves the tenant connection, gets a token (existing cache), streams RingCentral's
bytes through with the original `Content-Type`. Nothing is written to disk, S3, or Neon.
Auth: a tenant API client (existing M2M API keys), RBAC-gated. Documented in OpenAPI.

**On-prem DDL (new):**

```sql
IF OBJECT_ID(N'dbo.inbound_message_attachments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.inbound_message_attachments (
    tenant_id      NVARCHAR(64)   NOT NULL,
    source         NVARCHAR(16)   NOT NULL,
    external_id    NVARCHAR(64)   NOT NULL,   -- parent message (RingCentral message id)
    attachment_id  NVARCHAR(64)   NOT NULL,   -- RingCentral attachment id
    content_type   NVARCHAR(128)  NOT NULL,   -- e.g. image/jpeg
    size_bytes     INT            NULL,
    width          INT            NULL,
    height         INT            NULL,
    rc_uri         NVARCHAR(512)  NOT NULL,   -- RingCentral content URI (needs an RC token)
    captured_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_inbound_message_attachments_captured DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_inbound_message_attachments PRIMARY KEY (tenant_id, source, external_id, attachment_id),
    CONSTRAINT FK_inbound_message_attachments_message FOREIGN KEY (tenant_id, source, external_id)
      REFERENCES dbo.inbound_messages (tenant_id, source, external_id)
  );
END
```

pegII builds the Pegasus lookup URL from `(source, external_id, attachment_id)`; `rc_uri` is kept
for traceability and for a future direct-to-RingCentral path.

**Tests:** normalizer keeps MmsAttachment metadata, drops `Text`; capture persists attachments
idempotently; forwarder sends message then N metadata merges; missing attachments table parks
without touching the message; proxy streams bytes + content type, 404 for unknown/other-tenant
attachment, maps RingCentral 404 → 404, requires auth.

**Existing MMS already on-prem:** one-off to re-read the RingCentral record for captured messages
with MmsAttachment and enqueue their attachment metadata rows (cheap — no downloads).

**Risk to verify before building:** references only work while RingCentral still holds the
message. Confirm RingCentral's message-store retention for this account; if it purges, older
pictures become unretrievable (the lookup returns 404, and pegII should show "no longer available").

## Out of scope / unknowns

- **Thread (shared-inbox) store:** zero `THREAD_STORE` rows captured for this tenant and not probed.
  No attachment handling designed for it until we see real thread entries.
- Outbound MMS (none observed in 90 days) — handled the same way, untested against real data.
- `conversationId` exists on v1 records but `thread_id` is null for V1 rows; worth populating so pegII
  can group conversations (small, separate change).

## Docs

- pegII handoff doc: add the attachments table, the lookup endpoint + auth, and reader guidance;
  correct "Backfill starts immediately" (it was capped at 250 until PR 1).
- `docs/ringcentral-onprem-inbound-message-attachments.sql`, runbook sections, GOTCHAS (FSync 250 cap).
- SDK/OpenAPI: the lookup route is an integrations route — document it in OpenAPI (and SDK if pegII-style consumers use it).
