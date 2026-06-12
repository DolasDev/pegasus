"""Hardening: prctl wiring (mocked) + a REAL same-uid /proc denial proof.

The integration test is the point of Unit 8.1: a process that called
``set_non_dumpable()`` must reject ``/proc/<pid>/environ`` reads from a
same-uid child — exactly the move hostile tenant code would make to steal
the shim's ``WORKFLOW_BROKER_TOKEN`` / ``TEMPORAL_CLOUD_API_KEY``.

Yama interaction (``/proc/sys/kernel/yama/ptrace_scope``): Yama's LSM hook
only restricts ``PTRACE_MODE_ATTACH`` requests; ``/proc/<pid>/environ``
opens with ``PTRACE_MODE_READ``, so at scope 0 and at the common default
scope 1 the CONTROL read (no hardening) succeeds and proves the threat is
real on this kernel. At scope >= 2 (admin-only / no-ptrace) even READ-mode
introspection may require CAP_SYS_PTRACE; the control then can't
distinguish Yama from our flag, so it is skipped with the observed scope
in the skip reason. The hardened-denial assertion runs at every scope.
"""

from __future__ import annotations

import errno
import json
import logging
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from pegasus_tenant_runner import hardening, runner
from pegasus_tenant_runner.hardening import (
    PR_GET_DUMPABLE,
    PR_SET_DUMPABLE,
    HardeningError,
    set_non_dumpable,
)

# ---------------------------------------------------------------------------
# Unit: prctl invocation + failure paths (mocked libc)
# ---------------------------------------------------------------------------


class FakeLibc:
    """Records prctl calls; per-op return codes configurable."""

    def __init__(self, set_rc: int = 0, get_rc: int = 0) -> None:
        self.calls: list[tuple[int, ...]] = []
        self._rc = {PR_SET_DUMPABLE: set_rc, PR_GET_DUMPABLE: get_rc}

    def prctl(self, op: int, *args: int) -> int:
        self.calls.append((op, *args))
        return self._rc[op]


@pytest.fixture()
def fake_linux(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hardening.sys, "platform", "linux")


