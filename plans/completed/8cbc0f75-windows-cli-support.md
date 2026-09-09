# Windows support for the `pegasus-workflows` CLI

## Context

**Confirmed in the field:** `pegasus-workflows setup` crashes on Windows with
`AttributeError: module 'os' has no attribute 'fchmod'`. That is `credentials.py:208`,
reached via `setup` → `_seed_profile` (`cli/setup.py:128`) → `write_profile`. It fires on
Python 3.11/3.12, where Windows has no `os.fchmod`, and it lands on **step 1 of 3** — so
the very first command a Windows author runs dies before writing a single credential.
There is no workaround short of hand-authoring `~/.pegasus/credentials`.

`packages/workflows-sdk-python` ships the `pegasus-workflows` CLI — per `CLAUDE.md`, the
external product boundary that integration/workflow authors (and their AI coding agents)
use without repo access. Today it has **no stated platform**: no OS classifiers in
`pyproject.toml`, no "Supported platforms" section in the README, zero `sys.platform` /
`os.name` branches anywhere in the package, and CI is `ubuntu-latest` only. A Windows
author is currently on their own.

An audit of the whole package found the CLI is **much closer to portable than expected**:
it uses `pathlib` throughout (no `os.path.join`, no `posixpath`, no `.split("/")` on
paths), has no signals/`fcntl`/`pty`/`fork`/`termios` usage, no `shell=True`, and its four
runtime deps (`temporalio`, `httpx`, `typer`, `mcp`) are all cross-platform — `uv.lock`
already resolves Windows arms (`colorama`, `pywin32` under `sys_platform == 'win32'`).

Only **one code path actually breaks** — and it is exactly the one the field report hit —
plus a latent encoding class. The intended outcome is that Windows becomes a declared,
CI-verified platform rather than an accident.

**Difficulty: low.** One PR: 2 code fixes, 4 test guards, 1 new CI job, docs.
The audit is what makes it low — the package already uses `pathlib` everywhere and has no
POSIX-only imports, so this is a handful of targeted fixes, not a port. The only remaining
unknown is what the first Windows CI run surfaces, which is why the CI job ships here and
not as a follow-up.

---

## The two real defects

### 1. Credential writing is broken on Windows — `pegasus_workflows/credentials.py:201-209`

`write_profile()` is the backing store for `pegasus-workflows configure` and
`pegasus-workflows setup`. Two problems in the same block — **the first is the confirmed
field crash, the second is what you hit next once the first is fixed.** They must ship
together: fixing `fchmod` alone lets the write proceed for the first time, which is
precisely what exposes the newline bug on the _next_ command.

- **`os.fchmod(fd, 0o600)` (line 208) — CONFIRMED, this is the reported crash.**
  `os.fchmod` did not exist on Windows before Python 3.13, and this package's floor is
  `requires-python = ">=3.11"`. On Windows + 3.11/3.12 this raises `AttributeError`, so
  **no credential file can be written at all**. On 3.13+ it exists but only toggles the
  read-only attribute, so `0o600` is a no-op. Note the floor must stay `>=3.11` — the fix
  is a `hasattr` guard, not a Python-version bump that would strand users.
- **`os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)` (line 201)** — on
  Windows, `os.open` without `os.O_BINARY` returns a CRT **text-mode** fd, and
  `os.fdopen(fd, "w", ...)` (line 203) wraps it in a `TextIOWrapper` that _also_
  translates `\n` → `\r\n`. If both layers translate, the file gets `\r\r\n`, `tomllib`
  rejects the stray `\r`, and every subsequent command fails to read the credentials the
  CLI just wrote. This is why `tempfile` maintains a separate `_bin_openflags`.

**Fix** — preserve the existing security intent, don't rewrite it. The comment at lines
198-200 documents a deliberate property (re-tighten a _pre-existing_ loose file, bound to
this exact fd, immune to a path swap); keep that on POSIX:

