# RingCentral Message Capture → On-Prem Bridge

**Branch:** _create `feat/ringcentral-message-capture` before implementing — do not build on `main`._
**Goal:** Reliably capture all RingCentral SMS (inbound + outbound, across the v1.0 message-store **and** the new Thread Messaging "Shared" store), persist them in Pegasus (Neon), and forward them to the on-prem Postgres over the existing WireGuard bridge — with a managed webhook-subscription + OAuth-token lifecycle layer so capture survives expiry, blacklisting, and outages.

> Status: ✅ COMPLETE (2026-06-09). All phases implemented and merged to `main` across every layer (domain, repository, API handlers/services, all seven cron/worker Lambdas, infra, UI, e2e + runbook). Auth pivoted from platform 3-legged OAuth to **per-tenant bring-your-own JWT** (paste client id/secret + JWT credential; validated by a live jwt-bearer exchange) — see PRs #200–#223. Verified green: domain 33, api 97, infra 244, tenant-web 14, full typecheck, e2e webhook acceptance. Plan archived to `plans/completed/`.
>
> _Note: the sections below are the original DRAFT design. Where it says "OAuth", the shipped implementation uses BYO-JWT (no platform OAuth app, no consent redirect); the connect endpoint is `POST /api/v1/integrations/ringcentral/connections`. Everything else shipped as designed._

### Resolved decisions (2026-06-08)

1. **On-prem Postgres is authoritative.** Neon's role drops to a **control plane + transient message buffer**: it holds long-lived operational state (connections, subscriptions, sync cursors, raw webhook inbox, outbox) and only a _short-lived_ copy of message bodies, purged shortly after a row is confirmed forwarded on-prem. The system of record for messages is on-prem.
2. **Per-tenant OAuth.** One platform-level RingCentral app; each tenant authorizes it via 3-legged OAuth (the connect flow). Tokens, subscriptions, and cursors are all per `RingCentralConnection` (per tenant).
3. **Near-real-time required → webhooks are the PRIMARY path** (user accepts the webhook dependency). The scheduled reconciliation sync is **demoted to a low-frequency safety net** (gap recovery / blacklist windows), not the primary capture mechanism.
4. **On-prem target is the existing SQL Server**, written via the existing **mssql-executor** path over the WireGuard tunnel (T-SQL `MERGE`, idempotent). No new on-prem Postgres; the forwarder does not open its own DB connection — it submits T-SQL through mssql-executor.
5. **Scope: SMS only** (no MMS/fax/voicemail in v1). A connection may cover multiple SMS-enabled numbers belonging to that tenant.
6. **Cloud buffer retention (chosen for enterprise reliability at reasonable cost):** two-tier. The **message body (PII)** is nulled/purged **72h after `forwardStatus=SENT`** (covers a long-weekend replay/debug window). A lightweight **idempotency tombstone** (the `Message` row with body/attachments nulled) is retained **30 days**, then hard-deleted — this stops the safety-net/backfill sync from needlessly re-forwarding recently-seen messages. On-prem remains the only durable, long-term store.
7. **Backfill on first tenant connect:** `FSync` the thread store (naturally bounded to active/open threads) and date-bounded backfill the v1.0 store for the **last 90 days** (configurable per tenant, hard-capped, paginated). Same idempotent forward path, so backfill and live capture can't double-write on-prem.

Multi-tenant webhook model (how the dependency is accommodated): **one shared webhook URL** serves all tenants. Each tenant's subscription carries its own `verificationToken` and the event payload includes its `subscriptionId`; we map `subscriptionId → connection → tenant` to load the tenant-scoped client. Adding a tenant = one more subscription pointing at the same endpoint. This scales cleanly and is the standard SaaS webhook fan-in pattern.

---

## 1. Background & the reliability problem (why this design)

A live diagnosis of the source account (number `+19085760908`, `usageType: MainCompanyNumber`, extension 101) established:

