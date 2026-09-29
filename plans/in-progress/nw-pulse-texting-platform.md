# NW Pulse Texting — Platform Master Plan

**Branch:** none yet. One worktree + branch + PR per phase: pegasus via `scripts/new-worktree.sh feat <slug>`; movemanager per its CLAUDE.md, with its own plan file.
**Goal:** Ship every platform capability the three NW pulse-texting workflows (`nw_pulse_send`, `nw_pulse_reply`, `nw_pulse_daily_check`) need. Cloud-owned data is built in pegasus. Legacy data is built as **real endpoints on the pegII API** (`movemanager/Pegasus.Api`) and consumed through the cloud bridge. **No direct cloud→MSSQL access and no stubs.**
**Status:** APPROVED 2026-09-29 (v2: pegII API instead of stubs/direct DB; D1–D5 decided) · **SDK today:** 0.38.2 · **movemanager HEAD:** `f0abdf16` (Beta 9.3.1)
**Inputs:** the workflow author's three specs for NW pulse texting (pulse-texting scope, proposed platform interfaces, workflows pending platform work; 09.23–09.25). They are external and not in this repo; the workflow code lives in the authoring repo under `nw-pulse-texting/`.

---

## Execution status (resume here)

- [ ] **Phase 0** — Spikes (no code): S1–S7
- [x] **Phase 1** — [pegasus] Workflow state store → SDK 0.39.0 — MERGED #743 (`807057e0`), PUBLISHED to PyPI 2026-09-29; authoring `CLAUDE.md` updated
- [~] **Phase 2** — [pegasus] 2a–2c (message read, opt-out, `send_sms` dedup) built on `feat/sms-optout-read-dedup` → SDK 0.40.0; **2d (mark-read at RingCentral) pending S2**
- [ ] **Phase 3** — [pegasus] `send_email` (SES) → SDK 0.41.0
- [ ] **Phase 4** — [movemanager] pegII API foundations: write auth, envelope/error contract, idempotency + task-meta tables, version endpoint
- [ ] **Phase 5** — [movemanager → pegasus] Order reads: `schemaVersion` + v1→keyed `KeyMoveDates` normalization; live order search → SDK 0.42.0
- [ ] **Phase 6** — [movemanager → pegasus] Tasks: create, get/list, close by id → SDK 0.43.0 (+ one-line desktop guard fix)
- [ ] **Phase 7** — [movemanager → pegasus] Order memos + local text read-mirror and conversation links → SDK 0.44.0
- [ ] **Phase 8** — NW enablement + end-to-end test move (ops)

**Order and parallelism:**