```python
flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0)
fd = os.open(path, flags, 0o600)
...
fh = os.fdopen(fd, "w", encoding="utf-8", newline="\n")
...
if hasattr(os, "fchmod"):
    os.fchmod(fd, 0o600)
```

There is no stdlib ACL equivalent on Windows, and shelling out to `icacls` / depending on
`pywin32` is over-engineering for a file under `%USERPROFILE%`, which is already
user-private by its inherited ACL. Update the `write_profile` docstring (lines 180-185)
to say so explicitly: on Windows the protection is the profile directory's default ACL,
not a `0600` mode bit.

Do **not** lean on `path.parent.mkdir(mode=0o700, ...)` (line 187) as the Windows
guarantee — whether Windows honors that mode is version-dependent, and with
`exist_ok=True` it never applies to an already-existing `~/.pegasus` anyway.

The `newline="\n"` and `O_BINARY` interaction is the one thing that **cannot be
reproduced from Linux**, and the field report can't confirm it either — that crash happened
_before_ any bytes were written. The Windows CI leg below is what proves it, via
`test_credentials.py`'s existing write-then-read-back round trip.

### 2. Eight `read_text()` / `write_text()` calls with no `encoding=`

These fall back to `locale.getpreferredencoding()` — UTF-8 on Linux/macOS, but the ANSI
codepage (typically `cp1252`) on Windows. Non-ASCII content in a feedback-form message or
an integration-config mapping then raises `UnicodeDecodeError` on read or is silently
mis-encoded on write.

- `pegasus_workflows/cli/feedback_form.py` — lines 70, 81, 153, 159
- `pegasus_workflows/cli/integration_config.py` — lines 94, 279, 297, 305

Add `encoding="utf-8"` to each. This is not a new convention: every other call site in the
package already does it (`deployments.py:114`, `cli/init.py:74`, `cli/diagram.py:138`,
`cli/setup.py:161`) — these eight are the outliers.

**CI will not catch this on its own** — the existing fixtures are pure ASCII, so `cp1252`
never bites. Add one regression test that round-trips a non-ASCII `message.txt` through
`feedback_form` pull → read.

---

## Tests

Four asserts read a POSIX mode bit and will fail on Windows (`S_IMODE` reports `0o666`):

- `tests/test_credentials.py:35-36` and `:110-112`
- `tests/test_cli_setup.py:103`
- `tests/test_cli_profile.py:33`

**Guard the assert, not the test.** Three of these four sit inside tests that also do a
`write_profile` → `load_profiles` round trip — `test_write_profile_creates_0600_file`
(`:33-37`), `test_configure_via_flags_writes_0600` (`test_cli_profile.py:26-34`), and the
full `setup` end-to-end (`test_cli_setup.py:103-104`). That round trip is the **only thing
that catches the newline bug**, and it exercises the exact command that crashed in the
field. `skipif`-ing the whole test on Windows would delete the Windows leg's most valuable
coverage. So wrap just the `S_IMODE` line:

```python
if sys.platform != "win32":  # POSIX mode bits; on Windows the ~/.pegasus ACL is the protection
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
```

Only `test_credentials.py:105-112` — the chmod-644-then-retighten test, which is _entirely_
about the POSIX re-tightening property — is a legitimate whole-test
`@pytest.mark.skipif(sys.platform == "win32", reason=...)`.

Worth knowing: `test_credentials.py:146` already round-trips an api_key containing a
literal `"\n"`. That is the sharpest existing detector for the `\r\r\n` corruption — if the
`O_BINARY` fix is wrong, that test fails on the Windows leg. No new test needed for it.

No other test needs changing: nothing in `tests/` shells out, uses Docker, or hardcodes
`/tmp` or `HOME`.

---

## CI — `.github/workflows/ci.yml`

