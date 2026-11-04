"""TenantNamespaceProvisioning / TenantNamespaceUnavailable (0.55.0).

Every tenant's Automations run in their own Temporal namespace; until it is
ready a run is refused with a typed error.
"""

from __future__ import annotations

import httpx
import pytest

from pegasus_workflows.api import (
    PegasusApiError,
    PegasusClient,
    TenantMigrating,
    TenantNamespaceProvisioning,
    TenantNamespaceUnavailable,
)
from pegasus_workflows.cli.push import _echo_namespace_status

_PROVISIONING = {
    "error": "Automations for this account are getting their own isolated runtime.",
    "code": "TENANT_NAMESPACE_PROVISIONING",
}
_UNAVAILABLE = {
    "error": "This account's isolated Automation runtime is unavailable right now.",
    "code": "TENANT_NAMESPACE_UNAVAILABLE",
}


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )


def _provisioning(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(409, json=_PROVISIONING, headers={"Retry-After": "60"})


def test_run_workflow_raises_provisioning_with_retry_after() -> None:
    with pytest.raises(TenantNamespaceProvisioning) as err:
        _client_with(_provisioning).run_workflow("wf-1", {"a": 1})
    assert (err.value.status_code, err.value.code) == (409, "TENANT_NAMESPACE_PROVISIONING")
    assert err.value.retry_after_seconds == 60
    assert isinstance(err.value, PegasusApiError)
    # A sibling of TenantMigrating, not a subclass.
    assert not isinstance(err.value, TenantMigrating)


def test_retry_execution_raises_provisioning() -> None:
    with pytest.raises(TenantNamespaceProvisioning):
        _client_with(_provisioning).retry_execution("wf-1", "exec-1")


def test_unavailable_is_a_503_typed_error() -> None:
    client = _client_with(lambda r: httpx.Response(503, json=_UNAVAILABLE))
    with pytest.raises(TenantNamespaceUnavailable) as err:
        client.run_workflow("wf-1")
    assert (err.value.status_code, err.value.code) == (503, "TENANT_NAMESPACE_UNAVAILABLE")
    with pytest.raises(TenantNamespaceUnavailable):
        client.retry_execution("wf-1", "exec-1")


def test_a_code_on_the_wrong_status_stays_a_plain_error() -> None:
    client = _client_with(lambda r: httpx.Response(503, json=_PROVISIONING))
    with pytest.raises(PegasusApiError) as err:
        client.run_workflow("wf-1")
    assert not isinstance(err.value, TenantNamespaceProvisioning)


def test_both_are_exported_from_the_package() -> None:
    import pegasus_workflows

    assert pegasus_workflows.TenantNamespaceProvisioning is TenantNamespaceProvisioning
    assert pegasus_workflows.TenantNamespaceUnavailable is TenantNamespaceUnavailable
    assert {"TenantNamespaceProvisioning", "TenantNamespaceUnavailable"} <= set(
        pegasus_workflows.__all__
    )


@pytest.mark.parametrize(
    ("namespace", "expected"),
    [
        (None, ""),
        ({"status": "ACTIVE", "ready": True}, ""),
        ({"status": "PROVISIONING", "ready": False}, "being set up (status PROVISIONING)"),
        ({"status": "FAILED", "ready": False}, "failed to provision"),
    ],
)
def test_push_reports_the_namespace_status(namespace, expected, capsys) -> None:
    _echo_namespace_status(namespace)
    captured = capsys.readouterr()
    out = captured.out + captured.err
    if expected:
        assert expected in out
    else:
        assert out == ""
