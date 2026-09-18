---
source: src:pegasus-cloud-prisma
analyzed: 2026-09-17
evidence_grade: A
material: |
  Read as source (repo root = ~/repos/pegasus-domain-reference):
  apps/api/prisma/schema.prisma - all 88 model/enum declarations enumerated;
    read in full: lines 1-170 (enums), 300-400 (Tenant tail + ArchivedTrip),
    595-960 (Customer..QuoteLineItem), 1130-1295 (Inventory/Billing/AuditLog),
    1290-1420 (PegasusEvent, Document, DocumentVariant), 1616-1760 (workflow enums,
    Workflow), 1820-1970 (WorkflowTrigger, DomainEvent, TenantEventType),
    2040-2140 (IntegrationProjection, IntegrationCorrelation), 2200-2245 (InboundEvent),
    2825-2867 (ShipmentEventInbox).
  apps/api/src/lib/domain-events.ts (full, 120 L) - the event taxonomy.
  apps/api/src/handlers/moves.ts (full, 255 L), orders.ts (full, 182 L),
    documents.ts (lines 60-90, route inventory), quotes.ts / billing.ts /
    customers.ts / events.ts / inventory.ts (emit sites + mutating-route inventory).
  apps/api/src/repositories/move.repository.ts (full function list + mappers).
  apps/api/prisma/migrations/0001_init/migration.sql (grep for column types).
  NOT read: apps/api/src/handlers/longhaul-cloud/ (11,381 L across 56 files) - that
    trip/activity surface is src:pegii-longhaul's material; only cross-referenced here.
    Also not read: schema.prisma lines ~1419-1616 (IntegrationConfig, Dashboard),
    1970-2052 (WorkflowSecretConfig), 2141-2200, 2245-2825 (feedback, VPN, RingCentral,
    push) - inspected by declaration name only, judged non-domain.
---

# Pegasus Cloud persistence schema + command surface - analysis

## What it is

`apps/api/prisma/schema.prisma` (2,867 lines, 88 model/enum declarations) is the
PostgreSQL realisation of the Cloud domain, plus every piece of platform
machinery the domain model does not contain: the **domain-event outbox**, the
**tenant event-type registry**, the **workflow/trigger tables**, the
**integration projection + correlation cache**, three separate **inbound event
inboxes**, and an **archived-trip snapshot** of legacy MSSQL trips. Two
Postgres schemas: `public` (tenant-facing) and `platform` (admin-only,
"never queried by tenant APIs", `schema.prisma:5-8,1233-1238`).

S1 kind: `internal-system`. S2 adoption: **0-1** (one product). S3 openness:
`internal`. S4 evidence grade: **A** for everything cited; the "not read"
list above is explicit.

I read the schema together with `apps/api/src/handlers/` because the schema
alone overstates the model: **several tables have no write path**. The
combination is what tells you what Cloud can actually record.

The headline for the reference model: **Cloud's domain tables are thinner than
`packages/domain` implies, but its event, provenance and correlation machinery
is far richer** - and that machinery, not the `Move` table, is the part worth
taking.

## Model summary

### The domain tables (tenant-facing)

`Tenant` is "the root of every bounded context. Each moving-company instance is
one Tenant" (`schema.prisma:167-168`). Every domain table carries `tenant_id`.

```
Tenant --< Customer --< Contact              Address <-- Move.origin / Move.destination
       |          +-- Account                        <-- Stop.address
       |          +-- LeadSource
       +--< Move --< Stop (type, sequence, scheduled_at/arrived_at/departed_at)
       |      +--< MoveCrewAssignment >-- CrewMember --< Availability
       |      +--< MoveVehicleAssignment >-- Vehicle --+
       |      +--< Quote --< QuoteLineItem      (RateTable --< Rate)
       |      +--< Invoice --< Payment
       |      +--< InventoryRoom --< InventoryItem
       +--< Document --< DocumentVariant        (entity_type/entity_id, NOT an FK)
       +--< ArchivedTrip --< ArchivedTripDriver (JSON snapshot of an MSSQL trip)
```

Mirrors `packages/domain` one-for-one (see `src:pegasus-cloud-domain`) with
these persistence-only facts:

- **Money is `Decimal(12,2)` + a sibling `currency` string column**, repeated on
  every money-bearing row (`Quote.price_amount`/`price_currency`
  `schema.prisma:899-900`; `QuoteLineItem` 923-924; `Invoice.total_amount`/
  `total_currency` 1187-1188; `Payment.amount`/`currency` 1209-1210;
  `InventoryItem.declared_value`/`declared_value_currency` 1162-1163). Tariff
  tables instead use **integer cents / millicents** "to match
  packages/domain/src/rating's integer-only money math"
  (`schema.prisma:947-952`). Two money representations in one database.
- **`Address` is a table, not an embedded value** (`schema.prisma:667-689`), with
  `MoveOrigin` / `MoveDestination` named relations (676-677). No latitude/
  longitude, no time zone, no geocode, no address type.
- `Move` has **no weight, no cube, no service list, no shipment type, no
  external reference and no dates other than `scheduled_date`**
  (`schema.prisma:691-722`).

### The machinery (what the domain package does not contain)

| Table | What it does | Cite |
| --- | --- | --- |
| `DomainEvent` | Transactional outbox. `event_type`, `payload`, `occurred_at`, `dispatched_at`. | 1883-1926 |
| `TenantEventType` | Tenant-registered custom event names + optional JSON Schema + a derivation rule. | 1928-1968 |
| `WorkflowTrigger` | `EVENT` (subscribe to an `event_type`, with a payload `filter`) or `SCHEDULE` (cron). | 1828-1869 |
| `WorkflowExecution` | One run; `WorkflowExecutionTriggerSource = USER \| EVENT \| SCHEDULE`. | 1746+, 1652-1658 |
| `PegasusEvent` | Inbound vendor events (legacy M2M queue). `event_publisher`, `event_status`. | 1294-1326 |
| `InboundEvent` | Ingress receipts: `external_id` dedupe, `raw_payload` verbatim, `status`, `domain_event_id`. | 2204-2229 |
| `ShipmentEventInbox` | `platform`-schema inbox for legacy MoveManager outbox messages. `schema_version`! | 2840-2867 |
| `IntegrationProjection` | Last-known partner state, keyed by **their** id. | 2052-2085 |
| `IntegrationCorrelation` | 1:1 binding between a Pegasus entity and that partner key. | 2087-2114 |
| `ArchivedTrip` | Immutable JSON snapshot of a rejected MSSQL trip + denormalised columns. | 335-390 |
| `AuditLog` | `platform` schema; `before`/`after` JSON snapshots, immutable. Tenant admin only. | 1256-1283 |

