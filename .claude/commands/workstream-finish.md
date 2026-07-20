---
name: workstream-finish
description: Land the current worktree's completed work as one PR through the merge queue, then safely tear the worktree down once it has merged
argument-hint: (run inside the worktree; optional <slug> when tearing down from the primary checkout)
allowed-tools:
  - Bash
  - ExitWorktree
  - Read
---

<objective>
The counterpart to `/workstream-start`. Take a worktree whose implementation is
done and land it, then reclaim the workbench — without ever bypassing the merge
queue or discarding unmerged work.

It runs in two idempotent phases so it is safe to re-run:

- **Phase A — land** (when the branch is not yet merged): commit anything
  outstanding (plan + code together), push, open one PR, enable auto-merge.
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
   - If a PR exists and is `MERGED` → skip to step 5 (teardown).
   - Otherwise → do steps 3–4 (land).

3. **Finalize the commit (Phase A).**
   - Per `dolas/agents/team/workflow.md`, a finished plan moves out of
     `plans/in-progress/`. Move it: `git mv plans/in-progress/<slug>.md
plans/completed/<short-hash>-<slug>.md` (short-hash = `git rev-parse
--short HEAD`), so `main` never carries a stale in-progress entry.
   - `git add -A` and commit the remaining work with a clear message. If the
     tree is already clean and the plan is already archived, skip.
   - Never commit debug artifacts or unrelated files — review `git status` first.

4. **Land it through the queue (Phase A).**
   - `git push -u origin <branch>`
   - `gh pr create` (skip if one exists), then `gh pr merge <branch> --auto --squash`.
   - This enqueues the PR; the queue rebases + runs required checks + merges
     serially. Report the PR URL and that auto-merge is enabled. **Do not** push
     to `main` directly. Then stop and tell the user to re-run `/workstream-finish`
     once it merges (or watch the queue and continue when `mergedAt` is set).
   - Heads-up (`feedback_rapid_main_pushes_cancel_deploy.md`): if several PRs
     merge in quick succession, check `gh run list --workflow deploy.yml` for a
     canceled Deploy and re-dispatch.

5. **Teardown (Phase B — only once the PR is MERGED).**
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

6. **Archive a plan that shipped un-archived (Phase B safety net).**
   Normally Phase A moves the plan to `plans/completed/` inside the feature
   branch, so it lands already archived. But when the PR was merged _before_
   `/workstream-finish` ran Phase A — e.g. the implementer enabled auto-merge
   directly, or the queue merged while you were away — the plan reaches `main`
   still under `plans/in-progress/`. After syncing `main`, close that gap:
   - `test -f <primary>/plans/in-progress/<slug>.md` — if absent, nothing to do
     (already archived); skip and report the clean state.
   - If present, land a **small plans-only PR** through the queue — **never**
     direct-push to `main`, and don't dirty the primary checkout (keep it parked
     on `main`). Use a throwaway worktree off the freshest `main`:
     - `git -C <primary> fetch origin` then `git -C <primary> worktree add -b
chore/archive-<slug>-plan ../pegasus-archive-<slug> origin/main` (no deps
       or DB — it is a one-file move).
     - `git -C ../pegasus-archive-<slug> mv plans/in-progress/<slug>.md
plans/completed/<merge-short-hash>-<slug>.md`, where merge-short-hash =
       `git -C <primary> rev-parse --short origin/main` (the squash-merge commit
       the plan shipped in), matching the `plans/completed/` naming convention.
     - Commit (`chore(plans): archive <slug> plan (shipped in #<pr>)`), push,
       `gh pr create`, `gh pr merge --auto --squash`. Report the archive PR URL.
     - Once the archive PR is enqueued, remove the throwaway worktree:
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
  separate plan PR to reconcile in the normal path. The exception is step 6's
  safety net: when a PR merged before Phase A archived the plan, a tiny
  plans-only follow-up PR moves it to `plans/completed/` so `main` never carries
  a stale in-progress entry.
- Break-glass only: if the merge queue itself is broken, surface it and let the
  user decide — do not direct-push to `main` to get around it.
</notes>
