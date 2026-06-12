"""Executor end-to-end against REAL subprocesses (driver included).

The fixture workflow is dependency-free (plain class with an async ``run``)
so the child only needs the production sandbox env + the test interpreter —
exactly what the executor builds. The broker is a recording stub.
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path
from typing import Any

import pytest
from temporalio.exceptions import ApplicationError

from pegasus_tenant_runner.artifacts import PreparedWorkflow
from pegasus_tenant_runner.executor import TenantCodeExecutor

ECHO_WORKFLOW = textwrap.dedent(
    """
    import os

    class EchoWorkflow:
        async def run(self, payload):
            return {
                "echo": (payload or {}).get("input"),
                "token": os.environ.get("PEGASUS_RUNTIME_TOKEN"),
            }

    class BoomWorkflow:
        async def run(self, payload):
            raise ValueError("kaboom")

    class SleepyWorkflow:
        async def run(self, payload):
            import asyncio
            await asyncio.sleep(300)
    """
)


class StubBroker:
    def __init__(self) -> None:
        self.patches: list[dict[str, Any]] = []
        self.token_requests: list[str] = []

    def fetch_runtime_token(self, execution_id: str) -> str:
        self.token_requests.append(execution_id)
        return "vnd_stub_token"

    def patch_execution(
        self,
        execution_id: str,
        status: str,
        *,
        finished_at_iso: str,
        result: Any | None = None,
        error_message: str | None = None,
    ) -> None:
        self.patches.append(
            {
                "execution_id": execution_id,
                "status": status,
                "result": result,
                "error_message": error_message,
            }
        )


@pytest.fixture()
def prepared(tmp_path: Path) -> PreparedWorkflow:
    src = tmp_path / "src"
    src.mkdir()
    (src / "echo_wf.py").write_text(ECHO_WORKFLOW)
    scratch = tmp_path / "scratch"
    (scratch / "tmp").mkdir(parents=True)
    # The test interpreter stands in for the per-workflow venv python: what's
    # under test is the spawn/stdin/result protocol, not venv creation.
    return PreparedWorkflow(
        name="echo_wf",
        version="1.0.0",
        entry_point="echo_wf:EchoWorkflow",
        src_dir=src,
        python_bin=Path(sys.executable),
        scratch_dir=scratch,
    )


def _executor(
    broker: StubBroker,
    prepared: PreparedWorkflow,
    *,
    entry_point: str | None = None,
    timeout: int = 60,
) -> TenantCodeExecutor:
    if entry_point is not None:
        prepared = PreparedWorkflow(
            name=prepared.name,
            version=prepared.version,
            entry_point=entry_point,
            src_dir=prepared.src_dir,
            python_bin=prepared.python_bin,
            scratch_dir=prepared.scratch_dir,
        )
    return TenantCodeExecutor(
        broker=broker,  # type: ignore[arg-type]
        prepared={prepared.name: prepared},
        api_base_url="https://api.pegasus.invalid",
        execution_timeout_seconds=timeout,
        max_output_bytes=4096,
        max_result_bytes=1024 * 1024,
    )


async def test_happy_path_completes_and_patches(prepared: PreparedWorkflow) -> None:
    broker = StubBroker()
    executor = _executor(broker, prepared)
    result = await executor.run_entry_point(
        "echo_wf", {"executionId": "e1", "input": {"a": 1}}
    )
    assert result == {"echo": {"a": 1}, "token": "vnd_stub_token"}
    assert broker.token_requests == ["e1"]
    assert len(broker.patches) == 1
    assert broker.patches[0]["status"] == "COMPLETED"
    assert broker.patches[0]["result"] == result
    # Per-run scratch dir was cleaned up.
    assert list(prepared.scratch_dir.glob("run-*")) == []


async def test_tenant_failure_patches_failed_and_raises(
    prepared: PreparedWorkflow,
) -> None:
    broker = StubBroker()
    executor = _executor(broker, prepared, entry_point="echo_wf:BoomWorkflow")
    with pytest.raises(ApplicationError, match="kaboom"):
        await executor.run_entry_point("echo_wf", {"executionId": "e1"})
    assert broker.patches[0]["status"] == "FAILED"
    assert "kaboom" in broker.patches[0]["error_message"]


async def test_wall_clock_guard_kills_and_patches_timed_out(
    prepared: PreparedWorkflow,
) -> None:
    broker = StubBroker()
    executor = _executor(
        broker, prepared, entry_point="echo_wf:SleepyWorkflow", timeout=2
    )
    with pytest.raises(ApplicationError, match="wall-clock"):
        await executor.run_entry_point("echo_wf", {"executionId": "e1"})
    assert broker.patches[0]["status"] == "TIMED_OUT"


async def test_unknown_workflow_is_non_retryable(prepared: PreparedWorkflow) -> None:
    broker = StubBroker()
    executor = _executor(broker, prepared)
    with pytest.raises(ApplicationError, match="not prepared"):
        await executor.run_entry_point("other_wf", {"executionId": "e1"})
    assert broker.patches == []  # nothing to patch — no token fetched either
    assert broker.token_requests == []


async def test_broker_token_failure_patches_failed(prepared: PreparedWorkflow) -> None:
    class NoTokenBroker(StubBroker):
        def fetch_runtime_token(self, execution_id: str) -> str:
            from pegasus_tenant_runner.broker_client import BrokerError

            raise BrokerError("HTTP 404")

    broker = NoTokenBroker()
    executor = _executor(broker, prepared)
    with pytest.raises(ApplicationError, match="runtime token fetch failed"):
        await executor.run_entry_point("echo_wf", {"executionId": "e1"})
    assert broker.patches[0]["status"] == "FAILED"


async def test_patch_failure_does_not_mask_run_result(
    prepared: PreparedWorkflow,
) -> None:
    """If the terminal PATCH fails the run outcome still stands — the
    reconcile poller is the backstop for the stale row."""

    class PatchlessBroker(StubBroker):
        def patch_execution(self, *args: Any, **kwargs: Any) -> None:
            from pegasus_tenant_runner.broker_client import BrokerError

            raise BrokerError("HTTP 503")

    broker = PatchlessBroker()
    executor = _executor(broker, prepared)
    result = await executor.run_entry_point(
        "echo_wf", {"executionId": "e1", "input": {"x": 2}}
    )
    assert result["echo"] == {"x": 2}
