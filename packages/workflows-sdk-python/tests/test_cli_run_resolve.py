"""``_find_workflow`` — how ``run`` / ``schedule`` resolve ``name[@version]``.

A bare name must match exactly one visible version; several are refused with
the list rather than silently picking one (it used to pick the OLDEST, found in
the Phase 3c staging acceptance).
"""

from __future__ import annotations

import pytest
import typer

from pegasus_workflows.cli.run import _find_workflow


class _Client:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def list_workflows(self) -> list[dict]:
        return self._rows


def _row(id_: str, version: str, visibility: str = "TENANT", created: str = "2026-01-01") -> dict:
    return {
        "id": id_,
        "name": "wf",
        "version": version,
        "visibility": visibility,
        "createdAt": created,
    }


def test_bare_name_one_version_resolves() -> None:
    assert _find_workflow(_Client([_row("a", "0.1.0")]), "wf", None)["id"] == "a"


def test_bare_name_several_versions_is_refused_and_lists_them() -> None:
    client = _Client(
        [
            _row("old", "0.9.0", created="2026-01-01"),
            _row("new", "0.10.0", created="2026-02-01"),
        ]
    )
    with pytest.raises(typer.BadParameter) as exc:
        _find_workflow(client, "wf", None)
    msg = str(exc.value)
    assert "0.9.0, 0.10.0" in msg  # numeric order, not string order
    assert "wf@0.10.0" in msg


def test_bare_name_tenant_and_global_versions_differ_is_refused() -> None:
    client = _Client([_row("t", "0.1.0", "TENANT"), _row("g", "0.2.0", "GLOBAL")])
    with pytest.raises(typer.BadParameter):
        _find_workflow(client, "wf", None)


def test_same_version_tenant_fork_wins_over_global() -> None:
    client = _Client([_row("g", "0.1.0", "GLOBAL"), _row("t", "0.1.0", "TENANT")])
    assert _find_workflow(client, "wf", None)["id"] == "t"


def test_name_at_version_picks_exactly_that_version() -> None:
    client = _Client([_row("old", "0.1.0"), _row("new", "0.2.0")])
    assert _find_workflow(client, "wf", "0.1.0")["id"] == "old"
    assert _find_workflow(client, "wf", "0.2.0")["id"] == "new"


def test_prerelease_sorts_before_its_release() -> None:
    client = _Client([_row("r", "1.0.0"), _row("b", "1.0.0-beta.1")])
    with pytest.raises(typer.BadParameter) as exc:
        _find_workflow(client, "wf", None)
    assert "1.0.0-beta.1, 1.0.0" in str(exc.value)


def test_no_match_is_refused() -> None:
    with pytest.raises(typer.BadParameter, match="no visible Automation matches wf@9.9.9"):
        _find_workflow(_Client([_row("a", "0.1.0")]), "wf", "9.9.9")


def test_run_cli_refuses_ambiguous_bare_name_without_starting(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    from typer.testing import CliRunner

    from pegasus_workflows.cli import app
    from pegasus_workflows.cli import run as run_mod

    started: list[str] = []

    class _Fake(_Client):
        def __init__(self, *_a, **_kw) -> None:  # noqa: ANN002, ANN003
            super().__init__([_row("old", "0.1.0"), _row("new", "0.2.0")])

        def run_workflow(self, workflow_id: str, *_a, **_kw) -> dict:  # noqa: ANN002, ANN003
            started.append(workflow_id)
            return {}

    monkeypatch.setattr(run_mod, "PegasusClient", _Fake)
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    result = CliRunner().invoke(
        app, ["run", "wf", "--token", "vnd_" + "a" * 48, "--base-url", "http://x"]
    )
    assert result.exit_code == 2, result.output
    assert started == []
    assert "wf@0.2.0" in result.output

    result = CliRunner().invoke(
        app, ["run", "wf@0.2.0", "--token", "vnd_" + "a" * 48, "--base-url", "http://x"]
    )
    assert result.exit_code == 0, result.output
    assert started == ["new"]
