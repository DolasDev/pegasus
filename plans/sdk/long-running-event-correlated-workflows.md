# SDK spec — Long-running, event-correlated workflows (deliver domain events to a running execution; lift the 900s ceiling)

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0008-long-running-event-correlated-workflows.md`
- **Status:** Proposed
- **Filed:** 2026-06-29
- **SDK version when filed:** 0.6.0
- **SDK version that addresses it:** <!-- fill in when shipped -->
- **Area:** authoring API | PegasusClient | manifest | docs (platform behavior)

## Problem

Authoring `nw/order_lifecycle` — "start when an order is **booked**, end when it
is **completed**, and when an **actual packing date** is set close the
date-confirmation task" — surfaced that the platform has **no way to model a
single workflow that spans more than one domain event.**

Two concrete gaps:

1. **No domain-event delivery to a _running_ execution.** The platform model is
   "an EVENT trigger starts a _fresh_ execution per domain event"
   (`platform/send_order_saved_sms`, and the input-contract guide:
   `pegasus://guide/input-contract`). There is no documented mechanism — and
   nothing in `PegasusClient` or the authoring surface — to route a _later_
   domain event (`packing.actual_date_set`, `order.completed`) into an
   already-running execution correlated by some business key (here, the order
   id). `grep -rniE "signal|wait_condition" .venv/.../pegasus_workflows` returns
   only an unrelated `task_queue` hit in `cli/test.py`.

2. **900s execution-duration ceiling.** The manifest's `timeout_seconds` is
   "1–900, may only **lower** the 900s platform default, never raise it"
   (`CLAUDE.md` → Manifest rules). An order lifecycle (booked → completed) spans
   **days to weeks**, so even if events could be routed in, the execution would
   be killed long before `order.completed` arrives.

Temporal — which the SDK re-exports (`from pegasus_workflows import workflow`)
— already has the primitives for this: `@workflow.signal`, `@workflow.query`,
and `workflow.wait_condition`. `order_lifecycle` is authored against exactly
those (signals `packing.actual_date_set` / `order.completed`, a `status` query,
a `wait_condition` run loop) and registers cleanly. What is missing is the
**platform glue**: the dispatcher signaling the right running execution, and a
duration ceiling that permits a lifecycle-length run.

## Why it matters

"Lifecycle" workflows are a core class of automation for a moving company —
order booked → surveyed → packed → delivered → completed; quote → follow-ups →
won/lost; invoice → reminders → paid. Every one of them needs a stateful process
that reacts to several events over a long window. Today none are authorable:

- Decomposing into one-shot per-event workflows forces lifecycle state into
  projections/events and loses the natural "wait until X" control flow, the
  exactly-once guarantees, and the single queryable execution per order.
- The 900s ceiling rules out the long-lived approach regardless.

`nw/order_lifecycle` is **authored but unpublishable** until this lands; it is
the blocking dependency for the whole tenant's order automation.

## Proposed change

1. **Signal-routing trigger.** Let an EVENT trigger be configured to **signal an
   existing execution** instead of starting a new one, correlated by a business
   key extracted from the event payload (e.g. `payload.orderId`). The platform
   delivers the event envelope as the **signal argument**, using the **event
   type as the signal name** — so the author's `@workflow.signal(name="order.completed")`
   handler receives it. Authoring stays pure Temporal:

   ```python
   @workflow.signal(name="packing.actual_date_set")
   async def on_packing_actual_date_set(self, envelope: dict) -> None:
       self._packing_actual_date = envelope["payload"]["packingActualDate"]

   @workflow.run
   async def run(self, arg):
       order_id = resolve_order_id(arg)              # from the order.booked envelope
       await workflow.wait_condition(lambda: self._order_completed)
   ```

   Correlation config lives platform-side (trigger binding), not in the
   manifest — but the manifest may need to **declare the signals a workflow
   accepts** so the binding can be validated at publish time. If so, add an
   optional `accepts_signals = ["packing.actual_date_set", "order.completed"]`
   manifest field.

2. **Lift the duration ceiling for lifecycle workflows.** Allow
   `timeout_seconds` to exceed 900 (or accept `timeout_seconds = 0` / a
   `long_running = true` flag meaning "no execution timeout"), so a run can
   legitimately wait weeks for `order.completed`. Document the new ceiling.

3. **Docs:** a new `pegasus://guide/...` resource (and `CLAUDE.md` section) for
   the long-running / signal-correlated pattern, with `order_lifecycle` as the
   worked example.

Backward-compatible: existing one-shot EVENT triggers and the 900s default are
unchanged; this is additive (a new trigger mode + a raised/again-optional cap).

## Acceptance criteria

- [ ] A published workflow can be bound so that a domain event **signals a
      running execution** correlated by a payload key, delivering the envelope
      to the matching `@workflow.signal(name=<eventType>)` handler. Verified by:
      publish `order_lifecycle`, fire `order.booked` (starts it), then fire
      `packing.actual_date_set` and confirm the _same_ execution received the
      signal (via `executions` / the `status` query) — not a new execution.
- [ ] Firing `order.completed` for that order id causes the running execution to
      complete and return its lifecycle summary.
- [ ] A workflow execution can remain open well beyond 900s (test: a run that
      stays open ≥ 20 min, or whatever proves the cap is lifted) without being
      terminated for timeout, when configured long-running.
- [ ] The manifest validates with whatever new fields the design needs
      (`accepts_signals` and/or a long-running flag), and `package` accepts them.
- [ ] An MCP resource / `CLAUDE.md` section documents the pattern, referencing
      `nw/order_lifecycle`.

## Validation log

<!-- Filled in during step 4 of the feedback loop (in the pegasus-workflows
repo). Plan: publish nw/order_lifecycle to QA, drive the order.booked →
packing.actual_date_set → order.completed sequence against one order id, and
confirm a single long-lived execution handled all three. -->