### The command surface

Every mutating route over the domain tables (from
`apps/api/src/handlers/`, enumerated by grep):

| Command | Route | Emits a domain event? |
| --- | --- | --- |
| Create move | `POST /moves` (`moves.ts:99`) | **no** |
| Change move status | `PUT /moves/:id/status` (`moves.ts:159`) | **yes** - `move.status_changed` (`moves.ts:195-199`) |
| Assign crew | `POST /moves/:id/crew` (`moves.ts:206`) | **no** (enqueues a push instead, `moves.ts:223`) |
| Assign vehicle | `POST /moves/:id/vehicles` (`moves.ts:231`) | **no** |
| Create order (M2M) | `POST /orders` (`orders.ts:133`) | **no** - same `createMove` call, no event |
| Create quote | `POST /quotes` (`quotes.ts:48`) | **no** |
| Add quote line item | `POST /quotes/:id/line-items` (`quotes.ts:92`) | **no** |
| Finalize quote (DRAFT->SENT) | `POST /quotes/:id/finalize` (`quotes.ts:120`) | **no** |
| Accept quote | `POST /quotes/:id/accept` (`quotes.ts:141`) | **yes** - `quote.accepted` (`quotes.ts:156-160`) |
| Create invoice | `POST /invoices` (`billing.ts:39`) | **no** |
| Record payment | `POST /invoices/:id/payments` (`billing.ts:101`) | **conditionally** - `invoice.paid` only when the balance crosses to zero (`billing.ts:134-144`) |
| Create customer | `POST /customers` (`customers.ts:50`) | **yes** - `customer.created` (`customers.ts:82-86`) |
| Update / delete customer | `PUT /customers/:id`, `DELETE /customers/:id` (`customers.ts:119,141`) | **no** |
| Add inventory room / item | `POST /moves/:moveId/rooms`, `.../items` (`inventory.ts:34,66`) | **no** |
| Document upload / finalize / archive / delete | `documents.ts:101,164,292,302` | **no** |
| Receive vendor event | `POST /events` (`events.ts`) | **yes** - `pegasus_event.received` (`events.ts:127-134`) |
| Submit feedback | public respond endpoint (`feedback-public.ts:133`) | **yes** - `feedback.submitted` |
| Emit custom event | `POST /event-types/:name/emit` (`event-types.ts:322`) | **yes** - `emitTenantEvent` |

