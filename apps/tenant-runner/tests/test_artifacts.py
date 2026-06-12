"""Artifact pipeline: sha verify (TOCTOU), hostile zips, size guard, dedupe."""

from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import Path

import httpx
import pytest

from pegasus_tenant_runner.artifacts import (
    ArtifactInstallError,
    ArtifactIntegrityError,
    download_artifact,
    prepare_workflow,
    safe_extract,
    select_latest,
    sha256_file,
)
from pegasus_tenant_runner.broker_client import ExecutableWorkflow


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _workflow(
    *,
    name: str = "my_workflow",
    version: str = "1.0.0",
    sha256: str,
    created_at: str = "2026-06-11T00:00:00.000Z",
) -> ExecutableWorkflow:
    return ExecutableWorkflow(
        id="00000000-0000-4000-8000-000000000001",
        name=name,
        version=version,
        entry_points=(f"{name}.workflow:MyWorkflow",),
        artifact_sha256=sha256,
        artifact_size_bytes=None,
        download_url="https://s3.invalid/artifact.zip",
        created_at=created_at,
    )


def _transport_serving(data: bytes, status_code: int = 200) -> httpx.MockTransport:
    return httpx.MockTransport(
        lambda request: httpx.Response(status_code, content=data)
    )


VALID_ZIP = _zip_bytes(
    {
        "pegasus-workflows.toml": b"[[workflow]]\n",
        "my_workflow/__init__.py": b"",
        "my_workflow/workflow.py": b"MyWorkflow = object\n",
    }
)
VALID_SHA = hashlib.sha256(VALID_ZIP).hexdigest()


# ---------------------------------------------------------------------------
# sha256 / download
# ---------------------------------------------------------------------------


def test_sha256_file_matches_hashlib(tmp_path: Path) -> None:
    p = tmp_path / "f.bin"
    p.write_bytes(b"hello world" * 1000)
    assert sha256_file(p) == hashlib.sha256(b"hello world" * 1000).hexdigest()


def test_download_caps_bytes(tmp_path: Path) -> None:
    dest = tmp_path / "a.zip"
    with pytest.raises(ArtifactInstallError, match="cap"):
        download_artifact(
            "https://s3.invalid/a.zip",
            dest,
            max_bytes=10,
            transport=_transport_serving(b"x" * 100),
        )


def test_download_rejects_http_error(tmp_path: Path) -> None:
    with pytest.raises(ArtifactInstallError, match="403"):
        download_artifact(
            "https://s3.invalid/a.zip",
            tmp_path / "a.zip",
            transport=_transport_serving(b"denied", status_code=403),
        )


