# Agents Memory Index

This repository uses [`CLAUDE.md`](./CLAUDE.md) as the primary entry point for all AI coding assistants.
Please defer to `CLAUDE.md` to get oriented without duplication.

## Agent Files

**Company** (universal DolasDev principles)

- [dolas/agents/company/engineering-principles.md](./dolas/agents/company/engineering-principles.md) — Plan before code, TDD, non-breaking increments, safety rails, observability standards, output format.

**Team** (DolasDev workflow)

- [dolas/agents/team/workflow.md](./dolas/agents/team/workflow.md) — Branch discipline, sync protocol, scope control, conflict handling, commits, plan file format, archiving.

**Project** (Pegasus-specific)

- [CLAUDE.md](./CLAUDE.md) — Repo overview, commands, turbo pipeline, bounded contexts, and tech stack.
- [dolas/agents/project/context.md](./dolas/agents/project/context.md) — Multi-agent worktree model, task completion gate, TDD layers for this repo.
- [dolas/agents/project/DECISIONS.md](./dolas/agents/project/DECISIONS.md) — Architectural and technical decisions with reasoning.
- [dolas/agents/project/PATTERNS.md](./dolas/agents/project/PATTERNS.md) — Code patterns, abstractions, and conventions to follow or avoid.
- [dolas/agents/project/GOTCHAS.md](./dolas/agents/project/GOTCHAS.md) — Bugs, env issues, and non-obvious things discovered.

> **Agent Instructions:** After completing significant work, update the relevant files in `dolas/agents/`. Before closing any task, confirm they reflect what was learned.

## Turborepo: check the installed version's own docs

Turborepo's config keys, task behavior and CLI flags move between minor versions, so training data and
web results go stale fast — and this repo has already lost time to that. Before changing `turbo.json`
or a `turbo` command, read the docs **bundled with the version actually installed here**:

```
node -p "require.resolve('turbo/package.json')"   # from the workspace that depends on turbo
```

then read `docs/README.md` in that directory and the relevant pages under `docs/`. They ship inside
the npm package (`docs/reference/configuration.mdx`, `docs/guides/`, plus `schema.json`), match the
installed version exactly, and need no network. `turbo docs "<query>"` searches the same
version-matched set from the terminal.

Resolve `turbo` from the workspace you are working in, not by assuming `./node_modules/turbo` — the
root copy can be stale or absent. It was **2.9.18 on disk while the lockfile said 2.11.5** on
2026-10-05, which is exactly the kind of mismatch that makes a "turbo doesn't do that" conclusion
wrong.

> This section is ours, written deliberately. `turbo` ≥ 2.11 would otherwise inject its own managed
> block here on every agent-detected invocation; that is turned off via `"agentGuidance": false` in
> `turbo.json` — see the `//` note there and the GOTCHAS entry. Do not re-enable it to get this
> advice back; it is already above.
