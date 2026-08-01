# Audit: Python Toolchain (workflows SDK + stdlib + temporal worker)

> **Status: SCOPED** — 2026-06-10

> **Cleanup audit 2026-07-30 — PARTIAL.** Only a slice of Phase 1 had landed,
> opportunistically via #349 (ruff + pytest on the SDK, pytest on the stdlib,
> both path-filtered). The headline risk — `apps/temporal-worker` referenced
> nowhere in `ci.yml`, ~560 lines of tests running in no workflow while the
> image shipped to staging and prod ECR ungated — was still live. Phases 2-5
> are essentially unstarted.
>
> **Update 2026-07-31 — Phase 1.1 and 1.2 are now DONE.** The worker has a
> `temporal-worker-python` job in `ci.yml` (ruff + pytest, path-filtered on the
> worker + SDK + stdlib) and a `test` gate in `temporal-worker.yml` that both
> `staging` and `prod` depend on, so the image can no longer be built or pushed
> without a green ruff+pytest. Wiring it up surfaced that **ruff had never run
> against this tree**: two `UP035` violations were failing and are fixed. Both
> `prod` and `staging` re-check the test result independently — `staging` is
> _skipped_ (not failed) when `test` fails, and `prod` treats a skipped
> `staging` as passable, so gating only `staging` would have left prod open.
> Rollback dispatches deliberately bypass the gate.
>
> **Update 2026-08-01 — PHASE 1 IS COMPLETE.** The two remaining items landed:
> `pip-audit --skip-editable` now runs in all three Python CI jobs
> (`tenant-runner-python`, `temporal-worker-python`, `workflows-stdlib-python`),
> and ruff now covers `packages/workflows-stdlib` — the last un-linted Python
> tree, which needed a `[tool.ruff]` block in its `pyproject.toml` and three
> real fixes (`E501`, `I001`, `F401`), the same pattern as the `UP035` pair the
> worker's first-ever ruff run surfaced. pip-audit was clean on all three
> installable trees at merge time, so the gate landed green rather than
> importing a backlog. **Rescope applied:** the plan predated
> `apps/tenant-runner`, so Phase 1 spans four Python trees, not three — the CI
> shape is three jobs (the stdlib rides in the SDK's job, since it declares no
> dependencies of its own and imports `pegasus_workflows`).
>
> **Phases 2-5 remain** (dep upper bounds on the worker + runner, Dependabot pip
> for those trees + docker, release-workflow dedup, stdlib manifest/registry
> drift harness, uv lockfile, Turbo wrappers), so this plan stays in-progress.

Unit 11 of the CI/CD + devops audit batch. Scope: make Python a first-class
citizen in the dev/CI flow. Covers `packages/workflows-sdk-python`,
`packages/workflows-stdlib`, `apps/temporal-worker`, and the three Python
workflows (`release-sdk-python.yml`, `publish-stdlib.yml`, the Python-relevant
parts of `temporal-worker.yml`).

**Out of scope (owned by other units):** temporal-worker.yml staging/prod job
deduplication (Unit 2); supply-chain policy beyond Python (Unit 5). This plan
owns Python dependency pinning and pip-audit placement because they are
toolchain-local.

---

## Context

Three Python codebases exist, all invisible to Turbo (no `package.json`,
documented in `CLAUDE.md` package map):