- Phases 1–3 (pegasus) and Phase 4 (movemanager) have no dependencies on each other and can run in parallel.
- Phases 5–7 each need Phase 4. Each lands as a movemanager PR first (the API ships through `azure-pipelines.yml` → S3 → the site's `update-api.ps1` auto-update), then a pegasus PR for the cloud route and SDK.
- After each SDK bump merges: tag `sdk-python-vX.Y.Z` and publish (standing rule).

---

## Context (enough to resume without re-reading either codebase)

### What NW's workflows need, and where it gets built

| #   | Proposal (interfaces doc)               | Owner of the data                                                                              | Plan                                                                                                                           |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Inbound-text event + `get_text_message` | **Cloud** — `messages` (`schema.prisma:2684`)                                                  | `sms.received` already exists (#730), so no `pegii.text_message.received` is needed. Add `GET /sms/messages/:id` — **Phase 2** |
| 2   | `create_task`                           | pegII `Tasks`                                                                                  | pegII API endpoint — **Phase 6**                                                                                               |
| 3   | `close_task` by id + reason             | pegII `Tasks`                                                                                  | pegII API endpoint — **Phase 6**                                                                                               |
| 4   | `send_email`                            | **Cloud**                                                                                      | SES — **Phase 3**                                                                                                              |
| 5   | `add_order_memo`                        | pegII `memos`                                                                                  | pegII API endpoint — **Phase 7**                                                                                               |
| 6   | `mark_text_message_read`                | **RingCentral** (authoritative), mirrored in pegII `TextMessageStore.ReadStatus`               | Cloud PUTs to RingCentral (**Phase 2**), then best-effort updates the pegII mirror (**Phase 7**)                               |
| 7   | SMS opt-out                             | **Cloud**. pegII has no STOP handling, only the `sales.coord_email='Yes'` texting-consent flag | **Phase 2**                                                                                                                    |
| 8   | Workflow state, atomic insert           | **Cloud**                                                                                      | **Phase 1**                                                                                                                    |
| 9   | KeyMoveDates names                      | pegII serializer                                                                               | **Phase 5**: normalize in the pegII API from the source enum                                                                   |
| 10  | NW QA readiness                         | Ops                                                                                            | **Phase 8**. `CUSTOM_EVENTS_ENABLED` is **not needed**: `sms.received` is built-in, and SCHEDULE triggers need no flag         |
| 11  | Order selection                         | pegII `sales`                                                                                  | pegII API search endpoint — **Phase 5**                                                                                        |
| 12  | Arrival window                          | legacy                                                                                         | **Spike S5**. It does not block the pilot, which uses a fixed 4–7 PM window                                                    |

Also required by the scope, though absent from the proposals:

- `send_sms` duplicate protection (Phase 2).
- Order data read **live**, not from the snapshot (Phase 5, see below).
- `pegasus-workflows/CLAUDE.md` still lacks `sms.received` (Phase 2).

### Facts from movemanager that shape the pegII work (verified 2026-09-29)

**The pegII API (`Pegasus.Api`)**

- ASP.NET Core minimal APIs on **net8.0**, running as a Windows Service on each site server. The data path is endpoint → `Pegasus.Domain` interface → `Pegasus.Infrastructure/Repositories` over EF Core `PegasusDbContext` (raw SQL where needed).
- **It cannot reference the VB DAL or `Pegasus.DataTypes`**, which are .NET Framework 4.8.
- Envelope `{data, error, code, correlationId}` (`ApiResponse.cs:10`). `DomainError` → 422 with its code; unhandled → 500 `INTERNAL_ERROR`.
- Request authentication is still at its POC posture (`SerializedEntityEndpoints.cs:11-14`); Phase 4 hardens it before any write lands.
- The only existing writes are warehouse and ops. There is **no test project for the API**; the precedent is LocalDB repository tests in `Pegasus.Tests.Integration.Warehousing`, and the pipeline's API stage runs no tests.
- Additive schema migrations run at startup (`Program.cs:103-162`, `--migrate-only`).
- Deploy: `BuildApi` → `PublishApiToS3` (`s3://pegasus-movemanager/server/deploy/{channel}/`). Each site's `PegasusApi-AutoUpdate` task runs `update-api.ps1 -Channel X` with health-checked slot swap and rollback. The version appears only on the `GET /` HTML page.

**Orders**

- `GET /serialized/orders/:id` returns `dbo.SaleSerializedSnapshot.snapshot_json`, which the **desktop** writes on `IO_Sale.Write` (`SaleSnapshotWriter.vb`).
- `KeyMoveDates` became keyed in schema v2 (`8e548afc`, 2026-08-11, first in Beta 9.2.2 on 2026-09-02). A row saved before a site's client upgrade stays **v1, positional**, until someone re-saves it. **That is what the spec saw on NW.**
- The API does not return `schema_version`.
- The index→name table is `PDT.KeyDates` (`Pegasus/…/EnumeratedTypes.vb:100-134`): Survey, Pack, Wrap, Load, AVLLoadSpread, AutoLoad, LocalPickup, CartonDelivery, Rule19In, Rule19Out, Transport_ETA, Departure, Arrival, Clearance, Empty_Sealed, SIT_PS_In, SIT_PS_Out, **DelResidence (17)**, LongDistance, AutoDelivery, Unpack, OverflowPU, ExtraPickup, ExtraDelivery, DebrisPickup, OverflowDel, O_TPS, D_TPS, Pier_AirPU, RTG, StorageAccess, PierCutoff.

**Snapshot fields that can mislead**

- `UnusedFields.move_desc` is **always `""`**: declared but never loaded (`Sale_UnusedDatabaseFields.vb:64`).
- `ba_name` → `InvolvedParties.NationalAccount.Identity.Description`.
- Cell phone → `Locations.Shipper.ContactInfo.CellPhone` (`shipper_phone2`).
- SIT → `KeyMoveDates.SIT_PS_In/SIT_PS_Out` and `StorageInfo.KeyDates.*`.
- Relo → top-level `ReloCompany`.

**Snapshot staleness**

- "DEL ACTUAL ENTERED" appears nowhere in application code, and no code outside the Sale DAL updates `del_actual`, so it is likely a **DB trigger**.
- NW's `LongDistanceDispatchActivity` triggers `UPDATE sales` directly, which the cloud's own longhaul trip-save fires.
- Either path bypasses the snapshot. movemanager's own `plans/in-progress/validate-sale-against-post-trigger-state` is evidence of the lag.
- ⇒ The trigger dates and eligibility columns must be **read live from `sales`**.

**Tasks** (`Tasks`, `mastertasks`)

- Columns: order_num, task_coord_id, task_ops_id, master_id, category, code, description, base_date_name/field, date_offset, did_edit_target, target_date, note, was_completed, completed_time, completed_by, call_type, active, …
- **No priority, status, close reason or dedup key.** The assignee is an integer employee code.
- **Two desktop hazards:**
  - (a) `FormSupport.GetTasksForOrder` (`FormSupport.vb:1177-1183`) generates master tasks **only when an order has zero task rows**. An API-inserted task on a task-less order would silently suppress them.
  - (b) `UpdateTasks` (`:1188`) touches every not-completed, non-`USRDEF`, non-`did_edit_target` row and dereferences `task.BaseDateName.ToUpper`. A null there would throw in the desktop.
- Do not register "Pulse Follow-Up" as a `mastertasks` row: wildcard selectors would auto-create it on orders.

**Memos** (`memos`, PK `memo_id`)

- `memo_type` is a 1-char enum: None 0, Billing 1, Driver 2, Warehouse 3, General 4, Operations 5, CentralPlanning 6, Claims 7. **There is no "Survey".**
- Working code-path example: `AtlasMonitorWorker.vb:1091-1110`, with `Source="O"`, order number, `who_called`, `regarding`, `action`, `person`.

**Texting**

- `TextMessageStore` is PK `MessageId` = **the RingCentral message id** (= cloud `messages.externalId`). `ReadStatus` 1 = Read, 2 = Unread.
- **`IO_TextMessageStore.Upsert` overwrites `ReadStatus` from RingCentral on every reconciliation pass.** The desktop marks read by PUTting to RingCentral first (`ChatHistoryService.cs:426-456`).
- Order ↔ conversation links: `recipient_textconversation` (RecipientType Shipper/Driver). `order_textconversation` is retired. Coordinator follows: `employee_textconversation`.
- Nothing consumes the cloud-forwarded `dbo.inbound_messages`.

### Cloud bridge facts (pegasus)

- `lib/pegii-api-client.ts` is GET-only. `tunnelFetch` already carries any method.
- `pegiiApiErrorToHttp` maps every non-404 `HTTP_ERROR` to 502 `PEGII_SOURCE_BAD_RESPONSE`, which would disguise legitimate 400/409/422s as outages. **Must change** (Phase 5).
- The existing in-memory stubs `services/pegii-tasks.ts` and `services/pegii-orders.ts` (list) are **replaced**, not extended.

### Discoverability checklist (applies to EVERY pegasus phase that adds a capability)

1. `packages/workflows-sdk-python/pegasus_workflows/api.py`: the method; mutations call `_capture_mutation` with a realistic `wouldReturn`
2. `pegasus_workflows/testing/__init__.py` `_READS` / `_MUTATIONS`, plus `_MUTATION_CALLS` parity in `tests/test_testing_harness.py`
3. `apps/api/src/authz/actions.ts` + `authz/cedar.schema.json` + `authz/policies/30-personas/workflow-runtime.cedar`
4. The handler + its mount on `m2mV1` in `apps/api/src/app.ts`
5. `apps/api/src/lib/openapi-spec.ts` (the coverage test gates CI)
6. MCP guidance in `cli/mcp_server.py` where semantics are non-obvious (atomic claims, dedup keys, 409s, live vs snapshot)
7. SDK `README.md` + `CHANGELOG.md` + `pyproject.toml`; tests in `tests/test_api.py`
8. `~/repos/pegasus-workflows/CLAUDE.md` (in the authoring repo, not this one)

### movemanager process rules (its CLAUDE.md) that every pegII phase follows

- Its **own plan file** in `movemanager/plans/in-progress/`, produced in plan mode and **approved before code**. This master plan references those files; it does not replace them.
- **Schema changes need explicit instruction.** Every new table is named below, so approving this plan approves exactly those tables and nothing else. They ship through the API's additive startup migration runner.
- **Domain-first:** rules go in `Pegasus/Pegasus.Domain/{Task,Serialization,TextMessaging,…}`. Tests are split unit (`Pegasus.Tests.Unit`) / integration (LocalDB) and written first.
- Stay in layer; no NuGet additions without asking; `azure-pipelines.yml` server-stage edits are pre-authorized (adding an API test step qualifies).

---

## Phase 0 — Spikes (findings recorded back into this plan)

- [ ] **S1 NW client + snapshot versions.**
  - Which MoveManager build is NW's desktop on (≥ Beta 9.2.2 writes v2)?
  - What share of NW's active COD orders still have `schema_version = 1`?
  - Which channel is NW's `update-api.ps1` on, and what API version is deployed (the `GET /` page)?
- [ ] **S2 RingCentral.**
  - Does an inbound STOP still reach the message store?
  - Does RC or the carrier auto-answer STOP/HELP?
  - What `errorCode` does RC return when sending to an opted-out number?
  - **Is the cloud connection's extension the same one the desktop reconciles?** Read state is per extension, which decides whether the Phase 2 RingCentral PUT is visible to coordinators.
- [ ] **S3 SES prod readiness.** Is the account out of the sandbox? Is `pegasus.dolas.dev` DKIM-verified? What is the state of `plans/todo/ses-dmarc-records.md`? Which From display name?
- [ ] **S4 NW QA tunnel.** Diagnose the 502 "tunnel proxy fetch failed".
- [ ] **S5 Arrival window.** Is #668's longhaul activity window what was described at the 09.25 review?
  - If yes, add a follow-on: a read-only pegII API endpoint plus `get_activity_arrival_window`. #668 deferred its SDK surface "to the workflow that consumes it".
  - Either way, the pilot keeps the fixed 4–7 PM window.
- [ ] **S6 Desktop task hazard exposure.** How many NW COD orders reach pack day with **zero** `Tasks` rows? That sizes hazard (a) until the Phase 6 desktop guard fix ships.
  - Also find the DB trigger that writes `del_actual` and the "DEL ACTUAL ENTERED" `dispatch_log` row (`sys.triggers` on NW), confirming the live-read requirement.
- [ ] **S7 Link + identity facts.**
  - Does `recipient_textconversation.RecipientCode` for Shipper hold an order number or a normalized phone? The code and the d765877 plan disagree.
  - Which employee code should API-originated writes carry (`created_by`, `who_called`, `completed_by`)? A dedicated "PEGASUS" system employee is recommended.
  - Which memo type does NW want for ratings: General (4) or Operations (5)?

---

## Phase 1 — [pegasus] Workflow state store → SDK 0.39.0

Unblocks the send ledger, the phone-day reservation, reply matching and daily-check step 3. The spec says step 3 "runs as soon as proposal 8 ships".

**Model** `WorkflowState` (tenant-scoped, added to `TENANT_SCOPED_MODELS` in `lib/prisma.ts`):
`id, tenantId, namespace, key, state Json, version Int @default(1), updatedByUserId, createdAt, updatedAt` (as built) · `@@unique([tenantId, namespace, key])` · index `[tenantId, namespace, updatedAt]`.
The namespace is tenant-wide rather than per workflow, because the three pulse workflows share one ledger.

**Semantics**

- `if_absent=True` → a plain `create`; P2002 → **409 `STATE_EXISTS`** carrying the existing row. This is the atomic claim. Do **not** run it inside an interactive transaction (P2002 aborts a PG tx — the #730 lesson).
- `expected_version=N` → `updateMany({where:{…, version:N}, data:{…, version:{increment:1}}})`; `count===0` → **409 `STATE_VERSION_CONFLICT`** with the current row. This is the compare-and-set that scope §3.4 needs for "reclaim back to pending". The interface doc only listed `if_absent`, so this is an addition — tell the workflow author.
- Neither flag → an upsert that still bumps `version`.
- `delete(expected_version?)`; `list(namespace, prefix?, updated_since?, limit, cursor)` paginated with `key > last` (the #730 cursor lesson). A prefix list covers the ledger lookups "pulses sent to +1… in the last 24h" and "open follow-ups". Recommend keys like `pulse/<order>/<phase>` plus an index row `phone/<e164>/<iso-ts>`.
- 256 KB state cap (same as projections). **As built: no TTL/expiry.** Nothing in the spec asked for one, and the ledger is pilot measurement data. Add it only when a consumer needs it.

**Surface:** `/api/v1/workflow-state/:namespace/:key` (GET/PUT/DELETE) + `/api/v1/workflow-state/:namespace` (list). Actions `ReadWorkflowState` / `WriteWorkflowState`, granted to `workflow-runtime`.
**SDK:** `get_workflow_state` (None on miss), `list_workflow_state`, `put_workflow_state(namespace, key, state, *, if_absent=False, expected_version=None)` raising a typed `WorkflowStateConflict` (a `PegasusApiError`, with `.current`) on 409, `delete_workflow_state`.

- **Dry-run, as built:** pure capture with no read-back overlay. The offline harness delegates mutations to a no-network dry-run client, and a live existence check would break its byte-identical parity. Instead, a captured claim returns `version` 1 and a captured compare-and-set returns `expected_version + 1`, so claim → set flows still run.
  **Tests:** a repo integration test with two concurrent `if_absent` claims (exactly one wins) and a CAS race (exactly one wins); a tenant-isolation test; route tests (409 bodies); SDK tests; harness parity.

**Files:** `apps/api/prisma/schema.prisma` + migration · `lib/prisma.ts` · `repositories/workflow-state.repository.ts` (new) · `handlers/workflow-state.ts` (new) · `app.ts` · `authz/{actions.ts,cedar.schema.json,policies/30-personas/workflow-runtime.cedar}` · `lib/openapi-spec.ts` · SDK files in the discoverability checklist.

---

## Phase 2 — [pegasus] Inbound text read, SMS opt-out, `send_sms` idempotency, mark-read at RingCentral → SDK 0.40.0

**2a `get_text_message`.** `GET /api/v1/sms/messages/:id`, reading the cloud `messages` row. Action `ReadTextMessage`.

- Returns `{id, externalId, threadId, direction, fromNumber, toNumber, body, createdAt (rcCreationTime), bodyPurged}`.
- **Contract note:** the body is purged 72h after forward, so a handler must read promptly; `sms.received` already carries `body`.
- `readStatus`, `orderNumbers` and `employeeCodes` are **not cloud facts**; they come from Phase 7's `get_text_message_links`. The route goes under `/sms/`, not `/pegii/`, because the data is cloud-owned.

**2b Opt-out** (new tenant-scoped `SmsOptOut`: `tenantId, phoneE164, optedOut, source (keyword|provider|manual), keyword?, messageId?, updatedAt`, unique `[tenantId, phoneE164]`):

- **Platform-level capture:** on **every newly-captured INBOUND row, whatever the sync mode** (ISync, FSync or backfill; deliberately NOT tied to the `sms.received` emission conditions, which fire on ISync only), run non-fatally and _outside_ the capture tx.
  - Match the **first whitespace-delimited token**, case-insensitive, trailing punctuation stripped, against STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT. A string prefix match would opt out "Ended up great, 5!".
  - START/UNSTOP record an opt-in, pending S2 on whether the carrier also restores it. **Not `YES`**: it would re-enable texting on any affirmative reply.
- **Enforcement in `send_sms`** (every caller, including `feedback-requests.ts`): an opted-out recipient gets **409 `SMS_OPTED_OUT`** before any RingCentral call. RC's own opt-out rejection (code from S2) maps to the same 409 and is recorded with `source=provider`.
- Routes `GET /api/v1/sms/opt-outs/:phoneE164` (`ReadSmsOptOut`) and `POST /api/v1/sms/opt-outs` (`ManageSmsOptOut`, source `manual`/`keyword`). SDK `get_sms_opt_out`, `record_sms_opt_out`.
- E.164 normalization lives in one shared helper in `packages/domain/src/messaging`.

**2c `send_sms(dedup_key=…)`.** New `SmsSend` table (`tenantId, dedupKey, to, providerMessageId, status, createdAt`, unique `[tenantId, dedupKey]`).

- Claim the row by `create` (P2002 → return the first send with `alreadySent: true`), then call RC and store the provider id.
- A crash between claim and send leaves a `PENDING` row. On repeat, `PENDING` older than N minutes → 409 `SMS_SEND_IN_DOUBT`, so a human or the ledger decides; never a blind resend.
- Without `dedup_key`, behaviour is unchanged. `send_sms` also starts returning `providerMessageId` explicitly (ledger field, scope §11.3).

**2d `mark_text_message_read(message_id)`.** `POST /api/v1/sms/messages/:id/read`, action `UpdateTextMessage`.

- Resolves `externalId`, then PUTs `readStatus=Read` to RingCentral's message-store through the tenant's connection. Add `updateMessageReadStatus` to `services/ringcentral/`. This mirrors what the desktop does (`ChatHistoryService.cs:426-456`), so RingCentral stays the source of truth and the desktop's reconciliation `Upsert` carries it into `TextMessageStore`.
- Returns `{id, readStatus, alreadyRead}`. Phase 7 adds a best-effort immediate pegII mirror update.
- **Gated on S2** (same extension).
  - **Correction (Phase 0):** the desktop's `ringcentral_tokens` table has no non-secret extension column, so "same extension" is checked by comparing the cloud `ringcentral_connections.owner_number` with PegNW's `settings.ringcentral_fromPhoneNumber`.
  - A match is strong evidence, not proof. The Phase 8 test move (mark read, then watch the desktop badge) is the final check.

**Files:** `schema.prisma` + migration · `repositories/messaging.repository.ts` (opt-out hook) · `services/ringcentral/message-store.ts` (new, read-status PUT) · `repositories/sms-opt-out.repository.ts`, `repositories/sms-send.repository.ts` (new) · `handlers/sms.ts` · `services/ringcentral/sms.ts` (error mapping) · `packages/domain/src/messaging` (keyword + E.164) · authz trio · `openapi-spec.ts` · SDK checklist · **`pegasus-workflows/CLAUDE.md`: add `sms.received` (overdue) + all of the above**.

---

## Phase 3 — [pegasus] `send_email` (SES) → SDK 0.41.0

- `POST /api/v1/email/send`, action `SendEmail`, body `{to[], cc[]?, subject, body, bodyType: text|html, dedupKey?}` → `{id, status, alreadySent}`. Idempotency via an `EmailSend` table (same claim pattern as 2c).
- **Recipient policy ("internal only") — decision D2:** every address must match the tenant's **allowed recipient domains**, a tenant-admin-managed setting (not writable by a workflow runtime) → 400 `RECIPIENT_NOT_ALLOWED`. Caps: ≤10 recipients, ≤100 KB body, per-tenant daily limit.
- **Transport:** `SESv2Client.SendEmail` from the API Lambda. From = `no-reply@pegasus.<domain>` with the tenant display name; optional `Reply-To` = the coordinator.
- **Infra:** add the `ses:SendEmail` IAM grant scoped to the identity ARN, plus the `EMAIL_FROM` env, to the API Lambda, **gated by env name like `ringcentralEnabled`** (`envName === 'prod'` / staging), **not** a `-c` context flag, because CI `deploy:ci` passes only `-c env=` (the same trap as `pegasusSesEmail`). Off → 503 `EMAIL_NOT_CONFIGURED`.
- Add a `grep -r EMAIL_ packages/infra` check to the PR checklist (standing lesson: a flag-gated feature isn't shipped until wired).
- **Files:** `schema.prisma` + migration · `services/email/ses.ts` (new) · `handlers/email.ts` (new) · `repositories/email-send.repository.ts` (new) · tenant setting for allowed domains (model/handler + tenant-web Settings field) · `packages/infra/lib/stacks/api-stack.ts` + `bin/app.ts` · infra tests · authz trio · `openapi-spec.ts` · SDK checklist.
- **Risk:** deliverability until DMARC lands (S3); NW's mail filters may quarantine `no-reply@pegasus…`. Mitigation: pre-announce the address to NW IT.

---

## Phase 4 — [movemanager] pegII API foundations

Movemanager plan file: `plans/in-progress/pegasus-api-write-foundations.md`.

- [ ] **Write auth (prerequisite for any mutating route).**
  - Middleware requires `X-Pegasus-Api-Key` on every `/api/v1/pegii/*` route, reads included (D1), because orders carry PII.
  - The key is compared in constant time against a value in `appsettings.Production.json` / environment on the site server.
  - The cloud stores it per tenant in Secrets Manager, alongside the pegII overlay target, and `tunnelFetch` injects it.
  - Roll out as **warn-only first** (log missing keys), then enforce, so an old cloud client never bricks reads.
  - Reconcile the deploy README with the actual listener configuration.
- [ ] **Envelope/error contract for new endpoints.**
  - Every response is enveloped, errors included.
  - Status codes: 400 `VALIDATION_ERROR`, 404 `NOT_FOUND` / `ORDER_NOT_FOUND`, 409 with a specific code, 422 `DomainError`.
  - Idempotent replays return 200 with `alreadyExists: true` (not 409), so a cloud retry is indistinguishable from success.
- [ ] **New tables** (explicitly approved by this plan; additive migrations):
  - `pegasus_api_idempotency (idempotency_key nvarchar(200) PK, resource_type varchar(32), resource_id int, request_hash char(64), created_utc datetime2)`
    - A replay with the same key and a different `request_hash` → 409 `IDEMPOTENCY_KEY_REUSED`.
  - `pegasus_api_task_meta (task_id int PK → Tasks.id, task_type nvarchar(64), title nvarchar(200), priority varchar(8), close_reason nvarchar(max) NULL, closed_utc datetime2 NULL, created_utc datetime2, created_by_api bit)`
    - A sidecar, so the legacy `Tasks` table and the VB converters are untouched.
- [ ] **`GET /api/v1/pegii/version`** → `{version, schemaVersions: {sale: 2}, capabilities: [...]}`. The cloud uses it to refuse cleanly (503 `PEGII_CAPABILITY_MISSING`) when a site hasn't auto-updated yet.
- [ ] **API endpoint test harness.** Add a `WebApplicationFactory` + LocalDB test project (or extend `Pegasus.Tests.Integration.Warehousing`), and an API test step in `azure-pipelines.yml` `BuildApi` (pre-authorized server-stage edit). Today the API stage runs no tests.
- Files: `Pegasus.Api/{Program.cs, Middleware/ApiKeyMiddleware.cs (new), Endpoints/VersionEndpoints.cs (new), appsettings.json}` · `Pegasus.Infrastructure/Persistence` migrations · `Pegasus.Domain/Shared` idempotency contract · test project · `azure-pipelines.yml` (API stage only).
- pegasus side, same phase or first in Phase 5:
  - `lib/pegii-api-client.ts`: add `postJson`/`putJson`, header injection, and pass-through of pegII `code` for 400/404/409/422.
  - `pegiiApiErrorToHttp`: map those statuses through instead of 502.
  - The per-tenant pegII key secret.

## Phase 5 — Order reads: KeyMoveDates normalization + live order search → SDK 0.42.0

**movemanager** (plan `order-read-normalization-and-search.md`):

- [ ] Declare the `KeyDates` index→name table in `Pegasus.Domain/Serialization`, plus a pure `NormalizeKeyMoveDates(json, schemaVersion)` that turns a v1 array into the keyed object.
  - **Parity test** in `Pegasus.Tests.Unit`, which references both: assert the Domain table equals `PDT.KeyDates` name-for-name and index-for-index. Two independently declared things, so drift fails the build.
- [ ] `GET /serialized/orders/{id}` returns `schemaVersion` and always keyed `KeyMoveDates` (normalized on read; the stored row is untouched).
- [ ] **`GET /api/v1/pegii/orders/search`**, served from **live `sales`** (not the snapshot):
  - **Parameters:** `dateField` ∈ {`plan_pack`, `plan_load`, `del_actual`}, whitelisted as a server-side enum, never interpolated. `from`, `to`, `status` (default `A`), and `cursor`/`limit` (≤ 500).
  - **Returns** per order: `orderNumber, shipmentStatus, baName, reloMgmtCoName (account join), moveDesc (the real text column), planPack, planLoad, delActual, sitDate, sitActual, planSit, actSitOut, coordinatorCode, shipperFirstName, shipperPhone2, shipperZip/State, consigneeZip/State`.
  - These are exactly scope §2/§11.4's fields, so the send run needs **no** snapshot read to decide eligibility, and its pre-send re-check re-queries this endpoint.
  - Repository: `Pegasus.Infrastructure/Repositories/OrderSearchRepository.cs`, parameterized SQL.
- [ ] Integration tests on LocalDB: each date field, status filter, the account join, paging, whitelist rejection (400).

**pegasus** (after the movemanager release reaches NW):

- [ ] `GET /api/v1/pegii/orders/search` → `search_orders(date_field, date_from, date_to, status="A")`, action `ReadOrder`. **Delete the in-memory `list_orders` stub.** Deprecate `list_orders` per D4 (it has returned `[]` everywhere).
- [ ] `get_order(shape="native")` passes `schemaVersion` through.
- [ ] Document in the SDK/MCP: the snapshot vs live distinction; `UnusedFields.move_desc` is always empty; the `KeyMoveDates` key list.
- [ ] Update `gateways/pegii/pegii-order.dto.ts`: `Delivery` → `DelResidence` (analysis.md Trap #1).
- [ ] Discoverability checklist.

## Phase 6 — Tasks → SDK 0.43.0

**movemanager** (plan `api-task-create-close.md`):

- [ ] **Domain** `Pegasus.Domain/Task`:
  - `ApiTaskRules`: validation, priority vocabulary `low|normal|high`, and the title rule (≤ 200, whitespace collapsed, control chars stripped).
  - A registry of API task types, seeded with `Pulse Follow-Up`. The type lives in the sidecar, **never** in `mastertasks`.
- [ ] **`POST /api/v1/pegii/tasks`** `{orderNumber, taskType, title, description?, priority, dueAt?, assigneeCode?, idempotencyKey?}`. The legacy row is written to be **desktop-safe**:
  - `code='USRDEF'` (skipped by `UpdateTasks`), `did_edit_target='Y'`.
  - **Every** string column non-null, copying exactly the column set `New Task(Order)` + `TaskMaintenanceFormNew` write for a user-defined task. That column set is the contract, and an integration test asserts it.
  - `description` = title, `note` = description, `target_date` = dueAt, `task_coord_id` = assignee (default: the order's coordinator), `active='Y'`, `was_completed='N'`.
  - The sidecar row holds type, title, priority and the idempotency record, all in one transaction.
  - 404 on unknown order; 400 on unknown type or bad priority.
- [ ] `GET /tasks/{id}` and `GET /tasks?orderNumber=&taskType=&open=&dueBefore=`: the join of legacy row + sidecar. The daily check needs "open Pulse Follow-Up tasks due before X" across orders.
- [ ] **`POST /tasks/close`** `{taskId | orderNumber+taskType, reason?}`:
  - Sets `was_completed='Y'`, `completed_time`, `completed_by` = the system employee code (S7), and appends the reason to `note`. Sidecar `close_reason`/`closed_utc`.
  - Idempotent (`alreadyClosed`). 400 when neither or both identifiers are given.
- [ ] **Desktop guard fix** (hazard a): `GetTasksForOrder` counts only non-API rows (`… AND id NOT IN (SELECT task_id FROM pegasus_api_task_meta)`).
  - This is a desktop change, so it ships on the **MSIX** cadence. Until NW's client has it, S6 measures the exposure.
  - Until then (D3): the API returns 409 `ORDER_TASKS_NOT_INITIALIZED` when the order has zero task rows, and the reply workflow falls back to email-only escalation.
- [ ] Tests: unit (rules); integration (a row written by the API round-trips through the VB `IO.Task.ReadList` + `UpdateTasks` without throwing; idempotent create; close).

**pegasus:**

- [ ] Replace `services/pegii-tasks.ts` with gateway calls.
  - Routes: `POST /pegii/tasks` (`CreateTask`, new action); existing `GET /pegii/tasks[/:id]` and `POST /pegii/tasks/close` (`ReadTask`, `CloseTask`).
  - Close is additive: `taskId` or `orderId+taskType`.
- [ ] SDK `create_task(...)` with `dedup_key` → pegII `idempotencyKey`; `list_tasks` gains filters; `close_task(task_id=…)`.
- [ ] Discoverability checklist.

## Phase 7 — Memos + text read-mirror + conversation links → SDK 0.44.0

**movemanager** (plan `api-memos-and-text-read.md`):

- [ ] **`POST /api/v1/pegii/orders/{orderNumber}/memos`** `{text, memoType, idempotencyKey?}`.
  - Writes `memos` with `source='O'`, the order link and `memo_shipper`; `regarding`="Pulse survey"-style text; `action` = text; `created_by`/`who_called` = the system employee; `call_date/time` = now; `memo_type` per S7.
  - Mirrors the `AtlasMonitorWorker` field set; an integration test asserts the VB `IO.SaleMemo` reads it back.
  - Memo types live in `Pegasus.Domain/Sale/MemoType` (the enum re-declared with a parity test, as in Phase 5).
- [ ] **`POST /api/v1/pegii/text-messages/{messageId}/read`**: `UPDATE TextMessageStore SET ReadStatus=1 WHERE MessageId=@id`. A missing row returns 200 `{applied:false}` (the reconciliation hasn't archived it yet). It is **a mirror only**; RingCentral is authoritative (Phase 2).
- [ ] **`GET /api/v1/pegii/text-messages/{messageId}/links`** → `{conversationId, readStatus, orderNumbers[] (recipient_textconversation), employeeCodes[] (employee_textconversation)}`. Also 200 with nulls when the row doesn't exist yet.

**pegasus:**

- [ ] `add_order_memo(order_id, text, memo_type, dedup_key)` (`WriteOrderMemo`); `get_text_message_links(message_id)` (`ReadTextMessage`).
- [ ] `mark_text_message_read` (Phase 2) additionally calls the pegII mirror, best-effort (logged, never fails the call).
- [ ] Discoverability checklist.

## Phase 8 — NW enablement + end-to-end test move (ops)

- [ ] S4 resolved. NW QA and Prod pegII API on a release containing Phases 4–7, with the API key set on both ends and `/version` capabilities confirmed. Enforce auth after warn-only shows zero misses.
- [ ] NW desktop on the MSIX build with the Phase 6 guard fix; then lift the 409 `ORDER_TASKS_NOT_INITIALIZED` fallback.
- [ ] Tenant config:
  - `nw_pulse` CONFIG group: `PILOT_COORDINATORS`, `CS_PHONE`, `SAFETY_NET_EMAIL`, `HOLIDAYS`, `HELP_REPLY`, per-phase on/off.
  - Allowed email domains.
- [ ] Triggers:
  - SCHEDULE `*/15 * * * *`.
  - The daily check at the UTC equivalent of 17:00 Central. The dispatcher has **no catch-up** and DST shifts the UTC hour, so the workflow must re-check local time.
  - EVENT on `sms.received`.
- [ ] Hand the workflow author the shipped surface:
  - names: `sms.received`, `get_text_message` + `get_text_message_links`, `search_orders`, `expected_version`, `dedup_key`
  - the S-spike field answers, including "the salesman has `extension`+`email` but **no direct phone** ⇒ `[Coordinator Phone]` always takes the CS-number + extension fallback"
  - **We do not publish their workflows or configs** (standing rule).
- [ ] Test move on `TEST_PHONES`:
  1. pack → reply "5" → ack + memo + marked read in both RingCentral and the desktop
  2. load → reply "2" → task in the desktop + email + memo
  3. STOP → opt-out → next send 409
  4. daily check → reminder, then a forced 90-day close

---

## Decisions (approved by Steve 2026-09-29 — recommendations accepted)

- **D1 pegII API auth:** a shared-secret `X-Pegasus-Api-Key` header, warn-only first, then enforced (Phase 4).
- **D2 Email recipients:** restricted to a tenant-admin-managed allowed-domain list → 400 `RECIPIENT_NOT_ALLOWED` (Phase 3).
- **D3 Task-less orders:** until NW's desktop has the Phase 6 guard fix, `POST /tasks` returns 409 `ORDER_TASKS_NOT_INITIALIZED` for an order with zero task rows, and the reply workflow escalates by email only.
- **D4 `list_orders`:** deprecated in favour of `search_orders`. The SDK emits a `DeprecationWarning` pointing at `search_orders`; the route and method are removed in a later minor.
- **D5 SDK cadence:** one minor per pegasus phase, tagged and published on merge.

## Findings to act on outside this plan

- Security findings in movemanager were reported privately (2026-09-29) and are tracked outside this public repo.
- `IO_TextMessageStore.ReadMessages`' "Read" filter matches both 0 and 1 (`:56,67`). This is a minor existing bug, not in scope.

## Side effects & risks

- **Two release trains.** The pegII API auto-updates from S3 (fast); the desktop guard fix rides MSIX (slow). The cloud gates on `/version` capabilities, so a stale site degrades to a clear 503, not a 502.
- **The cloud must never call a write endpoint on a site without the idempotency table.** The capability gate covers this.
- **Opt-out enforcement in `send_sms`** changes behaviour for every existing caller (feedback requests). Intended; note it in the CHANGELOG.
- **pegasus:** four new tenant-scoped tables (WorkflowState, SmsOptOut, SmsSend, EmailSend). Run the tenant-isolation suite, and apply the migration to local Docker before push (pre-push runs against the Neon URL). Commit the coverage ratchet.
- **movemanager:** two new tables plus an **INSERT into legacy `Tasks` and `memos`** from net8. The desktop-safety integration tests are the gate. Re-read triggers on `Tasks`/`memos` (`sys.triggers` on NW) before shipping, per the GOTCHAS recipe from #668.
- **SES gating** is env-name based, never a `-c` context flag.
- **72h body purge:** `get_text_message` returns `bodyPurged: true` on old messages.
- **S2:** if the cloud RingCentral extension ≠ the desktop's, a RingCentral mark-read won't clear the desktop badge. The pegII mirror then carries it, but `Upsert` would re-set it to unread on the next reconciliation. Resolve before Phase 7.

## Acceptance

- **Each pegasus phase:** API tests + SDK tests + harness parity + OpenAPI coverage green; SDK published; README, MCP and `pegasus-workflows/CLAUDE.md` updated.
- **Each movemanager phase:** its plan archived, unit + integration tests green, and API tests running in the pipeline.
- **Overall:** the Phase 8 test move passes on NW QA, every proposal item (1–8, 11) is live, and questions 9, 10 and 12 are answered in this file.
