"""Subprocess driver: direct-execution semantics, run in a REAL child.

These tests spawn the actual driver script with ``sys.executable -P`` and a
hand-built environment (NOT the production sandbox env — sandbox_env tests
cover that; here the child needs the SDK importable to host the fixture
workflow, so PYTHONPATH includes the SDK checkout).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

from pegasus_tenant_runner.executor import DRIVER_PATH

_SDK_PATH = Path(__file__).resolve().parents[3] / "packages" / "workflows-sdk-python"

WORKFLOW_MODULE = textwrap.dedent(
    '''
    """Fixture tenant workflow in the exact SDK authoring shape."""
    import os

    from pegasus_workflows import activity, pegasus_workflow, workflow


    @activity.defn
    async def double(value: int) -> int:
        return value * 2


    @pegasus_workflow(name="fixture_wf", version="1.0.0")
    class FixtureWorkflow:
        @workflow.run
        async def run(self, payload: dict) -> dict:
            inner = (payload or {}).get("input") or {}
            doubled = await workflow.execute_activity(
                double, int(inner.get("n", 0)),
                start_to_close_timeout=None,
            )
            await workflow.sleep(0)
            return {
                "doubled": doubled,
                "has_runtime_token": "PEGASUS_RUNTIME_TOKEN" in os.environ,
                "api_base_url": os.environ.get("PEGASUS_API_BASE_URL"),
            }


    @pegasus_workflow(name="boom_wf", version="1.0.0")
    class BoomWorkflow:
        @workflow.run
        async def run(self, payload: dict) -> dict:
            raise ValueError("tenant code exploded")


    @activity.defn
    async def notify(to: str) -> dict:
        # Real activity body — builds the client and performs a mutation. Under
        # dry-run the client suppresses the send (apiBaseUrl is invalid, so a
        # real POST would fail); success proves nothing was sent.
        from pegasus_workflows.api import PegasusClient

        client = PegasusClient.from_runtime()
        client.record_side_effect("about_to_notify", {"to": to})
        return client.send_sms(to=to, body="hello")


    @pegasus_workflow(name="notify_wf", version="1.0.0")
    class NotifyWorkflow:
        @workflow.run
        async def run(self, payload: dict) -> dict:
            to = ((payload or {}).get("input") or {}).get("to", "+15550000000")
            return await workflow.execute_activity(
                notify, to, start_to_close_timeout=None,
            )


    @pegasus_workflow(name="logging_wf", version="1.0.0")
    class LoggingWorkflow:
        @workflow.run
        async def run(self, payload: dict) -> dict:
            # The standard authoring surface: logger + info on the FIRST lines.
            # Real temporalio.workflow.logger/info read the event-loop context,
            # so without the driver's patches this raised _NotInWorkflowEventLoop-
            # Error before any activity ran (sdk-feedback/0017).
            workflow.logger.info("logging_wf started")
            info = workflow.info()
            return {"ran": True, "workflow_id": info.workflow_id}


    @pegasus_workflow(name="waiter_wf", version="1.0.0")
    class WaiterWorkflow:
        @workflow.run
        async def run(self, payload: dict) -> dict:
            workflow.logger.info("waiter_wf waiting on a signal that never comes")
            # No signal source in a single-shot run — predicate stays False.
            await workflow.wait_condition(lambda: False)
            return {"ran": True}
    '''
)


def _run_driver(
    tmp_path: Path,
    *,
    entry_point: str,
    payload: dict,
    runtime_token: str = "vnd_test_token",
    dry_run: bool = False,
) -> tuple[subprocess.CompletedProcess[str], dict | None]:
    src = tmp_path / "src" / "fixture_wf"
    src.mkdir(parents=True, exist_ok=True)
    (src / "__init__.py").write_text("")
    (src / "workflow.py").write_text(WORKFLOW_MODULE)

    result_path = tmp_path / "result.json"
    request = json.dumps(
        {
            "entryPoint": entry_point,
            "payload": payload,
            "runtimeToken": runtime_token,
            "apiBaseUrl": "https://api.pegasus.invalid",
            "resultPath": str(result_path),
            "dryRun": dry_run,
        }
    )
    # temporalio comes from the test interpreter's site-packages; the SDK
    # and the fixture module ride PYTHONPATH.
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "PYTHONPATH": os.pathsep.join([str(tmp_path / "src"), str(_SDK_PATH)]),
        "HOME": str(tmp_path),
    }
    proc = subprocess.run(
        [sys.executable, "-P", str(DRIVER_PATH)],
        input=request,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    verdict = (
        json.loads(result_path.read_text()) if result_path.is_file() else None
    )
    return proc, verdict


def test_driver_runs_sdk_workflow_with_direct_execution(tmp_path: Path) -> None:
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:FixtureWorkflow",
        payload={"executionId": "e1", "input": {"n": 21}},
    )
    assert proc.returncode == 0, proc.stderr
    assert verdict is not None
    assert verdict["ok"] is True
    # workflow.execute_activity ran the activity callable directly.
    assert verdict["result"]["doubled"] == 42
    # The vnd_ token reached tenant code via in-process env (stdin → setenv).
    assert verdict["result"]["has_runtime_token"] is True
    assert verdict["result"]["api_base_url"] == "https://api.pegasus.invalid"


def test_driver_dry_run_captures_mutation_without_sending(tmp_path: Path) -> None:
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:NotifyWorkflow",
        payload={"executionId": "e1", "input": {"to": "+15551234567"}},
        dry_run=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert verdict is not None and verdict["ok"] is True
    result = verdict["result"]
    # Dry-run result is the trace envelope, not the bare workflow return.
    assert result["dryRun"] is True
    # The send was suppressed and returned the synthetic value (no real POST —
    # apiBaseUrl is invalid, so a live send would have failed the run).
    assert result["return"] == {"data": {"id": "dry-run", "status": "captured", "dryRun": True}}
    # Capture log: record_side_effect first, then the send_sms mutation.
    caps = result["captured"]
    assert caps[0]["label"] == "about_to_notify"
    assert caps[1]["capability"] == "SendSms"
    assert caps[1]["args"] == {"to": "+15551234567", "body": "hello"}
    # Per-activity trace records the notify activity and its (synthetic) result.
    assert result["trace"][0]["activity"] == "notify"


def test_driver_dry_run_traces_activities_with_empty_capture(tmp_path: Path) -> None:
    # A workflow whose activity performs no side effect: trace present, no captures.
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:FixtureWorkflow",
        payload={"executionId": "e1", "input": {"n": 21}},
        dry_run=True,
    )
    assert proc.returncode == 0, proc.stderr
    result = verdict["result"]
    assert result["dryRun"] is True
    assert result["return"]["doubled"] == 42
    assert result["captured"] == []
    assert result["trace"][0]["activity"] == "double"
    assert result["trace"][0]["result"] == 42


def test_driver_runs_workflow_using_logger_and_info(tmp_path: Path) -> None:
    # Regression for sdk-feedback/0017: workflow.logger / workflow.info on the
    # first lines of run() must NOT raise _NotInWorkflowEventLoopError. This is
    # the single path for both live and dry-run, so a live run must succeed too.
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:LoggingWorkflow",
        payload={"executionId": "e1", "input": {}},
    )
    assert proc.returncode == 0, proc.stderr
    assert verdict is not None and verdict["ok"] is True
    assert verdict["result"] == {"ran": True, "workflow_id": "dry-run"}
    assert "NotInWorkflowEventLoop" not in (proc.stderr or "")


def test_driver_dry_run_workflow_using_logger_and_info(tmp_path: Path) -> None:
    # The same workflow under dry-run also reaches completion (no crash).
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:LoggingWorkflow",
        payload={"executionId": "e1", "input": {}},
        dry_run=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert verdict is not None and verdict["ok"] is True
    assert verdict["result"]["dryRun"] is True
    assert verdict["result"]["return"] == {"ran": True, "workflow_id": "dry-run"}


def test_driver_reports_wait_condition_as_unsupported(tmp_path: Path) -> None:
    # A signal-/wait_condition-driven workflow cannot run single-shot; the driver
    # must report a clear "unsupported" error, not a raw event-loop crash (AC5).
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:WaiterWorkflow",
        payload={"executionId": "e1", "input": {}},
        dry_run=True,
    )
    assert proc.returncode == 3
    assert verdict is not None and verdict["ok"] is False
    assert "not yet supported" in verdict["error"]
    assert "NotInWorkflowEventLoop" not in verdict["error"]


def test_driver_reports_tenant_exception_as_failure(tmp_path: Path) -> None:
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:BoomWorkflow",
        payload={"executionId": "e1", "input": {}},
    )
    assert proc.returncode == 3
    assert verdict is not None
    assert verdict["ok"] is False
    assert "tenant code exploded" in verdict["error"]


def test_driver_fails_cleanly_on_missing_entry_point(tmp_path: Path) -> None:
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="fixture_wf.workflow:Nope",
        payload={},
    )
    assert proc.returncode == 3
    assert verdict is not None
    assert verdict["ok"] is False
    assert "Nope" in verdict["error"]


def test_driver_fails_cleanly_on_missing_module(tmp_path: Path) -> None:
    proc, verdict = _run_driver(
        tmp_path,
        entry_point="no_such_module:Thing",
        payload={},
    )
    assert proc.returncode == 3
    assert verdict is not None
    assert verdict["ok"] is False


def test_driver_token_never_on_argv(tmp_path: Path) -> None:
    """The contract is stdin-only delivery: nothing secret may be on the
    command line (argv is world-readable via /proc)."""
    # Structural pin: the executor builds argv as [python, -P, DRIVER_PATH]
    # and pipes the request via stdin — assert the driver reads stdin and
    # never touches sys.argv.
    source = DRIVER_PATH.read_text()
    assert "sys.stdin.read()" in source
    assert "sys.argv" not in source