- The account was migrated to **Thread Messaging (Shared Inbox)** on **2026-06-01**. `features?featureId=MessageThreads` → `available: true`.
- **Inbound** SMS to a common-resource number (main company / site / call-queue number) now writes to the **Message Threads store** (`/restapi/v1.0/account/~/message-threads/messages`) — _not_ the v1.0 `message-store`. Verified: v1.0 inbound stopped `2026-06-01T17:19Z`; thread store has the inbound from `2026-06-02` onward.
- **Outbound** sent via the v1.0 `/sms` API still lands in the v1.0 `message-store`.
- **Thread Messaging webhook events are "thin"** — per `threads/events.md`, the event payload carries only `lastModifiedTime`. The webhook is a _trigger_; the actual records must be pulled via the **sync API**.

Two hard reliability constraints fall out of this:

1. **No single store holds everything.** We must capture from **both** the Thread Messaging store (inbound + threaded outbound) and the v1.0 message-store (legacy/API outbound).
2. **Webhooks alone are not reliable.** RingCentral subscriptions expire, get blacklisted after repeated delivery failures, and can silently drop events during outages. Thin payloads also force a follow-up sync call regardless.

**Design principle (the spine of this plan):** _Webhooks for near-real-time, Sync as the safety net._ Per the resolved decisions, **webhooks are the primary path** — a push event triggers an immediate targeted sync-API pull (thread events are thin, carrying only `lastModifiedTime`, so a pull is always required to get the body). An independent, **low-frequency** scheduled **reconciliation sync** runs only to recover gaps (subscription blacklist windows, outages). Everything is **idempotent**, keyed on the RingCentral message id + store, so the webhook path and the safety-net path converge without duplicates.

---

## 2. Target architecture

```
                  RingCentral Cloud
        ┌──────────────────────────────────────┐
        │  Thread store  │  v1.0 message-store   │
        └────┬───────────────────────┬──────────┘
   thin webhook (trigger)        OAuth REST (sync/read)
             │                        │
   ┌─────────▼─────────┐    ┌─────────▼──────────────────┐
   │ POST /webhook     │    │ Reconciliation Sync (cron)  │  ◄── reliability backstop
   │ (pre-tenant, fast │    │ ISync thread entries + v1.0 │
   │  ack, raw inbox)  │    │ FSync on first run / gap    │
   └─────────┬─────────┘    └─────────┬──────────────────┘
             │ SQS                     │
        ┌────▼─────────────────────────▼────┐
        │  Capture Worker (normalize)        │
        │  - pull via sync cursor            │
        │  - resolve thread phone pair       │
        │  - UPSERT Message (idempotent)     │
        │  - enqueue ForwardOutbox row       │
        └────┬───────────────────────────────┘
             │  Neon (cloud system-of-record / staging)
        ┌────▼──────────────────────────────┐
        │  Forwarder (drains outbox)         │  ◄── transactional outbox, at-least-once
        │  builds T-SQL MERGE → mssql-executor│      + idempotent MERGE = effectively-once
        └────┬───────────────────────────────┘
             │ submits T-SQL via existing mssql-executor (WireGuard VPC)
             │ WireGuard tunnel (10.200.0.0/16 overlay)
        ┌────▼──────────────────┐
        │ On-Prem SQL Server     │  dbo.inbound_messages (authoritative, on-prem)
        └───────────────────────┘

   Management plane (cron-driven, per RingCentralConnection):
     • OAuth token refresh   • Subscription create/renew/recreate
```

Reuses proven Pegasus patterns: Hono handlers on `/api/v1`, pre-tenant mounting for unauthenticated/M2M routes (`app.ts`), tenant-scoped Prisma (`createTenantDb`), Secrets Manager + KMS, the **WireGuard VPC + tunnel/executor Lambda** pattern (`wireguard-stack.ts`, `apps/tunnel-proxy`), EventBridge-cron Lambdas, and structured logging via the Powertools `logger` singleton.

