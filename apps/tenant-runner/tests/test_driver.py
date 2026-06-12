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
    '''
)


def _run_driver(
    tmp_path: Path,
    *,
    entry_point: str,
    payload: dict,
    runtime_token: str = "vnd_test_token",
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
