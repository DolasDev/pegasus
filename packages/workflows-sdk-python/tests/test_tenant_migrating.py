"""TenantMigrating (0.50.0): runs paused while a tenant's Automations move namespace."""

from __future__ import annotations

import httpx
import pytest

from pegasus_workflows.api import PegasusApiError, PegasusClient, TenantMigrating

_MIGRATING = {
    "error": "Automations for this account are being moved to their own isolated runtime.",
    "code": "TENANT_MIGRATING",
}


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )


def _migrating(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(409, json=_MIGRATING, headers={"Retry-After": "60"})


def test_run_workflow_raises_tenant_migrating_with_retry_after() -> None:
    with pytest.raises(TenantMigrating) as err:
        _client_with(_migrating).run_workflow("wf-1", {"a": 1})
    assert (err.value.status_code, err.value.code) == (409, "TENANT_MIGRATING")
    assert err.value.retry_after_seconds == 60
    assert "isolated runtime" in (err.value.message or "")
    # A subclass, so existing `except PegasusApiError` handlers still catch it.
    assert isinstance(err.value, PegasusApiError)


def test_retry_execution_raises_tenant_migrating() -> None:
    with pytest.raises(TenantMigrating):
        _client_with(_migrating).retry_execution("wf-1", "exec-1")


def test_missing_retry_after_is_none() -> None:
    client = _client_with(lambda r: httpx.Response(409, json=_MIGRATING))
    with pytest.raises(TenantMigrating) as err:
        client.run_workflow("wf-1")
    assert err.value.retry_after_seconds is None


def test_other_409s_stay_plain_pegasus_api_errors() -> None:
    body = {"error": "Execution is not retryable", "code": "EXECUTION_NOT_RETRYABLE"}
    client = _client_with(lambda r: httpx.Response(409, json=body))
    with pytest.raises(PegasusApiError) as err:
        client.retry_execution("wf-1", "exec-1")
    assert not isinstance(err.value, TenantMigrating)


def test_tenant_migrating_is_exported_from_the_package() -> None:
    import pegasus_workflows

    assert pegasus_workflows.TenantMigrating is TenantMigrating
    assert "TenantMigrating" in pegasus_workflows.__all__
