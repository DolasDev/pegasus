---
name: workstream-finish
description: Land the current worktree's completed work as one PR through the merge queue, then safely tear the worktree down once it has merged
argument-hint: (run inside the worktree; optional <slug> when tearing down from the primary checkout)
allowed-tools:
  - Bash
  - ExitWorktree
  - Read
  - Edit
  - Skill
---

<objective>
The counterpart to `/workstream-start`. Take a worktree whose implementation is
done and land it, then reclaim the workbench — without ever bypassing the merge
queue or discarding unmerged work.

It runs in two idempotent phases so it is safe to re-run:

- **Phase A — land** (when the branch is not yet merged): commit anything
  outstanding (plan + code together), **review the diff**, push, open one PR,
  enable auto-merge.
- **Phase B — teardown** (when the PR has merged): archive the plan if it shipped
  un-archived, then leave the worktree and delete it, its branch, and its
  Postgres via `scripts/rm-worktree.sh`.

Re-run it after the queue merges to move from A to B.
</objective>

<process>
1. **Locate the workstream.** Determine the branch and slug:
   `git rev-parse --abbrev-ref HEAD` (expect `<type>/<slug>`; slug is the part
   after the `/`). Refuse to act on `main` or a detached HEAD — this command
   only operates on a feature branch. `git worktree list` shows which worktree
   holds it.

2. **Check merge state first** (decides A vs B):
   `gh pr view <branch> --json state,mergedAt,url` (tolerate "no PR yet").
   - If a PR exists and is `MERGED` → skip to step 6 (teardown).
   - Otherwise → do steps 3–5 (land).

3. **Finalize the commit (Phase A).**
   - Per `dolas/agents/team/workflow.md`, a finished plan moves out of
     `plans/in-progress/`. Move it: `git mv plans/in-progress/<slug>.md
plans/completed/<short-hash>-<slug>.md` (short-hash = `git rev-parse
--short HEAD`), so `main` never carries a stale in-progress entry.
   - `git add -A` and commit the remaining work with a clear message. If the
     tree is already clean and the plan is already archived, skip.
   - Never commit debug artifacts or unrelated files — review `git status` first.

