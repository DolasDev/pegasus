# RingCentral Message Capture — Operations Runbook

How the RingCentral SMS capture pipeline works, how to turn it on, how to read
its alarms, and how to recover when something breaks.

## What it does

Captures **all** RingCentral SMS for a tenant — inbound via the Thread Messaging
store and outbound via the v1.0 message-store — buffers them in Neon, and
forwards each idempotently to the tenant's on-prem SQL Server over the existing
WireGuard / `mssql-executor` path.

```
RingCentral ──webhook──▶ POST /api/integrations/ringcentral/webhook
                              │ fast-ack: persist InboundWebhookEvent + SQS enqueue
                              ▼
                         capture queue ──▶ capture worker ──┐
   reconciliation sync (15-min cron) ──────────────────────┤ idempotent
   backfill-on-connect (OAuth callback) ───────────────────┘ captureMessage
                                                              upsert + outbox
                                                              │
                              forwarder cron (5-min) ─────────┘
                                  │ MERGE dbo.inbound_messages via mssql-executor
                                  ▼
                          on-prem SQL Server  (authoritative store)
                                  │
                          buffer-purge cron (6h): null body @72h, delete tombstone @30d
```

Everything is gated behind `RINGCENTRAL_ENABLED`. While unset (every environment
today) nothing runs: no RC API calls, empty queue/outbox, all crons no-op, all
alarms green.

## Enabling the feature (per environment)

Set on the api Lambda + the RC cron Lambdas (ops step — not part of the rollout):

| Variable                                              | Required           | Notes                                                                                                               |
| ----------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `RINGCENTRAL_ENABLED`                                 | yes                | `true` turns the integration on.                                                                                    |
| `RINGCENTRAL_CLIENT_ID` / `RINGCENTRAL_CLIENT_SECRET` | yes                | Platform RC app credentials.                                                                                        |
| `RINGCENTRAL_OAUTH_REDIRECT_URI`                      | yes                | Must match the RC app + point at `/api/integrations/ringcentral/oauth/callback`.                                    |
| `RINGCENTRAL_OAUTH_STATE_SECRET`                      | yes                | HMAC secret for the signed OAuth state.                                                                             |
| `RINGCENTRAL_WEBHOOK_URL`                             | yes (for webhooks) | Public URL of `POST /api/integrations/ringcentral/webhook`. The renewal cron won't create subscriptions without it. |
| `RINGCENTRAL_API_BASE`                                | no                 | Defaults to `https://platform.ringcentral.com`.                                                                     |
| `RINGCENTRAL_BACKFILL_DAYS`                           | no                 | Backfill window on first connect. Defaults to 90; capped at 365.                                                    |
| `RINGCENTRAL_SECRET_PREFIX`                           | injected           | Set by CDK (Secrets Manager name prefix).                                                                           |
| `RINGCENTRAL_WEBHOOK_QUEUE_URL`                       | injected           | Set by CDK (capture queue URL).                                                                                     |

The tenant's on-prem connection string comes from `Tenant.mssqlConnectionString`
(configured via Settings). The on-prem target table DDL is in
[`ringcentral-onprem-inbound-messages.sql`](./ringcentral-onprem-inbound-messages.sql) —
hand to the on-prem DBA before forwarding is expected to succeed.

After enabling: hit `GET /api/v1/integrations/ringcentral/oauth/start?number=<E.164>`
as a tenant admin, complete the RC consent, and the callback records the
connection, stores the refresh token in Secrets Manager, and kicks an immediate
backfill. The renewal cron then creates the webhook subscription within the hour.

## Alarms (SNS topic `pegasus-alarms`)

Gauges are published every 15 min by the `RingCentralMetricsFunction`
(`Pegasus/RingCentral` namespace). All RC alarms use `treatMissingData:
NOT_BREACHING`, so they stay green while the feature is inert (the emitter
publishes 0s) and only fire on a real value.

