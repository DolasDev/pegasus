# RingCentral `sms.received` workflow event

**Status:** complete · **Branch:** `feat/sms-received-event`

## Goal

When a text arrives on a tenant's RingCentral number, fire an event a workflow can
trigger on to parse the reply and run automation.

## Decisions

- **Built-in event `sms.received`** in `DOMAIN_EVENT_TYPES` (`noun.past_verb`, like
  `feedback.submitted`). Globally triggerable; also a legal `domainCondition` source.
- **Emitted in `captureMessage`'s transaction**, the one point the webhook and
  safety-net sync paths converge on.
- **Once per text:** first capture = the outbox `createMany({skipDuplicates})` count
  (ON CONFLICT DO NOTHING serializes a webhook/sync race). Not `upsert` (no
  create/update signal), not `create`+P2002 (aborts the Postgres tx).
- **INBOUND only**, and a thread entry with no explicit `direction` never emits, so a
  workflow's own `send_sms` reply can't loop.
- **ISync only:** FSync (first run, 90-day backfill, invalid-token fallback) re-reads
  history, so it doesn't replay.
- **Cross-store guard:** skip if an INBOUND twin (same numbers + body, ±60s) was already
  captured from the other RC store. Prod (2026-09-28) holds only `V1_STORE` rows — 181 inbound, 253 outbound, zero thread-store — so the guard is dormant today and kept as a safety net.
- **Payload is a snapshot incl. `body`**. There's no message read endpoint and bodies purge
  72h after forward. To keep the PII window, the buffer-purge cron nulls `payload.body`
  on dispatched `sms.received` events and on custom events derived from them, 72h after
  they occurred.

## Known gaps

- A text captured by the invalid-token FSync fallback doesn't emit (it's indistinguishable
  from history).
- `~/repos/pegasus-workflows/CLAUDE.md` (external authoring repo) isn't updated here.
- Nothing is published to PyPI (SDK change is docs-only; README/CHANGELOG/MCP updated).
