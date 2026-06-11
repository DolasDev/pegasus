"""Shared test fixtures.

Mirrors ``apps/temporal-worker/tests/conftest.py``: the runner depends on
``packages/workflows-sdk-python`` (the ``pegasus_workflows`` package used by
fixture tenant workflows), which isn't installed by a plain
``pip install -e .`` of the runner alone — point sys.path at it so
``uv run --extra dev pytest`` works from ``apps/tenant-runner/``.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent  # apps/tenant-runner/tests → repo root

_SDK_PATH = _REPO_ROOT / "packages" / "workflows-sdk-python"

if _SDK_PATH.is_dir() and str(_SDK_PATH) not in sys.path:
    sys.path.insert(0, str(_SDK_PATH))