| Tree                            | What                                                                              | Tests                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/workflows-sdk-python` | SDK + `pegasus-workflows` CLI (hatchling, `requires-python >=3.11`)               | 5 test files, ~650 lines (`tests/test_api.py`, `test_manifest.py`, `test_cli_init.py`, `test_decorator.py`, `test_package.py`) |
| `packages/workflows-stdlib`     | Curated workflows (`send_quote_followup` only, manifest `pegasus-workflows.toml`) | **None** (but see worker e2e below)                                                                                            |
| `apps/temporal-worker`          | Fargate worker, Python 3.12 container (`apps/temporal-worker/Dockerfile`)         | 5 test files, ~480 lines incl. a real `WorkflowEnvironment.start_local()` e2e (`tests/test_worker_e2e.py:45-79`)               |

### Findings (verified, with evidence)

1. **PRs touching Python get ZERO CI.** `.github/workflows/ci.yml` has no
   Python job (jobs: secret-scan, typecheck, lint, test, e2e — all
   Node/Turbo). SDK lint+tests run only on `sdk-python-v*` tag pushes
   (`.github/workflows/release-sdk-python.yml:21-24`, lint at `:52`, pytest
   at `:58`). A broken SDK change merges green and only fails at release
   time — or worse, see (2).

2. **Worker tests run NOWHERE.** `apps/temporal-worker/tests/` (config,
   registry, runtime_client, status_sync, worker_e2e) is not referenced by
   any workflow (`grep -rn pytest .github/workflows/` hits only
   `release-sdk-python.yml`). Meanwhile `.github/workflows/temporal-worker.yml`
   builds and pushes the worker image to **staging AND prod ECR + forces a
   Fargate redeploy** on any `main` push touching `apps/temporal-worker/**`,
   `packages/workflows-sdk-python/**`, or `packages/workflows-stdlib/**`
   (`temporal-worker.yml:28-35`) with **no test or lint step at all**
   (`temporal-worker.yml:56-141`). Given the batch-worktree protocol merges
   directly to main without PRs, Python code can reach prod ECS without ever
   executing pytest. The only backstop is the ECS circuit breaker
   (`temporal-worker.yml:106-110`), which catches crash-loops, not logic bugs.

3. **Stdlib publishes with no pre-publish validation.**
   `publish-stdlib.yml:48-67` installs the SDK from PyPI (unpinned,
   `pip install --upgrade pegasus-workflows-sdk`, `:50`) and runs
   `pegasus-workflows push`. Manifest parsing happens inside `push`
   (`packages/workflows-sdk-python/pegasus_workflows/manifest.py:127`
   `load_manifest`), but nothing verifies the declared
   `entry_points` (`packages/workflows-stdlib/pegasus-workflows.toml:11`)
   actually import, nor that they stay in sync with the worker's curated
   registry (`apps/temporal-worker/pegasus_temporal_worker/registry.py:50-56`
   `_CURATED_WORKFLOWS`). Manifest/registry drift = published workflow the
   worker refuses to run, discovered only at execution time.

4. **No upper bounds, no lockfile, non-reproducible worker images.**
   - SDK: `temporalio>=1.7`, `httpx>=0.27`, `typer>=0.12`
     (`packages/workflows-sdk-python/pyproject.toml:18-22`).
   - Worker: `temporalio>=1.7`, `httpx>=0.27`
     (`apps/temporal-worker/pyproject.toml:21-27`).
   - The Dockerfile resolves dependencies fresh on every build
     (`apps/temporal-worker/Dockerfile:50-52`: `pip install` of both
     packages, no constraints file), and the base image is tag-pinned but not
     digest-pinned (`Dockerfile:22,63` `python:3.12-slim`). A temporalio 2.0
     or httpx 1.0 release changes the prod image with no code change. Two
     builds of the same SHA can differ.

5. **No Python vulnerability scanning.** `pip-audit` (or equivalent) appears
   nowhere in `.github/workflows/`. The Node side has `audit-ci`
   (`ci.yml:128-129`); Python has nothing.

6. **Dependabot ignores Python entirely.** `.github/dependabot.yml` has a
   single `npm` ecosystem entry — no `pip` entries for the three Python
   dirs, no `docker` entry for the worker Dockerfile. Python deps will
   silently age.

7. **Release workflow hand-duplicates the dependency list.**
   `release-sdk-python.yml:49` installs
   `pip build pytest ruff temporalio httpx typer` by name instead of
   `pip install -e .[dev]` — a new runtime dep added to `pyproject.toml`
   would still pass (the `-e .` at `:55` pulls it) but lint at `:52` runs
   before install with a hand-rolled env, and the duplication invites drift.
   Tool versions (ruff, pytest) are also unpinned in CI, so a ruff minor
   release can fail a release tag that passed locally.

8. **`.venv` is NOT committed** (research note in the audit brief was wrong):
   `git ls-files packages/workflows-sdk-python | grep -c venv` → 0;
   `packages/workflows-sdk-python/.gitignore:6` and root `.gitignore:63-65`
   already cover `.venv/`, `__pycache__/`, `*.pyc`. No action needed.

9. **Local dev loop is already decent** — `pegasus-workflows test` spins up
   `docker-compose.temporal.yml` (repo root, exists) and runs a workflow
   locally (`pegasus_workflows/cli/test.py`). The worker's
   `tests/conftest.py` docstring already anticipates `uv run pytest`. The
   worker e2e test self-skips when the temporalio test server can't be
   downloaded (`test_worker_e2e.py:57-61`), so it is CI-safe by design —
   and on GitHub-hosted runners it will actually run (network available).

10. Minor: `test_worker_e2e.py:11` docstring claims the e2e test is
    `@pytest.mark.integration`-marked; it is actually only
    `@pytest.mark.asyncio` (`:45`). Harmless today (it self-skips), but fix
    the docstring or add the marker when touching the file.

### AI-integration assessment (honest)

- **No AI needed** for CI jobs, pinning, lockfiles, or the stdlib harness —
  these are deterministic plumbing; adding an LLM would be toil, not leverage.
- **One genuine use:** when Phase 3 (sandboxed tenant code) lands, an
  AI-assisted "workflow review" step (Claude reviewing tenant-submitted
  workflow code for obvious foot-guns before publish) would add value — but
  that belongs to the Phase 3 plan
  (`plans/todo/workflows-phase3-sandboxed-tenant-code-and-triggers.md`), not
  this one. For the curated stdlib, the existing `/code-review` skill already
  covers Python diffs; no new integration warranted.
- Dependabot + pip-audit (Plan items below) are the automation-supported
  process change; they need no AI.

---

## Plan

### Phase 1 — Python CI job on every PR/push (quick win, highest value) — DONE

- [x] **1.1 Add a `python` job to `.github/workflows/ci.yml`** (~1h).
      _Shipped as three path-filtered jobs rather than one always-run job:
      `tenant-runner-python`, `temporal-worker-python`,
      `workflows-stdlib-python`. Each filter includes `.github/workflows/ci.yml`
      itself so a change to the job self-validates, which is what closes the
      required-check-vs-skipped trap the sketch below was avoiding. `pip-audit`
      (2026-08-01) and `Ruff (stdlib)` (2026-08-01) completed the step list._
      Always-run (no path filter): total runtime is ~2-3 min with pip
      caching, well under the existing `e2e` job's wall-clock, so it adds
      zero latency and avoids the required-check-vs-skipped-workflow trap
      that a separate path-filtered workflow would create. Covers all three
      trees; the worker tests transitively exercise the stdlib (registry
      imports `send_quote_followup.workflow`,
      `registry.py:29`). Sketch (append to `ci.yml` jobs):

      ```yaml
      python:
        name: Python (SDK + worker + stdlib)
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v6
          - uses: actions/setup-python@v6
            with:
              python-version: '3.12'
              cache: 'pip'
              cache-dependency-path: |
                packages/workflows-sdk-python/pyproject.toml
                apps/temporal-worker/pyproject.toml
          - name: Install SDK (editable, with dev deps)
            run: python -m pip install --upgrade pip && python -m pip install -e 'packages/workflows-sdk-python[dev]'
          - name: Install worker (editable, with dev deps)
            run: python -m pip install -e 'apps/temporal-worker[dev]'
          - name: Ruff (all Python trees)
            run: |
              python -m ruff check packages/workflows-sdk-python
              python -m ruff check apps/temporal-worker
              python -m ruff check packages/workflows-stdlib
          - name: SDK tests
            working-directory: packages/workflows-sdk-python
            run: python -m pytest -q
          - name: Worker tests (incl. stdlib e2e via WorkflowEnvironment)
            working-directory: apps/temporal-worker
            run: python -m pytest -q
          - name: pip-audit
            run: |
              python -m pip install pip-audit
              python -m pip-audit --skip-editable
      ```

      Notes: worker `tests/conftest.py` already sys.path-injects the SDK and
      stdlib, so no extra install is needed for the stdlib. `ruff check` on
      `packages/workflows-stdlib` picks up the SDK's repo-adjacent defaults;
      if it complains about missing config, run it with
      `--config packages/workflows-sdk-python/pyproject.toml`.

- [x] **1.2 Gate the worker image build on the same tests** (~20min). _Shipped
      #568 as a standalone `test` job in `temporal-worker.yml` that BOTH
      `staging` and `prod` depend on — gating only `staging` would have left
      prod open, because a failed `test` leaves `staging` skipped and `prod`
      treats a skipped `staging` as passable. Rollback dispatches deliberately
      bypass the gate._ Because
      batch merges land on main without PRs, add a fast test step to the
      `staging` job of `.github/workflows/temporal-worker.yml` _before_ the
      Docker build (after the checkout at `temporal-worker.yml:74`):

      ```yaml
      - uses: actions/setup-python@v6
        with:
          python-version: '3.12'
          cache: 'pip'
      - name: Test before building image
        run: |
          python -m pip install --upgrade pip
          python -m pip install -e 'packages/workflows-sdk-python[dev]' -e 'apps/temporal-worker[dev]'
          python -m pytest -q apps/temporal-worker/tests packages/workflows-sdk-python/tests
      ```

      Boundary note: this adds a step inside the existing `staging` job; it
      does NOT restructure the staging/prod job duplication (Unit 2 owns
      that). If Unit 2 extracts a shared/reusable job, this gate moves with it.

### Phase 2 — Dependency hygiene (pinning, audit, update automation)

- [ ] **2.1 Add upper bounds to all Python deps** (~30min). Edit
      `packages/workflows-sdk-python/pyproject.toml:18-22` and
      `apps/temporal-worker/pyproject.toml:21-27`:

      ```toml
      dependencies = [
        "temporalio>=1.7,<2.0",
        "httpx>=0.27,<1.0",
        "typer>=0.12,<1.0",   # SDK only
      ]
      [project.optional-dependencies]
      dev = [
        "pytest>=8.0,<9",
        "pytest-asyncio>=0.23,<2",  # worker only
        "ruff>=0.6,<0.15",          # bump ceiling deliberately, not implicitly
      ]
      ```

      Rationale: temporalio and httpx are the two deps where a major bump
      changes runtime behavior inside a prod container that rebuilds its
      dependency set on every image build (Finding 4). Keep floors as-is so
      one resolution satisfies SDK + worker (comment at worker
      `pyproject.toml:22-24` already documents this contract).

- [ ] **2.2 Add `pip` + `docker` ecosystems to `.github/dependabot.yml`**
      (~15min):

      ```yaml
        - package-ecosystem: 'pip'
          directories:
            - '/packages/workflows-sdk-python'
            - '/apps/temporal-worker'
          schedule:
            interval: 'weekly'
          groups:
            python-minor-and-patch:
              update-types: ['minor', 'patch']
          target-branch: 'main'
        - package-ecosystem: 'docker'
          directory: '/apps/temporal-worker'
          schedule:
            interval: 'weekly'
          target-branch: 'main'
      ```

      With Phase 1 in place, these PRs are actually tested — without it,
      Dependabot pip PRs would be rubber stamps.

- [ ] **2.3 Fix `release-sdk-python.yml` dep duplication + pin SDK install in
      `publish-stdlib.yml`** (~20min). - `release-sdk-python.yml:48-58`: replace the hand-rolled
      `pip install --upgrade pip build pytest ruff temporalio httpx typer` + later `-e .` with:

        ```yaml
        - name: Install package + dev tooling
          run: python -m pip install --upgrade pip build && python -m pip install -e '.[dev]'
        ```

        (lint and tests then use the pyproject-declared, ceiling-bounded
        tool versions).
      - `publish-stdlib.yml:50`: pin the SDK the stdlib is published with —
        `pip install 'pegasus-workflows-sdk==0.1.*'` (or read an exact pin
        from a one-line `packages/workflows-stdlib/sdk-version.txt` so bumping
        is an explicit, reviewable diff). Today `--upgrade` means a bad SDK
        release instantly breaks stdlib publishing.

### Phase 3 — Stdlib validation harness (publish-time safety)

- [ ] **3.1 Create `packages/workflows-stdlib/tests/test_manifest.py`** (~1.5h).
      Pure-Python validation, no Temporal server needed: - `load_manifest("pegasus-workflows.toml")` parses clean
      (`pegasus_workflows.manifest:load_manifest`). - Every `entry_points` string (`module:Class`) imports and resolves to a
      class decorated by `@pegasus_workflow` (assert the attribute the
      decorator sets — check `pegasus_workflows/__init__.py` for the exact
      marker when implementing). - **Drift check:** manifest workflow names ==
      `pegasus_temporal_worker.registry._CURATED_WORKFLOWS.keys()`
      (import via the same sys.path technique as
      `apps/temporal-worker/tests/conftest.py:25-35`). This is the test
      that catches "published but worker won't run it" (Finding 3). - Smoke execution is intentionally NOT duplicated here — the worker's
      `test_worker_e2e.py` already executes the registered workflow against
      `WorkflowEnvironment.start_local`. Instead, generalize that test to
      iterate `workflow_classes()` so future stdlib additions are
      auto-covered (today it indexes `[0]`, `test_worker_e2e.py:65`). - Wire into the Phase 1 `python` CI job (add
      `python -m pytest -q packages/workflows-stdlib/tests` after the
      worker tests; reuse the same env).

- [ ] **3.2 Pre-publish validation step in `publish-stdlib.yml`** (~30min).
      Before the `push` step (`publish-stdlib.yml:52`), insert:

      ```yaml
      - name: Validate manifest + entry points before publish
        working-directory: packages/workflows-stdlib
        run: |
          python -m pip install pytest
          python -m pytest -q tests
      ```

      (the SDK is already installed from PyPI two steps earlier, which is
      exactly the resolution a tenant would have — dogfooding preserved).
      Skip the registry drift-check here if importing the worker package from
      a PyPI-only env proves awkward; mark that one test
      `@pytest.mark.skipif` on `pegasus_temporal_worker` being unimportable —
      it still always runs in ci.yml where the full tree is installed.

### Phase 4 — uv adoption for reproducible worker builds (assessed: adopt, narrowly)

- [ ] **4.1 Adopt uv for `apps/temporal-worker` only; generate `uv.lock`** (~2h).
      Honest cost/benefit: - **Benefit:** the real win is a committed lockfile making the prod
      worker image byte-reproducible (Finding 4) — pip alone has no
      first-class lock. Secondary: 10-100x faster installs (shaves CI
      minutes), one tool for venv+lock+run, and
      `apps/temporal-worker/tests/conftest.py` docstring already assumes
      `uv run pytest`. - **Cost:** one more toolchain binary in CI and on dev machines;
      `[tool.uv.sources]` path-dependency syntax to learn; lockfile churn
      in diffs. The SDK is _published to PyPI_ and consumed by tenants —
      it must stay a plain, backend-agnostic pyproject (no uv-specific
      metadata in its published form; `[tool.uv]` tables are ignored by
      pip, so even that is safe, but there's nothing to gain — **do not**
      lock the SDK package itself). - **Verdict:** adopt for the worker (deployable artifact, wants
      reproducibility); leave SDK and stdlib on plain pip.
      Steps: - In `apps/temporal-worker/pyproject.toml`, declare the SDK as a path
      dependency for resolution:

        ```toml
        dependencies = [
          "pegasus-workflows-sdk",
          "temporalio>=1.7,<2.0",
          "httpx>=0.27,<1.0",
        ]
        [tool.uv.sources]
        pegasus-workflows-sdk = { path = "../../packages/workflows-sdk-python", editable = true }
        ```

      - `cd apps/temporal-worker && uv lock` → commit `uv.lock`.
      - Rewrite `apps/temporal-worker/Dockerfile:47-52` builder stage:

        ```dockerfile
        COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
        # ... existing COPY lines for sdk/stdlib/worker sources ...
        WORKDIR /build/apps/temporal-worker
        RUN uv sync --frozen --no-dev --python /usr/local/bin/python3.12
        # venv lands at /build/apps/temporal-worker/.venv → copy that to /opt/venv
        ```

        (keep the existing two-stage copy-the-venv pattern; only the
        resolver changes. `--frozen` fails the build if `uv.lock` is stale —
        that failure is the feature.)
      - Pin the uv image tag (e.g. `ghcr.io/astral-sh/uv:0.7`) rather than
        `:latest` — pinning the pinner.
      - Optionally digest-pin `python:3.12-slim` at `Dockerfile:22,63`
        (`python:3.12-slim@sha256:...`) and let the Phase 2.2 Dependabot
        docker entry bump it.

- [ ] **4.2 Switch CI installs to uv where the lockfile applies** (~30min).
      In the Phase 1 `python` job and the Phase 1.2 image gate, replace the
      worker's `pip install -e` with
      `uv sync --frozen --extra dev` + `uv run pytest` (via
      `astral-sh/setup-uv@v5` with `enable-cache: true`). SDK install stays
      pip (`pip install -e '.[dev]'`) to keep testing the path tenants use.

### Phase 5 — Turbo/npm integration (assessed: thin wrapper, conditional)

- [ ] **5.1 Decide + (if adopted) add thin `package.json` wrappers** (~45min).
      Honest assessment: - **For:** `CLAUDE.md` promises "`npm test` — run all testing layers";
      today that silently excludes ~1,100 lines of Python tests. A thin
      `package.json` (`"private": true`, `"scripts": {"test": "...", "lint": "..."}`)
      in `packages/workflows-sdk-python` and `apps/temporal-worker` makes
      local `npm test` honest and gives agents one entry point. - **Against:** Turbo gains nothing real (test caching is disabled
      repo-wide; no build outputs to cache), and a wrapper that fails when
      the contributor has no Python env would make `npm test` flaky for
      pure-TS work — the opposite of lean. - **Verdict:** adopt ONLY with a graceful no-op guard, and only after
      Phase 4 (uv makes env bootstrap a single self-healing command).
      Sketch (`apps/temporal-worker/package.json`):

        ```json
        {
          "name": "@pegasus/temporal-worker",
          "private": true,
          "version": "0.0.0",
          "scripts": {
            "test": "command -v uv >/dev/null 2>&1 && uv run pytest -q || echo 'uv not installed — skipping Python tests (run in CI python job)'",
            "lint": "command -v uv >/dev/null 2>&1 && uv run ruff check . || echo 'uv not installed — skipping ruff'"
          }
        }
        ```

        For the SDK (no uv): same pattern guarding on
        `python -m pytest` availability inside its venv, or simply skip the
        SDK wrapper and rely on the CI job — acceptable outcome. If wrappers
        are added, update `CLAUDE.md`'s package-map note ("invisible to
        Turbo/tsc") accordingly. If the no-op guard feels too hacky, the
        fallback decision is: **no wrapper, CI job is the contract** — also a
        valid end state; record the choice in
        `dolas/agents/project/DECISIONS.md`.

### Cleanup (fold into whichever phase touches the file first)

- [ ] **C.1** Fix `apps/temporal-worker/tests/test_worker_e2e.py:11`
      docstring/marker mismatch: either add
      `markers = ["integration"]` to `[tool.pytest.ini_options]`
      (`apps/temporal-worker/pyproject.toml:46-49`) + the
      `@pytest.mark.integration` decorator, or correct the docstring. (~10min)

---

## Files to Modify / Create

| Action               | File                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Modify               | `.github/workflows/ci.yml` (add `python` job — 1.1, 2.x audit step)                                 |
| Modify               | `.github/workflows/temporal-worker.yml` (pre-build test gate — 1.2)                                 |
| Modify               | `.github/workflows/release-sdk-python.yml` (dep-list dedup — 2.3)                                   |
| Modify               | `.github/workflows/publish-stdlib.yml` (SDK pin + pre-publish validation — 2.3, 3.2)                |
| Modify               | `.github/dependabot.yml` (pip + docker ecosystems — 2.2)                                            |
| Modify               | `packages/workflows-sdk-python/pyproject.toml` (upper bounds — 2.1)                                 |
| Modify               | `apps/temporal-worker/pyproject.toml` (upper bounds, uv sources, marker — 2.1, 4.1, C.1)            |
| Modify               | `apps/temporal-worker/Dockerfile` (uv-based resolve, base-image pin — 4.1)                          |
| Modify               | `apps/temporal-worker/tests/test_worker_e2e.py` (iterate all registry workflows; marker — 3.1, C.1) |
| Create               | `packages/workflows-stdlib/tests/__init__.py` + `tests/test_manifest.py` (3.1)                      |
| Create               | `apps/temporal-worker/uv.lock` (4.1)                                                                |
| Create (conditional) | `apps/temporal-worker/package.json`, `packages/workflows-sdk-python/package.json` (5.1)             |
| Modify (conditional) | `CLAUDE.md`, `dolas/agents/project/DECISIONS.md` (5.1 decision record)                              |

## Side Effects & Risks

- **New required CI job:** if `python` is added to branch protection /
  push-gate expectations, a flaky temporalio test-server download could block
  merges. Mitigation: the e2e test already self-skips on download failure
  (`test_worker_e2e.py:57-61`); keep that behavior.
- **`temporal-worker.yml` gains ~2 min per image deploy** (test gate). This
  is the point — but during an incident the `workflow_dispatch` path also
  pays it. Acceptable; the gate is the same tests that would have caught the
  regression being hotfixed.
- **Upper bounds can block legitimate upgrades** (e.g. wanting temporalio
  2.0): the bound forces a deliberate pyproject edit. That is intended, but
  document it in the pyproject comments so future-you doesn't curse past-you.
- **pip-audit may flag transitive CVEs with no fix available**, breaking CI
  on someone else's timeline. Mitigation: `pip-audit --skip-editable` plus,
  if it bites, an explicit `--ignore-vuln ID` with a dated comment (mirror of
  the existing `audit-ci.jsonc` allowlist pattern).
- **uv lockfile drift:** editing worker deps without re-running `uv lock`
  fails the Docker build (`--frozen`). Loud and immediate — desired, but
  note it in `apps/temporal-worker/README.md` when implementing.
- **publish-stdlib still installs the SDK from PyPI** — pinning (2.3) means a
  stdlib publish needs the pin bumped after each SDK release. One-line diff,
  explicitly reviewable; better than silent `--upgrade`.
- Phase 5 wrappers, if adopted, make `npm test` output noisier for pure-TS
  contributors without Python/uv installed (a skip line, not a failure).

## Acceptance Criteria / Verification

All commands run from repo root unless noted.

1. **Python CI on PRs:** open a draft PR with a deliberate ruff violation in
   `packages/workflows-sdk-python/pegasus_workflows/api.py` → the `python`
   job fails; revert → passes. Locally:
   `python -m pip install -e 'packages/workflows-sdk-python[dev]' -e 'apps/temporal-worker[dev]' && python -m ruff check packages/workflows-sdk-python apps/temporal-worker packages/workflows-stdlib && (cd packages/workflows-sdk-python && python -m pytest -q) && (cd apps/temporal-worker && python -m pytest -q)` exits 0.
2. **Image gate:** `gh run list --workflow temporal-worker.yml` after the
   next main push shows the test step executing before `Build + push image`
   in the staging job log.
3. **Bounds:** `grep -n '<' packages/workflows-sdk-python/pyproject.toml apps/temporal-worker/pyproject.toml` shows a ceiling on every runtime dep.
4. **pip-audit:** the `python` CI job log contains a `pip-audit` step that
   exits 0 (or documented `--ignore-vuln` entries).
5. **Dependabot:** within a week of merge, `gh pr list --author app/dependabot`
   shows (or `.github/dependabot.yml` validates via
   `gh api repos/{owner}/{repo}/dependabot/alerts` reachable) pip-ecosystem
   coverage; minimally `grep -n "package-ecosystem: 'pip'" .github/dependabot.yml` hits.
6. **Stdlib harness:** `cd packages/workflows-stdlib && python -m pytest -q tests`
   passes; temporarily renaming `send_quote_followup` in
   `pegasus-workflows.toml` makes the drift-check test fail.
7. **Reproducible image:** `[ -f apps/temporal-worker/uv.lock ]`; two
   consecutive `docker build -f apps/temporal-worker/Dockerfile .` runs
   resolve identical dependency versions (compare `pip freeze`/`uv pip freeze`
   inside the image); editing a dep floor without `uv lock` fails the build
   with a frozen-lockfile error.
8. **Release path still green:** push the next `sdk-python-v*` tag → both
   jobs in `release-sdk-python.yml` pass with the deduped install; next
   `stdlib-v*` tag → `publish-stdlib.yml` shows the validation step before
   the push step.
9. **Phase 5 decision recorded** (either direction) in
   `dolas/agents/project/DECISIONS.md`; if wrappers added, `npm test` from
   root includes Python test output (or the graceful skip line) and
   `CLAUDE.md` package map updated.
