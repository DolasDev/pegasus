# Signal delivery — post-merge follow-ups (PR 2, event-routed signals)

- **Status:** DONE 2026-11-11 — released, documented, staging acceptance ALL
  PASS (log below). Archived.
- **Plan:** `plans/completed/f5d5a31f-workflow-signal-delivery.md` (archived with
  PR 2 #944; decisions 13-17 cover what changed while building it).

## Checklist

- [x] **After PR 2 merges and its Deploy succeeds (staging + prod):** tag
      `sdk-python-v0.61.0` on the REAL merge commit. Done 2026-11-10: #944 →
      `c7ddce47`, Deploy staging + prod SUCCESS (migration applied on both),
      tag pushed, Release SDK run 42915531400 green, PyPI latest = 0.61.0.
- [x] **Authoring repo** `~/repos/pegasus-workflows/CLAUDE.md`: event-routed
      signals documented under the `signals` bullet — `c8d4aec` (only that hunk;
      another session's uncommitted edit left untouched).
- [x] **Staging acceptance on AVP Smoke** — ALL PASS 2026-11-11 (log below).
- [x] Archive this file.

## Acceptance log (staging AVP Smoke, 2026-11-11)

**Deviation from the recipe — custom events are OFF on staging:** `POST
/api/v1/event-types` answers 404 "Custom events are not enabled" (the
platform-wide `isCustomEventsEnabled()` master switch), so no custom event type
could be registered. Driven instead with the built-in `pegasus_event.received`:
`POST /api/v1/events` (the avp-smoke key holds `CreateEvent`) emits it with
`payload {pegasusEventId, eventType, eventPublisher}` copied from the body. The
business key rode in `eventType` (`correlationPath = "payload.eventType"`) and
each trigger filtered on `eventPublisher` (`accept-sig-start` /
`accept-sig-deliver`), which also kept real events away from them. No
`accept_emit` Automation was needed.

Scratch project (session scratchpad): durable `accept_route@0.1.0`
(`5fc6ff8a-0c4f-4803-be25-4bc9677f79a0`, `signals = ["order_event"]`, records
each event once by `domainEventId`, ends on `payload.status == "done"`, ≤ 2 h);
`accept_emit@0.1.0` (`9dd75976-…`, published, unused). Triggers: START
`26664be7-…`, DELIVER `1503d61f-…`. Tenant `4b2e0267-c597-451e-a367-771dfac52fba`.

- **(3) START creates one instance per key — PASS.** 18:59:47Z emit `A1` →
  19:00:05Z execution `7d8f5489-c932-4f02-bcc2-5f92c290ea48` RUNNING, source
  EVENT, `temporalWorkflowId = wfl/4b2e0267-…/accept_route/A1`, input = the
  envelope. Timeline: `WorkflowExecutionStarted` then
  `WorkflowExecutionSignaled signal: order_event` in the SAME event batch
  (signal-with-start), first workflow task 0.3 s later on the pinned worker —
  so signal-with-start + `versioningOverride` + REJECT_DUPLICATE work on
  Temporal Cloud. 19:00:37Z second `A1` → signalled the same instance at
  19:01:03Z, still ONE row. Logs: "started its Workflow instance" 19:00:05,
  "delivered" 19:01:03.
- **(4) DELIVER, unknown key — PASS.** 19:01:59Z emit `B9` → no row (checked
  19:03:32Z); log 19:02:03 "not delivered" `reason NO_OPEN_INSTANCE`,
  `wfl/…/B9`. Metrics 19:00 bucket: `SignalDelivered` = 2,
  `SignalDeliveryFailed{Reason=NO_OPEN_INSTANCE}` = 1.
- **(5) Kill switch ON (Steve) — PASS.** 19:07Z manual run → 423
  `WORKFLOWS_DISABLED`. 19:07:09Z `A1` (open) → **delivered** to `7d8f5489`;
  19:07:10Z NEW key `C1` → "not delivered" `reason WORKFLOWS_DISABLED`, no row.
- **Instance end + closed key — PASS.** 19:08:45Z direct signal (`executions
signal --name order_event --payload {domainEventId: manual-done, payload:
{status: done}}`, switch still ON) → row COMPLETED by 19:09:52Z (reconciler
  closes `wfl/` rows like any durable row), result `{outcome: done, events: [3
routed ids + manual-done], statuses: [None, None, None, done], startEventId =
the first event's id}` — the START event was both input and first signal and
  was recorded once. Switch OFF (Steve). 19:13:13Z `A1` again → Temporal
  REJECT_DUPLICATE → "not delivered" `reason INSTANCE_CLOSED`; the inserted
  row `32c23f1f-…` was DELETED (GET → 404), still one row — no stranded key.
  Reaching Temporal also proved the switch was OFF.
- **Cleanup:** both triggers deleted; `accept_route` and `accept_emit` retired;
  kill switch OFF.

All three "verify on real Temporal" items from #944 are now observed:
signal-with-start with pinning, `describe().memo` read-back (a NEW instance was
correctly kept, not deleted as SIGNALLED_EXISTING), and a `wfl/` row closing
through the reconciler.