def test_invokes_prctl_set_then_verifies(
    fake_linux: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    libc = FakeLibc()
    monkeypatch.setattr(hardening, "_libc", lambda: libc)
    set_non_dumpable()
    assert libc.calls == [
        (PR_SET_DUMPABLE, 0, 0, 0, 0),
        (PR_GET_DUMPABLE, 0, 0, 0, 0),
    ]


def test_set_failure_raises_with_errno(
    fake_linux: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(hardening, "_libc", lambda: FakeLibc(set_rc=-1))
    monkeypatch.setattr(hardening.ctypes, "get_errno", lambda: errno.EINVAL)
    with pytest.raises(HardeningError, match=r"errno 22"):
        set_non_dumpable()


def test_readback_mismatch_raises(
    fake_linux: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(hardening, "_libc", lambda: FakeLibc(get_rc=1))
    with pytest.raises(HardeningError, match="PR_GET_DUMPABLE reports 1"):
        set_non_dumpable()


def test_non_linux_warns_and_noops(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(hardening.sys, "platform", "darwin")

    def _boom() -> None:  # pragma: no cover - failing branch
        raise AssertionError("libc must not be touched off-Linux")

    monkeypatch.setattr(hardening, "_libc", _boom)
    with caplog.at_level(logging.WARNING, logger="pegasus_tenant_runner"):
        set_non_dumpable()
    assert any("hardening.non_dumpable_skipped" in r.message for r in caplog.records)


def test_runner_main_refuses_to_start_when_hardening_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wiring guard: a HardeningError aborts main() before config parsing."""

    def _fail() -> None:
        raise HardeningError("boom")

    def _config_must_not_run() -> None:  # pragma: no cover - failing branch
        raise AssertionError("load_config must not run when hardening fails")

    monkeypatch.setattr(runner, "set_non_dumpable", _fail)
    monkeypatch.setattr(runner, "load_config", _config_must_not_run)
    # Keep main()'s failure-path configure_logging() from rewiring the root
    # logger out from under pytest's caplog for later tests.
    monkeypatch.setattr(runner, "configure_logging", lambda: None)
    with pytest.raises(SystemExit) as excinfo:
        runner.main()
    assert excinfo.value.code == 1


# ---------------------------------------------------------------------------
# Integration (Linux-only): REAL /proc denial from a same-uid child
# ---------------------------------------------------------------------------

#: Victim process: optionally hardens itself, then spawns a same-uid child
#: that tries to read the victim's /proc/<pid>/environ. Prints one JSON
#: verdict line: {"child": "ok"|"denied"|"other", "errno": int|null}.
_VICTIM_SCRIPT = textwrap.dedent(
    """
    import json, os, subprocess, sys

    if sys.argv[1] == "harden":
        from pegasus_tenant_runner.hardening import set_non_dumpable
        set_non_dumpable()

    child_code = (
        "import json, os, sys\\n"
        "try:\\n"
        "    with open(f'/proc/{os.getppid()}/environ', 'rb') as fh:\\n"
        "        data = fh.read()\\n"
        "    print(json.dumps({'child': 'ok', 'errno': None, 'bytes': len(data)}))\\n"
        "except PermissionError as exc:\\n"
        "    print(json.dumps({'child': 'denied', 'errno': exc.errno}))\\n"
        "except OSError as exc:\\n"
        "    print(json.dumps({'child': 'other', 'errno': exc.errno}))\\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", child_code], capture_output=True, text=True, timeout=30
    )
    sys.stderr.write(out.stderr)
    print(out.stdout.strip())
    """
)


def _run_victim(mode: str, tmp_path: Path) -> dict:
    script = tmp_path / "victim.py"
    script.write_text(_VICTIM_SCRIPT, encoding="utf-8")
    app_dir = Path(__file__).resolve().parent.parent
    env = dict(os.environ)
    env["PYTHONPATH"] = str(app_dir)
    out = subprocess.run(
        [sys.executable, str(script), mode],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
        env=env,
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


def _ptrace_scope() -> int | None:
    try:
        return int(Path("/proc/sys/kernel/yama/ptrace_scope").read_text().strip())
    except (OSError, ValueError):  # Yama not built in
        return None


@pytest.mark.skipif(sys.platform != "linux", reason="prctl + /proc are Linux-only")
def test_non_dumpable_blocks_same_uid_proc_environ_read(tmp_path: Path) -> None:
    """THE Unit 8.1 proof: after set_non_dumpable(), a same-uid child cannot
    read the parent's /proc/<pid>/environ. The denial verdict also doubles as
    proof that children spawned AFTER hardening still execute normally
    (dumpable resets on execve — the child ran Python and reported back)."""
    verdict = _run_victim("harden", tmp_path)
    assert verdict["child"] == "denied", verdict
    # __ptrace_may_access denials surface as EACCES (cred path) or EPERM
    # (dumpable path) depending on kernel version; both are PermissionError.
    assert verdict["errno"] in (errno.EACCES, errno.EPERM), verdict


@pytest.mark.skipif(sys.platform != "linux", reason="prctl + /proc are Linux-only")
def test_control_without_flag_same_uid_read_succeeds(tmp_path: Path) -> None:
    """Control: WITHOUT the flag the same read succeeds — i.e. the threat is
    real on this kernel and the denial above is attributable to our prctl
    call, not ambient policy. Yama (any ptrace_scope) does not gate
    PTRACE_MODE_READ, only ATTACH — but if some other LSM/scope>=2 setup
    denies the control anyway, skip rather than fail (the hardened test
    above already proved the property we ship)."""
    verdict = _run_victim("control", tmp_path)
    scope = _ptrace_scope()
    if verdict["child"] != "ok" and scope is not None and scope >= 2:
        pytest.skip(
            f"control read denied by ambient policy (yama ptrace_scope={scope}); "
            "cannot attribute denial to PR_SET_DUMPABLE on this host"
        )
    assert verdict["child"] == "ok", (verdict, f"ptrace_scope={scope}")
    assert verdict["bytes"] > 0  # environ actually carried data worth stealing
