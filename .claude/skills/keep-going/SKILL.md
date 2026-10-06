---
name: keep-going
description: Checkpoint the current task into its plan file so a fresh session can resume after /clear — update the plan with exact resume state, then print the plan path and a paste-ready resume prompt
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
---

<objective>
The developer is about to clear context and wants to pick this task back up in a
fresh session. Bring the task's plan file fully up to date so that a new agent
with **no memory of this session** can continue from it, then hand back its path.

This is a checkpoint only: do not start new implementation, do not commit, do
not push. Only update the plan file.
</objective>

<process>

## 1. Find the plan file

In order, stop at the first hit:

1. The plan file this session has been working from (read, edited, or cited) —
   wherever it lives (`plans/in-progress/`, `plans/todo/`, a design doc).
2. `plans/in-progress/<slug>.md` where `<slug>` matches the current branch
   (`git branch --show-current`, minus its `<type>/` prefix) or the worktree
   directory name (`pegasus-<slug>`).
3. Neither exists → create `plans/in-progress/<slug>.md` in the format required
   by `dolas/agents/team/workflow.md` → "Plan File".

`plans/in-progress/` is **not** an in-flight signal — it holds stale and parked
plans. Never pick a file there just because it exists; it must match this task.
If two candidates are plausible, ask which one rather than guessing.

## 2. Gather live state (check it, don't recall it)

```bash
git branch --show-current
git rev-parse --show-toplevel
git log --oneline -5
git status --short
gh pr view --json number,state,url,mergeStateStatus,statusCheckRollup 2>/dev/null
```

Note any background watchers, CI runs, deploys, or merge-queue entries this
session started that a new session would need to re-check.

## 3. Update the plan file

Keep the existing structure (branch + goal, ordered checklist, files, risks) and
bring it current. Then add or replace a `## Resume here` section at the **top**
of the body, containing:

- **Where:** branch, worktree path, last commit (short sha + subject).
- **Status:** checklist marks reconciled with reality — `[x]` done,
  `[~]` in progress, `[ ]` pending. Mark `[x]` only what was actually verified.
- **Next action:** the single concrete next step — a file + what to change, or
  the exact command to run. Not "continue implementing".
- **Uncommitted work:** what is in the working tree and why it isn't committed.
- **In flight:** PR number, CI / merge-queue / deploy state, anything being
  watched, with the command to re-check it.
- **Decisions & dead ends:** choices made this session with their reason, and
  approaches tried that failed and why — the things that are expensive to
  rediscover.
- **Gotchas:** non-obvious facts learned this session that the next step depends on.
- **Verification still owed:** tests, typecheck, manual checks not yet run or not
  yet passing (say which, with the failure if any).

Write facts, not narrative. Use repo-relative paths and real identifiers
(PR numbers, commit shas, test names). Drop anything the next session can
trivially re-derive from `git log`.

## 4. Self-check

Re-read the whole plan file as if you had never seen this session. If the next
action depends on anything only in your context (a value, an error message, a
reason), write it into the file. Remove resume notes that are now stale.

## 5. Report

Output exactly two lines and nothing else:

```
<absolute path to plan file>
Resume from <repo-relative path> — read it fully, then start at "Next action": <one-line next action>
```

If the work is in a worktree, append `(cd <worktree path> first)` to the second line.

</process>