| Alarm                              | Fires when                               | Response                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pegasus-rc-capture-dlq`           | Capture DLQ depth > 0                    | Poison webhook-capture jobs. See **Capture DLQ** below.                                                                                                                                                                                   |
| `pegasus-rc-outbox-dead`           | Any `MessageForwardOutbox` row is `DEAD` | A forward exhausted all retries. See **DEAD outbox** below.                                                                                                                                                                               |
| `pegasus-rc-outbox-backlog`        | > 500 rows `PENDING`/`FAILED`            | On-prem is likely unreachable or the forwarder is stalled. Check WireGuard / `mssql-executor` health and `Tenant.mssqlConnectionString`. Rows park `PENDING` and drain automatically once on-prem recovers — no data loss.                |
| `pegasus-rc-subscriptions-dead`    | A subscription is `DEAD`/`BLACKLISTED`   | Near-real-time delivery is down for a connection; the 15-min reconciliation sync still backstops capture. The renewal cron recreates it within the hour — investigate if it persists (bad `RINGCENTRAL_WEBHOOK_URL`, repeated slow acks). |
| `pegasus-rc-connections-unhealthy` | A connection's `health` is `UNHEALTHY`   | Usually a failing token refresh. Capture for that tenant has stopped; re-run the OAuth connect flow to re-store a refresh token.                                                                                                          |
| `pegasus-rc-sync-lag`              | Oldest sync cursor > 1h stale            | Capture stalled. Check the sync cron (`RingCentralSyncFunction`) logs for RC rate-limiting or auth errors.                                                                                                                                |

## Capture DLQ

The capture worker consumes webhook jobs from the capture queue; after
`maxReceiveCount` (5) failed attempts a job lands in the DLQ
(`RingCentralCaptureDLQ`, 14-day retention).

1. **Inspect**: read a few messages from the DLQ (SQS console → _Send and receive
   messages_ → _Poll_, or `aws sqs receive-message`). Each body is a `CaptureJob`
   (`{ webhookEventId, tenantId, connectionId, subscriptionId }`). The matching
   `InboundWebhookEvent` row holds the raw payload + `error`.
2. **Diagnose** from the worker logs (`/aws/lambda/...RingCentralCapture...`):
   typically an RC auth/rate-limit error or a connection that was deleted.
3. **Fix the cause** (re-store the token, raise the RC rate limit, etc.).
4. **Redrive**: SQS console → DLQ → _Start DLQ redrive_ (back to the source
   queue). Capture is idempotent (`(tenantId, source, externalId)` upsert), so
   re-processing never duplicates a message.
5. If a job is genuinely un-processable (connection gone for good), delete it —
   the reconciliation sync will re-capture anything still reachable.

## DEAD outbox (forwards that gave up)

The forwarder retries with exponential backoff and dead-letters a row to `DEAD`
after 8 attempts (only for genuine on-prem **query** errors — an unreachable
on-prem **parks** rows `PENDING` indefinitely without consuming attempts, so an
outage never dead-letters the backlog).

A `DEAD` row means the MERGE itself failed repeatedly (e.g. the on-prem table is
missing or its schema drifted). To recover:

1. Find the cause in `MessageForwardOutbox.lastError` and the forwarder logs
   (`/aws/lambda/...RingCentralForward...`).
2. Fix on-prem (apply the DDL, correct the schema/permissions).
3. **Manual redrive** — set the affected rows back to `PENDING` so the next
   forwarder run picks them up (the forwarder drains `PENDING` _and_ `FAILED`):

   ```sql
   UPDATE message_forward_outbox
   SET status = 'PENDING', next_attempt_at = now(), attempts = 0, last_error = NULL
   WHERE status = 'DEAD' AND tenant_id = '<tenant>';
   ```

   The matching `messages.forward_status` is kept in lock-step by the forwarder
   on its next attempt.

## Retention (PII)

Neon is a transient buffer; on-prem is authoritative once a message is `SENT`.
The buffer-purge cron (`RingCentralBufferPurgeFunction`, every 6h) enforces:

- **Body purge** — `body` is nulled and `bodyPurgedAt` stamped 72h after a
  successful forward (`purgeAfter`). Worst-case body lifetime ≈ 72h + 6h.
  `captureMessage` never rewrites a purged body, so a re-capture can't resurrect
  it.
- **Tombstone delete** — `SENT` message rows captured more than 30 days ago are
  hard-deleted (the FK cascade drops their outbox rows). `PENDING`/`FAILED` rows
  (still being delivered) and `DEAD` rows (kept for investigation) are retained.

## Disabling

Set `RINGCENTRAL_ENABLED` unset/false. New captures stop (the OAuth/webhook
paths fail closed). Already-captured messages still flush on-prem and the
buffer-purge still runs — retention is intentionally not gated on the flag.
