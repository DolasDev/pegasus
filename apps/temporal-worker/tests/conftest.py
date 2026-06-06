"""Shared test fixtures.

The worker depends on two sibling packages that live elsewhere in the
monorepo and aren't installed in a normal ``pip install -e .`` of the
worker alone:

* ``packages/workflows-sdk-python`` — provides the ``pegasus_workflows``
  package (``PegasusClient``, the ``pegasus_workflow`` decorator).
* ``packages/workflows-stdlib`` — provides the curated workflow modules
  (``send_quote_followup``).

In production the Dockerfile bundles both; for pytest we point sys.path
at the right places so plain ``uv run pytest`` works from the
``apps/temporal-worker/`` directory.

If a future maintainer prefers a wheel-based install, replace this with
``pip install -e ../../packages/workflows-sdk-python ../../packages/workflows-stdlib``
in the dev-deps. The sys.path tweak keeps the test setup self-contained.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent  # apps/temporal-worker/tests → repo root

_SDK_PATH = _REPO_ROOT / "packages" / "workflows-sdk-python"
_STDLIB_PATH = _REPO_ROOT / "packages" / "workflows-stdlib"

for path in (_SDK_PATH, _STDLIB_PATH):
    str_path = str(path)
    if path.is_dir() and str_path not in sys.path:
        sys.path.insert(0, str_path)
