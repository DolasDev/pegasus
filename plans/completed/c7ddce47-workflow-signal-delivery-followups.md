# Signal delivery — post-merge follow-ups (PR 2, event-routed signals)

- **Status:** TODO — release, docs in another repo, live acceptance.
- **Plan:** `plans/completed/<hash>-workflow-signal-delivery.md` (archived with
  PR 2; decisions 13-17 cover what changed while building it).
- **Branch:** none for the release/docs steps; a fix branch only if acceptance
  finds a defect.

## Checklist

- [ ] **After PR 2 merges and its Deploy succeeds (staging + prod):** tag
      `sdk-python-v0.61.0` on the REAL merge commit (`git show -s` it first —
      never tag main blindly) → the Release SDK workflow publishes it; confirm
      PyPI shows 0.61.0.
- [ ] **Authoring repo** `~/repos/pegasus-workflows/CLAUDE.md`: under the
      `signals` manifest bullet (which says "Event-routed delivery (triggers) is
      a later release"), document `create_trigger(..., mode="START" | "DELIVER",
correlation_path=..., signal_name=...)`, one instance per key for life,
      START's event = run input + first signal, dedupe on `domainEventId`.
      Commit ONLY that hunk (the file often carries others' uncommitted edits)
      and push.
- [ ] **Staging acceptance on AVP Smoke** (`--profile avp-smoke`; recipe in
      `plans/todo/durable-workflows-3c-followups.md` "How the acceptance was
      driven"). Scratch project in the session scratchpad: a durable Workflow
      declaring `signals = ["order_event"]` that records every event and ends on
      `payload.status == "done"` (≤ 2 h wait), plus a registered custom event
      type (`register_event_type`, e.g. `accept.order_event`).
  - [ ] (3) EVENT trigger `mode="START"`, `correlation_path="payload.orderId"`:
        emit `{orderId: "A1"}` → an instance `wfl/<tenant>/<name>/A1` and ONE
        row; emit `{orderId: "A1"}` again → same instance signalled, still one
        row; `SignalDelivered` = 2.
  - [ ] (4) a second trigger `mode="DELIVER"` on another event type (or switch
        the trigger): emit for an unknown key `B9` → no row,
        `SignalDeliveryFailed{Reason=NO_OPEN_INSTANCE}`.
  - [ ] (5) kill switch ON (Steve flips it in admin-web): emit for `A1` (open)
        → delivered; emit for a NEW key `C1` → no instance,
        `SignalDeliveryFailed{Reason=WORKFLOWS_DISABLED}`. Switch back OFF,
        verify with a run.
  - [ ] End the instance (`{status: "done"}`), confirm the row closes; emit
        `A1` again → `SignalDeliveryFailed{Reason=INSTANCE_CLOSED}` and NO
        stranded QUEUED row. Retire the scratch Workflow, delete the triggers.
  - Emitting: `client.emit_event(name, payload)` needs `EmitTenantEvent`,
    which `workflow_developer` (the avp-smoke CLI key's role) does NOT have —
    the runtime service account does. So publish a second scratch
    **Automation** `accept_emit` (`required_actions = ["EmitTenantEvent"]`)
    whose activity calls `PegasusClient.from_runtime().emit_event(
input["name"], input["payload"])`, and drive each emit with
    `pegasus-workflows run accept_emit@<v> --input '{"name": …, "payload":
{"orderId": "A1"}}'`. Fallback: insert a `DomainEvent` outbox row with
    `psql` (staging DB URL from the reconcile Lambda env) and wait ≤ 1 min.
    Metrics: CloudWatch `Pegasus/Workflows` `SignalDelivered` /
    `SignalDeliveryFailed`; dispatcher logs say "Event-routed signal …".
- [ ] When all of the above are done, archive this file.