---

## 3. New bounded context: `messaging`

Pure domain in `packages/domain/src/messaging/` (zero I/O, branded IDs, immutable VOs, factory functions, named exports — per `PATTERNS.md`).

- **IDs:** `MessageId`, `RingCentralConnectionId`, `SubscriptionId`, `SmsThreadId` (all `Brand<string, …>` + `to*` factories).
- **Enums/VOs:** `MessageDirection` (`INBOUND|OUTBOUND`), `MessageSource` (`THREAD_STORE|V1_STORE`), `MessageStatus` (`CAPTURED|FORWARDED|FAILED`), `ForwardStatus`, `PhoneNumber` (E.164 validated), `MessageContent`.
- **Aggregate:** `Message` (readonly: id, source, externalId, threadId?, direction, from, to, body, rcCreationTime, rcLastModifiedTime, status, …). SMS-only — no attachments.
- **Pure functions:** `dedupeKey(source, externalId)`, `normalizeThreadEntry(...)`, `normalizeV1Message(...)`, `canForward(message)`, status transitions, `isWebhookValidationHandshake(headers)`.

---

## 4. Persistence (Prisma) — `apps/api/prisma/schema.prisma`

All tenant-scoped, `@@schema("public")`, `tenantId` FK to `Tenant`, snake_case `@map`. Migrations are **expand-only / non-destructive** per the expand-then-contract rule.

| Model                     | Purpose                                                                                                 | Key fields / constraints                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| `RingCentralConnection`   | One connected RC account per tenant (or per number)                                                     | `rcAccountId`, `rcExtensionId`, `ownerNumber`, `tokenSecretArn` (Secrets Manager — refresh token), `tokenStatus`, `scopes[]`, `lastRefreshedAt`, `health`                                                                                                                                                                               |
| `RingCentralSubscription` | Managed webhook subscription                                                                            | `subscriptionId`, `eventFilters[]`, `transport`, `deliveryAddress`, `verificationToken`, `expiresAt`, `status` (`ACTIVE                                                                                                                                                                                                                 | EXPIRING                                                                     | BLACKLISTED | DEAD`), `lastRenewedAt`, `failureCount`                        |
| `RingCentralSyncCursor`   | Sync token per store — the backstop's memory                                                            | `store` (`THREAD                                                                                                                                                                                                                                                                                                                        | V1`), `syncToken`, `lastSyncAt`, `@@unique([tenantId, connectionId, store])` |
| `InboundWebhookEvent`     | Raw event inbox (replay/audit)                                                                          | `rawPayload Json`, `headers Json`, `receivedAt`, `processedAt`, `status`                                                                                                                                                                                                                                                                |
| `Message`                 | Normalized captured SMS — **transient cloud buffer** (body purged after forward; on-prem authoritative) | `source`, `externalId`, `threadId?`, `direction`, `fromNumber`, `toNumber`, `body`, `rcCreationTime`, `rcLastModifiedTime`, `forwardStatus`, `bodyPurgedAt?`, `purgeAfter?`, **`@@unique([tenantId, source, externalId])`**, indexes on `[tenantId, forwardStatus]` and `[tenantId, rcCreationTime]` (SMS-only — no attachments column) |
| `MessageForwardOutbox`    | Reliable on-prem delivery                                                                               | `messageId`, `attempts`, `nextAttemptAt`, `status` (`PENDING                                                                                                                                                                                                                                                                            | SENT                                                                         | FAILED      | DEAD`), `lastError`, index `[tenantId, status, nextAttemptAt]` |

The `@@unique([tenantId, source, externalId])` on `Message` is the linchpin: webhook-path and sync-path upserts collide on it, giving exactly-one row regardless of how many times either path sees the message.

---

## 5. Management plane (the "hook registration management layer")

### 5a. OAuth / credential lifecycle

