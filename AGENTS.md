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