**Nothing creates a `Stop`.** `createMove` takes only `origin` and
`destination` addresses (`move.repository.ts:88-112`); no handler writes the
`stops` table. Stops are read-only in practice - `move.repository.ts:20` includes
them `orderBy: { sequence: 'asc' }` and `mapStop` (lines 32-51) reads them back,
but the exported write functions are only `createMove`, `updateMoveStatus`,
`assignCrewMember`, `assignVehicle` (lines 113, 151, 193, 209). **`Stop`,
`StopType.STORAGE`, `arrived_at` and `departed_at` are therefore dead columns
today.**

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `MoveStatus` | `PENDING \| SCHEDULED \| IN_PROGRESS \| COMPLETED \| CANCELLED`, default `PENDING` | A1 | `schema.prisma:25-33,696` |
| `StopType` | `PICKUP \| DELIVERY \| STORAGE \| WAYPOINT` | A3, A5 | `schema.prisma:35-42` |
| `INVALID_STATE` / `PRECONDITION_FAILED` | 422 error codes for a disallowed transition / missing crew | A1 | `moves.ts:173-191` |
| `TenantStatus` | `ACTIVE \| SUSPENDED \| OFFBOARDED` - "Soft-deleted - tenant middleware returns 404" | A8 | `schema.prisma:104-122` |
| `TenantUserStatus` | `PENDING \| ACTIVE \| DEACTIVATED` | A8 | `schema.prisma:92-110` |
| `CrewRole` | `DRIVER \| MOVER \| SUPERVISOR` | A8, A13 | `schema.prisma:83-90` |
| `CrewMember.tenantUserId` | "Optional link to the tenant login that belongs to this crew member... so the Moves list/detail can be scoped to their own trips" | A8, A9 | `schema.prisma:764-767` |
| `DOMAIN_EVENT_TYPES` | `quote.accepted`, `move.status_changed`, `invoice.paid`, `customer.created`, `pegasus_event.received`, `feedback.submitted` - "a PUBLIC CONTRACT... additions are easy, renames are breaking" | A1, A7 | `lib/domain-events.ts:10-29` |
| `INTEGRATION_EVENT_TYPES` | `pegii.shipment.opened`, `pegii.shipment.closed`, `pegii.sale.saved` - "the lowercased pegII catalog DetailType under the `pegii.` namespace (Shipment.Opened -> pegii.shipment.opened)" | A1, A4, A9 | `lib/domain-events.ts:32-54` |
| `INTEGRATION_EVENT_TYPE_PREFIX` | `'pegii.'` - "Reserved event-name namespace owned by the integration pipeline" | A9, C8 | `lib/domain-events.ts:56-57` |
| `DomainEvent.payload` | "Event-specific payload (entity ids + minimal context). **Consumers must refetch authoritative state; the payload is a pointer, not a snapshot.**" | A1, A4 | `schema.prisma:1889-1892` |
| `occurredAt` | "When the domain state change happened (transaction time)" | A4, C5 | `schema.prisma:1894-1895` |
| `dispatchedAt` | "Stamped by the trigger dispatcher once the event has been processed. Null = pending." | A4 | `schema.prisma:1897-1899` |
| `TenantEventType.payloadSchema` | "Optional JSON Schema (draft-07). When set, the emit endpoint validates the instance payload against it and rejects a mismatch." | C8 | `schema.prisma:1945-1947` |
| `TenantEventType.domainCondition` | "`{ sourceEventType, filter }`. When a built-in domain event of `sourceEventType` matches `filter`, the dispatcher emits an instance of THIS custom type... derivation cycles are structurally impossible." | A1, C8 | `schema.prisma:1949-1954` |
| `WorkflowExecutionTriggerSource` | "Provenance of a WorkflowExecution": `USER \| EVENT \| SCHEDULE` | C7 | `schema.prisma:1650-1658` |
| `PegasusEvent.eventStatus` | "Processing state: NEW -> IN_PROGRESS -> PROCESSED \| ERROR" | A4 | `schema.prisma:1306-1307` |
| `PegasusEvent.eventPublisher` | "Name or identifier of the system that published this event" | C7 | `schema.prisma:1309-1310` |
| `InboundEvent.externalId` | "Dedup id derived from the payload (the configured `dedupKeyPath`, or a body hash fallback)" | A9 | `schema.prisma:2210-2212` |
| `InboundEvent.rawPayload` | "The partner payload verbatim (for replay/backfill)" | C7 | `schema.prisma:2214-2215` |
| `ShipmentEventInbox.messageId` | "Relay-supplied MessageId (the legacy Outbox row's GUID). **The idempotency key.**" | A9 | `schema.prisma:2842-2843` |
| `ShipmentEventInbox` fields | `aggregateType`, `aggregateId`, `eventType`, `schemaVersion`, `source`, `occurredAtUtc`, `receivedAt`, `dispatchedAt` | A4, A9, C8 | `schema.prisma:2845-2866` |
| `IntegrationProjection.state` | "Last-known external state, **in the integration's NATIVE payload shape**" | A9 | `schema.prisma:2062-2063` |
| `IntegrationProjection.entityKey` | the partner's identifier the state is cached under | A9 | `schema.prisma:2060` |
| `IntegrationCorrelation` | "Binds a Pegasus entity to the external key its state is cached under... a projection is keyed by the PARTNER's identifier, which we only learn BY fetching" | A9 | `schema.prisma:2079-2093` |
| `localEntityType` / `localEntityId` | "Our side: the Pegasus entity kind (e.g. `shipment`) and its id" | A9 | `schema.prisma:2098-2100` |
| `ArchivedTrip` | "an immutable historical copy" of an MSSQL trip: "the exact `{ ...trip, activities, notes, shipments }` shape the trip-detail handler returns" | A3 | `schema.prisma:320-365` |
| `ArchivedTrip.originalTripId` | `Int` - "MSSQL TripMaster.id" | A3, A9 | `schema.prisma:339` |
| `plannedFirstDay` / `plannedLastDay` | denormalised trip planning window | A3, C5 | `schema.prisma:344-345` |
| `totalEstimatedLbs` / `totalEstimatedLinehaulUsd` | denormalised trip totals - the only weight columns on any operational table | A2, A3 | `schema.prisma:348-349` |
| `ArchivedTripDriver.reason` | free-text reason a driver rejected an offered trip | A3, C7 | `schema.prisma:373` |
| `Document.entityType` | allowlist `customer \| quote \| move \| invoice \| shipment`; **`shipment`'s `entityId` "is the legacy `order_num` (a string) read from on-prem MSSQL - there is no Postgres row to FK against"** | A2, A6, A9 | `handlers/documents.ts:66-71` |
| `TariffVersionStatus` | `STAGED \| ACTIVE \| SUPERSEDED` | A12 | `schema.prisma:954-960` |
| `AuditLog.before` / `.after` | "Snapshot of the resource before/after the mutation"; "No updatedAt - audit logs are immutable once written" | C7 | `schema.prisma:1269-1276` |

## Lifecycles & events

### The move lifecycle, as actually enforced

`MoveStatus` (`schema.prisma:25-33`) is enforced at the handler, not the
database: `PUT /moves/:id/status` calls `canTransition(move.status, status)` and
returns **422 `INVALID_STATE`** with the message
`Cannot transition move from ${move.status} to ${status}` (`moves.ts:173-181`);
`IN_PROGRESS` additionally requires `canDispatch` and otherwise returns **422
`PRECONDITION_FAILED`**, "At least one crew member must be assigned before
dispatch" (`moves.ts:183-191`). There is **no reason code parameter** on the
request body - `UpdateStatusBody` is `{ status }` and nothing else
(`moves.ts:85-87`). A cancellation therefore cannot say why.

**Who may cause a transition** is expressible here, unlike in the domain
package: `requirePermission(Actions.UpdateMove)` gates the route
(`moves.ts:161`), and reads are ABAC'd per record - a `driver` principal passes
`ReadMove` "only when their linked crew member is assigned to the move"
(`moves.ts:34-54`), with a deliberate fail-closed sentinel so "a driver with no
linked CrewMember must see an empty Moves list rather than every tenant move"
(`moves.ts:29-32`). That is a real actor model - it just is not part of the
lifecycle vocabulary.

### The domain-event taxonomy

`lib/domain-events.ts:10-29` declares six names (the comment says "five launch
event names"; `feedback.submitted` was appended later with an explanatory
comment, lines 24-28):

```
quote.accepted · move.status_changed · invoice.paid · customer.created
pegasus_event.received · feedback.submitted
```

plus a **separate, deliberately non-overlapping** integration taxonomy
(`lib/domain-events.ts:32-54`):

```
pegii.shipment.opened · pegii.shipment.closed · pegii.sale.saved
```

"kept SEPARATE from the DOMAIN_EVENT_TYPES platform taxonomy above - they are
not emitted by Pegasus domain writes, they're ingested from on-prem"
(lines 36-39). The `pegii.` prefix is reserved so a tenant cannot register a
colliding custom name (lines 44-57).

**The emit contract is the important part.** `emitDomainEvent(tx, ...)` takes a
`Prisma.TransactionClient`; "Callers MUST invoke it inside the same transaction
as the domain state change it describes - atomicity comes from the caller's
transaction" (`lib/domain-events.ts:4-8,58-83`). Every emit site honours this:
`moves.ts:193-201`, `quotes.ts:154-162`, `billing.ts:124-147`,
`customers.ts:82-86`, `events.ts:121-137`. Two sites go further and make the
emit **race-safe by construction**:

- Quote accept uses a compare-and-set: "`acceptQuote` is a compare-and-set on
  status: SENT; null means a concurrent request changed the status between the
  precheck and the update, so no event is emitted and the request is rejected
  like the precheck would have" (`quotes.ts:149-166`).
- `invoice.paid` fires only on the **balance crossing zero**, with the
  before-balance recomputed inside the transaction "so concurrent payments
  racing across the boundary can't both observe a stale positive balance and
  double-emit" (`billing.ts:118-144`).

Payloads are pointers by design: `move.status_changed` carries
`{ moveId, previousStatus, newStatus }` (`moves.ts:198`), `quote.accepted`
`{ quoteId, moveId }` (`quotes.ts:159`), `invoice.paid`
`{ invoiceId, moveId, totalAmount, totalCurrency }` (`billing.ts:139-142`),
`customer.created` `{ customerId }` (`customers.ts:85`).
`move.status_changed` is the **only** event in the system that carries a
before-and-after pair.

### Other state machines in the schema

- `QuoteStatus` 44-52, `InvoiceStatus` 54-62, `ItemCondition` 73-81 - mirrors of
  the domain package.
- `DocumentStatus` 134-146 (`PENDING_UPLOAD -> ACTIVE -> ARCHIVED |
  PENDING_DELETION`, "S3 object still present, purged by background worker") and
  `DocumentVariantStatus` 158-168 ("FAILED is terminal for decode errors (the
  download-url endpoint falls back to the original)").
- `TariffVersionStatus` `STAGED | ACTIVE | SUPERSEDED` (954-960) and
  `IntegrationConfigStatus` `PUBLISHED | SUPERSEDED` (1616-1623) - the schema's
  two **supersession** vocabularies, and the closest thing Cloud has to a
  correction model.
- `WorkflowExecutionStatus` `QUEUED -> RUNNING -> COMPLETED | FAILED |
  TIMED_OUT | CANCELLED` (1628-1638).
- `PegasusEvent.eventStatus` `NEW -> IN_PROGRESS -> PROCESSED | ERROR` - a
  *string* column with a default, not an enum (`schema.prisma:1306-1307`).
- `InboundEvent.status` - `"accepted" | "rejected"`, with the crucial comment
  "**ingestion outcome (NOT workflow outcome)**" (`schema.prisma:2219-2220`).

**No execution-event vocabulary exists anywhere in the schema.** There is no
table of arrivals, departures, loads, unloads, deliveries or exceptions. The
only execution timestamps are `stops.arrived_at` / `stops.departed_at`
(`schema.prisma:734-735`), which nothing writes.

## Time, identity, evidence

### Time

- **Domain tables are time-zone-naive.** Prisma's default `DateTime` maps to
  `timestamp(3)` without a zone; confirmed in the generated DDL:
  `"scheduled_date" TIMESTAMP(3) NOT NULL` and `"scheduled_at" TIMESTAMP(3)`
  (`prisma/migrations/0001_init/migration.sql:117,131`). Only 29 columns
  opt into `@db.Timestamptz(6)`, and **none of them is on a domain table** -
  they are on `TenantSsoProvider` (423-424), the RingCentral tables
  (2575-2663) and `ShipmentEventInbox` (2860-2866). So the one event stream
  that carries a properly zoned instant is the legacy MoveManager bridge.
- **Three distinct clocks are modelled on the inbound paths, and this is the
  schema's best time idea**:
  `ShipmentEventInbox.occurredAtUtc` ("When the domain change happened on-prem")
  vs `receivedAt` ("When this cloud consumer first accepted the message") vs
  `dispatchedAt` ("Onward-dispatch hook... null = ingested, not yet forwarded")
  (`schema.prisma:2857-2866`). `PegasusEvent` has the same triple as
  `eventDatetime` / `receivedAt` / `processedAt` (1303-1304, 1318-1319), and
  `DomainEvent` has `occurredAt` vs `dispatchedAt` (1894-1899).
- **Planned vs actual never coexist on one entity.** `ArchivedTrip` has
  `plannedFirstDay` / `plannedLastDay` (344-345) but no actuals; `Stop` has
  `scheduled_at` / `arrived_at` / `departed_at` (733-735) but is never written.
  **Estimated is nowhere**: no ETA column exists in the schema.
- `Move` has exactly one date (`scheduled_date`, 700). No pack date, no load
  date, no delivery spread, no SIT-in/out dates.

### Identity and cross-references

Internally: `uuid()` primary keys everywhere, `tenant_id` on every domain row,
composite uniques such as `(tenantId, email)` on Customer (639),
`(tenantId, registrationPlate)` on Vehicle (793), `(tenantId, name, version)` on
Workflow (1729).

Externally - and this is **the strongest part of this source** - Cloud has four
distinct cross-reference mechanisms, all of them outside the domain tables:

1. **`IntegrationProjection` + `IntegrationCorrelation`** (2052-2114). The
   projection caches a partner record's native state keyed by **`entityKey`,
   the partner's id**. The correlation table's doc comment states the problem
   exactly: *"Without this, 'read the cached external state for shipment S' is
   inexpressible: a projection is keyed by the PARTNER's identifier, which we
   only learn BY fetching - so cache-then-fetch degrades to always-fetch and the
   cache is dead weight on the read path (Gap A)"* (2079-2084). The binding is
   **1:1 in both directions**, enforced by two unique constraints:
   `correlation_local` on `(tenant, integration, entityType, localEntityType,
   localEntityId)` and `correlation_external` on `(tenant, integration,
   entityType, entityKey)` (2108-2110), "so the mapping is a true 1:1 - one
   local entity resolves to one external key, and one external key back to one
   local entity" (2085-2086). `integrationId` is "a code-defined slug (e.g.
   `demo_partner`), NOT an FK" (2043-2044).
2. **Polymorphic entity references that deliberately cross systems.**
   `Document.entityType` / `entityId` is "a polymorphic (entityType, entityId)
   string pair, not a foreign key", and the `shipment` case points **into
   MSSQL**: "Its `entityId` is the legacy `order_num` (a string) read from
   on-prem MSSQL - there is no Postgres row to FK against"
   (`handlers/documents.ts:66-71`). **This is the only place in Cloud where the
   word `shipment` names an entity, and it resolves to a pegII order number.**