- **3-legged connect:** admin endpoints `GET /api/v1/integrations/ringcentral/oauth/start` → RC authorize URL; `GET …/oauth/callback` → exchange code, store the (rotating) refresh token in **Secrets Manager** (`pegasus/{env}/ringcentral/{connectionId}`), record `RingCentralConnection`. Access tokens are never persisted.
- **Token-refresh worker (EventBridge cron):** refresh access tokens before expiry; persist rotated refresh tokens; on refresh failure mark `tokenStatus=EXPIRED` + `health=UNHEALTHY` and alarm. (RC refresh tokens lapse if unused — the cron keeps them warm.)

### 5b. Subscription manager

- `SubscriptionManager.ensure(connection)`:
  - **create** if none — `POST /restapi/v1.0/subscription` with a fresh `verificationToken` and the event filters below; store `subscriptionId` + `expiresAt`.
  - **renew** (`PUT`) when `expiresAt` within the renewal threshold (e.g. < 24h of TTL).
  - **recreate** if `status` is `BLACKLISTED`/`DEAD` or renewal 404s.
- **Event filters (cover both stores):**
  - `/restapi/v1.0/account/~/message-threads/entries/sync` — Thread _message_ events (inbound + threaded outbound). **Primary.**
  - `/restapi/v1.0/account/~/message-threads/sync` — Thread events (assignment/resolve) — optional, useful for thread metadata.
  - `/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS` — v1.0 outbound, if v1.0 send remains in use.
- **Renewal scheduler (EventBridge cron):** iterate ACTIVE connections, renew/recreate as needed, update health.

---

## 6. Capture paths

### 6a. Webhook ingestion (latency path) — `POST /api/v1/integrations/ringcentral/webhook`

- Mounted **pre-tenant** (unauthenticated, like the M2M block in `app.ts`).
- **Validation handshake:** if the `Validation-Token` request header is present (subscription create/renew), echo it back in the response header and return `200` immediately.
- **Event auth:** compare the inbound `verificationToken` header against the stored per-subscription token; resolve tenant/connection from the subscription id in the payload. Reject mismatches at `WARN` (expected) → 401.
- **Fast-ack:** persist raw payload to `InboundWebhookEvent`, push to **SQS**, return `200` in <1s. No heavy work inline (slow/erroring endpoints get blacklisted by RC).

### 6b. Capture worker (SQS consumer Lambda)

- For each raw event: because thread events are thin, call the **sync API** (`ISync` using the stored `RingCentralSyncCursor`) to pull the actual changed entries. For thread messages, call **Read Thread** to resolve the from/to phone pair (thread entries omit numbers). Normalize via domain functions → **UPSERT `Message`** on `(tenantId, source, externalId)`. For new/changed rows, insert a `MessageForwardOutbox` row. Mark the raw event processed.

### 6c. Reconciliation sync (safety net) — EventBridge cron, per connection

- Independent of webhook health, but now a **low-frequency** safety net (webhooks carry near-real-time). Suggested cadence ~15 min (tunable): `ISync` thread entries **and** `ISync` v1.0 message-store from stored cursors; `FSync` on first run or `SYNC_TOKEN_INVALID` to backfill/repair. Same idempotent upsert + outbox path. Guarantees that anything a webhook missed (blacklist window, AWS/RC outage) is still captured within one sync interval — without being the primary latency path.

---

## 7. On-prem forwarding over WireGuard (durable delivery)

**Why forwarding exists (decoupling capture from delivery):** the webhook endpoint must be public in AWS, but the authoritative DB is on-prem behind WireGuard. Writing to on-prem directly from the webhook handler fails three ways — it slows the RC ack (→ subscription blacklist), it loses messages whenever on-prem is unreachable, and it forces the internet-facing Lambda into the WG VPC. So capture and delivery are decoupled via a **transactional outbox**: capture writes a buffer row + an outbox row and acks fast; a separate **Forwarder** drains the outbox into on-prem with retries. At-least-once delivery + idempotent on-prem upsert = **effectively-once**, and on-prem downtime just parks rows as PENDING until it recovers.

