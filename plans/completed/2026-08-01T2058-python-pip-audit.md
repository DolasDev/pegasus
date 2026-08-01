# Python toolchain — finish Phase 1 (pip-audit in PR CI + ruff over the stdlib)

> **Status: COMPLETE** — 2026-08-01. Branch `chore/python-pip-audit`.
> Deviation from the plan as written: the `I001` fix in
> `tests/test_send_quote_followup.py` was not the import order — removing the
> unused `pytest` import left a double blank line before the first comment
> banner, which is what ruff was flagging (`ruff check --fix` collapsed it).
> Also updated the `workflows-stdlib-python` job header comment, which claimed
> the job only ran pytest on the stdlib.
> Source plan: `plans/in-progress/audit-python-toolchain.md` (Unit 11 of the
> CI/CD + devops audit batch). Master index:
> `plans/in-progress/audit-00-master-plan.md` Wave 3.

## Context

Phase 1 of `audit-python-toolchain.md` is two-thirds landed:

- **1.1 (Python jobs in `ci.yml`)** — three path-filtered jobs exist today:
  `tenant-runner-python`, `temporal-worker-python`, `workflows-stdlib-python`
  (`.github/workflows/ci.yml:179`, `:220`, `:259`).
- **1.2 (image gate)** — `temporal-worker.yml` has a `test` job that both
  `staging` and `prod` depend on (shipped #568).

Two items of Phase 1 are still open, and the plan was written before
`apps/tenant-runner` existed, so Phase 1 now spans **four** Python trees:

1. **`pip-audit` runs nowhere.** `grep -rn pip-audit .github/` → no hits. The
   Node side has `audit-ci` (`ci.yml:128-129`); Python has no vulnerability
   scanning at all, in CI or at release. Two of these trees ship to prod
   (`apps/temporal-worker` → Fargate, `apps/tenant-runner` → sandbox host) and
   one is published to PyPI for tenants.
2. **`ruff` never runs over `packages/workflows-stdlib`.** The
   `workflows-stdlib-python` job runs ruff on the SDK and pytest on both, but
   no ruff step for the stdlib itself, and `packages/workflows-stdlib/pyproject.toml`
   carries no `[tool.ruff]` config (the other three trees all do). Verified
   locally with the other trees' ruff settings: **3 real violations** exist —
   `E501` in `emit_custom_event/workflow.py:49`, `I001` + `F401` in
   `tests/test_send_quote_followup.py`. Same shape as the `UP035` pair that
   #568 surfaced the first time ruff was pointed at the worker.

**Pre-verified (2026-08-01):** `pip-audit --skip-editable` against a fresh venv
with `[dev]` extras is **clean today** on all three installable trees
(temporal-worker, workflows-sdk-python, tenant-runner) — "No known
vulnerabilities found". So this gate lands green rather than importing a
backlog.

## Plan

- [x] **1. Ruff config + clean tree for `packages/workflows-stdlib`**
      Add `[tool.ruff]` / `[tool.ruff.lint]` to
      `packages/workflows-stdlib/pyproject.toml` matching the other three trees
      verbatim (`line-length = 100`, `target-version = "py311"`,
      `select = ["E", "F", "I", "UP", "B", "W"]`). Fix the 3 violations:
      wrap the long `emit_quote_won` signature, drop the unused `pytest`
      import, sort the import block.

- [x] **2. Ruff step in the `workflows-stdlib-python` job**
      Add `Ruff (stdlib)` after `Ruff (SDK)` in `.github/workflows/ci.yml`,
      `working-directory: packages/workflows-stdlib`. Ruff comes from the SDK's
      `[dev]` extra already installed in that job — no extra install.

- [x] **3. `pip-audit` step in all three Python CI jobs**
      Append a `pip-audit` step to `tenant-runner-python`,
      `temporal-worker-python`, and `workflows-stdlib-python` in `ci.yml`:
      `python -m pip install pip-audit && python -m pip_audit --skip-editable`.
      `--skip-editable` skips the locally-installed first-party package (no
      PyPI advisories to match anyway) and audits the resolved dependency set —
      which is exactly what the Dockerfile/`pip install` resolves at image-build
      time. Comment the `--ignore-vuln ID` escape hatch (mirroring the
      `audit-ci.jsonc` allowlist convention) for a transitive CVE with no fix.
      The stdlib declares no dependencies of its own, so the SDK audit in
      `workflows-stdlib-python` covers that tree's full closure.

- [x] **4. Plan bookkeeping**
      Mark 1.1/1.2/pip-audit/stdlib-ruff done in
      `plans/in-progress/audit-python-toolchain.md`, record Phase 1 as complete
      (Phases 2-5 still open, so the source plan stays in-progress), and tick
      the Wave 3 Phase-1 bullet in `plans/in-progress/audit-00-master-plan.md`.

## Files to Modify

| Action | File                                                                       |
| ------ | -------------------------------------------------------------------------- |
| Modify | `.github/workflows/ci.yml` (stdlib ruff step + 3× pip-audit steps)         |
| Modify | `packages/workflows-stdlib/pyproject.toml` (`[tool.ruff]` config)          |
| Modify | `packages/workflows-stdlib/emit_custom_event/workflow.py` (E501)           |
| Modify | `packages/workflows-stdlib/tests/test_send_quote_followup.py` (I001, F401) |
| Modify | `plans/in-progress/audit-python-toolchain.md` (status)                     |
| Modify | `plans/in-progress/audit-00-master-plan.md` (Wave 3 bullet)                |

## Side Effects & Risks

- **Live advisory database.** Like `audit-ci` on the Node side, `pip-audit`
  reads a live feed — a newly-published advisory can turn CI red on someone
  else's timeline with no diff of ours. Accepted (it is the same posture the
  Node side already runs); the `--ignore-vuln` escape hatch is documented in
  the step comment. Diagnosis recipe is the same as the audit-ci flip:
  re-run against `origin/main` before suspecting the PR.
- **`pip-audit` is unpinned** in the step, matching how `ruff`/`pytest` come
  from the `[dev]` extras. Pinning it belongs with Phase 2.1's bounds work.
- **Jobs get ~15-25 s slower** (one extra pip install + one HTTP audit). All
  three are path-filtered and well under the `e2e` job's wall clock, so no PR
  latency is added on the critical path.
- **Ruff on the stdlib is a new gate on a tree that has never been linted** —
  the fixes are pure hygiene (unused import, import order, one wrapped
  signature) and touch no workflow logic. `pytest -q` in that tree is the
  regression check.

## Acceptance Criteria / Verification

1. `cd packages/workflows-stdlib && python -m ruff check .` exits 0 (and,
   before the fixes, reported exactly the 3 violations above).
2. `cd packages/workflows-stdlib && python -m pytest -q` still passes.
3. `python -m pip_audit --skip-editable` exits 0 in each of the three venvs
   (SDK, worker, tenant-runner) with `[dev]` extras installed.
4. `grep -c 'pip_audit' .github/workflows/ci.yml` → 3.
5. On the PR: all three Python jobs run (the diff touches all four trees) and
   are green, each log showing a `pip-audit` step and — for
   `workflows-stdlib-python` — a `Ruff (stdlib)` step.
6. `plans/in-progress/audit-python-toolchain.md` Phase 1 shows every box
   checked; `audit-00-master-plan.md` Wave 3 Phase-1 bullet ticked with a
   deviation note naming what remains (Phases 2-5).
