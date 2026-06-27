"""Tests for manifest parsing and validation.

The validation rules must stay in lockstep with the server's
``ManifestSchema`` — these tests pin the regex behaviour.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from pegasus_workflows.manifest import (
    MANIFEST_TIMEOUT_MAX_SECONDS,
    NAME_REGEX,
    VERSION_REGEX,
    ManifestError,
    load_manifest,
    validate_manifest_fields,
)


@pytest.mark.parametrize("name", ["demo", "a", "send_quote-followup", "x0", "0abc", "a" * 64])
def test_valid_names(name: str) -> None:
    assert NAME_REGEX.match(name)


@pytest.mark.parametrize(
    "name", ["", "-leading", "_leading", "UPPER", "with space", "a" * 65, "wïth"]
)
def test_invalid_names(name: str) -> None:
    assert not NAME_REGEX.match(name)


@pytest.mark.parametrize("version", ["0.0.0", "1.2.3", "10.20.30", "1.2.3-beta.1", "1.0.0-rc-1"])
def test_valid_versions(version: str) -> None:
    assert VERSION_REGEX.match(version)


@pytest.mark.parametrize("version", ["1", "1.2", "1.2.3.4", "v1.2.3", "1.2.x", "1.2.3-BETA"])
def test_invalid_versions(version: str) -> None:
    assert not VERSION_REGEX.match(version)


def test_validate_manifest_fields_accepts_valid() -> None:
    validate_manifest_fields("demo", "0.1.0", ["demo.workflow:Hello"], "desc")


@pytest.mark.parametrize(
    "name,version,entry_points",
    [
        ("Bad Name", "0.1.0", ["a:B"]),
        ("demo", "1.2", ["a:B"]),
        ("demo", "0.1.0", []),
        ("demo", "0.1.0", [""]),
    ],
)
def test_validate_manifest_fields_rejects_invalid(
    name: str, version: str, entry_points: list[str]
) -> None:
    with pytest.raises(ManifestError):
        validate_manifest_fields(name, version, entry_points)


def test_load_manifest_from_directory(workflow_project: Path) -> None:
    manifests = load_manifest(workflow_project)
    assert len(manifests) == 1
    m = manifests[0]
    assert m.name == "demo"
    assert m.version == "0.1.0"
    assert m.entry_points == ["demo.workflow:HelloWorkflow"]
    assert m.source_dir == "demo"
    assert m.description == "A demo workflow."
    assert m.required_actions == []


def test_to_api_manifest_shape(workflow_project: Path) -> None:
    m = load_manifest(workflow_project)[0]
    api = m.to_api_manifest()
    assert api == {
        "name": "demo",
        "version": "0.1.0",
        "entryPoints": ["demo.workflow:HelloWorkflow"],
        "requiredActions": [],
        "description": "A demo workflow.",
    }


def test_to_api_manifest_includes_diagram_when_passed(workflow_project: Path) -> None:
    """The publish flow passes the workflow.mmd contents as `diagram`."""
    m = load_manifest(workflow_project)[0]
    api = m.to_api_manifest(diagram="flowchart TD\n  A --> B")
    assert api["diagram"] == "flowchart TD\n  A --> B"


def test_to_api_manifest_omits_diagram_when_not_passed(workflow_project: Path) -> None:
    """Callers that don't publish (e.g. tests) omit the diagram entirely."""
    m = load_manifest(workflow_project)[0]
    assert "diagram" not in m.to_api_manifest()


def test_to_api_manifest_omits_absent_description(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            """
        ).strip(),
        encoding="utf-8",
    )
    m = load_manifest(tmp_path)[0]
    api = m.to_api_manifest()
    assert "description" not in api
    # requiredActions is always present, even when absent from the TOML.
    assert api["requiredActions"] == []


def test_load_manifest_parses_required_actions(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            required_actions = ["ReadQuote", "CreateEvent"]
            """
        ).strip(),
        encoding="utf-8",
    )
    m = load_manifest(tmp_path)[0]
    assert m.required_actions == ["ReadQuote", "CreateEvent"]
    assert m.to_api_manifest()["requiredActions"] == ["ReadQuote", "CreateEvent"]


