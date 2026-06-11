"""Subprocess environment construction — allowlist, never strip.

The single most security-sensitive contract in the runner: the tenant
subprocess environment is BUILT FROM SCRATCH here. Nothing from the shim's
own ``os.environ`` is ever copied through, so the credentials and connection
details the shim holds simply do not exist in the child:

* ``WORKFLOW_BROKER_TOKEN`` (the per-tenant ``wbk_`` credential),
* ``TEMPORAL_ADDRESS`` / ``TEMPORAL_NAMESPACE`` / ``TEMPORAL_CLOUD_API_KEY``
  (a namespace credential reaches every tenant's task queue),
* any ``AWS_*`` variable, and the ECS credential/metadata URI variables
  (``AWS_CONTAINER_CREDENTIALS_RELATIVE_URI``,
  ``AWS_CONTAINER_CREDENTIALS_FULL_URI``, ``ECS_CONTAINER_METADATA_URI*``)
  whose unguessable paths are the only practical way to reach
  169.254.170.2 from inside the task.

An allowlist construction cannot rot the way a denylist does: a future env
var added at task launch is invisible to tenant code by default.

The tenant's OWN ``vnd_`` runtime token is deliberately NOT placed in this
environment either — it travels over the driver's stdin (never argv, which
is world-readable via /proc) and the driver exports it inside the child
process only (see subprocess_driver.py).
"""

from __future__ import annotations

from .artifacts import PreparedWorkflow

__all__ = ["ENV_ALLOWLIST_KEYS", "build_subprocess_env"]

#: The EXACT set of keys a tenant subprocess starts with. Tests pin this.
ENV_ALLOWLIST_KEYS = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "PYTHONPATH",
        "PYTHONDONTWRITEBYTECODE",
        "PYTHONUNBUFFERED",
        "PEGASUS_EXECUTION_ID",
    }
)


def build_subprocess_env(prepared: PreparedWorkflow, *, execution_id: str) -> dict[str, str]:
    """Build the stripped environment for one tenant-code subprocess.

    ``PATH`` deliberately contains only the workflow's own venv bin plus the
    standard system bins (the image is slim; there is nothing interesting in
    them, but ``python -m venv``-created interpreters resolve tools like
    ``uname`` via PATH and an empty PATH breaks innocent stdlib calls).
    """
    env = {
        "PATH": f"{prepared.python_bin.parent}:/usr/local/bin:/usr/bin:/bin",
        "HOME": str(prepared.scratch_dir),
        "TMPDIR": str(prepared.scratch_dir / "tmp"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONPATH": str(prepared.src_dir),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        "PEGASUS_EXECUTION_ID": execution_id,
    }
    assert set(env) == ENV_ALLOWLIST_KEYS  # keep the constant honest
    return env