- **On-prem SQL Server is authoritative** (resolved decision). Neon holds the message body only **transiently** per the two-tier retention policy (body purged 72h after SENT; tombstone 30 days).
- **Delivery via the existing mssql-executor** (not a new DB connection): the forwarder builds a parameterized T-SQL `MERGE` and submits it through the existing mssql-executor Lambda in the WireGuard VPC, which already holds the tenant's on-prem SQL Server connection (`Tenant.mssqlConnectionString`) and routes over the `10.200.0.0/16` overlay. This reuses the proven on-prem write path rather than introducing a parallel one.
- Forwarder drains `MessageForwardOutbox` PENDING (where `nextAttemptAt <= now`), submits the idempotent `MERGE` via mssql-executor, marks `SENT`, schedules buffer purge. Failures → exponential backoff + jitter via `nextAttemptAt`; after N attempts → `DEAD` + alarm (DLQ semantics). On-prem reachability failures simply park rows PENDING until the tunnel/DB recovers — no loss.
- **On-prem target DDL (T-SQL)** — provisioned once per tenant DB (delivered as a migration script the on-prem DBA runs, or auto-ensured by mssql-executor on first write):
  ```sql
  IF OBJECT_ID(N'dbo.inbound_messages', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.inbound_messages (
      tenant_id      NVARCHAR(64)   NOT NULL,
      source         NVARCHAR(16)   NOT NULL,   -- THREAD_STORE | V1_STORE
      external_id    NVARCHAR(64)   NOT NULL,   -- RingCentral message id
      thread_id      NVARCHAR(64)   NULL,
      direction      NVARCHAR(16)   NOT NULL,   -- INBOUND | OUTBOUND
      from_number    NVARCHAR(32)   NOT NULL,
      to_number      NVARCHAR(32)   NOT NULL,
      body           NVARCHAR(MAX)  NULL,
      rc_created_at  DATETIME2(3)   NOT NULL,
      rc_modified_at DATETIME2(3)   NULL,
      captured_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_inbound_messages_captured DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_inbound_messages PRIMARY KEY (tenant_id, source, external_id)
    );
  END
  ```
- **Idempotent write (T-SQL `MERGE`, parameterized):**
  ```sql
  MERGE dbo.inbound_messages AS tgt
  USING (SELECT @tenant_id AS tenant_id, @source AS source, @external_id AS external_id) AS src
    ON (tgt.tenant_id = src.tenant_id AND tgt.source = src.source AND tgt.external_id = src.external_id)
  WHEN MATCHED THEN UPDATE SET
    direction = @direction, from_number = @from_number, to_number = @to_number,
    body = @body, thread_id = @thread_id, rc_modified_at = @rc_modified_at
  WHEN NOT MATCHED THEN INSERT
    (tenant_id, source, external_id, thread_id, direction, from_number, to_number, body, rc_created_at, rc_modified_at)
    VALUES (@tenant_id, @source, @external_id, @thread_id, @direction, @from_number, @to_number, @body, @rc_created_at, @rc_modified_at);
  ```
  (No MMS/attachments column — SMS-only v1.)

---

## 8. Infrastructure (CDK) — `packages/infra/lib/stacks/`

New `messaging-stack.ts` (or extend `api-stack.ts`):