3. **`ArchivedTrip.originalTripId` -> MSSQL `TripMaster.id`** and
   `originalDriverId` / `ArchivedTripDriver.driverId` ->
   `v_longhaul_drivers.driver_id` (`schema.prisma:339,343,370`). Typed
   cross-system integer keys, named in comments.
4. **Message-level idempotency keys.** `ShipmentEventInbox.messageId` is the
   relay's Outbox GUID and is the table's primary key: "Delivery is
   at-least-once, so the consumer dedupes on the relay's `messageId`... **this
   table IS the dedupe gate: a row's presence means the message was already
   accepted**" (2825-2843). `InboundEvent` uses
   `@@unique([tenantId, integrationId, externalId])` "so a redelivered event is
   recorded once and the workflow fires once" (2199-2226).
   `PegasusEvent.eventApiId` is `@unique` globally (1298-1300).

### Evidence, provenance, corrections

Better than the domain package, and still short of what A4/A6 need.

**Present:**

- **Actor on every integration write**: `IntegrationProjection.updatedByUserId`
  and `IntegrationCorrelation.updatedByUserId` are the "workflow_runtime
  service-account user id that last wrote the row" (2067-2068, 2102-2103).
  `Document.uploadedBy` is a `TenantUser.id` (1360-1361).
  `Workflow.createdByUserId` / `WorkflowTrigger.createdByUserId` are
  denormalised "so the row survives user deletion" (1683-1685, 1855-1857).
- **Publisher on every inbound event**: `PegasusEvent.eventPublisher` (1309-1310),
  `ShipmentEventInbox.source` ("SNS `source` message attribute (Relay `Source`
  config, e.g. `MoveManager`)", 2851-2852).
- **Raw payload retained**: `InboundEvent.rawPayload` "verbatim (for
  replay/backfill)" (2214-2215); `PegasusEvent.eventData` (1312-1313);
  `ShipmentEventInbox.payload` "as published by the relay (**pointer, not
  authoritative state**)" (2854-2855).
- **Ingestion outcome separated from processing outcome**: `InboundEvent.status`
  is explicitly "ingestion outcome (NOT workflow outcome)" and `domainEventId`
  is "The DomainEvent this receipt emitted (null if rejected/malformed)"
  (2219-2223). A three-way distinction - received / accepted / acted on - that
  the reference model needs for A4.
- **Versioned optimistic-write counter**: `IntegrationProjection.version`,
  "Monotonic counter bumped on each write - observability + future If-Match"
  (2065-2066).
- **Before/after snapshots**: `AuditLog.before` / `.after`, immutable
  (1269-1277).
- **A reason field, exactly once**: `ArchivedTripDriver.reason` (373) - why a
  driver rejected an offered trip.
- **Supersession as the correction idiom**: `TariffVersionStatus.SUPERSEDED`
  (958), `IntegrationConfigStatus.SUPERSEDED` (1620), `FeedbackFormStatus`
  ("A publish supersedes the prior PUBLISHED row", 2237-2241).

**Absent:**

- `AuditLog` covers **only tenant administration** - `resourceType` is
  "Currently always `TENANT`" and the action list is
  `CREATE_TENANT | UPDATE_TENANT | SUSPEND_TENANT | REACTIVATE_TENANT |
  OFFBOARD_TENANT` (1263-1268). **No domain entity has an audit trail.**
- No domain row records who asserted any field. `Move.user_id` is the creator
  (694). A status change is recorded in the outbox but the outbox row has no
  actor column at all (`DomainEvent`, 1883-1905) - so *that a move went to
  COMPLETED* is durable, *who said so* is not.
- No correction, amendment or reversal on any domain entity; `DomainEvent` rows
  are never superseded or retracted.
