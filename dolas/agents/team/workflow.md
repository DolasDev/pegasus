---
name: dolas-team-workflow
description: DolasDev team engineering workflow. Governs branch discipline, sync protocol, scope control, conflict handling, commits, plan file format, and plan archiving across all team projects.
---

# DolasDev Team Workflow

These rules govern how the engineering team operates across projects. They are **mandatory**.

## Branch Discipline

- Work ONLY within the current working directory and its branch.
- Never run `git checkout`, `git switch`, `git merge`, or `git rebase`.
- Never remove or prune worktrees. Never modify git configuration.
- Do NOT push unless explicitly instructed.

**At session start**, identify the current branch (`git branch --show-current`), state it at the top of your plan file, and confirm all changes will remain on this branch.

## Sync Before Coding

**Before writing any code**, always run:

```
git fetch
git pull
```

If `git pull` results in merge conflicts, **stop immediately**. Do not attempt to write any code. Present the conflicting files and conflict markers to the developer, explain the nature of each conflict, and assist in resolving them interactively. Only proceed with implementation after the working tree is clean and all conflicts are resolved.

## Scope Control

You may ONLY modify files explicitly listed in the approved plan or inside directories assigned for this task.

You MUST NOT:

- Refactor code unrelated to the task. If refactoring is required, limit it to in-scope files, ensure it does not alter unrelated public behaviour, and get separate approval for large refactors.
- Rename global symbols outside scope.
- Introduce architectural changes unless explicitly requested.
- Apply formatting-only changes to unrelated files.
- Update dependencies or lock files (`package-lock.json`, etc.) unless explicitly instructed.
- Modify shared utilities, types, or interfaces without noting it in the plan and getting explicit approval.
- Modify files outside the current worktree.

If you discover a necessary change outside scope: **stop, report it, and request instruction.**

## Conflict Handling

Stop and seek clarification when:

- Task is unclear → clarify before writing a plan.
- Required files are missing → report and pause.
- Architecture appears inconsistent → ask before fixing.
- Overlapping responsibility detected with another subsystem → stop and ask.
- Change requires cross-branch coordination → stop immediately.
- Solution requires modifying shared infrastructure outside scope → stop.

## Commits

Every commit must be focused and atomic — one logical change, no debug artifacts, no temp files. Commit messages must state what changed and why.

**Do not commit or push until the developer explicitly instructs you to.** When ready: run the full test suite, confirm all layers pass, summarise what changed, and wait for explicit approval.

## Plan File

Each agent works from a plan file in `plans/in-progress/`. Check for an existing file before creating one. Use a short, descriptive kebab-case name (e.g. `plans/in-progress/add-rbac-middleware.md`).

Every plan file must contain:

- Current branch name and one-line goal
- Ordered checklist: `[ ]` pending · `[x]` done · `[~]` in progress
- All files to be modified and created, plus identified side effects or risks
- Enough context that any agent can resume without re-reading the codebase

**Write and get the plan approved before implementing.** Update it after every completed subtask — it is the source of truth for progress.

## Concurrent Work & The Merge Queue

When multiple sessions run in parallel, each works in its own worktree on its own branch (see `scripts/new-worktree.sh`). Sessions never share a working directory and never coordinate directly — the merge queue is the coordination point.

### Landing work — canonical path

1. Open a PR for the branch: `gh pr create`.
2. Enable auto-merge: `gh pr merge --auto --squash` (or `--merge`/`--rebase` per project convention). This enqueues the PR.
3. GitHub's native **merge queue** rebases each PR against the current tip of `main`, runs the required-check matrix, and merges serially. Multiple enqueued PRs are processed in order — no manual cross-session coordination needed. Note: rapid queue merges can still trigger the deploy-cancellation race described in project memory (`feedback_rapid_main_pushes_cancel_deploy.md`); if several PRs merge in quick succession, check `gh run list --workflow deploy.yml` and re-dispatch if a run was cancelled.
4. "Merged" means the queue finished, not the instant `--auto` was set. The PR page shows queue position.

**Agents do not run `git merge`, `git rebase`, or `git push origin main` themselves.** Those operations are forbidden by Branch Discipline. Drive the merge exclusively through `gh pr merge --auto` — this is a GitHub API call via the `gh` CLI, not a git push, and is explicitly permitted within these rules.

### Direct push to `main` — break-glass only

Pushing directly to `main` (the old batch-merge-locally protocol) bypasses the queue and can cancel a neighbour's already-running deploy job (`deploy.yml` concurrency cancels a pending run when a new push races it). Use it only when:

- The merge queue itself is broken and a fix must land immediately, **and**
- The developer has explicitly approved the direct push.

When in doubt, use the queue.

## Archiving Completed Plans

After developer approval and commit, move the plan file from `plans/in-progress/` to `plans/completed/`:

```
plans/completed/<short-hash>-<slug>.md   # git rev-parse --short HEAD
plans/completed/<YYYY-MM-DDTHHMM>-<slug>.md  # if no commit yet
```

The archived file is a permanent record — do not edit it. An empty `plans/in-progress/` means no work is in flight.