- **SQS** capture queue + **DLQ** (redrive).
- **EventBridge cron rules:** reconciliation-sync, subscription-renewal, token-refresh.
- **Lambdas:** capture worker (SQS-triggered); forwarder (builds T-SQL `MERGE`, invokes the **existing mssql-executor** — no new VPC Lambda); buffer-purge cron; sync/renewal/token-refresh cron handlers.
- **Reuse:** grant the forwarder permission to invoke mssql-executor; no new WireGuard/VPC construct needed (the on-prem write path already exists).
- **KMS** key for token encryption; **Secrets Manager** entries for RC refresh tokens (`grantRead`/`grantWrite` scoped).
- **Env vars** (api-stack): `RINGCENTRAL_API_BASE`, `RINGCENTRAL_WEBHOOK_QUEUE_URL`, `RINGCENTRAL_TOKEN_KMS_KEY_ID`, OAuth client id/secret refs.
- **CloudWatch alarms:** subscription `DEAD`, sync lag, outbox `DEAD`/depth, token-refresh failures, webhook validation-failure rate, DLQ depth.
- Grant API Lambda: SQS send, Secrets read/write (RC), KMS encrypt/decrypt.

---

## 9. Observability, security, multi-tenancy

- **Logging/metrics:** Powertools `logger` with `correlationId` (never `console.*`). Metrics: webhooks received, validation failures, messages captured (by path), sync lag, outbox depth/lag, forward failures, renewals, blacklists, token-refresh failures.
- **Security:** webhook `verificationToken` check (+ optional HMAC); least-privilege IAM; refresh tokens encrypted at rest (KMS + Secrets Manager), **never returned by any API** (mirror `TenantSsoProvider.secretArn`); message bodies are PII — define cloud retention, redact bodies from logs, encrypt in transit on the WG leg (already tunneled).
- **Tenancy:** every row carries `tenantId`; handlers use `c.get('db')` tenant-scoped client; subscription/connection lookups resolve tenant from the subscription id, then load the scoped client.

---

## 10. Phased delivery (each phase independently deployable, feature-flagged)

- **Phase 0 — Scaffolding:** domain `messaging` context + tests; Prisma models + expand-only migration; `RingCentralConnection` + OAuth connect/callback + token-refresh worker (Secrets Manager). _No capture yet._
- **Phase 1 — Sync-only capture (prove correctness first):** reconciliation sync cron (thread + v1.0), normalization, idempotent `Message` upsert. Validates completeness with zero webhook dependency. **This alone fixes the original "only outbound visible" problem** (just not yet near-real-time).
- **Phase 2 — Webhook near-real-time path (the primary path):** subscription manager + renewal cron, `POST /webhook` (handshake + verification, multi-tenant `subscriptionId → tenant` resolution), SQS, capture worker. Achieves near-real-time; the Phase-1 sync drops to the low-frequency safety net.
- **Phase 3 — On-prem forwarding:** outbox + forwarder Lambda in WG VPC + on-prem DDL; backfill.
- **Phase 4 — Hardening:** alarms, DLQ runbook, load/longhaul test (cf. `plans/in-progress/longhaul-test-notes`), retention policy.

---

## 11. Files to create / modify

**Create**

- `packages/domain/src/messaging/index.ts` + `*.test.ts` (TDD-first)
- `apps/api/src/repositories/messaging.repository.ts` + tests
- `apps/api/src/handlers/integrations/ringcentral-webhook.ts` + tests
- `apps/api/src/handlers/integrations/ringcentral-oauth.ts` + tests
- `apps/api/src/services/ringcentral/{client,subscription-manager,sync,normalize}.ts` + tests
- `apps/api/src/lambda-ringcentral-capture.ts` (SQS worker)
- `apps/api/src/lambda-ringcentral-sync.ts`, `…-renew.ts`, `…-token-refresh.ts`, `…-buffer-purge.ts` (cron)
- `apps/api/src/lambda-ringcentral-forward.ts` — outbox drainer that builds T-SQL `MERGE` and invokes the existing **mssql-executor** (no new VPC Lambda) + tests
- `apps/api/src/services/ringcentral/onprem-merge.ts` — T-SQL `MERGE` builder (parameterized) + tests
- `apps/api/prisma/migrations/<ts>_add_messaging/migration.sql`
- `packages/infra/lib/stacks/messaging-stack.ts` + snapshot tests
- On-prem **T-SQL** DDL script (`dbo.inbound_messages`) + runbook under `docs/`

