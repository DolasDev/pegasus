"""Process hardening: make the shim non-dumpable (Phase 3 Unit 8.1).

Threat closed here
──────────────────
The tenant subprocess runs as the SAME uid as this shim (uid 999 in the
container — see the Dockerfile). A stripped environment (sandbox_env.py)
keeps secrets out of the *child*, but Linux lets a same-uid process read
another process's ``/proc/<pid>/environ`` and ``/proc/<pid>/mem`` — i.e.
hostile tenant code could simply read the SHIM's exec-time environment and
recover ``WORKFLOW_BROKER_TOKEN`` (and, once Unit 9 lands, a
namespace-scoped ``TEMPORAL_CLOUD_API_KEY`` with cross-tenant reach).

The classic fix — run tenant code under a different uid via a setuid drop —
is NOT available: the container already runs as non-root, and setuid/setgid
require privileges we deliberately do not hold.

What ``PR_SET_DUMPABLE = 0`` does instead: every /proc-based introspection
of a process (``environ``, ``mem``, ``maps``, ...) and every ptrace attach
goes through the kernel's ptrace access-mode check
(``PTRACE_MODE_READ_FSCREDS`` / ``PTRACE_MODE_ATTACH_FSCREDS``). For a
NON-dumpable target, that check requires ``CAP_SYS_PTRACE`` — which no one
in this container has — so a same-uid reader gets ``EACCES``/``EPERM``.
One flag closes ``/proc/<shim>/environ``, ``/proc/<shim>/mem``, AND
same-uid ptrace attach.

Children are unaffected: the dumpable flag is reset to 1 on ``execve()`` of
a non-setuid binary, so tenant subprocesses (and their own debugging of
themselves) work exactly as before.

What this does NOT cover
────────────────────────
* Root-in-container reading the shim — irrelevant: nothing in this image
  runs as root (``USER pegasus``), and there is no setuid binary to climb.
* The shared-kernel boundary: code that escapes the process model via a
  kernel vulnerability is out of scope for this flag (that residual is
  owned by the ECS task / kernel hardening layer, not the shim).
* Secrets the shim later hands to the child on purpose (the tenant's own
  ``vnd_`` token) — those are the tenant's to see by design.

Non-Linux note: ``prctl(2)`` is Linux-only. Local development on macOS has
no /proc and no same-uid-/proc threat of this shape, and the production
runtime is always the Linux container image — so off-Linux this module
logs a warning and no-ops rather than blocking dev workflows. On Linux a
failure is fatal by design: a shim that cannot protect its credentials must
refuse to start.
"""

from __future__ import annotations

import ctypes
import logging
import sys

__all__ = ["HardeningError", "set_non_dumpable"]

log = logging.getLogger("pegasus_tenant_runner")

#: ``<sys/prctl.h>`` operation codes (stable kernel ABI).
PR_GET_DUMPABLE = 3
PR_SET_DUMPABLE = 4


class HardeningError(RuntimeError):
    """Raised when mandatory process hardening cannot be applied."""


def _libc() -> ctypes.CDLL:  # pragma: no cover - patched in unit tests
    return ctypes.CDLL(None, use_errno=True)


def set_non_dumpable() -> None:
    """Mark this process non-dumpable via ``prctl(PR_SET_DUMPABLE, 0)``.

    Must be called at the very start of the runner entrypoint, before any
    config parsing and long before any tenant subprocess exists. Raises
    :class:`HardeningError` on any failure on Linux — the runner must not
    start dumpable. No-ops (with a warning) on non-Linux dev hosts.
    """
    if sys.platform != "linux":
        log.warning(
            "hardening.non_dumpable_skipped",
            extra={"platform": sys.platform, "reason": "prctl is Linux-only"},
        )
        return

    libc = _libc()
    if libc.prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        errno = ctypes.get_errno()
        raise HardeningError(
            f"prctl(PR_SET_DUMPABLE, 0) failed with errno {errno} — refusing "
            "to start: the shim's environment (broker token, Temporal "
            "credentials) would be readable via /proc by tenant code"
        )

    # Belt and braces: read the flag back. PR_GET_DUMPABLE returns the
    # current value as the syscall's return code (0 = non-dumpable).
    state = libc.prctl(PR_GET_DUMPABLE, 0, 0, 0, 0)
    if state != 0:
        raise HardeningError(
            f"PR_GET_DUMPABLE reports {state} after setting 0 — refusing to "
            "start with a dumpable shim"
        )