4. **Review the diff before it becomes a PR (Phase A).**
   This is a solo repo: nothing else ever reads the diff, and the merge queue's
   required checks are all deterministic. This step is the review. It runs
   **once per PR** at the last moment the diff is still cheap to change —
   deliberately here and not in `.husky/pre-push`, which is held to a <30 s
   budget (`audit-00-master-plan.md` acceptance criterion 1) and would pay the
   cost on every WIP push.

   - **Decide whether to skip — deterministically, before spending anything:**
     `git diff --name-only origin/main...HEAD`. Skip the review when the diff is
     docs/plans-only (everything under `plans/`, `dolas/`, or `*.md` — the same
     definition `ci.yml`'s paths-filter uses), when it is a pure revert, or when
     the developer explicitly says to skip. **A skip is recorded in the PR body,
     never silent.**
   - **Always (when not skipped):** `/code-review` on the branch diff.
   - **Additionally `/security-review`** when that same file list touches
     security-sensitive paths: `apps/api/src/authz/**`, `**/middleware/**`,
     `apps/api/prisma/migrations/**`, `packages/infra/**`,
     `.github/workflows/**`, `apps/tenant-runner/**`, `**/*.cedar`.
   - **Disposition every finding.** Each one is either fixed on the branch — as
     its own commit, so the fix is reviewable separately from the work — or
     written down with a one-line reason under a `## Review` section in the PR
     body. Advisory, not a blocking gate: the developer may ship over a
     finding, but never silently. (A hard gate on a solo repo only trains
     people to bypass it.)
   - **Say what it is.** The reviewer runs in the same session that wrote the
     code, so it is a **self-review** and catches less than an independent one.
     State that in the `## Review` section so nobody reads it as more than it
     is. Running it independently in CI is possible — `claude-code-action`
     accepts a `claude_code_oauth_token` from `claude setup-token`, so it can
     bill the subscription rather than an API key — and was **deliberately held
     2026-08-02**; keep it local until the local pass proves its worth.
   - **Cost model:** subscription quota, not API dollars — the same pool as
     interactive work, so a heavy PR day can throttle the session doing the
     work. That is the accepted trade against the ~$25-60/mo the CI-side
     equivalent would cost (`audit-ai-process-automation.md`).

5. **Land it through the queue (Phase A).**
   - `git push -u origin <branch>`
   - `gh pr create` (skip if one exists), then `gh pr merge <branch> --auto --squash`.
   - This enqueues the PR; the queue rebases + runs required checks + merges
     serially. Report the PR URL and that auto-merge is enabled. **Do not** push
     to `main` directly. Then stop and tell the user to re-run `/workstream-finish`
     once it merges (or watch the queue and continue when `mergedAt` is set).
   - Heads-up (`feedback_rapid_main_pushes_cancel_deploy.md`): if several PRs
     merge in quick succession, check `gh run list --workflow deploy.yml` for a
     canceled Deploy and re-dispatch.

6. **Teardown (Phase B — only once the PR is MERGED).**
   - **Guard (andon):** confirm the worktree is clean and fully pushed —
     `git status --porcelain` empty and `git rev-list --count @{upstream}..HEAD`
     == 0. If not, STOP and report; never discard unmerged work. (Today
     `rm-worktree.sh` force-removes; this guard is what makes teardown safe, so
     do it here explicitly.)
   - `ExitWorktree` with `action: "keep"` to return the session to the primary
     checkout (you cannot remove the worktree you are standing in).
   - From the primary checkout run `scripts/rm-worktree.sh <slug>` — removes the
     worktree, its branch, and its Postgres container, and prunes.
   - `git -C <primary> fetch --prune && git -C <primary> pull --ff-only` to keep
     `main` synced.

7. **Archive a plan that shipped un-archived (Phase B safety net).**
   Normally Phase A moves the plan to `plans/completed/` inside the feature
   branch, so it lands already archived. But when the PR was merged _before_
   `/workstream-finish` ran Phase A — e.g. the implementer enabled auto-merge
   directly, or the queue merged while you were away — the plan reaches `main`
   still under `plans/in-progress/`. After syncing `main`, close that gap:
   - `test -f <primary>/plans/in-progress/<slug>.md` — if absent, nothing to do
     (already archived); skip and report the clean state.
   - If present, land a **small plans-only PR** through the queue — **never**
     direct-push to `main`, and don't dirty the primary checkout (keep it parked
     on `main`). Use a throwaway worktree off the freshest `main`: - `git -C <primary> fetch origin` then `git -C <primary> worktree add -b
chore/archive-<slug>-plan ../pegasus-archive-<slug> origin/main` (no deps
     or DB — it is a one-file move). - `git -C ../pegasus-archive-<slug> mv plans/in-progress/<slug>.md
plans/completed/<merge-short-hash>-<slug>.md`, where merge-short-hash =
     `git -C <primary> rev-parse --short origin/main` (the squash-merge commit
     the plan shipped in), matching the `plans/completed/` naming convention. - Commit (`chore(plans): archive <slug> plan (shipped in #<pr>)`), push,
     `gh pr create`, `gh pr merge --auto --squash`. Report the archive PR URL. - Once the archive PR is enqueued, remove the throwaway worktree:
     `git -C <primary> worktree remove ../pegasus-archive-<slug>` (its branch
     auto-deletes on squash-merge). The archive PR merges on its own through
     the queue; no need to block on it.
   - Report the final clean state (`git worktree list`).
     </process>

<notes>
- Idempotent: safe to run at any point. Before merge it lands / re-uses the PR;
  after merge it tears down; if already torn down it no-ops.
- One PR carries both the plan file and the implementation (that is the whole
  point of `/workstream-start` seeding the plan into the worktree) — there is no
  separate plan PR to reconcile in the normal path. The exception is step 7's
  safety net: when a PR merged before Phase A archived the plan, a tiny
  plans-only follow-up PR moves it to `plans/completed/` so `main` never carries
  a stale in-progress entry.
- The step-4 review is the repo's answer to "nobody reviews a solo dev's diffs"
  (`audit-ai-process-automation.md`, item 1 — "highest value item in this
  audit"), moved from GitHub Actions to the local session so it costs
  subscription quota instead of ~$25-60/mo of API spend. It is advisory by
  design; the disposition rule (fix it or write it down) is what keeps it from
  degrading into a rubber stamp.
- Break-glass only: if the merge queue itself is broken, surface it and let the
  user decide — do not direct-push to `main` to get around it.
</notes>
