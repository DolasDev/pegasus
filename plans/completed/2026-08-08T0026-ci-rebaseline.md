# Record the post-fix CI numbers and re-baseline the targets

> **Status: COMPLETE** — 2026-08-08. Branch `chore/ci-rebaseline`. No deviation: targets were derived from the 11 post-fix runs, each stated with its bound rather than just the observed number.
> Closes the follow-up from #592: the acceptance measurements now exist, but the
> targets they are measured against still describe a **5-job pipeline that no
> longer exists**.

## Context

`audit-ci-pipeline-efficiency.md` Phase 2 set two numeric targets on 2026-06-10
against run 27243490124 — a **5-job** pipeline (secret-scan, typecheck, lint,
test, e2e): wall ≤2m45s (165 s), billed ≤5.5 min (330 s). Since then Waves 2-3
**deliberately added work**: `migration-safety`, three Python jobs, e2e browser
coverage, and coverage ratchets worth ~1,800 extra api tests. The targets were
never re-baselined, so the pipeline has been measured against a repo that no
longer exists and reads as permanently failing its own goals.

#592 then fixed the setup-step cache thrashing. Post-fix measurements (11 runs
after `c80c2a21`, 2026-08-08):

| Class                                | Wall clock | Billed (Σ non-skipped jobs) | Jobs |
| ------------------------------------ | ---------- | --------------------------- | ---- |
| Warm code run                        | 215-226 s  | 335-377 s                   | 7    |
| Warm code run + Python trees touched | ~220 s     | 443-492 s                   | 10   |
| Lockfile-changing PR (cold `npm ci`) | 258-291 s  | —                           | 7-10 |
| Docs/plans-only                      | 18-20 s    | 13-17 s                     | 2    |

**The load-bearing fact for re-baselining: the critical path is now always the
`Test` job (195-212 s), and setup is only ~14 s of it.** The remaining ~180 s is
`turbo run test` itself. Wall clock therefore **cannot** go below the test suite's
own runtime — the old 165 s target is not merely missed, it is unreachable while
the suite takes ~180 s, and `test` has turbo caching disabled repo-wide by
design. Any future wall-clock win must come from test runtime, not from CI
plumbing.

Billed minutes tell the opposite, and better, story: **377 s for 7 jobs today vs
~450 s for 5 jobs at baseline** — more than 2× the jobs for less total compute.

## Plan

- [x] **1. Re-baseline `audit-ci-pipeline-efficiency.md` Phase 2 targets.**
      Replace the two stale numbers with class-specific, measured-and-achievable
      ones, each stating what bounds it: - Warm code run wall clock **≤ 4m00s (240 s)** — Test-bound; note the only
      lever is test runtime. - Billed **≤ 6m30s (390 s)** for a 7-job code run; **≤ 8m30s (510 s)** when
      the three Python jobs also run. - Docs/plans-only **< 45 s wall / < 30 s billed** (measured 18-20 / 13-17 —
      keep this tight, it is proven). - `Run ./.github/actions/setup` **≤ 20 s** on a cache hit (measured
      13.9-15.5 s). - New: Actions cache storage **< 7 GB** with **zero** `node-cache-*`
      entries — the condition #592 depends on, and the one that silently
      regresses if anything re-enables the npm cache.
      Record the old targets inline as superseded rather than deleting them, so
      the history of why they changed survives.

- [x] **2. Update the master plan's Acceptance Criteria block.** Criteria 2 and 3
      currently read MISS against the stale targets. Re-state them with the
      post-fix numbers and the re-baselined targets, and mark the #592 outcome as
      verified on `main`.

- [x] **3. Note the archive condition on `audit-ci-pipeline-efficiency.md`.**
      With Phase 2 re-baselined and met, the only thing left in that plan is
      Phase 4 (`ci-triage.yml` AI failure triage), which is user-deferred under
      `audit-ai-process-automation.md`. Flag that it is archive-ready **pending
      the user's call** on folding Phase 4 into the AI plan — do not archive
      unilaterally; dropping a phase is a scope decision.

## Files to Modify

| Action | File                                                |
| ------ | --------------------------------------------------- |
| Modify | `plans/in-progress/audit-ci-pipeline-efficiency.md` |
| Modify | `plans/in-progress/audit-00-master-plan.md`         |

## Side Effects & Risks

- **Re-baselining can be self-serving** — moving the goalposts to whatever was
  measured. Mitigated by stating the _bound_ for each target (Test runtime,
  job count) rather than just the observed number, and by keeping the
  docs/plans-only target tight rather than padding it.
- **Plans-only diff**; no code, no CI, nothing deployable.
- The cache-storage criterion is the one that can silently regress: re-enabling
  `cache: 'npm'` anywhere, or `package-manager-cache` defaulting back on in a
  future setup-node major, puts the repo straight back into eviction.

## Acceptance Criteria / Verification

1. Neither plan still contains the 2m45s / 5.5-min targets as live goals.
2. Every new target names its bound and the measurement it came from.
3. The master plan's criteria 2 and 3 read as measured-and-met against the new
   targets, with the #592 verification cited.
4. `audit-ci-pipeline-efficiency.md` states its archive condition explicitly.