- No link from a `Document` to the fact or event it evidences.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 2 | 0 | 1 | 1 | 2 | 2 | C3=2: enum + handler-enforced transition graph with typed 422 codes + a dispatch precondition + a compare-and-set accept (`schema.prisma:25-33`, `moves.ts:173-191`, `quotes.ts:149-166`); permissions say who may cause it (`moves.ts:161`). C7=2: the same-transaction outbox with `previousStatus`/`newStatus` (`moves.ts:193-201`, `lib/domain-events.ts:58-83`). C8=2: taxonomy declared a public contract, "renames are breaking" (`lib/domain-events.ts:10-13`) + a tenant registry with JSON Schema validation (`schema.prisma:1945-1947`). C1/C2/C4 stay low - the *vocabulary* is a generic job tracker with no offer/award, no estimate-submitted, no reason codes. |
| A2 Shipment structure | 1 | 1 | 0 | 0 | n/a | 2 | 0 | 1 | **There is no shipment table.** The word appears as a `Document.entityType` whose id is a pegII `order_num` (`handlers/documents.ts:66-71`) and as a JSON key inside `ArchivedTrip.snapshot` ("`{ ...trip, activities, notes, shipments }`", `schema.prisma:328-330`) - note that plural: **several shipments on one trip, expressible only as opaque JSON**. C6=2 for the documented cross-system entity reference. The only weight in the schema is `ArchivedTrip.totalEstimatedLbs` (348), a denormalised display column. |
| A3 Trip, stop & assignment | 1 | 1 | 0 | 0 | 2 | 2 | 2 | 1 | `stops` table with `sequence` (724-748) exists but **has no write path** - see the command-surface table. Assignment is a bare join table with only `assigned_at` (824-850): no role, no period, no unassignment record. `ArchivedTrip` is the only trip-shaped row and it is an immutable JSON snapshot of an MSSQL trip (320-365) => C5=2 (`plannedFirstDay`/`plannedLastDay`), C6=2 (`originalTripId` -> `TripMaster.id`), C7=2 (immutable snapshot + `createdById` + `ArchivedTripDriver.reason`). C8=1: `kind` is "generic (`rejected` today) so cancelled-trip retention can reuse the same tables later with no migration" (330-332). Live trips are **not here**: see `src:pegii-longhaul`. |
| A4 Execution events & tracking | 1 | 1 | 1 | 0 | 2 | 2 | 2 | 2 | Cloud has **excellent event plumbing and zero execution-event vocabulary**. C1=1: the only physical columns are `stops.arrived_at`/`departed_at` (734-735), unwritten. C5=2 and C7=2 for the occurred/received/dispatched triple and the raw-payload + publisher retention (2842-2866, 2204-2226). C8=2: `ShipmentEventInbox.schemaVersion` (2849) is the only versioned event vocabulary in the estate, and `pegii.` is a reserved namespace (`lib/domain-events.ts:56-57`). No ETA, no exception, no reason code, no telemetry boundary => C2/C3 stay at 1. |
| A5 Storage-in-transit | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | `StopType.STORAGE` is declared (`schema.prisma:38`) and **never read** (verified by grep across `apps/api/src` and `packages/domain/src`). No SIT table, column, duration, warehouse party or delivery-out leg. Cloud's only SIT knowledge is SQL against MSSQL activity codes `SITIN`/`SITOUT` in the pegII proxy (`handlers/longhaul-cloud/shipments-list.ts:261-286`), which belongs to `src:pegii-longhaul`. Scored 0 across: this area is genuinely absent. |
| A6 Documents & evidence | 2 | 1 | 3 | 0 | 1 | 2 | 2 | 2 | C3=3: a complete two-level upload lifecycle - `PENDING_UPLOAD -> ACTIVE -> ARCHIVED \| PENDING_DELETION` with `deletedAt` (134-146, 1358-1363), plus a variant machine with a terminal `FAILED` and a documented fallback, made idempotent by `@@unique([documentId, variant])` - "The unique constraint + upsert is the entire concurrency story: re-delivery of the S3 ObjectCreated event is a no-op" (1379-1382, 1409-1414). C6=2 for the polymorphic reference that spans Postgres and MSSQL keys. C7=2 for `uploadedBy` on every row. But `documentType` is a free string with only prose examples ("contract", "photo", "bol", "receipt", 1349-1350) => C2=1, and no document links to a fact => C4=0. |
| A7 Charges & billing hooks | 2 | 2 | 2 | 1 | 2 | 1 | 1 | 2 | Quote/line-item/invoice/payment persisted with per-row currency (894-950, 1181-1231). C5=2: `valid_until`, `issued_at`, `due_at`, `paid_at`, `effective_from`/`effective_to`. C7=1: `Payment.reference` (1213) only. C8=2: `TariffVersionStatus` supersession (954-960) + integer-cents discipline (947-952). No accessorial-vs-linehaul distinction on `QuoteLineItem` (919-950); the only charge event is `invoice.paid`, and only at the zero-balance crossing (`billing.ts:134-144`). |
| A8 Parties & roles | 1 | 1 | 1 | 0 | n/a | 2 | 1 | 0 | Customer/Contact/Account/LeadSource/TenantUser/CrewMember (582-665, 750-775). C3=1 for `TenantStatus` and `TenantUserStatus` (104-122, 92-110) - party lifecycles exist, but only for platform identities. C6=2: `CrewMember.tenantUserId` is a real 1:1 person<->login binding (764-770) and `ArchivedTripDriver.driverId` crosses into MSSQL (370). **No agent roles of any kind** - no booking/origin/hauling/destination agent, no van line, no carrier, no warehouse, no RMC. A `Move` has two party columns: `user_id` and optional `customer_id` (694-695). |
| A9 Identity & cross-references | 2 | 3 | 1 | 0 | 1 | 3 | 2 | 2 | **This source's best area.** C2=3: the `IntegrationCorrelation` comment states precisely why a partner-keyed cache is unreadable by a local id and names the failure ("Gap A", 2079-2084). C6=3: typed local<->external 1:1 with both-direction uniqueness (2098-2110), plus three more reference idioms - polymorphic `(entityType, entityId)` crossing into MSSQL (`documents.ts:66-71`), `originalTripId` (339), and message-level idempotency keys (2842-2843, 2199-2226). C7=2: `updatedByUserId` + `version` + verbatim raw payloads. C8=2: `integrationId` is an intentionally non-FK code slug (2043-2044) and `pegii.` is a reserved namespace. C3=1: no lifecycle for a binding (the SDK exposes `created`/`unchanged`/`rebound`/`conflict`, but that vocabulary is not in the schema). |
| A12 Rating & tariffs | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 2 | Seven 400NG tables - `Tariff400ngZip3`, `ServiceArea`, `LinehaulRate` (mileage x weight bands), `ShorthaulRate`, `FullPackRate` (schedule x weight band), `FullUnpackRate` (flat), `TariffFuelSurcharge` (1003-1132). C3=2: `STAGED -> ACTIVE -> SUPERSEDED` (954-960). C8=2: integer cents/millicents and per-tariff table naming; the tables are deliberately **not** tenant-scoped - "400NG is government reference data identical for every tenant" (938-943). |
| A13 Crew, driver & settlement | 1 | 1 | 0 | 0 | 2 | 2 | 1 | 0 | `CrewMember` / `Vehicle` / `Availability` / two assignment join tables (750-850). C5=2: `window_start`/`window_end` with a supporting index (817-820). C6=2: the crew-member<->login link and the MSSQL driver id. **No compensation, revenue split, settlement, rate or pay column exists anywhere in 2,867 lines.** |

**S5 - fit to Pegasus data (can Cloud persist this today?)**

| Area | Fit | Note |
| --- | --- | --- |
| A1 | partial | Status + a real transition gate + an atomic outbox. No reasons, no actor on the event row. |
| A2 | **no** | No shipment table, no weight, no services. `shipment` exists only as a foreign key string into pegII. |
| A3 | **no** (live) / partial (archived) | `stops` has no write path; live trips are MSSQL. `ArchivedTrip` proves the JSON snapshot works but is write-once and query-hostile. |
| A4 | **no** (vocabulary) / yes (transport) | Nothing to record an arrival; everything needed to carry one reliably. |
| A5 | **no** | One unread enum value. |
| A6 | partial | Files, variants, lifecycle, uploader - yes. Typed document classes and evidence links - no. |
| A7 | partial | Invoicing yes. Charge taxonomy only inside the tariff tables. |
| A8 | **no** | Agent roles absent; only customer + platform-user + crew. |
| A9 | **yes** | `IntegrationCorrelation` + `IntegrationProjection` can already hold a typed local<->partner binding per integration. |
| A12 | yes (400NG) | Full tariff version lifecycle and rate tables. |
| A13 | partial | Scheduling yes; settlement no. |