**Modify**

- `apps/api/prisma/schema.prisma` — new models/enums
- `apps/api/src/app.ts` — mount webhook (pre-tenant) + OAuth/admin routes (post-tenant)
- `apps/api/src/authz/actions.ts` + Cedar policies — messaging admin actions
- `packages/infra/lib/stacks/api-stack.ts` — env vars, SQS/Secrets/KMS grants
- `packages/infra/bin/*` — wire `MessagingStack`
- `apps/e2e/tests/api/` — acceptance specs

---

## 12. TDD order (per engineering-principles.md — tests precede implementation)

1. `[x]` domain `messaging` tests (normalization, dedupe key, status transitions, handshake detection) → `[x]` implement domain
2. `[x]` repository tests (idempotent upsert, outbox enqueue, cursor) → `[x]` implement repository
3. `[x]` webhook handler tests (handshake echo, verification-token, fast-ack, raw persist) → `[x]` implement
4. `[x]` subscription-manager tests (create/renew/recreate, blacklist) → `[x]` implement
5. `[x]` sync tests (ISync cursor advance, FSync backfill, thread phone-pair resolution, idempotency vs webhook path) → `[x]` implement
6. `[x]` forwarder tests (T-SQL `MERGE` builder/parameterization, at-least-once, idempotent on-prem MERGE, backoff, DEAD, on-prem-down → rows stay PENDING) + buffer-purge tests → `[x]` implement forwarder + purge cron
7. `[x]` infra snapshot/assertion tests → `[x]` implement stack
8. `[x]` e2e API acceptance (webhook handshake/validation/unknown-sub)

---

## 13. Side effects & risks

- **External writes to RingCentral** (subscription create/renew/delete, token refresh) — outward-facing, rate-limited; gate behind connection health + idempotent ensure-logic; respect `RateLimitedUntilUtc`.
- **PII at rest in cloud** — message bodies in Neon; needs retention + access policy sign-off.
- **WG VPC change** — forwarder Lambda + SG; coordinate with `wireguard-stack.ts` owner; risk of overlay routing misconfig.
- **Migration** — additive only; no rename/drop in first PR (expand-then-contract).
- **Cost** — extra Lambdas, SQS, cron frequency; tune sync interval vs latency.
- **RC API coupling** — thread sync API + Read Thread are the documented contract (`messages-handling.md`, `threads/events.md`); v1.0 path slated for deprecation — isolate behind `services/ringcentral/`.
- **CI gate** — if any pipeline step fails, fix CI before continuing (per CLAUDE.md).

---

## 14. Open questions

**Resolved (2026-06-08):**

1. ~~System of record~~ → **On-prem authoritative**; Neon = control plane + transient buffer.
2. ~~Connection model~~ → **Per-tenant 3-legged OAuth** against one platform RC app.
3. ~~Latency~~ → **Near-real-time; webhooks primary**, sync demoted to safety net.

**Resolved (2026-06-08, round 2):** 4. ~~On-prem engine~~ → **existing SQL Server via mssql-executor** (T-SQL `MERGE`). 5. ~~Scope~~ → **SMS only**; multiple numbers per connection allowed. 6. ~~Buffer retention~~ → **body purged 72h after SENT; tombstone 30 days** (best-judgement default; tunable). 7. ~~Backfill~~ → **thread FSync + 90-day v1.0 window on first connect** (configurable, capped).

**Still open (nice-to-have, none block Phase 0):** 8. Confirm every tenant that will enable RC capture already has a healthy WireGuard overlay + working `Tenant.mssqlConnectionString` (mssql-executor reachability is a prerequisite for Phase 3). 9. Who runs the on-prem `dbo.inbound_messages` DDL — DBA-applied script vs auto-ensure on first write? 10. Any compliance constraint on SMS bodies transiting/buffering in AWS at all (could tighten the 72h to "purge on SENT").

```

```
