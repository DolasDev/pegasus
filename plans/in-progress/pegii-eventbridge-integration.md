# PegII → EventBridge integration

Bring legacy **pegII / MoveManager** domain events into Pegasus as a first-class
event source — consumable by **workflows** (via the existing v2 trigger model) and
by future "other situations" — over a custom **EventBridge** bus.

> Supersedes the SNS-FIFO half of `legacy-outbox-relay-setup.md`. The Roles
> Anywhere + leaf-cert renewal machinery in that runbook is **retained**; only the
> publish target changes (SNS → EventBridge).

## Decisions (locked)

| Decision             | Choice                                                      | Why                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud routing fabric | **Custom EventBridge bus**                                  | Native archive/replay for onboarding future consumers; whole-event content rules (no hand-curated attribute promotion as the registry grows); clean multi-consumer fan-out.         |
| Delivery semantics   | **At-least-once, idempotent consumers**                     | EventBridge has no FIFO. Payloads are self-contained; strict per-shipment ordering is not required. Dedupe on a legacy event id instead.                                            |
| Tenant identity      | **Relay stamps `tenantId`** (pegII appsettings, per-site)   | Legacy MoveManager is per-site and carries no Pegasus tenant id. Stamping at the source makes the cloud pure routing — no mapping table, no drift, no unmapped-source failure mode. |
| Ingest migration     | **Switch relay to `events:PutEvents` now**, retire SNS FIFO | Cleanest end state. The on-prem relay + Roles Anywhere are touched once (swap IAM action + endpoint), then the redundant FIFO topic/queue/consumer go away.                         |

## The event contract (relay ⇄ cloud)

What the on-prem relay must `PutEvents`, and what every cloud consumer relies on:

```jsonc
{
  "EventBusName": "pegasus-{env}-integration-events",
  "Source": "pegii.movemanager", // stable; rules match on this
  "DetailType": "Shipment.Opened", // == AsyncAPI catalogue message name, 1:1
  "Detail": {
    "tenantId": "<pegasus tenant cuid>", // stamped from relay appsettings (per-site)
    "eventId": "<legacy dbo.Outbox row id>", // idempotency key — EB is at-least-once
    "schemaVersion": 1,
    "occurredAt": "2026-06-24T...Z",
    "payload": {
      "code": "...",
      "projectId": 0,
      "eticket": 0,
      "shippedTo": "...",
      "carrier": "...",
      "driver": "...",
      "status": "...",
    },
  },
}
```

- Catalogue source of truth: `GET /api/v1/pegii/events/catalogue` on the pegII API
  (dolab-m70q-1:65274). Currently `Shipment.Opened` / `Shipment.Closed`; the
  registry is expected to grow (more aggregates than Shipment).
- Rules stay **coarse**: route all `source: pegii.*` → mapper. All _fine_ filtering
  stays in the existing v2 `WorkflowTrigger.filter` model on the resulting
  `DomainEvent` — we do not duplicate filter logic into EB rules.
- `DomainEvent.eventType` is derived from `DetailType`:
  `Shipment.Opened` → `pegii.shipment.opened`.

## Cloud side (this repo)

| #   | Unit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | **EB bus + archive.** Custom `EventBus` `pegasus-{env}-integration-events`, CMK-encrypted (payloads carry `shippedTo`/`driver`), Archive on (replay). Lives in `OutboxRelayStack` so unit 3's IAM swap needs no cross-stack ref. Purely additive — cannot affect the live SNS path.                                                                                                                                                                                                                                                                  | **done (local)** |
| 2   | **Route → buffer.** EB Rule (`source: pegii.*` prefix) → SQS standard buffer + DLQ. _Not_ EB→Lambda direct: the accounts cap Lambda at **10 concurrent execs**, so buffer + (unit-4) reserved concurrency to avoid starving the fleet. Buffer has no consumer yet — fills until the unit-4 mapper drains it.                                                                                                                                                                                                                                         | **done (local)** |
| 3   | **Roles Anywhere IAM grant.** On `RelayPublishRole`: add `events:PutEvents` on the bus ARN **additively** (keep `sns:Publish` until unit 6 so the cutover doesn't race the deploy). Bus reuses `outboxKey`, so the existing `PublishKms` grant already covers the CMK. SSM leaf-pull + renewal unchanged.                                                                                                                                                                                                                                            | **done (local)** |
| 4   | **Mapper Lambda.** NEW `lambda-integration-event-map.ts` (parallel to the SNS consumer, which stays live until unit 6): validate `tenantId` is a real/ACTIVE tenant (else → DLQ), idempotent + cutover-safe via the `shipment_event_inbox` ledger (create-if-absent + conditional `updateMany(dispatchedAt:null)` dispatch claim), then emit a tenant-scoped `DomainEvent` (`pegii.shipment.opened`). Existing dispatcher → `matchesFilter` → `workflow.start` fires with **zero new trigger code**. Capped at `maxConcurrency 2` (10-slot account). | **done (local)** |
| 5   | **Register `pegii.*` as built-in integration event types.** New `INTEGRATION_EVENT_TYPES` set (api `lib/domain-events.ts` + mirrored in tenant-web) accepted by trigger validation alongside `DOMAIN_EVENT_TYPES` — globally triggerable, no per-tenant seeding. The `pegii.` namespace is reserved in the custom-event registry. Workflows UI picker shows an "Integration (pegII)" optgroup. **Required, not UX:** trigger-create rejects unknown event types, so without this no tenant could trigger on `pegii.*`.                               | **done (local)** |
| 6   | **Retire SNS.** Relay confirmed live on EventBridge (staging + prod), so the SNS path is removed: SNS FIFO topic + queue + DLQ + subscription + the shipment-event consumer Lambda (`lambda-shipment-event-consume.ts` deleted) + the `sns:Publish` grant. KMS key + `shipment_event_inbox` table stay (the bus + mapper use them). The 3 SNS-era CloudWatch alarms are replaced by 2 integration-buffer alarms (DLQ depth + oldest-age). EventBridge is now the only path.                                                                          | **done (local)** |

## pegII side (separate .NET repo — owner: Steve)

- **appsettings:** add `PegasusTenantId`, `EventBusName`, `Region`.
- **Publish swap:** `SNS Publish` → `EventBridge PutEvents`, mapping each `dbo.Outbox`
  row to the envelope above (stamp `tenantId` + `eventId`). The Roles Anywhere
  credential helper already installed keeps working — only the IAM action changes.
- Optional: update the catalogue endpoint's `description` (it still says "SNS topic
  the outbox relay publishes to").

## Cutover order (non-breaking, even though SNS is retired)

1. Deploy cloud units 1–5 → bus live + accepting events, nothing publishes yet.
2. Flip the relay to `PutEvents` on **staging (dolios)** → verify a `Shipment.Opened`
   lands as a `DomainEvent` and triggers a test workflow.
3. Then the **prod** relay.
4. **Only then** deploy unit 6 (delete SNS). Never delete the topic while anything
   still publishes to it.

## Gotchas being designed around

- **Lambda concurrency cap = 10** (both accounts) → EB→SQS→Lambda with reserved
  concurrency, never EB→Lambda direct.
- **At-least-once** → dedupe on `eventId`; consumers idempotent by construction.
- **Unknown/disabled `tenantId`** → DLQ + alarm, never silently drop.
- **CMK on bus + archive** — payloads carry light PII (`shippedTo`, `driver`).
- **Catalogue text** still says "SNS" — update after cutover so the published source
  of truth matches reality.
