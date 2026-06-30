# SDK spec — Task lifecycle API (`close_task`) and order domain reads on PegasusClient

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0009-task-lifecycle-and-order-reads.md`
- **Status:** Proposed
- **Filed:** 2026-06-29
- **SDK version when filed:** 0.6.0
- **SDK version that addresses it:** <!-- fill in when shipped -->
- **Area:** PegasusClient | docs

## Problem

`nw/order_lifecycle` needs to **close the order's "date confirmation" task** when
the actual packing date is set. There is **no task surface on `PegasusClient`**
as of 0.6.0. The domain reads are `list_customers`, `list_quotes`, `list_moves`,
`list_inventory`, `list_invoices`, `list_events`; the writes are `emit_event`,
`send_sms`, the integration-config methods, and secrets/config/projections.
There is:

- **No task API** — no way to list, read, create, complete, or **close** a task.
- **No order domain read** — there is no `list_orders` / `get_order`. "Order"
  appears only as an _example_ `entity_type` string in the generic projection
  docstrings (`api.py` ~L803–855), i.e. an external record key, not a
  first-class domain entity the way `moves`/`quotes` are.

Because of the missing task API, the side effect at the heart of the workflow
cannot be performed. `close_date_confirmation_task` currently ships as a **stub**
that returns a marker dict and does nothing — the same pattern `send_sms` used
before `sms-notification-and-secrets` (origin `sdk-feedback/0002`) shipped the
real primitive:

```python
@activity.defn
async def close_date_confirmation_task(order_id: str, packing_date: str) -> dict:
    # STUB — no task API yet (this spec). Intended real body below.
    return {"stub": True, "action": "close_date_confirmation_task",
            "orderId": order_id, "packingDate": packing_date}
```

The manifest declares `required_actions = ["ReadOrder", "CloseTask"]` to express
intent, but neither Cedar action nor its backing method exists, so the workflow
cannot be granted them or run for real.

## Why it matters

Tasks are the unit of human work in the moving ops flow (date confirmation,
survey scheduling, paperwork, QA sign-off). Any workflow whose job is to
**advance or close out operational tasks** in response to events is blocked
without a task API — `order_lifecycle` is the first, and "close task X when
event Y happens" is a pattern that will recur across every tenant. Re-fetching
authoritative order state (the input contract says the event payload is a
_pointer_, re-fetch via the API) is likewise impossible without an order read.

There is no acceptable workaround: `emit_event` can fire a custom event but
cannot mutate a task, and projections are integration-scoped KV state, not the
tenant's task records.

## Proposed change

Add to `PegasusClient` (for use inside activities; gated by manifest
`required_actions`):

```python
# Order reads (gated by ReadOrder)
client.get_order(order_id: str) -> dict          # GET /api/v1/orders/{id}
client.list_orders(**params) -> list[dict]       # GET /api/v1/orders

# Task lifecycle (reads gated by ReadTask; close gated by CloseTask)
client.list_tasks(order_id: str | None = None, **params) -> list[dict]
client.get_task(task_id: str) -> dict
client.close_task(
    *, order_id: str, task_type: str, reason: str | None = None
) -> dict
```

`close_task` should be **idempotent** (closing an already-closed task is a
no-op success, not an error), since a long-running workflow may retry the
activity. Identifying a task by `(order_id, task_type)` avoids the workflow
having to first list tasks to find an id; alternatively/additionally support
`close_task(task_id=...)`. Errors mirror the existing convention: `PegasusApiError`
on 403 (action not declared), 404 (no such order/task).

These auto-surface in the `pegasus://reference/api` MCP resource (it introspects
`PegasusClient`), so no separate doc wiring is needed beyond docstrings.

Backward-compatible: purely additive methods + new Cedar actions.

## Acceptance criteria

- [ ] `PegasusClient` exposes `get_order`, `list_orders`, `list_tasks`,
      `get_task`, and `close_task` with the signatures above (or close
      equivalents), each documented.
- [ ] `close_task` closes the matching task and is **idempotent** — a second
      call for an already-closed task returns success, not an error. Verified by
      a real call against a QA tenant: close once (task transitions to closed),
      close again (still success).
- [ ] The actions are real Cedar action ids: a workflow declaring
      `required_actions = ["CloseTask"]` is granted the capability; calling
      `close_task` **without** declaring it raises `PegasusApiError` (403).
- [ ] `nw/order_lifecycle`'s `close_date_confirmation_task` activity is
      un-stubbed to call `client.close_task(order_id=..., task_type="date_confirmation", ...)`,
      and a live run (per the long-running-event-correlated-workflows spec,
      origin `sdk-feedback/0008`) shows the date-confirmation task closed after
      `packing.actual_date_set`.
- [ ] The new methods appear in the `pegasus://reference/api` MCP resource.

## Validation log

<!-- Filled in during step 4 of the feedback loop (in the pegasus-workflows
repo). Plan: against a QA tenant with an order that has an open
date-confirmation task, call close_task and confirm the task closes (and is
idempotent), then un-stub the activity and re-run the order_lifecycle sequence. -->
