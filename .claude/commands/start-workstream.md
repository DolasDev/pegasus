---
name: start-workstream
description: Provision an isolated worktree for an approved plan, seed the plan into it, and move the session in to implement — plan and code land together in one PR
argument-hint: <type> <slug> <plan-file>
allowed-tools:
  - Bash
  - EnterWorktree
  - Read
---

<objective>
Turn an approved plan into a running workstream:

1. Create the worktree + branch (delegates to `scripts/new-worktree.sh`, unchanged,
   idempotent) — isolated dir, isolated Postgres, env files, deps installed.
2. Seed the plan into `plans/in-progress/<slug>.md` **inside that worktree only**.
   The primary checkout (`main`) is never edited — it stays clean.
3. Move the session into the worktree (EnterWorktree) and implement there, on the
   branch. The plan file is committed **together with** the implementation, and
   the whole thing lands on `main` through the branch's single PR + the merge
   queue when the work is done — no early push, no separate plan PR.

Mechanical provisioning lives in `scripts/start-workstream.sh` — this command is
the thin session-level wrapper described in the DolasDev workflow
(`dolas/agents/team/workflow.md` → "Concurrent Work & The Merge Queue").
</objective>

<inputs>
- `<type>` — branch prefix: `feat` | `fix` | `chore` | `docs`
- `<slug>` — short lowercase id, e.g. `rating-engine` (matches `new-worktree.sh` convention)
- `<plan-file>` — path to the drafted, user-approved plan (typically a plan-mode
  artifact under `~/.claude/plans/`, or any markdown file the user points at)

If any argument is missing, ask for it rather than guessing — especially
`<plan-file>`: never invent plan content, only seed a plan the user already approved.
</inputs>

<process>
1. Confirm the plan has been approved by the user before running.
2. Run: `scripts/start-workstream.sh <type> <slug> <plan-file>`
   This provisions the worktree and seeds the plan file. It makes **no** git
   commit / push / PR — nothing goes to the remote at this step. Read its output
   for the worktree path.
3. Call `EnterWorktree` with `path` set to the printed worktree path (e.g.
   `../pegasus-<slug>`, resolved as a sibling of the primary checkout) to move
   the session's cwd, branch, config, and plans directory into the worktree.
4. Implement the plan **inside the worktree** — do not return to the primary
   checkout mid-task (Branch Discipline: one stream, one worktree, one branch).
5. When the work is done, commit the plan file **and** the implementation
   together, then open one PR and land it via the merge queue
   (`gh pr create` → `gh pr merge --auto --squash`).
</process>

<notes>
- Idempotent: re-running with the same `<slug>` reuses the existing worktree/DB
  (via `new-worktree.sh`) and will not clobber a plan file you have already
  started editing.
- The plan lives only in the worktree until the work is done, so an in-progress
  plan is visible via `git worktree list` + the branch (not on `main`) — which
  avoids the plan file conflicting with itself at merge time and avoids extra
  `main`-push churn. If you want in-flight plans visible on `main` sooner, land a
  small plans-only PR deliberately rather than on every workstream start.
- The provisioning step is side-effect-free on the remote; the only outward-facing
  action is the single PR you open at the end, once the work is ready.
- Companion commands: `/workstream-board` shows every in-flight workstream at a
  glance; `/finish-workstream` lands this branch through the merge queue and tears
  the worktree down once it has merged.
</notes>
