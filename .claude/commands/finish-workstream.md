---
name: finish-workstream
description: Land the current worktree's completed work as one PR through the merge queue, then safely tear the worktree down once it has merged
argument-hint: (run inside the worktree; optional <slug> when tearing down from the primary checkout)
allowed-tools:
  - Bash
  - ExitWorktree
  - Read
---

<objective>
The counterpart to `/start-workstream`. Take a worktree whose implementation is
done and land it, then reclaim the workbench — without ever bypassing the merge
queue or discarding unmerged work.

It runs in two idempotent phases so it is safe to re-run:

- **Phase A — land** (when the branch is not yet merged): commit anything
  outstanding (plan + code together), push, open one PR, enable auto-merge.
- **Phase B — teardown** (when the PR has merged): leave the worktree and delete
  it, its branch, and its Postgres via `scripts/rm-worktree.sh`.

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
     to `main` directly. Then stop and tell the user to re-run `/finish-workstream`
     once it merges (or watch the queue and continue when `mergedAt` is set).
   - Heads-up (`feedback_rapid_main_pushes_cancel_deploy.md`): if several PRs
     merge in quick succession, check `gh run list --workflow deploy.yml` for a
     cancelled Deploy and re-dispatch.

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
     `main` synced. Report the final clean state (`git worktree list`).
</process>

<notes>
- Idempotent: safe to run at any point. Before merge it lands / re-uses the PR;
  after merge it tears down; if already torn down it no-ops.
- One PR carries both the plan file and the implementation (that is the whole
  point of `/start-workstream` seeding the plan into the worktree) — there is no
  separate plan PR to reconcile.
- Break-glass only: if the merge queue itself is broken, surface it and let the
  user decide — do not direct-push to `main` to get around it.
</notes>