## Strengths worth adopting

1. **A transactional outbox as the definition of "a domain event happened"** -
   the outbox row commits with the state change or not at all, and "atomicity
   comes from the caller's transaction, not from this helper"
   (`lib/domain-events.ts:4-8,58-83`; every emit site uses `db.$transaction`).
   The reference model should state this as an invariant of the catalog: an
   event is a *fact recorded with its change*, never a post-hoc notification.
2. **Payload-as-pointer, stated explicitly**: "Consumers must refetch
   authoritative state; the payload is a pointer, not a snapshot"
   (`schema.prisma:1889-1892`). This settles a recurring catalog design
   argument in one sentence and should be inherited verbatim.
3. **`move.status_changed` carries `{ previousStatus, newStatus }`**
   (`moves.ts:198`). A transition event that names both ends is replayable and
   idempotently interpretable; one that names only the new state is not. Make
   before/after mandatory for every lifecycle event in the catalog.
4. **Emit only on a real crossing, computed inside the transaction**
   (`invoice.paid` at the zero-balance crossing, `billing.ts:118-144`) and
   **emit only when a compare-and-set wins** (`quote.accepted`,
   `quotes.ts:149-166`). Both are the right answer to "how do I not emit twice".
5. **Three clocks, named separately**: `occurredAtUtc` / `receivedAt` /
   `dispatchedAt` (`schema.prisma:2857-2866`), with `occurredAt` defined as
   "when the domain state change happened (transaction time)" (1894-1895).
   A4 needs exactly this - and the reference model needs a fourth, the
   *asserted-at* time, which Cloud lacks.
6. **Ingestion outcome separated from processing outcome**, with the emitted
   event id recorded on the receipt: `InboundEvent.status` "(NOT workflow
   outcome)" plus `domainEventId` "null if rejected/malformed"
   (`schema.prisma:2219-2223`). A three-stage receipt chain the catalog should
   copy.
7. **The dedupe gate is a table, not a code path**: "this table IS the dedupe
   gate: a row's presence means the message was already accepted"
   (`schema.prisma:2831-2834`), plus `@@unique([tenantId, integrationId,
   externalId])` on `InboundEvent`. At-least-once delivery is assumed, not
   hoped away.
8. **`IntegrationCorrelation` as a first-class model concept, not a join
   table.** The local<->external binding is unique in both directions
   (`schema.prisma:2108-2110`), separate from the cached state, survives the
   state's expiry, and has its own actor and timestamps. Generalise it: an HHG
   shipment needs the same binding to a van-line registration number, an RMC
   service-order number and a BOL number simultaneously - Cloud's version is
   one-per-`(integration, entityType)`, which is the right *shape* at the wrong
   *arity*.
9. **A versioned event schema on the ingest boundary**
   (`ShipmentEventInbox.schemaVersion`, `schema.prisma:2849`). The published
   catalog needs a per-event-type version, and this is the only place in the
   estate that already has one.
10. **Reserved namespaces and a tenant extension registry**: `pegii.` is
    reserved (`lib/domain-events.ts:56-57`), tenants may register their own
    names, those names "flow through the very same DomainEvent outbox +
    dispatcher - the dispatcher already matches eventType by raw string
    equality, so a custom name routes with no dispatcher change"
    (`schema.prisma:1911-1925`), with an optional draft-07 payload schema
    (1945-1947) and a derivation rule whose source "is validated at create time
    to be a built-in name only, so **derivation cycles are structurally
    impossible**" (1949-1954). This is a complete, working extensibility model
    for a published catalog and should be adopted wholesale.
11. **Supersede rather than update** as the correction idiom
    (`TariffVersionStatus`, `IntegrationConfigStatus`, `FeedbackFormStatus`,
    lines 954-960, 1616-1623, 2237-2241).
12. **Denormalised columns declared as such, with the reason**: `ArchivedTrip`'s
    display columns are "Denormalized columns for list cards / filtering (avoids
    parsing snapshot)" (341-342), and `createdByUserId` is denormalised "so the
    row survives user deletion" (1683-1685). Where the model denormalises, say
    why.

## Weaknesses / traps

1. **The schema overstates the model. Do not read a table as a capability.**
   `stops` (724-748) is fully specified - typed, sequenced, with planned and
   actual timestamps - and **nothing writes it**. If a mapping is built from
   the schema alone it will claim stop-level coverage Cloud does not have.
   Every A3/A4/A5 claim about Cloud must be checked against
   `apps/api/src/handlers/` and `repositories/move.repository.ts`.
2. **Event coverage is opportunistic, not systematic.** Six event types cover:
   one move transition, one quote transition, one invoice crossing, one customer
   creation, one inbound relay and one feedback response. **Move creation emits
   nothing** (`moves.ts:111-132`), and neither does the M2M `POST /orders` path
   that creates the identical row (`orders.ts:159-181`) - so an order arriving
   from an integration is invisible to every workflow trigger. Crew assignment
   emits a *push notification* instead of a domain event (`moves.ts:220-225`) -
   the operationally interesting fact (a driver was assigned) exists only as a
   mobile alert. Vehicle assignment emits nothing and is not even transactional
   (`moves.ts:243`). Quote finalize/send emits nothing. Do not infer "Cloud can
   capture intent" from "Cloud has an outbox" - it can, at six sites.
3. **`DomainEvent` has no actor column** (1883-1905). The system that best
   knows who issued a command throws that away at the moment it records the
   consequence. The reference model's event envelope must carry the asserting
   principal; Cloud will need a schema change to supply it.
4. **`AuditLog` is not a domain audit log** - `resourceType` "Currently always
   `TENANT`" (1265-1266). Do not cite it as provenance for move, quote or
   invoice changes.
5. **Time-zone-naive domain columns** (`TIMESTAMP(3)`,
   `migrations/0001_init/migration.sql:117,131`) while the integration tables
   are `Timestamptz(6)`. Any date crossing that boundary silently changes
   meaning. The reference model should require a zone (or an explicit
   stop-local date type) on every operational time.
