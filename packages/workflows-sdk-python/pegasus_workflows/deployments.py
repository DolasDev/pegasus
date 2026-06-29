"""Post-publish deployment ledger — ``deployments.toml`` beside the manifest.

Workflow ids are environment-specific: publishing the same workflow to QA and to
prod yields different ids. After a successful ``push``, the only record of *where*
a workflow landed and *what id it got* is stdout. This module persists that as a
durable, machine-readable mapping ``(env, workflow) → {id, version, …}`` so every
post-publish action (run, executions, fork, rollback) can read the id instead of
scraping scrollback.

The file is safe to commit — it holds ids and URLs only, never a token.

```toml
[prod]
base_url = "https://api.pegasus.dolas.dev"
workflow_id = "f8077342-2e58-4dc1-a47a-797ca394ef72"
version = "0.1.0"
visibility = "GLOBAL"
published_at = "2026-06-26T21:05:48Z"
```

Multi-workflow projects namespace each entry by workflow name under the env table
(``[prod.send_order_saved_sms]``).
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from ._toml import dumps as _toml_dumps

__all__ = [
    "DEPLOYMENTS_FILENAME",
    "derive_env",
    "read_deployments",
    "record_deployment",
]

#: Ledger filename, written beside ``pegasus-workflows.toml``.
DEPLOYMENTS_FILENAME = "deployments.toml"


def derive_env(base_url: str) -> str:
    """Derive an environment key from a base URL when ``--env`` is not given.

    Uses the hostname (``https://api.pegasus-qa.dolas.dev`` → that host). Falls
    back to ``"default"`` for an unparseable / hostless URL.
    """
    host = urlsplit(base_url).hostname
    return host or "default"


def read_deployments(project_dir: Path) -> dict[str, Any]:
    """Parse the project's ``deployments.toml`` (read-only).

    Returns an empty dict when the file does not exist.
    """
    path = Path(project_dir) / DEPLOYMENTS_FILENAME
    if not path.is_file():
        return {}
    with path.open("rb") as fh:
        return tomllib.load(fh)


def record_deployment(
    project_dir: Path,
    *,
    env: str,
    base_url: str,
    workflow_name: str,
    multi: bool,
    workflow_id: str,
    version: str,
    visibility: str,
    published_at: str,
) -> Path:
    """Upsert a deployment record into ``deployments.toml``; return its path.

    Idempotent: re-publishing to the same ``env`` overwrites that entry in place
    (no duplicate table). Publishing to a new ``env`` adds a table. When *multi*
    is true (project declares more than one workflow), the record is nested under
    the workflow name (``[env.workflow_name]``) so every workflow coexists.
    """
    path = Path(project_dir) / DEPLOYMENTS_FILENAME
    data = read_deployments(project_dir)

    entry = {
        "base_url": base_url,
        "workflow_id": workflow_id,
        "version": version,
        "visibility": visibility,
        "published_at": published_at,
    }

    if multi:
        env_table = data.get(env)
        # If a prior single-workflow record sits at this env, promote to nested.
        if not isinstance(env_table, dict) or _is_entry(env_table):
            env_table = {}
        env_table[workflow_name] = entry
        data[env] = env_table
    else:
        data[env] = entry

    path.write_text(_toml_dumps(data), encoding="utf-8")
    return path


def _is_entry(table: dict[str, Any]) -> bool:
    """True if *table* looks like a leaf deployment record (not env→workflows).

    Checks that ``workflow_id`` maps to a *string* — a nested ``env→{name: entry}``
    table could have a workflow literally named ``workflow_id`` (valid per the
    name regex), whose value is a dict, and must not be mistaken for a leaf.
    """
    return isinstance(table.get("workflow_id"), str)
