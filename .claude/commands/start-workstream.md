---
name: start-workstream
description: Provision a worktree for an approved plan, land the plan on main first (own PR), then move the session into the worktree to implement it
argument-hint: <type> <slug> <plan-file>
allowed-tools:
  - Bash
  - EnterWorktree
  - Read
---

<objective>
Turn an approved plan into a running workstream, plan-first:

1. Create the worktree + branch (delegates to `scripts/new-worktree.sh`, unchanged,
   idempotent) — isolated dir, isolated Postgres, env files, deps installed.
2. Copy the plan into `plans/in-progress/<slug>.md` **inside that worktree only**.
   `main` (the primary checkout) is never edited directly — it stays clean.
3. Commit + push just the plan file, open a PR, enable auto-merge (squash) — the
   plan reaches `main` through the normal merge queue, never a direct push. Once
   merged, every other worktree branched from `main` afterward sees this plan in
   `plans/in-progress/`, so concurrent workstreams stay aware of each other.
4. Move the session into the new worktree (EnterWorktree) so implementation
   continues there, on the same branch. That branch's own PR (opened later, when
   the work is done) carries the rest of the commits.

Mechanical git/gh work lives in `scripts/start-workstream.sh` — this command is
the thin orchestration wrapper described in the DolasDev workflow
(`dolas/agents/team/workflow.md` → "Concurrent Work & The Merge Queue").
</objective>

<inputs>
- `<type>` — branch prefix: `feat` | `fix` | `chore` | `docs`
- `<slug>` — short lowercase id, e.g. `rating-engine` (matches `new-worktree.sh` convention)
- `<plan-file>` — path to the drafted, user-approved plan (typically a plan-mode
  artifact under `~/.claude/plans/`, or any markdown file the user points at)

If any argument is missing, ask for it rather than guessing — especially
`<plan-file>`: never invent plan content, only land a plan the user already approved.
</inputs>

<process>
1. Confirm the plan has been approved by the user before running anything (this
   command commits and opens a PR — it is not a planning step itself).
2. Run: `scripts/start-workstream.sh <type> <slug> <plan-file>`
   This provisions the worktree, lands the plan file, commits, pushes, opens the
   PR, and enables auto-merge. Read its output for the worktree path and PR status.
3. Call `EnterWorktree` with `path` set to the printed worktree path (e.g.
   `../pegasus-<slug>`, resolved as a sibling of the primary checkout) to move
   the session's cwd, branch, config, and plans directory into the worktree.
4. Report to the user: worktree path, branch name, and the plan PR's auto-merge
   status. Then continue implementing the plan **inside the worktree** — do not
   return to the primary checkout mid-task (Branch Discipline: one stream, one
   worktree, one branch).
</process>

<notes>
- Idempotent: re-running with the same `<slug>` reuses the existing worktree/DB
  (via `new-worktree.sh`), skips re-committing an already-landed plan, and reuses
  an existing PR instead of erroring.
- Cosmetic trade-off: because the plan-file commit gets squash-merged into `main`
  ahead of the rest of the branch, the branch's *own* later PR will list
  `plans/in-progress/<slug>.md` in its diff again. Content is identical, so this
  merges cleanly — it's a redundant-looking line on the PR page, not a conflict.
- This command performs outward-facing actions (push, PR, auto-merge) as soon as
  it runs — only invoke it once the plan is genuinely ready to start.
</notes>