6. **`ArchivedTrip.snapshot` is a JSON blob of another system's response shape**
   (328-330). It preserves trip/activity/shipment structure - including the fact
   that one trip carries **several shipments** - but only as opaque JSON that no
   query can reach. Treat it as *evidence that the concepts exist in pegII*, not
   as a model of them; the model belongs to `src:pegii-longhaul`.
7. **Two money representations** - `Decimal(12,2)` + currency string on domain
   rows vs integer cents/millicents on tariff rows (899-900 vs 947-952) - and
   currency repeated per row with no invariant that an invoice's payments match
   its total's currency. Pick one in the reference model.
8. **`PegasusEvent.eventStatus` and `InboundEvent.status` are `String`, not
   enums** (1306-1307, 2219-2220), with the state machine only in a comment.
   Vocabularies that matter should be closed and named.
9. **`pegasus_event.received` is a transport event masquerading as a domain
   event.** It is in the same public taxonomy as `quote.accepted` but says only
   "a vendor payload arrived" (`events.ts:127-134`). The catalog should keep
   business facts and transport receipts in separate namespaces - which the
   code *does* do for `pegii.*` (`lib/domain-events.ts:36-39`) and then
   undoes here.
10. **The `INTEGRATION_EVENT_TYPES` list is hand-maintained against a remote
    catalog**: "This list MUST stay in sync with the mapper's `deriveEventType`
    output as the catalog grows; Catalog source of truth: `GET
    /api/v1/pegii/events/catalog`" (`lib/domain-events.ts:42-47`). A published
    catalog cannot rely on a comment to stay in sync with its own source.
11. **`IntegrationCorrelation` is one binding per `(integration, entityType)`**
    (2108-2110). An HHG shipment routinely carries several external identities
    at once; a 1:1 table will force either one row per identifier kind or a
    remodel.

## Out-of-v1 material

- **A11 claims & valuation.** Nothing. `InventoryItem.declared_value` +
  `condition_at_pack` / `condition_at_delivery` (1156-1175) are the only
  adjacent columns. No claim table, no valuation election.
- **A12 rating & tariffs.** The full 400NG rate-table set is worth keeping as a
  worked example of tariff persistence: `Tariff400ngZip3` (1003-1020),
  `Tariff400ngServiceArea` (1022-1039), `Tariff400ngLinehaulRate` with
  `(milesLower, weightLower)` banding and `@@unique([tariffVersionId,
  milesLower, weightLower])` (1041-1059), `Tariff400ngShorthaulRate`
  (1061-1078), `Tariff400ngFullPackRate` keyed by `(schedule, weightLower)`
  (1080-1097), `Tariff400ngFullUnpackRate` - flat per schedule, "regardless of
  shipment weight, unlike full pack" (1097-1114), `TariffFuelSurcharge`
  (1116-1132) with `TariffFuelSurchargeSource` (962-972). Platform-global, not
  tenant-scoped, with the reasoning stated (938-952).
- **A13 crew & settlement.** `Availability` with an index on
  `(window_start, window_end)` (817-820) is the only capacity-planning
  structure. No pay, no settlement.
- **Workflow platform (no rubric area, but it is how events become actions).**
  `WorkflowTrigger` (1828-1869) subscribes a workflow to an `event_type` with an
  optional payload `filter`; `WorkflowExecution` (1746+) records the run with
  `WorkflowExecutionTriggerSource = USER | EVENT | SCHEDULE` (1650-1658). The
  dry-run result envelope is stored as `{ dryRun, return, trace, captured }`
  (1758-1760) - a captured-side-effect log, which is a useful precedent for
  "what would this event have caused".
- **Multi-tenancy.** `Tenant` is the root of every context (167-172), with
  `TenantStatus` soft-delete semantics (104-122) and a tenant-scoped Prisma
  extension (`lib/prisma.ts`, referenced at 941-946, 2049-2051). Relevant to any
  reference model that must serve several agencies.
- **`ShipmentEventInbox` is not tenant-scoped** - "legacy events carry no
  Pegasus tenant id - MoveManager is per-site" (2835-2837). A structural fact
  about the pegII bridge worth carrying into the mapping work.

## Open questions

1. **Will the reference-model catalog be emitted from Cloud commands, from the
   pegII outbox relay, or both?** Cloud has six native emit sites and a separate
   `pegii.*` ingest taxonomy that is deliberately kept apart
   (`lib/domain-events.ts:36-39`). The catalog needs a stated position on
   whether one shipment fact can arrive by two routes and how they reconcile.
2. **Is `stops` unwritten by intent or by backlog?** If stops are meant to
   become real, a stop-write command is the single highest-leverage change for
   A3/A4. If not, the reference model should not treat Cloud as having a stop
   concept at all.
3. **Who is the actor on a domain event?** Adding a principal to `DomainEvent`
   is a small schema change with a large modelling consequence. Is it wanted?
4. **Should `IntegrationCorrelation` generalise to many identifier kinds per
   entity** (registration number, BOL, RMC service order, agent order number)
   before the model is fixed? Its current 1:1-per-integration shape is the
   binding constraint.
5. **What is the intended home for SIT - Cloud or pegII?** Same question as in
   `src:pegasus-cloud-domain`, restated at the persistence layer: there is no
   column anywhere to hold a SIT-in date, a SIT-out date, or a day count.
6. **Does `ArchivedTrip.snapshot` need to be queryable?** It is the only place
   in Postgres where trip -> activities -> several shipments coexist. If trips
   move to Cloud, that JSON is the de-facto schema to formalise.
7. **How is `INTEGRATION_EVENT_TYPES` kept in sync with
   `GET /api/v1/pegii/events/catalog`** (`lib/domain-events.ts:44-47`), and what
   is the full pegII catalog? Three names are listed here; the catalog endpoint
   is the source of truth and was not read. This is a direct input to
   `src:pegii-order` / `src:pegii-longhaul`.
8. **Is `RateTable`/`Rate` (854-892) actually used**, given the parallel 400NG
   tariff tables? Two rate models coexist with no FK or comment relating them.