Add a **new job** next to `workflows-stdlib-python` (line 299), rather than converting
that job to an `os:` matrix. Two reasons: a matrix would rename the existing check
(`Workflows Stdlib (Python)`), and the Windows leg should run the **SDK steps only** —
`packages/workflows-stdlib` is server-side code that was not swept and does not need a
Windows gate.

```yaml
workflows-sdk-python-windows:
  name: Workflows SDK (Python, Windows)
  runs-on: windows-latest
  timeout-minutes: 15
  needs: changes
  if: needs.changes.outputs.workflows_stdlib == 'true'
  defaults:
    run:
      shell: bash
```

Steps mirror the SDK half of the existing job: `actions/checkout@v6` →
`actions/setup-python@v6` (3.12) → `pip install -e 'packages/workflows-sdk-python[dev]'`
→ ruff → pytest, with `working-directory: packages/workflows-sdk-python`.

- **`shell: bash`** (Git Bash ships on the Windows runner) so the `&&` and quoting copied
  from the Linux job behave identically instead of relying on pwsh to match.
- **`timeout-minutes: 15`**, not 10 — `windows-latest` runs roughly 2× slower on Python
  installs, and a timeout would read as a flake.
- **Skip `pip_audit`** on this leg — same resolved closure as the Linux job, no new signal.
- **Do not set `PYTHONUTF8=1`** on the runner. That would mask the exact class of bug
  (defect #2) this leg exists to catch.
- Reuse the existing `changes.outputs.workflows_stdlib` path filter (`ci.yml:55,61,71`) —
  it already covers `packages/workflows-sdk-python/**`.
- Follow the file's convention of a header comment block explaining _why_ the job exists.

### Finding: the Python CI jobs are advisory today

Worth surfacing, because it affects whether "CI-verified" means anything. `ci.yml` has **no
aggregate/fan-in job** — every job declares only `needs: changes`. The required checks on
`main` are exactly `Secret Scanning (Betterleaks)`, `Typecheck`, `Lint`, `Test`,
`E2E Tests`, and the `merge-queue-main` ruleset declares no status-check rule of its own.

So `Workflows Stdlib (Python)` — along with `Tenant Runner (Python)` and
`Temporal Worker (Python)` — is **non-blocking**: it can go red without stopping a merge.
The new Windows job inherits that. Adding it is therefore safe (it cannot wedge the queue),
but on its own it is decorative.

**Recommendation:** after the job has passed once on `main`, add
`Workflows SDK (Python, Windows)` to the required-checks list. That is a repo-admin action
on branch protection, not a file in this PR, so it needs an explicit go — and it's worth
asking at the same time whether the three existing Python jobs should become required too,
since that gap is almost certainly unintentional.

`release-sdk-python.yml` stays Linux-only — it builds a pure-Python wheel; a Windows build
leg would add nothing.

---

## Docs — the discovery surfaces

`CLAUDE.md` requires that an SDK change propagate to its discovery surfaces.

- **`packages/workflows-sdk-python/README.md`** — add a short **Supported platforms**
  section: Linux, macOS, Windows; Python 3.11+. Windows notes should cover
  (a) PowerShell venv activation (`.venv\Scripts\Activate.ps1`) alongside the POSIX
  `source .venv/bin/activate`, (b) that credentials are protected by the `~/.pegasus`
  directory ACL rather than a `0600` mode bit, and (c) that `pegasus-workflows test`
  requires Docker Desktop (it auto-starts local Temporal via `docker compose`; the code is
  already portable — `shutil.which("docker")` + list-form `subprocess.run`, no
  `shell=True`). Also caveat the five existing `0600` mentions (lines 43, 49, 53, 892, 950).
- **`packages/workflows-sdk-python/pyproject.toml`** — add `Operating System ::` classifiers
  (POSIX/Linux, MacOS, Microsoft :: Windows) next to the existing Python classifiers
  (lines 14-17), so PyPI metadata states the platform.
- **`CHANGELOG.md`** + a version bump, **then publish after merge**. Per the standing rule,
  the SDK ships from this repo's sessions: push a `sdk-python-v<version>` tag on the merged
  commit carrying that `pyproject.toml` version, which triggers `release-sdk-python.yml`
  (trusted-publishing OIDC, no token) to build and upload to PyPI. This is not optional
  polish — **PyPI is the only way the fix reaches the person who reported it.** An
  unpublished bump means the bug is still broken for every Windows user.
  (Interim, if they need it before the release: the README's git-subdirectory install,
  `pip install "pegasus-workflows-sdk @ git+https://…#subdirectory=packages/workflows-sdk-python"`.)
  Note the separate rule that _integration/workflow configs_ are never published from a
  platform session still holds — it just doesn't apply here.
- No MCP resource or CLI `--help` string repeats the POSIX activation line, so those two
  surfaces need no change. (Confirmed by grep over `cli/mcp_server.py`.)

**Follow-up, not this PR:** the workflow-authoring consumer repo
`~/repos/pegasus-workflows/CLAUDE.md` has the same POSIX-only assumptions at line 46
(`source .venv/bin/activate`) and line 258 (`mode 0600`). Different repo, different commit.

---

## Explicitly out of scope (audited, confirmed harmless)

Listed so nobody re-litigates them: hardcoded `/` in `cli/init.py:39,71-72` (Windows
accepts `/` in paths); `f"{dir}/{file}"` in `cli/diagram.py:59,123` and
`cli/mcp_server.py:731` (display/prompt strings, never opened); zip `arcname` in
`cli/package.py:78` (`zipfile` normalizes separators); `rglob` sort order in
`cli/package.py:72` (reproducibility only, and `artifactSha256` is already not
byte-stable); CRLF in the `push.py:64-69` diagram vs. the zip's copy (the server never
byte-compares them — `apps/api/src/handlers/workflows.ts`); and
`NamedTemporaryFile(delete=False)` in `cli/mcp_server.py:667-681`, which already uses the
Windows-safe close-then-reopen pattern.

