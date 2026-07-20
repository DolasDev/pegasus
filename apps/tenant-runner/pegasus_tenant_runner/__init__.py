"""Pegasus tenant runner — the trusted shim around UNTRUSTED tenant code.

Phase 3 Unit 8. One runner process serves exactly ONE tenant: it discovers
that tenant's executable workflow artifacts via the internal broker (per-
tenant ``wbk_`` token — never the shared broker secret, never AWS
credentials), verifies each artifact's sha256 against the digest recorded at
finalize (TOCTOU defense), unpacks it into an isolated per-workflow
directory + venv, registers thin proxy workflows with Temporal, and executes
tenant entry points in subprocesses whose environment is built from an
explicit allowlist (no broker token, no Temporal connection details, no AWS
or container-metadata variables).

This ``__init__`` is deliberately empty of imports: the subprocess driver
(:mod:`pegasus_tenant_runner.subprocess_driver`) runs inside the tenant's
venv and must not drag the whole shim (httpx clients etc.) into the tenant
process just by sharing the package.
"""

__all__: list[str] = []
