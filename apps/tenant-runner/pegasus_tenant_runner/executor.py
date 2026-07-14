"""Tenant-code subprocess execution — the heart of the trusted shim.

One :class:`TenantCodeExecutor` per runner process. For each Temporal
activity invocation it:

1. fetches the execution's ``vnd_`` runtime token from the broker (the shim
   proxies this call so the subprocess never needs broker credentials),
2. spawns the workflow's venv interpreter on the trusted driver script with
   the allowlist environment (see sandbox_env.py) and pipes one JSON request
   over stdin (the only channel that carries the runtime token),
3. enforces the wall-clock execution budget — a subprocess that outlives it
   is SIGKILLed and the execution is marked TIMED_OUT (full limit
   enforcement at the run path is Unit 10; the runner's job is to never let
   tenant code outlive its activity),
4. captures size-capped stdout/stderr tails for the runner log,
5. reads the verdict from the run's result file, PATCHes terminal status to
   the API (COMPLETED / FAILED / TIMED_OUT — mirror of status_sync.py via
   the broker client), and completes/fails the Temporal activity to match.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from temporalio.exceptions import ApplicationError

from .artifacts import PreparedWorkflow
from .broker_client import BrokerError, TenantBrokerClient
from .sandbox_env import build_subprocess_env

log = logging.getLogger(__name__)

__all__ = ["TenantCodeExecutor", "DRIVER_PATH"]

#: Absolute path of the trusted driver script, executed by file path with
#: ``-P`` (Python ≥3.11: keep the script's directory off sys.path) so a
#: tenant module named like ours cannot shadow anything the driver imports
#: before tenant code runs anyway.
DRIVER_PATH = Path(__file__).resolve().parent / "subprocess_driver.py"

#: Cap on the error-message text persisted to the execution row.
_MAX_ERROR_CHARS = 2_000


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _tail(data: bytes, cap: int) -> str:
    """Last ``cap`` bytes of ``data`` as best-effort text."""
    tail = data[-cap:] if len(data) > cap else data
    text = tail.decode("utf-8", errors="replace")
    if len(data) > cap:
        text = f"[truncated to last {cap} bytes]\n{text}"
    return text


class TenantCodeExecutor:
    """Runs tenant entry points in stripped-env subprocesses."""

    def __init__(
        self,
        *,
        broker: TenantBrokerClient,
        prepared: dict[str, PreparedWorkflow],
        api_base_url: str,
        execution_timeout_seconds: int,
        max_output_bytes: int,
        max_result_bytes: int,
    ) -> None:
        self._broker = broker
        self._prepared = prepared
        self._api_base_url = api_base_url
        self._execution_timeout = execution_timeout_seconds
        self._max_output_bytes = max_output_bytes
        self._max_result_bytes = max_result_bytes

    # -- internals ----------------------------------------------------------

    def _patch_status(
        self,
        execution_id: str,
        status: str,
        *,
        result: Any | None = None,
        error_message: str | None = None,
    ) -> None:
        """Terminal write-back; failures are logged, never masked over the
        run outcome (the Phase-2 reconcile poller is the backstop for rows
        this leaves stale)."""
        if not execution_id:
            return
        try:
            self._broker.patch_execution(
                execution_id,
                status,
                finished_at_iso=_utc_now_iso(),
                result=result,
                error_message=error_message,
            )
        except (BrokerError, ValueError):
            log.exception(
                "runner.status_patch_failed",
                extra={"execution_id": execution_id, "status": status},
            )

    # -- public -------------------------------------------------------------

    async def run_entry_point(self, workflow_name: str, payload: Any) -> Any:
        """Execute one tenant workflow invocation. Called from the proxy
        activity; raises :class:`ApplicationError` (non-retryable) on any
        tenant-side failure so Temporal records exactly one attempt."""
        prepared = self._prepared.get(workflow_name)
        if prepared is None:
            raise ApplicationError(
                f"workflow {workflow_name!r} is not prepared on this runner",
                non_retryable=True,
            )

        execution_id = ""
        dry_run = False
        if isinstance(payload, dict):
            execution_id = str(payload.get("executionId") or "")
            dry_run = bool(payload.get("dryRun"))

        # 1. Broker-proxied runtime-token fetch (sync httpx → worker thread).
        try:
            runtime_token = await asyncio.to_thread(
                self._broker.fetch_runtime_token, execution_id
            )
        except (BrokerError, ValueError) as exc:
            message = f"runtime token fetch failed: {exc}"
            await asyncio.to_thread(
                self._patch_status, execution_id, "FAILED", error_message=message
            )
            raise ApplicationError(message, non_retryable=True) from exc

        # 2. Per-run scratch dir + result file (under the workflow's scratch
        # root, so HOME/TMPDIR confinement covers it).
        run_dir = prepared.scratch_dir / f"run-{uuid.uuid4().hex}"
        run_dir.mkdir(parents=True)
        result_path = run_dir / "result.json"

        request = json.dumps(
            {
                "entryPoint": prepared.entry_point,
                "payload": payload,
                "runtimeToken": runtime_token,
                "apiBaseUrl": self._api_base_url,
                "resultPath": str(result_path),
                "dryRun": dry_run,
            }
        ).encode("utf-8")

        env = build_subprocess_env(prepared, execution_id=execution_id)

        try:
            proc = await asyncio.create_subprocess_exec(
                str(prepared.python_bin),
                "-P",
                str(DRIVER_PATH),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=str(run_dir),
            )

            # 3. Wall-clock guard. communicate() also writes the stdin
            # request; on timeout the child is SIGKILLed and reaped.
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(input=request),
                    timeout=self._execution_timeout,
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                message = (
                    f"execution exceeded the {self._execution_timeout}s wall-clock "
                    "budget and was killed"
                )
                log.error(
                    "runner.subprocess_timeout",
                    extra={
                        "workflow_name": workflow_name,
                        "execution_id": execution_id,
                        "timeout_seconds": self._execution_timeout,
                    },
                )
                await asyncio.to_thread(
                    self._patch_status, execution_id, "TIMED_OUT", error_message=message
                )
                raise ApplicationError(message, non_retryable=True) from None

            # 4. Size-capped output tails — runner log only, never the result.
            stdout_tail = _tail(stdout, self._max_output_bytes)
            stderr_tail = _tail(stderr, self._max_output_bytes)
            log.info(
                "runner.subprocess_finished",
                extra={
                    "workflow_name": workflow_name,
                    "execution_id": execution_id,
                    "exit_code": proc.returncode,
                    "stdout_tail": stdout_tail,
                    "stderr_tail": stderr_tail,
                },
            )

            # 5. Verdict.
            verdict = self._read_verdict(result_path)
            if verdict is None:
                message = (
                    f"tenant subprocess exited with code {proc.returncode} and wrote "
                    f"no readable result; stderr tail: {stderr_tail[:_MAX_ERROR_CHARS]}"
                )
                await asyncio.to_thread(
                    self._patch_status, execution_id, "FAILED", error_message=message
                )
                raise ApplicationError(message, non_retryable=True)

            if verdict.get("ok") is True:
                result = verdict.get("result")
                await asyncio.to_thread(
                    self._patch_status, execution_id, "COMPLETED", result=result
                )
                return result

            error_message = str(verdict.get("error") or "workflow failed")[:_MAX_ERROR_CHARS]
            await asyncio.to_thread(
                self._patch_status, execution_id, "FAILED", error_message=error_message
            )
            raise ApplicationError(error_message, non_retryable=True)
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)

    def _read_verdict(self, result_path: Path) -> dict[str, Any] | None:
        """Read + parse the result file; None for missing/oversized/garbage."""
        try:
            if not result_path.is_file():
                return None
            if result_path.stat().st_size > self._max_result_bytes:
                log.error(
                    "runner.result_too_large",
                    extra={
                        "size_bytes": result_path.stat().st_size,
                        "cap_bytes": self._max_result_bytes,
                    },
                )
                return None
            parsed = json.loads(result_path.read_text(encoding="utf-8"))
            return parsed if isinstance(parsed, dict) else None
        except (OSError, ValueError):
            return None