---

## Verification

1. **Linux, unchanged behavior** — from `packages/workflows-sdk-python`:
   `python -m ruff check . && python -m pytest -q`. Every mode assert must still _execute_
   here (the `sys.platform != "win32"` branch taken), and only the one whole-test `skipif`
   may report as skipped. A Linux run that skips more than that means a guard is inverted.
2. **`0600` still enforced on POSIX** — `pegasus-workflows configure --profile winftest`,
   then `stat -c '%a' ~/.pegasus/credentials` → `600`. Then `chmod 644` it, re-run
   `configure`, and confirm it is re-tightened to `600` — that is the pre-existing-loose-file
   property the `fchmod` guard must not lose.
3. **Windows CI is the real gate** — push the branch and read the new
   `Workflows SDK (Python, Windows)` check. It proves the `O_BINARY` / `newline` fix:
   `test_credentials.py`'s write-then-read round trip fails on Windows if the CRLF
   double-translation is still there.
4. **Encoding regression** — the new non-ASCII round-trip test must pass on the Windows
   leg specifically (it will pass on Linux either way).
5. **Re-run the original field repro on the reporter's Windows box** — this is the
   acceptance test, since it's the case that prompted the work. `pip install -e .`, then
   `pegasus-workflows setup`. It must get past step 1 (no `AttributeError`), then
   **run a second command that reads the file back** — `pegasus-workflows profile list` —
   which is what catches the newline bug. Then `init` and `package` to smoke the remaining
   file-writing commands.

Audited and found already Windows-clean, so not part of this change: `cli/setup.py` (both
its file calls already pass `encoding="utf-8"`; the `.mcp.json` stanza's bare
`"command": "pegasus-workflows"` resolves to the `.exe` shim on PATH) and `cli/init.py`
(encoding everywhere; its `/`-joined relative template paths are valid on Windows).
