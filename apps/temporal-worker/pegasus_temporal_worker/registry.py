"""Curated-only workflow + activity registry.

Single source of truth for which workflows this worker process is allowed
to execute. The Phase 2 scope-lock is explicit: **only curated stdlib
workflows run server-side** (arbitrary tenant code is Phase 3). The
:func:`get_registrations` helper is the only path that adds workflows
or activities to the Temporal :class:`Worker`, and it refuses any name
not present in :data:`_CURATED_WORKFLOWS`.

Why a registry instead of a discovery scan:

* Defense-in-depth — even if a future change accidentally ships an
  unvetted module inside the image, the worker never registers it.
* Each registration's ``Workflow.name`` value is the same name the
  Pegasus API uses to identify a workflow, so the mapping is the
  contract with Unit 6's broker.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

# stdlib is bundled into the image at /opt/stdlib (PYTHONPATH).
# Locally (pytest, docker-compose) it's importable via the editable
# install of workflows-stdlib OR via a manual sys.path tweak in
# tests/conftest.py — the registry doesn't care which.
from send_quote_followup.workflow import SendQuoteFollowup, compose_followup


@dataclass(frozen=True)
class Registration:
    """One registry entry.

    ``workflow_cls`` is the Temporal workflow class (decorated with
    ``@pegasus_workflow``); ``activities`` is the list of
    ``@activity.defn`` callables the worker must register so the workflow
    can dispatch them.
    """

    name: str
    workflow_cls: type
    activities: tuple[Callable[..., Any], ...]


# The ONLY workflows this worker runs. Keyed by ``Workflow.name`` (the
# value passed to ``@pegasus_workflow(name=...)`` and tracked on the
# Pegasus side as ``Workflow.name``).
_CURATED_WORKFLOWS: dict[str, Registration] = {
    "send_quote_followup": Registration(
        name="send_quote_followup",
        workflow_cls=SendQuoteFollowup,
        activities=(compose_followup,),
    ),
}


class UnknownWorkflowError(KeyError):
    """Raised when a non-curated workflow name is requested.

    Distinct from ``KeyError`` so callers can catch it specifically and
    avoid masking unrelated dict-misses.
    """


def get_workflow(name: str) -> Registration:
    """Return the registration for ``name`` or raise.

    Used by tests and (in theory) by any future code path that needs to
    look up a workflow by name. The worker itself never calls this —
    it iterates :func:`get_registrations` instead.
    """
    try:
        return _CURATED_WORKFLOWS[name]
    except KeyError as exc:
        raise UnknownWorkflowError(
            f"workflow {name!r} is not in the curated registry"
        ) from exc


def get_registrations() -> tuple[Registration, ...]:
    """Return every registration the worker should attach to its Worker."""
    return tuple(_CURATED_WORKFLOWS.values())


def workflow_classes() -> list[type]:
    """Return the list of workflow classes for :class:`temporalio.worker.Worker`."""
    return [reg.workflow_cls for reg in _CURATED_WORKFLOWS.values()]


def activity_callables() -> list[Callable[..., Any]]:
    """Return the flat list of activity callables for the worker.

    De-duplicates by identity so two workflows sharing an activity register
    it once.
    """
    seen: set[int] = set()
    out: list[Callable[..., Any]] = []
    for reg in _CURATED_WORKFLOWS.values():
        for act in reg.activities:
            if id(act) in seen:
                continue
            seen.add(id(act))
            out.append(act)
    return out
