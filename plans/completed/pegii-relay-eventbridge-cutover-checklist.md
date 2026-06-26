# pegII Outbox Relay → EventBridge: contract + cutover checklist

Handoff for the **on-prem `Pegasus.Outbox.Relay`** (separate .NET repo). The
cloud side (units 1–5 of `pegii-eventbridge-integration.md`) is built and the
relay's IAM identity is already granted `events:PutEvents`. This doc is the spec
the relay must satisfy and the step-by-step cutover.

> **One-line summary:** change the relay's publish target from
> `SNS:Publish` to `EventBridge:PutEvents`, stamp the Pegasus `tenantId`, and
> verify on staging before prod. No new credentials — the existing Roles Anywhere
> identity already carries the grant.

---

## 1. The event contract (what the relay must `PutEvents`)

One `PutEventsRequestEntry` per `dbo.Outbox` row:

```jsonc
{
  "EventBusName": "pegasus-{env}-integration-events", // staging | prod
  "Source": "pegii.movemanager", // stable; the cloud rule matches source: pegii.*
  "DetailType": "Shipment.Opened", // == AsyncAPI catalogue message name, 1:1
  "Detail": "<stringified JSON, see below>", // PutEvents Detail is a STRING
}
```

`Detail` (JSON-stringified) — every field is required:

```jsonc
{
  "tenantId": "<pegasus tenant cuid>", // NEW — from appsettings (this site's Pegasus tenant)
  "eventId": "<dbo.Outbox row id/GUID>", // idempotency key — cloud dedupes on it
  "schemaVersion": 1,
  "occurredAt": "2026-06-24T12:00:00Z", // ISO-8601 (the Outbox OccurredAtUtc)
  "payload": {
    /* the existing event body, unchanged */
  },
}
```

Notes:

- **`Source` and `DetailType` are top-level EventBridge fields**, not inside `Detail`.
  The cloud rule routes on `Source` (prefix `pegii.`); the mapper derives the
  workflow event type from `DetailType` (`Shipment.Opened` → `pegii.shipment.opened`).
- **`tenantId` is the one genuinely new field.** It is stamped per-site from
  config, NOT looked up. Get it wrong and the event dead-letters (the mapper
  rejects unknown/inactive tenants).
- **`eventId` must be stable** for a given Outbox row across retries — it is the
  at-least-once dedupe key. Reuse the Outbox row's GUID.
- The `payload` shape is unchanged from today's SNS message body.
- Catalogue stays the source of truth: `GET /api/v1/pegii/events/catalogue`
  (dolab-m70q-1:65274). New event types = new `DetailType`s; the cloud rule is
  coarse so it needs no change, but the cloud `INTEGRATION_EVENT_TYPES` list
  (apps/api `lib/domain-events.ts`) must add the derived name to make it
  triggerable — keep them in lockstep.

---

## 2. Relay code changes

- [ ] **appsettings.json** — add:
  - `Pegasus:TenantId` — this site's Pegasus tenant cuid (ask the platform team
    for the staging-site and prod-site ids).
  - `Pegasus:EventBusName` — `pegasus-staging-integration-events` (staging) /
    `pegasus-prod-integration-events` (prod).
  - `Pegasus:Region` — the bus region (same region as the topic today).
  - Keep the existing `TopicArn` for now (dual-publish is not required; just don't
    delete it until cutover is confirmed — see §4).
- [ ] **Publish path** — replace the SNS `PublishRequest` with an EventBridge
      `PutEventsRequest` built from the contract above. One entry per Outbox row;
      `PutEvents` accepts up to 10 entries per call, so batch the drain loop in 10s.
- [ ] **Stamp `tenantId` + `eventId`** into `Detail` from config + the Outbox row.
- [ ] **Error handling** — treat a `PutEvents` response with
      `FailedEntryCount > 0` like a publish failure: leave those Outbox rows
      un-acked (Status stays pending) so the next drain retries. Per-entry
      `ErrorCode`/`ErrorMessage` are in the response `Entries`.
- [ ] **AWS SDK** — `AWSSDK.EventBridge` (or the unified SDK's EventBridge client).
      Credentials come from the **same Roles Anywhere profile** already wired (the
      `aws_signing_helper` credential process in the relay's AWS profile) — no change.

> IAM is already done cloud-side: the relay role has `events:PutEvents` on the bus
> ARN **and** retains `sns:Publish` during the transition (Pegasus unit 3). The
> bus reuses the same CMK as the topic, so the existing KMS grant covers it. No
> new trust anchor / leaf cert / profile.

---

## 3. Pre-cutover verification (staging / dolios)

Do this on the **staging** site first.

- [ ] Confirm the bus exists: in the Pegasus staging AWS account,
      `aws events describe-event-bus --name pegasus-staging-integration-events`.
- [ ] Point the relay at staging config (TenantId = staging-site tenant, bus name,
      region) and start it against a test `dbo.Outbox` row (insert a synthetic
      `Shipment.Opened`).
- [ ] **Verify the chain:**
  1. EventBridge → the rule → the buffer queue
     (`pegasus-staging-integration-events-buffer`) shows traffic
     (CloudWatch `AWS/SQS NumberOfMessagesSent`), DLQ stays empty.
  2. The mapper Lambda (`...IntegrationEventMapFunction`) logs
     `integration event mapped to domain event` with the right `tenantId`/`eventType`.
  3. A `domain_events` row exists for the staging tenant with
     `event_type = 'pegii.shipment.opened'`.
  4. (End-to-end) create a workflow trigger on `pegii.shipment.opened` for the
     staging tenant (Workflows UI → trigger picker → "Integration (pegII)") and
     confirm a run starts.
- [ ] **Bad-tenant check:** publish one event with a wrong `tenantId` → it should
      land in the buffer DLQ (not silently vanish) and fire the DLQ alarm.

---

## 4. Cutover order (matches the cloud plan)

1. ✅ Cloud units 1–5 deployed (bus + archive + rule + buffer + mapper + IAM +
   event-type registration). **Done — pending this PR's deploy.**
2. [ ] Flip the **staging** relay to `PutEvents`; run §3 verification.
3. [ ] Flip the **prod** relay (prod TenantId + `pegasus-prod-integration-events`).
       Prod's Roles Anywhere CA must be committed first if not already
       (`packages/infra/config/outbox-relay/prod-ca.pem`) so the prod relay role —
       and its `events:PutEvents` grant — actually exists.
4. [ ] Only after both relays are confirmed live on EventBridge: tell the
       platform team to deploy **cloud unit 6** (retire the SNS topic + FIFO queue +
       DLQ + SNS consumer + `sns:Publish` grant). **Never delete the topic while any
       relay still publishes to it.**
5. [ ] Optional: update the catalogue endpoint's channel `description` (still says
       "FIFO SNS topic the outbox relay publishes to").

---

## 5. Rollback

Until cloud unit 6 runs, the SNS path is intact and the relay still holds
`sns:Publish`. If EventBridge publishing misbehaves, revert the relay's publish
target back to SNS (config/build) — no cloud change needed. Cloud unit 6 is the
point of no return, which is exactly why it is gated behind steps 2–3.
