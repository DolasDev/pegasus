# Record the master plan's 7 acceptance measurements (5 safe ones)

> **Status: COMPLETE** — 2026-08-06. Branch `chore/audit-measurements`.
>
> **Result: 3 pass, 2 miss, 2 held.** Deviations from the plan as written:
>
> - **Criterion 1 needed two numbers, not one.** "A one-package change" is
>   ambiguous in this repo: a leaf change (`apps/admin-web`) is **3.4 s**, but a
>   `packages/domain` change is the dependency root and correctly fans out to 9
>   packages / 13 tasks = **1m26s**. Recorded both; the criterion as written
>   passes, and the fan-out is now written down so it is not a surprise later.
> - **Criterion 3's stated method does not work here.** The `/timing` API returns
>   `total_ms: 0` because this repo is public and Actions minutes are not billed.
>   Summing non-skipped job durations is the right proxy and is what got recorded.
> - **`gh` has no `durationMS` JSON field** (criterion 2 names one). Computed
>   wall clock as `updatedAt − startedAt` instead.
> - **Found while measuring, not fixed:** `scripts/setup.sh:89` probes
>   `localhost:5432` to decide whether to start Docker, but migrate/seed use
>   `DATABASE_URL` from `apps/api/.env`. In any worktree those are different
>   databases. Harmless today, and it is what made this measurement safe — the
>   primary dev DB was never touched. Noted in the master plan.
>   Closes the last self-owned gap in `plans/in-progress/audit-00-master-plan.md`:
>   its own acceptance criteria (lines 125-131) were never measured, which the
>   2026-07-30 cleanup audit called out as a reason the file stays open.

## Context

The master plan defines 7 measurable acceptance criteria and says "capture a
baseline now and re-measure after Waves 1-2". Waves 1-3 shipped; **no
measurement was ever recorded**. Five are safe to run unattended; two are
outward-facing and are **held pending explicit approval** (user decision
2026-08-01, re-confirmed 2026-08-06):

- **HELD — criterion 5 (deploy trust):** requires a deliberate 3-commit rapid
  push to `main`.
- **HELD — criterion 7 (prod feedback):** requires firing a real prod CloudWatch
  alarm (`aws cloudwatch set-alarm-state`) to time the email round-trip.

**Baseline for comparison** (`audit-ci-pipeline-efficiency.md:17-30`, run
27243490124, 5-job pipeline, 2026-06-10): wall clock 3m05s-3m33s; billed
~7.5 min; Test job 3m00s was the critical path.

**Already gathered (read-only, 2026-08-06)** — 23 successful `ci.yml` runs:

| Class           | Wall clock | Sum of job durations | Target          | Verdict    |
| --------------- | ---------- | -------------------- | --------------- | ---------- |
| Code PR / push  | 211-272 s  | 383-562 s            | ≤165 s / ≤330 s | **MISSED** |
| Docs/plans-only | 18-20 s    | 13-17 s              | <60 s           | **MET**    |

Step-level diagnosis of run 31045211891 (the two long jobs):

- `Run ./.github/actions/setup` costs **51-54 s in every job** — the composite
  action landed, but `audit-ci-pipeline-efficiency.md:266` promised "Install
  dependencies ≤5s (cache hit)". At 4 jobs/run that is ~3.4 billed min, the
  single biggest recoverable chunk, and ~50 s of it sits on the critical path.
- `Run tests` is **144 s** (baseline: turbo test 109 s). Grew because the
  coverage ratchets added ~1,800 api tests; `test` has turbo caching disabled
  repo-wide (`turbo.json`), so no remote-cache win is available to it by design.
- The pipeline also gained jobs the target predates: `migration-safety`, three
  Python jobs, and browser coverage in the e2e job (Wave 2, an explicit
  "latency-for-truth trade" per the master plan's own rank-6 note).

So the two numeric misses are **composition change plus one unrealized
optimization**, not a regression in what was shipped. Record both the numbers
and that attribution — a bare "MISSED" would misrepresent it.

## Plan

- [x] **1. Criterion 1 — pre-push latency** (target <30 s, baseline 2-5 min).
      Make a one-package change in this worktree and time the real hook:
      `time git push`. `.husky/pre-push` runs
      `TURBO_SCM_BASE=origin/main turbo run typecheck test --affected`.
      Record the measured seconds and what the affected set resolved to.

- [x] **2. Criterion 4 — the three false-green guards fire on a seeded failure.**
      All three are verifiable locally; **none require pushing a broken commit**. - `ci.yml:412-424` expo-doctor guard: feed `printf '✖ fail\n'` through the
      exact `grep '✖' | grep -v 'duplicate dependencies'` pipeline and confirm
      it now yields a non-empty `failures` (the original bug was `grep -q`
      producing no stdout, so the guard could never fire). - `apps/api/vitest.global-setup.ts:73-77` DB silent-skip fail-fast: run
      with `CI=true` and `DATABASE_URL` unset; expect the throw. - `ci.yml:564-572` e2e minimum-executed floor (`E2E_MIN_EXECUTED_TESTS=32`,
      deploy.yml uses 8): run the guard's shell against a seeded
      `results.json` below the floor and confirm exit 1.

- [x] **3. Criterion 6 — local loop restored.** `npm run db:seed` exits 0
      against this worktree's fresh Postgres, and `npm run setup`
      (`scripts/setup.sh`) ends with a running, seeded stack.

- [x] **4. Record all of it** in the master plan's Acceptance Criteria section:
      each of the 5 checked with its measured value, date, and pass/fail;
      the 2 held ones left unchecked and annotated **HELD — needs approval**
      so a future reader doesn't mistake them for forgotten.

## Files to Modify

| Action | File                                        |
| ------ | ------------------------------------------- |
| Modify | `plans/in-progress/audit-00-master-plan.md` |

## Side Effects & Risks

- **Measurement only — no production behavior changes.** The only file changed
  is a plan file.
- **Two criteria stay unmeasured by design.** They are annotated in place, not
  silently dropped.
- **The two numeric misses are findings, not blockers.** Recording them does not
  fix them; the `./.github/actions/setup` 51 s finding is the actionable one and
  belongs to `audit-ci-pipeline-efficiency.md`, whose Phase 2 promised ≤5 s.
  Note it there so it is not lost.
- The seeded-failure checks run **locally only**. Nothing deliberately broken is
  ever committed or pushed.

## Acceptance Criteria / Verification

1. Master plan lines 125-131: 5 criteria checked with measured values + date;
   2 annotated HELD.
2. Every recorded number is reproducible from a command written next to it.
3. `audit-ci-pipeline-efficiency.md` carries the unrealized-≤5 s-install finding.
4. No non-plan file is modified; nothing broken is committed.
