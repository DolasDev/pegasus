"""The worker driver's process exit — codes and stderr survive ``os._exit``.

The driver skips interpreter finalization (``os._exit``) because a Temporal
core thread touching Python during ``Py_Finalize`` segfaulted it on staging.
These run the real script as a subprocess and pin that every exit path still
returns its documented code (3 worker failure, 4 bad request) and that its
stderr reason reaches the shim. (Python's stderr is line-buffered even on a
pipe and the driver writes whole lines, so the explicit flush before
``os._exit`` is belt-and-braces; these don't fail without it.)
"""

from __future__ import annotations

import json
import subprocess
import sys

from pegasus_tenant_runner.workflow_workers import WORKER_DRIVER_PATH


def _run(stdin: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-P", str(WORKER_DRIVER_PATH)],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_bad_start_request_exits_4_and_its_message_is_flushed() -> None:
    result = _run("not json\n")
    assert result.returncode == 4
    assert "invalid start request" in result.stderr


def test_start_request_missing_a_field_exits_4() -> None:
    result = _run(json.dumps({"type": "start", "address": "x"}) + "\n")
    assert result.returncode == 4
    assert "missing 'namespace'" in result.stderr


def test_unimportable_entry_point_exits_3_with_its_reason() -> None:
    request = {
        "type": "start",
        "address": "127.0.0.1:1",
        "namespace": "default",
        "entryPoint": "no_such_module_xyz:Wf",
        "taskQueue": "q",
        "deploymentName": "d",
        "buildId": "b",
    }
    result = _run(json.dumps(request) + "\n")
    assert result.returncode == 3
    assert "worker failed" in result.stderr
    assert "no_such_module_xyz" in result.stderr
