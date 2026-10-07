# Daily scheduled `audit-ci` on `main`

Branch: `chore/daily-audit-ci`. Goal: a newly published advisory turns a scheduled run on `main` red
and opens an issue, instead of being discovered by ejecting whichever PR enters the merge queue next.

- [x] Extract the `audit-ci` invocation (with the npm-endpoint `code undefined` pass-through) from
      `ci.yml`'s Lint job into `scripts/audit-ci.sh`; Lint calls the script.
- [x] Add `.github/workflows/dependency-audit.yml`: daily cron + `workflow_dispatch`, shared setup
      action, `issues: write`; on failure open-or-comment on one titled issue and fail the run; on
      success close it.
- [x] Mark the item done in `plans/todo/ci-blockers-after-security-backlog.md`.

Files: `scripts/audit-ci.sh` (new), `.github/workflows/dependency-audit.yml` (new),
`.github/workflows/ci.yml`, `plans/todo/ci-blockers-after-security-backlog.md`.

Verified locally: shellcheck clean; `check_ci_merge_group.py` passes; the script exits 0 on the real
config and 1 (listing GHSA URLs) with the threshold forced to `moderate`; the issue-body extraction
strips ANSI codes. Not verifiable locally: the issue create/comment/close steps — first exercised by a
`workflow_dispatch` run after merge (green path: no issue, nothing to close).

Risk: a cron workflow's red run emails only the last editor of the cron line, which is why the issue
is the durable signal. Scheduled workflows are disabled by GitHub after 60 days without repo
activity — not a concern at this repo's commit rate.
