"""Tests for named credential profiles and the resolution precedence."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from pegasus_workflows import credentials as cr


@pytest.fixture(autouse=True)
def _hermetic_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the credentials file at a temp path and clear ambient env vars."""
    creds = tmp_path / "credentials"
    monkeypatch.setenv(cr.CREDENTIALS_FILE_ENV_VAR, str(creds))
    monkeypatch.delenv(cr.TOKEN_ENV_VAR, raising=False)
    monkeypatch.delenv(cr.BASE_URL_ENV_VAR, raising=False)
    return creds


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def test_no_file_returns_empty_profiles() -> None:
    assert cr.load_profiles() == {}


def test_write_profile_creates_0600_file(_hermetic_env: Path) -> None:
    path = cr.write_profile("prod", api_key="vnd_secret", api_root="https://api.x")
    assert path == _hermetic_env
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600, oct(mode)
    profiles = cr.load_profiles()
    assert profiles["prod"]["api_key"] == "vnd_secret"
    assert profiles["prod"]["api_root"] == "https://api.x"


def test_write_profile_upserts_in_place(_hermetic_env: Path) -> None:
    cr.write_profile("qa", api_key="vnd_1", api_root="https://qa")
    cr.write_profile("prod", api_key="vnd_2")
    cr.write_profile("qa", api_key="vnd_1b", api_root="https://qa2")
    profiles = cr.load_profiles()
    assert set(profiles) == {"qa", "prod"}
    assert profiles["qa"]["api_key"] == "vnd_1b"
    assert profiles["qa"]["api_root"] == "https://qa2"


def test_omitted_api_root_defaults(_hermetic_env: Path) -> None:
    _write(_hermetic_env, '[qa]\napi_key = "vnd_k"\n')
    token, base_url = cr.resolve(token=None, base_url=None, profile="qa")
    assert token == "vnd_k"
    assert base_url == cr.DEFAULT_API_ROOT


def test_precedence_explicit_flag_wins(_hermetic_env: Path) -> None:
    _write(_hermetic_env, '[prod]\napi_key = "vnd_p"\napi_root = "https://prod"\n')
    token, base_url = cr.resolve(
        token="vnd_explicit", base_url="https://explicit", profile="prod"
    )
    assert token == "vnd_explicit"
    assert base_url == "https://explicit"


def test_precedence_profile_beats_env(
    _hermetic_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write(_hermetic_env, '[prod]\napi_key = "vnd_p"\napi_root = "https://prod"\n')
    monkeypatch.setenv(cr.TOKEN_ENV_VAR, "vnd_env")
    monkeypatch.setenv(cr.BASE_URL_ENV_VAR, "https://env")
    token, base_url = cr.resolve(token=None, base_url=None, profile="prod")
    assert token == "vnd_p"
    assert base_url == "https://prod"


def test_precedence_env_beats_default_profile(
    _hermetic_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write(_hermetic_env, '[default]\napi_key = "vnd_d"\napi_root = "https://default"\n')
    monkeypatch.setenv(cr.TOKEN_ENV_VAR, "vnd_env")
    token, base_url = cr.resolve(token=None, base_url=None, profile=None)
    # env token wins over the default profile's token...
    assert token == "vnd_env"
    # ...but base_url falls through to the default profile (no env base set).
    assert base_url == "https://default"


def test_precedence_default_profile_used_last(_hermetic_env: Path) -> None:
    _write(_hermetic_env, '[default]\napi_key = "vnd_d"\napi_root = "https://default"\n')
    token, base_url = cr.resolve(token=None, base_url=None, profile=None)
    assert token == "vnd_d"
    assert base_url == "https://default"


def test_base_url_ultimate_fallback_is_local() -> None:
    token, base_url = cr.resolve(token="vnd_x", base_url=None, profile=None)
    assert base_url == cr.LOCAL_API_ROOT


def test_unknown_profile_raises() -> None:
    with pytest.raises(cr.ProfileError, match="no credential profile 'ghost'"):
        cr.resolve(token=None, base_url=None, profile="ghost")


def test_write_tightens_preexisting_loose_file(_hermetic_env: Path) -> None:
    _hermetic_env.write_text('[old]\napi_key = "vnd_old"\n', encoding="utf-8")
    os.chmod(_hermetic_env, 0o644)
    cr.write_profile("new", api_key="vnd_new")
    assert stat.S_IMODE(_hermetic_env.stat().st_mode) == 0o600
    assert set(cr.load_profiles()) == {"old", "new"}


def test_write_preserves_home_profiles_when_project_local_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Disable the file override so read precedence (project-local) and the write
    # target (home) genuinely differ — the data-loss scenario.
    monkeypatch.delenv(cr.CREDENTIALS_FILE_ENV_VAR, raising=False)
    home = tmp_path / "home"
    (home / ".pegasus").mkdir(parents=True)
    (home / ".pegasus" / "credentials").write_text(
        '[staging]\napi_key = "vnd_staging"\n', encoding="utf-8"
    )
    monkeypatch.setattr(Path, "home", lambda: home)

    proj = tmp_path / "proj"
    (proj / ".pegasus").mkdir(parents=True)
    (proj / ".pegasus" / "credentials").write_text(
        '[localdev]\napi_key = "vnd_local"\n', encoding="utf-8"
    )
    monkeypatch.chdir(proj)

    cr.write_profile("prod", api_key="vnd_prod")

    home_profiles = cr._load_profiles_from(home / ".pegasus" / "credentials")
    # Home keeps [staging] + gains [prod]; the project-local [localdev] is NOT
    # merged into the home file.
    assert set(home_profiles) == {"staging", "prod"}


def test_value_with_newline_survives_roundtrip(_hermetic_env: Path) -> None:
    # A token pasted with a trailing newline must not corrupt the file.
    cr.write_profile("p", api_key="vnd_key\n", api_root="https://x")
    assert cr.load_profiles()["p"]["api_key"] == "vnd_key\n"


def test_list_summaries_never_exposes_key(_hermetic_env: Path) -> None:
    cr.write_profile("prod", api_key="vnd_TOPSECRET", api_root="https://prod")
    cr.write_profile("qa", api_key="vnd_alsosecret")
    summaries = cr.list_profile_summaries()
    assert summaries == [
        {"name": "prod", "api_root": "https://prod"},
        {"name": "qa", "api_root": cr.DEFAULT_API_ROOT},
    ]
    assert "vnd_TOPSECRET" not in repr(summaries)
    assert all("api_key" not in row for row in summaries)
