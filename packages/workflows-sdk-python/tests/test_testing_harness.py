"""Tests for ``pegasus_workflows.testing`` — the offline activity harness.

These exercise the real activity bodies (via Temporal's ``ActivityEnvironment``)
against a fake client, proving reads pass through, mutations are captured (never
performed), and the ``if client is None`` stub branch is retired.
"""

from __future__ import annotations

import asyncio
import inspect

import pytest

from pegasus_workflows import PegasusClient, activity
from pegasus_workflows.testing import (
    _IGNORED,
    _MUTATIONS,
    _READS,
    CaptureError,
    FakeClient,
    arun_activity,
    fake_client,
    run_activity,
)

# --- activities under test (mirror the consumer `_runtime_client()` pattern) ---


def _runtime_client() -> PegasusClient | None:
    try:
        return PegasusClient.from_runtime()
    except RuntimeError:
        return None


@activity.defn
async def fetch_and_notify(order_id: str) -> dict:
    """A real read + a real mutation, guarded by the legacy stub branch."""
    client = _runtime_client()
    if client is None:
        return {"stub": True}
    order = client.get_order(order_id)
    client.send_sms(to="+15551234567", body=f"order {order['orderNumber']} saved")
    return {"stub": False, "orderNumber": order["orderNumber"]}


@activity.defn
def close_it(order_id: str) -> dict:
    """A synchronous activity performing a single mutation."""
    client = PegasusClient.from_runtime()
    return client.close_task(order_id=order_id, task_type="date_confirmation")


@activity.defn
async def map_only(integration_id: str, order: dict) -> dict:
    """A benign mapping read — should capture nothing."""
    client = PegasusClient.from_runtime()
    return client.map_to_external(integration_id, order)


# --- reads ---------------------------------------------------------------------


def test_keyed_read_passthrough() -> None:
    client = fake_client(reads={"get_order": {"S-123": {"orderNumber": "S-123"}}})
    assert client.get_order("S-123") == {"orderNumber": "S-123"}
    assert client.captured == []


def test_whole_value_read_passthrough() -> None:
    rows = [{"id": "o1"}, {"id": "o2"}]
    client = fake_client(reads={"list_orders": rows})
    assert client.list_orders(status="open") == rows
    assert client.captured == []


def test_missing_fixture_raises() -> None:
    client = fake_client()
    with pytest.raises(CaptureError, match="no fixture for read 'get_order'"):
        client.get_order("S-1")


def test_missing_keyed_fixture_raises() -> None:
    client = fake_client(reads={"get_order": {"S-1": {}}})
    with pytest.raises(CaptureError, match="no fixture for get_order"):
        client.get_order("S-999")


def test_get_projection_absent_returns_none() -> None:
    # A missing projection fixture mirrors the real 404 -> None contract.
    client = fake_client()
    assert client.get_projection("demo_partner", "order", "S-1") is None


# --- mutations -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("call", "capability"),
    [
        (lambda c: c.send_sms(to="+1555", body="hi"), "SendSms"),
        (lambda c: c.emit_event("order.saved", {"id": 1}), "EmitTenantEvent"),
        (lambda c: c.close_task(order_id="S-1", task_type="t"), "CloseTask"),
        (lambda c: c.put_projection("i", "order", "S-1", {"x": 1}), "WriteIntegrationProjection"),
        (lambda c: c.delete_projection("i", "order", "S-1"), "WriteIntegrationProjection"),
        (lambda c: c.set_config("K", "v"), "ManageWorkflowConfigs"),
        (lambda c: c.set_secret("K", "v"), "ManageWorkflowSecrets"),
        (lambda c: c.deliver_to_external("demo_partner", {"x": 1}), "DeliverToExternal"),
    ],
)
def test_mutation_is_captured_not_performed(call, capability) -> None:
    client = fake_client()
    call(client)
    assert len(client.captured) == 1
    assert client.captured[0]["capability"] == capability


def test_capture_records_args_and_synthetic_return() -> None:
    client = fake_client()
    result = client.send_sms(to="+1555", body="hello")
    entry = client.captured[0]
    assert entry["method"] == "send_sms"
    assert entry["kwargs"] == {"to": "+1555", "body": "hello"}
    assert entry["would_return"] == result
    assert result["data"]["dryRun"] is True


def test_deliver_to_external_capture_shape() -> None:
    client = fake_client()
    result = client.deliver_to_external("demo_partner", {"orderNumber": "S-1"})
    assert result == {"delivered": False, "status": None, "response": None, "dryRun": True}
    assert client.captured[0]["capability"] == "DeliverToExternal"


def test_record_side_effect() -> None:
    client = fake_client()
    client.record_side_effect("raw_post", {"url": "https://partner/x"})
    assert client.captured[0]["capability"] == "custom"
    assert client.captured[0]["payload"] == {"url": "https://partner/x"}


def test_ignored_method_raises() -> None:
    client = fake_client()
    with pytest.raises(AttributeError, match="does not support 'run_workflow'"):
        client.run_workflow("wf-1")


def test_is_dry_run_true() -> None:
    assert fake_client().is_dry_run is True


# --- run_activity (real body via ActivityEnvironment) --------------------------


def test_run_activity_runs_real_body_not_stub() -> None:
    client = fake_client(reads={"get_order": {"S-9": {"orderNumber": "S-9"}}})
    result = run_activity(fetch_and_notify, "S-9", client=client)
    # The real body ran — not the `if client is None` stub branch.
    assert result == {"stub": False, "orderNumber": "S-9"}
    # The mutation was captured, not performed.
    assert [c["capability"] for c in client.captured] == ["SendSms"]
    assert client.captured[0]["kwargs"]["body"] == "order S-9 saved"


def test_run_activity_sync_activity() -> None:
    client = fake_client()
    result = run_activity(close_it, "S-1", client=client)
    assert result["status"] == "closed"
    assert client.captured[0]["capability"] == "CloseTask"


def test_run_activity_benign_read_captures_nothing() -> None:
    client = fake_client(reads={"map_to_external": {"demo_partner": {"external": {"a": 1}}}})
    body = run_activity(map_only, "demo_partner", {"orderNumber": "S-1"}, client=client)
    assert body == {"external": {"a": 1}}
    assert client.captured == []


def test_from_runtime_restored_after_run() -> None:
    # The patch is scoped to the call; outside it, from_runtime behaves normally.
    run_activity(close_it, "S-1", client=fake_client())
    with pytest.raises(RuntimeError):
        PegasusClient.from_runtime()


def test_arun_activity_coroutine() -> None:
    # arun_activity is the awaitable variant; drive it directly (the SDK test
    # suite has no pytest-asyncio plugin) to cover the async path.
    client = fake_client(reads={"get_order": {"S-2": {"orderNumber": "S-2"}}})
    result = asyncio.run(arun_activity(fetch_and_notify, "S-2", client=client))
    assert result["orderNumber"] == "S-2"


# --- anti-drift: every PegasusClient runtime method must be classified ---------


def test_classification_covers_every_client_method() -> None:
    public = {
        name
        for name, member in inspect.getmembers(PegasusClient, callable)
        if not name.startswith("_") and name != "from_runtime"
    }
    classified = set(_READS) | set(_MUTATIONS) | set(_IGNORED)
    missing = public - classified
    stale = classified - public
    assert not missing, f"PegasusClient methods not classified in testing harness: {missing}"
    assert not stale, f"testing harness classifies non-existent methods: {stale}"


def test_fake_client_is_fakeclient_instance() -> None:
    assert isinstance(fake_client(), FakeClient)
