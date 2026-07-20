"""Artifact download, integrity verification, and isolated installation.

Pipeline per workflow (all failures skip THAT workflow and log loudly —
one bad artifact must never take down the runner or other workflows):

1. **Download** the zip via the broker-issued presigned GET URL (the runner
   holds no AWS credentials; the URL is the entire authorization), streaming
   to disk with a hard byte cap.
2. **TOCTOU defense (MANDATORY, Unit 6 review):** the presigned *PUT* URL
   issued at upload time outlives finalize validation (~15 min TTL), so the
   S3 bytes can be overwritten AFTER the API validated them. The recorded
   ``artifactSha256`` is the defense: the runner re-hashes the downloaded
   bytes and refuses to unpack/execute on any mismatch.
3. **Extract** into ``<work>/<name>/src`` with its own safety checks. The
   finalize validator already rejected hostile entry names, and the sha
   check proves we hold the same bytes — but the extractor re-checks
   anyway (defense-in-depth): no absolute/``..`` paths, no symlink entries,
   bounded entry count, and a bounded TOTAL decompressed size (the
   install-size guard from Resolved decision #3d — a 10 MB zip can expand
   to gigabytes; the cap is enforced while streaming, not from the
   untrusted size headers).
4. **Venv** creation: ``python -m venv --without-pip --system-site-packages``.
   No pip binary exists inside the venv and no network is touched — the SDK
   (and temporalio/httpx) come from the image's system site-packages; the
   tenant's own source is exposed to the subprocess via ``PYTHONPATH``
   (v1 forbids artifact dependencies, and the runner has no code path that
   could install any).
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import stat
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

import httpx

from .broker_client import ExecutableWorkflow

log = logging.getLogger(__name__)

__all__ = [
    "ArtifactIntegrityError",
    "ArtifactInstallError",
    "PreparedWorkflow",
    "download_artifact",
    "prepare_workflow",
    "safe_extract",
    "select_latest",
    "sha256_file",
]

#: Mirrors MAX_EXECUTABLE_ARTIFACT_BYTES in apps/api/src/lib/workflow-artifact.ts.
MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

#: Mirrors MAX_ZIP_ENTRIES in apps/api/src/lib/workflow-artifact.ts.
MAX_ZIP_ENTRIES = 10_000

_CHUNK = 64 * 1024


class ArtifactIntegrityError(RuntimeError):
    """Downloaded artifact failed the sha256 check — possible TOCTOU overwrite."""


class ArtifactInstallError(RuntimeError):
    """Artifact could not be safely unpacked/installed."""


@dataclass(frozen=True)
class PreparedWorkflow:
    """One workflow ready for subprocess execution."""

    name: str
    version: str
    entry_point: str
    src_dir: Path
    python_bin: Path
    scratch_dir: Path


def sha256_file(path: Path) -> str:
    """Streaming hex SHA-256 of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def download_artifact(
    url: str,
    dest: Path,
    *,
    max_bytes: int = MAX_ARTIFACT_BYTES,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """Stream the presigned GET URL to ``dest``, enforcing a byte cap.

    The URL is self-authorizing (S3 presigned); no auth header is attached —
    in particular the broker token must never be sent to S3.
    """
    written = 0
    with httpx.Client(timeout=60.0, transport=transport) as client:
        with client.stream("GET", url) as response:
            if not response.is_success:
                raise ArtifactInstallError(
                    f"artifact download failed: HTTP {response.status_code}"
                )
            with dest.open("wb") as out:
                for chunk in response.iter_bytes(_CHUNK):
                    written += len(chunk)
                    if written > max_bytes:
                        raise ArtifactInstallError(
                            f"artifact exceeds the {max_bytes}-byte cap during download"
                        )
                    out.write(chunk)


def _is_unsafe_entry_path(name: str) -> bool:
    """Mirror of isUnsafeEntryPath in apps/api/src/lib/workflow-artifact.ts."""
    if not name:
        return True
    if name.startswith("/") or name.startswith("\\"):
        return True
    if len(name) >= 2 and name[0].isalpha() and name[1] == ":":
        return True
    return any(seg == ".." for seg in name.replace("\\", "/").split("/"))


def safe_extract(
    zip_path: Path,
    dest_dir: Path,
    *,
    max_total_bytes: int,
    max_entries: int = MAX_ZIP_ENTRIES,
) -> int:
    """Extract ``zip_path`` into ``dest_dir`` with hostile-archive defenses.

    Every output is created by the extractor itself as a REGULAR file (or
    plain directory) — symlink entries are rejected outright, so nothing the
    archive says can make a path escape ``dest_dir`` or alias another file.
    Decompressed bytes are counted as they stream; the count (never the
    untrusted header sizes) enforces ``max_total_bytes``.

    Returns the total number of decompressed bytes written.
    """
    total = 0
    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = zf.infolist()
            if len(infos) > max_entries:
                raise ArtifactInstallError(
                    f"zip has too many entries ({len(infos)} > {max_entries})"
                )
            for info in infos:
                name = info.filename
                if _is_unsafe_entry_path(name):
                    raise ArtifactInstallError(f"unsafe zip entry path: {name!r}")
                # Reject symlinks (and any other non-regular-file mode). The
                # upper 16 bits of external_attr carry the Unix mode for
                # archives created on POSIX systems.
                mode = (info.external_attr >> 16) & 0xFFFF
                if mode and stat.S_ISLNK(mode):
                    raise ArtifactInstallError(f"symlink zip entry rejected: {name!r}")

                target = dest_dir / name.replace("\\", "/")
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, target.open("wb") as out:
                    while chunk := src.read(_CHUNK):
                        total += len(chunk)
                        if total > max_total_bytes:
                            raise ArtifactInstallError(
                                f"artifact decompresses past the {max_total_bytes}-byte "
                                "install-size guard"
                            )
                        out.write(chunk)
    except zipfile.BadZipFile as exc:
        raise ArtifactInstallError(f"artifact is not a valid zip: {exc}") from exc
    return total


def _create_venv(venv_dir: Path) -> Path:
    """Create the per-workflow venv and return its python binary path.

    ``--without-pip`` is load-bearing: the venv has NO installer, so even a
    future bug in the shim cannot grow a dependency-installation path.
    ``--system-site-packages`` exposes the image's pre-installed SDK
    (pegasus_workflows, temporalio, httpx) without any network access.
    """
    subprocess.run(
        [
            sys.executable,
            "-m",
            "venv",
            "--without-pip",
            "--system-site-packages",
            str(venv_dir),
        ],
        check=True,
        capture_output=True,
    )
    python_bin = venv_dir / "bin" / "python"
    if not python_bin.exists():
        raise ArtifactInstallError(f"venv creation produced no interpreter at {python_bin}")
    return python_bin


def select_latest(workflows: list[ExecutableWorkflow]) -> list[ExecutableWorkflow]:
    """Pick one row per workflow NAME — the most recently created.

    Temporal proxies are registered by name (the run path starts
    ``workflow.name``), so two executable versions of the same name can't
    both be live on one queue. Latest upload wins; the skipped versions are
    logged. Unit 10's run-path routing may refine this contract.
    """
    by_name: dict[str, ExecutableWorkflow] = {}
    for wf in workflows:
        current = by_name.get(wf.name)
        if current is None or wf.created_at > current.created_at:
            if current is not None:
                log.info(
                    "runner.artifact_version_skipped",
                    extra={"workflow_name": wf.name, "skipped_version": current.version},
                )
            by_name[wf.name] = wf
        else:
            log.info(
                "runner.artifact_version_skipped",
                extra={"workflow_name": wf.name, "skipped_version": wf.version},
            )
    return list(by_name.values())


def prepare_workflow(
    work_root: Path,
    wf: ExecutableWorkflow,
    *,
    max_unpacked_bytes: int,
    transport: httpx.BaseTransport | None = None,
) -> PreparedWorkflow:
    """Download, verify, extract, and venv one workflow artifact.

    Raises :class:`ArtifactIntegrityError` on a sha mismatch (the TOCTOU
    case — logged by the caller at ERROR) and :class:`ArtifactInstallError`
    for everything else. Any failure cleans up the partial directory.
    """
    wf_dir = work_root / wf.name
    if wf_dir.exists():
        shutil.rmtree(wf_dir)
    wf_dir.mkdir(parents=True)

    try:
        zip_path = wf_dir / "artifact.zip"
        download_artifact(wf.download_url, zip_path, transport=transport)

        # TOCTOU defense — verify BEFORE the zip is opened for extraction.
        actual = sha256_file(zip_path)
        if actual != wf.artifact_sha256:
            raise ArtifactIntegrityError(
                f"artifact sha256 mismatch for {wf.name}@{wf.version}: "
                f"expected {wf.artifact_sha256}, got {actual} — refusing to install"
            )

        src_dir = wf_dir / "src"
        src_dir.mkdir()
        safe_extract(zip_path, src_dir, max_total_bytes=max_unpacked_bytes)
        zip_path.unlink()  # nothing should re-read the archive after this

        python_bin = _create_venv(wf_dir / "venv")

        scratch_dir = wf_dir / "scratch"
        scratch_dir.mkdir()
        (scratch_dir / "tmp").mkdir()

        if len(wf.entry_points) > 1:
            log.warning(
                "runner.extra_entry_points_ignored",
                extra={
                    "workflow_name": wf.name,
                    "used": wf.entry_points[0],
                    "ignored": list(wf.entry_points[1:]),
                },
            )

        return PreparedWorkflow(
            name=wf.name,
            version=wf.version,
            entry_point=wf.entry_points[0],
            src_dir=src_dir,
            python_bin=python_bin,
            scratch_dir=scratch_dir,
        )
    except Exception:
        shutil.rmtree(wf_dir, ignore_errors=True)
        raise
