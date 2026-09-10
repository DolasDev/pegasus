"""Guards on the package's own metadata files.

``uv.lock`` records the project's own version alongside its dependencies, so a
version bump in ``pyproject.toml`` must be accompanied by a re-lock. Nothing in
CI would otherwise notice: the CI jobs install with **pip**, by deliberate
choice (uv is the local-dev convenience, not a CI dependency — see the
tenant-runner job in ci.yml), so a stale ``uv.lock`` stays invisible there while
breaking ``uv sync`` / ``uv run`` for anyone developing against the SDK.

That is exactly how it broke: the 0.38.0 -> 0.38.1 bump landed without a re-lock
and every CI leg stayed green. This test is the cheap check that would have
caught it, and it costs no new tooling — plain tomllib, no uv required.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = PACKAGE_ROOT / "pyproject.toml"
UV_LOCK = PACKAGE_ROOT / "uv.lock"

DISTRIBUTION_NAME = "pegasus-workflows-sdk"


def _load(path: Path) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def test_uv_lock_records_the_current_project_version() -> None:
    """`uv.lock` must be re-locked whenever pyproject's version changes."""
    if not UV_LOCK.is_file():
        pytest.skip("uv.lock is not checked in for this package")

    declared = _load(PYPROJECT)["project"]["version"]

    entries = [
        package
        for package in _load(UV_LOCK).get("package", [])
        if package.get("name") == DISTRIBUTION_NAME
    ]
    assert entries, f"{DISTRIBUTION_NAME} has no entry in uv.lock"
    assert len(entries) == 1, f"{DISTRIBUTION_NAME} appears {len(entries)}x in uv.lock"

    locked = entries[0].get("version")
    assert locked == declared, (
        f"uv.lock is stale: it records {DISTRIBUTION_NAME} {locked!r} but "
        f"pyproject.toml declares {declared!r}.\n"
        f"Run `uv lock` in {PACKAGE_ROOT.name}/ and commit the result."
    )


def test_declares_supported_operating_systems() -> None:
    """The OS classifiers are the only machine-readable platform statement on PyPI.

    Windows is covered by its own CI leg; dropping the classifier would leave
    that support true but undiscoverable to anyone reading the package metadata.
    """
    classifiers = _load(PYPROJECT)["project"]["classifiers"]
    operating_systems = {c for c in classifiers if c.startswith("Operating System")}
    assert "Operating System :: Microsoft :: Windows" in operating_systems
    assert "Operating System :: POSIX :: Linux" in operating_systems