def test_download_sends_no_auth_headers(tmp_path: Path) -> None:
    """The presigned URL is self-authorizing — the broker token must never
    leak to S3."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"ok")

    download_artifact(
        "https://s3.invalid/a.zip", tmp_path / "a.zip", transport=httpx.MockTransport(handler)
    )
    headers = {k.lower() for k in seen[0].headers}
    assert "authorization" not in headers
    assert "x-workflow-broker-token" not in headers


# ---------------------------------------------------------------------------
# safe_extract
# ---------------------------------------------------------------------------


def test_safe_extract_writes_files(tmp_path: Path) -> None:
    zip_path = tmp_path / "a.zip"
    zip_path.write_bytes(VALID_ZIP)
    dest = tmp_path / "out"
    dest.mkdir()
    total = safe_extract(zip_path, dest, max_total_bytes=1024 * 1024)
    assert (dest / "my_workflow" / "workflow.py").read_bytes() == b"MyWorkflow = object\n"
    assert total > 0


@pytest.mark.parametrize("evil", ["../escape.py", "/abs.py", "a/../../b.py"])
def test_safe_extract_rejects_traversal_paths(tmp_path: Path, evil: str) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # ZipInfo bypasses zipfile's own name normalisation on write.
        zf.writestr(zipfile.ZipInfo(evil), b"pwn")
    zip_path = tmp_path / "a.zip"
    zip_path.write_bytes(buf.getvalue())
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArtifactInstallError, match="unsafe zip entry"):
        safe_extract(zip_path, dest, max_total_bytes=1024)
    assert not (tmp_path / "escape.py").exists()


def test_safe_extract_rejects_symlink_entries(tmp_path: Path) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("link.py")
        info.external_attr = 0o120777 << 16  # symlink mode
        zf.writestr(info, "/etc/passwd")
    zip_path = tmp_path / "a.zip"
    zip_path.write_bytes(buf.getvalue())
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArtifactInstallError, match="symlink"):
        safe_extract(zip_path, dest, max_total_bytes=1024)


def test_safe_extract_enforces_decompressed_size_guard(tmp_path: Path) -> None:
    """A tiny zip that decompresses huge (zip bomb) trips the streaming
    counter — never the (lying) header sizes."""
    bomb = _zip_bytes({"big.py": b"\0" * (4 * 1024 * 1024)})  # compresses tiny
    zip_path = tmp_path / "a.zip"
    zip_path.write_bytes(bomb)
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArtifactInstallError, match="install-size guard"):
        safe_extract(zip_path, dest, max_total_bytes=1024 * 1024)


def test_safe_extract_enforces_entry_cap(tmp_path: Path) -> None:
    many = _zip_bytes({f"f{i}.py": b"" for i in range(20)})
    zip_path = tmp_path / "a.zip"
    zip_path.write_bytes(many)
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArtifactInstallError, match="too many entries"):
        safe_extract(zip_path, dest, max_total_bytes=1024, max_entries=10)


def test_safe_extract_rejects_non_zip(tmp_path: Path) -> None:
    zip_path = tmp_path / "a.zip"
    zip_path.write_bytes(b"definitely not a zip")
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ArtifactInstallError, match="not a valid zip"):
        safe_extract(zip_path, dest, max_total_bytes=1024)


# ---------------------------------------------------------------------------
# prepare_workflow — the TOCTOU gate
# ---------------------------------------------------------------------------


def test_prepare_workflow_happy_path(tmp_path: Path) -> None:
    wf = _workflow(sha256=VALID_SHA)
    prepared = prepare_workflow(
        tmp_path,
        wf,
        max_unpacked_bytes=1024 * 1024,
        transport=_transport_serving(VALID_ZIP),
    )
    assert prepared.name == "my_workflow"
    assert prepared.entry_point == "my_workflow.workflow:MyWorkflow"
    assert (prepared.src_dir / "my_workflow" / "workflow.py").is_file()
    assert prepared.python_bin.is_file()
    assert prepared.scratch_dir.is_dir()
    # The venv has no pip — there is no dependency-install path at all.
    assert not (prepared.python_bin.parent / "pip").exists()
    # The archive is gone once extracted.
    assert not (tmp_path / "my_workflow" / "artifact.zip").exists()


def test_prepare_workflow_sha_mismatch_refuses_to_install(tmp_path: Path) -> None:
    """TOCTOU defence: bytes differing from the finalize-recorded digest
    (e.g. re-PUT via the still-valid presigned upload URL) are rejected
    BEFORE extraction, and nothing is left on disk."""
    tampered = _zip_bytes({"evil.py": b"import os\n"})
    wf = _workflow(sha256=VALID_SHA)  # expects the validated bytes
    with pytest.raises(ArtifactIntegrityError, match="sha256 mismatch"):
        prepare_workflow(
            tmp_path,
            wf,
            max_unpacked_bytes=1024 * 1024,
            transport=_transport_serving(tampered),
        )
    # Cleanup happened: no partial install, no extracted files, no venv.
    assert not (tmp_path / "my_workflow").exists()


def test_prepare_workflow_cleans_up_on_install_failure(tmp_path: Path) -> None:
    sha_of_garbage = hashlib.sha256(b"garbage").hexdigest()
    wf = _workflow(sha256=sha_of_garbage)
    with pytest.raises(ArtifactInstallError):
        prepare_workflow(
            tmp_path,
            wf,
            max_unpacked_bytes=1024 * 1024,
            transport=_transport_serving(b"garbage"),
        )
    assert not (tmp_path / "my_workflow").exists()


# ---------------------------------------------------------------------------
# select_latest
# ---------------------------------------------------------------------------


def test_select_latest_dedupes_by_name_keeping_newest() -> None:
    old = _workflow(sha256="a" * 64, version="1.0.0", created_at="2026-06-01T00:00:00.000Z")
    new = _workflow(sha256="b" * 64, version="1.1.0", created_at="2026-06-10T00:00:00.000Z")
    other = _workflow(
        name="other_wf", sha256="c" * 64, created_at="2026-06-05T00:00:00.000Z"
    )
    # Order-independent: newest wins whichever side of the comparison it's on.
    assert {w.version for w in select_latest([old, new, other])} == {"1.1.0", "1.0.0"}
    picked = {w.name: w for w in select_latest([new, old, other])}
    assert picked["my_workflow"].version == "1.1.0"
    assert picked["other_wf"].name == "other_wf"
