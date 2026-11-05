"""Durable Workflows on the client side (0.56.0, Phase 3c).

A ``kind = "workflow"`` version published moments ago isn't ready to start
until its worker comes up; the run is refused with a typed, retryable error.
"""

from __future__ import annotations

import httpx
import pytest

import pegasus_workflows
from pegasus_workflows.api import (
    PegasusApiError,
    PegasusClient,
    TenantNamespaceProvisioning,
    WorkflowVersionStarting,
)

_STARTING = {
    "error": 'Workflow "lifecycle" was just published and its worker is still starting up.',
    "code": "WORKFLOW_VERSION_STARTING",
}


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )


def _starting(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(409, json=_STARTING, headers={"Retry-After": "30"})


def test_run_workflow_raises_version_starting_with_retry_after() -> None:
    with pytest.raises(WorkflowVersionStarting) as err:
        _client_with(_starting).run_workflow("wf-1")
    assert (err.value.status_code, err.value.code) == (409, "WORKFLOW_VERSION_STARTING")
    assert err.value.retry_after_seconds == 30
    assert isinstance(err.value, PegasusApiError)
    assert not isinstance(err.value, TenantNamespaceProvisioning)


def test_retry_execution_raises_version_starting() -> None:
    with pytest.raises(WorkflowVersionStarting):
        _client_with(_starting).retry_execution("wf-1", "exec-1")


def test_open_workflow_limit_is_a_plain_api_error() -> None:
    client = _client_with(
        lambda r: httpx.Response(429, json={"error": "limit", "code": "OPEN_WORKFLOW_LIMIT"})
    )
    with pytest.raises(PegasusApiError) as err:
        client.run_workflow("wf-1")
    assert (err.value.status_code, err.value.code) == (429, "OPEN_WORKFLOW_LIMIT")


def test_exported_lazily_from_the_package() -> None:
    assert pegasus_workflows.WorkflowVersionStarting is WorkflowVersionStarting
    assert "WorkflowVersionStarting" in pegasus_workflows.__all__
