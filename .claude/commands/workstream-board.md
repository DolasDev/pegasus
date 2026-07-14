---
name: workstream-board
description: Read-only status of every in-flight workstream — worktrees, branches, dirty/ahead-behind, seeded plan, and open-PR/queue state — derived live from git and gh
allowed-tools:
  - Bash
  - Read
---

<objective>
A single glanceable board of what is in flight across all parallel workstreams.
Purely a derived projection over `git worktree list` + `gh` — it maintains no
state of its own and reconciles against git every time it runs. Read-only:
never creates, switches, commits, pushes, or removes anything.
</objective>

<process>
1. Enumerate worktrees from the source of truth:
   `git worktree list --porcelain` (run from any worktree — it lists them all).
   The primary checkout is the first entry; the rest are active workstreams
   created by `scripts/new-worktree.sh` / `/start-workstream`.

2. For each worktree, gather (use `git -C <path> ...`, all read-only):
   - **branch** — `git -C <path> rev-parse --abbrev-ref HEAD` (or `(detached)`).
   - **HEAD** — `git -C <path> rev-parse --short HEAD`.
   - **dirty** — non-empty `git -C <path> status --porcelain` → ✎, else clean.
   - **ahead/behind** vs upstream — `git -C <path> rev-list --left-right
     --count @{upstream}...HEAD 2>/dev/null` (blank if no upstream).
   - **plan** — the seeded plan file, if any: `plans/in-progress/<slug>.md`
     (slug = branch after `<type>/`).
   - **PR + queue** — `gh pr view <branch> --json number,state,url,isDraft,mergeStateStatus 2>/dev/null`;
     for queue position use `gh api graphql` on the PR's `mergeQueueEntry
     { position state }` when `mergeStateStatus` suggests it is queued. Tolerate
     "no PR" cleanly.

3. Print a compact table, one row per worktree, most relevant first
   (primary checkout last). Columns:
   `slug/branch · HEAD · dirty · ahead/behind · plan? · PR#/state`.
   Add a one-line legend under it. If a worktree is dirty **and** has no open PR,
   flag it — that is unlanded work worth attention.
</process>

<notes>
- Git is the ledger; this board is only a view of it. If it disagrees with git,
  git wins — re-run rather than trust a cached impression.
- Pairs with `/start-workstream` (begin) and `/finish-workstream` (land + tear
  down): this is the "what's happening right now" lens between the two.
- Because every session shares the same `gh` credentials, an open PR here may be
  driven by another session — the board shows state, not ownership. Do not act
  on another workstream's PR from this command (it is read-only by design).
</notes>
