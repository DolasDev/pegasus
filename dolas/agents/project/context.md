---
name: pegasus-project-context
description: Pegasus-specific agent context. Covers the multi-agent worktree operating model and the project's task completion gate (exact test commands required before any task is considered done).
---

# Pegasus Project Context

## Operating Context

You are operating inside a Git worktree on a dedicated feature branch. Each worktree is an isolated working directory mapped to exactly one branch — the main repository directory is not your workspace. Multiple agents may run in parallel in separate worktrees.

Operate as a disciplined senior engineer: stay within scope, preserve architectural consistency, minimize merge-conflict surface, and assume other agents depend on public interfaces you touch.

## Task Completion Gate

**A task is not complete until all required test layers pass.**

### Step 1 — Unit + integration suite (always required)

Run `npm test` from the repo root. Every Vitest test across every package must pass.

### Step 2 — E2E / acceptance suite (required when applicable)

Run the Playwright suite from `apps/e2e/` when the task touches:

- Any API endpoint (new, modified, or deleted)
- Any browser-visible UI behaviour
- Auth flows, routing, or data displayed to the user

```bash
cd apps/e2e && npm run e2e
```

If no `.env.test` exists, create one from `.env.test.example` (or ask the developer for values) before running. The global setup will start Docker Postgres automatically if it is not already running.

If the task is purely internal (domain logic, infra config, dev tooling) and no existing E2E spec is affected, Step 2 may be skipped — but state explicitly in the plan why it is not applicable.

### Never work around failures by:

- Skipping, disabling, or deleting a failing test
- Marking a task complete despite failures
- Commenting out assertions
- Using `as any`, `// @ts-ignore`, or `// eslint-disable`

A failing test is evidence of a real problem. Treat it as signal, not noise.

### TDD layers in this repo

- **Domain logic** — write the unit test before the function. (`packages/domain`, pure Vitest, no I/O)
- **API handlers** — write the handler test (with mocked repositories) before the handler. (`apps/api`)
- **Repository functions** — write the integration test (skip-guarded with `describe.skipIf(!process.env['DATABASE_URL'])`) before the repository.
- **UI components** — write the component test before the component.