def test_load_manifest_rejects_non_string_required_actions(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            required_actions = [123]
            """
        ).strip(),
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="required action"):
        load_manifest(tmp_path)


def test_validate_manifest_fields_rejects_non_list_required_actions() -> None:
    with pytest.raises(ManifestError, match="required_actions must be a list"):
        validate_manifest_fields("demo", "0.1.0", ["a:B"], None, "ReadQuote")


def test_load_manifest_missing_file(tmp_path: Path) -> None:
    with pytest.raises(ManifestError, match="not found"):
        load_manifest(tmp_path)


def test_load_manifest_no_workflows(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text("title = 'nope'\n", encoding="utf-8")
    with pytest.raises(ManifestError, match="no \\[\\[workflow\\]\\]"):
        load_manifest(tmp_path)


def test_load_manifest_rejects_duplicate(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["a:B"]

            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["a:B"]
            """
        ).strip(),
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="duplicate"):
        load_manifest(tmp_path)


def test_source_dir_defaults_to_name(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["a:B"]
            """
        ).strip(),
        encoding="utf-8",
    )
    assert load_manifest(tmp_path)[0].source_dir == "demo"


# ---------------------------------------------------------------------------
# timeout_seconds (Phase 3 Unit 10)
# ---------------------------------------------------------------------------


def test_load_manifest_parses_timeout_seconds(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            timeout_seconds = 300
            """
        ).strip(),
        encoding="utf-8",
    )
    m = load_manifest(tmp_path)[0]
    assert m.timeout_seconds == 300


def test_to_api_manifest_includes_timeout_seconds_when_set(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            timeout_seconds = 300
            """
        ).strip(),
        encoding="utf-8",
    )
    m = load_manifest(tmp_path)[0]
    api = m.to_api_manifest()
    assert api["timeoutSeconds"] == 300


def test_to_api_manifest_omits_timeout_seconds_when_absent(workflow_project: Path) -> None:
    """The fixture has no timeout_seconds — it must be absent from to_api_manifest."""
    m = load_manifest(workflow_project)[0]
    api = m.to_api_manifest()
    assert "timeoutSeconds" not in api


def test_load_manifest_timeout_seconds_at_max_boundary(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            f"""
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            timeout_seconds = {MANIFEST_TIMEOUT_MAX_SECONDS}
            """
        ).strip(),
        encoding="utf-8",
    )
    m = load_manifest(tmp_path)[0]
    assert m.timeout_seconds == MANIFEST_TIMEOUT_MAX_SECONDS


def test_load_manifest_timeout_seconds_at_min_boundary(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            timeout_seconds = 1
            """
        ).strip(),
        encoding="utf-8",
    )
    m = load_manifest(tmp_path)[0]
    assert m.timeout_seconds == 1


@pytest.mark.parametrize("bad_value", [901, 1200, 0, -1])
def test_load_manifest_rejects_out_of_range_timeout_seconds(
    tmp_path: Path, bad_value: int
) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            f"""
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            timeout_seconds = {bad_value}
            """
        ).strip(),
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="timeout_seconds"):
        load_manifest(tmp_path)


def test_load_manifest_rejects_non_integer_timeout_seconds(tmp_path: Path) -> None:
    (tmp_path / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:Hello"]
            timeout_seconds = "300"
            """
        ).strip(),
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="timeout_seconds"):
        load_manifest(tmp_path)


def test_validate_manifest_fields_rejects_non_integer_timeout_seconds() -> None:
    with pytest.raises(ManifestError, match="timeout_seconds"):
        validate_manifest_fields("demo", "0.1.0", ["a:B"], timeout_seconds=3.5)  # type: ignore[arg-type]


def test_validate_manifest_fields_accepts_valid_timeout_seconds() -> None:
    validate_manifest_fields("demo", "0.1.0", ["a:B"], timeout_seconds=300)


def test_validate_manifest_fields_rejects_bool_as_timeout_seconds() -> None:
    # bool is a subclass of int in Python — must be explicitly rejected.
    with pytest.raises(ManifestError, match="timeout_seconds"):
        validate_manifest_fields("demo", "0.1.0", ["a:B"], timeout_seconds=True)  # type: ignore[arg-type]
