# Pegasus — Move Management Platform

## Project Overview

Pegasus is a cloud-native move management SaaS platform replacing a legacy VB.NET WinForms desktop application. It modernises the full lifecycle of a residential/commercial move: lead capture, quoting, crew scheduling, dispatch, inventory tracking, and billing — all as a multi-tenant web application backed by a serverless AWS infrastructure.

## Tech Stack

| Package / App     | Layer                  | Technology                                                                                                                      |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| (Root)            | Monorepo orchestration | [Turborepo](https://turbo.build/) + npm workspaces + TypeScript 5 (strict mode)                                                 |
| `packages/domain` | Domain Model           | Pure TypeScript — entities, value objects, business rules. Zero runtime dependencies.                                           |
| `packages/api`    | API                    | [Hono](https://hono.dev/) on AWS Lambda. [Prisma](https://www.prisma.io/) + PostgreSQL ([Neon](https://neon.tech)). Zod & jose. |
| `packages/web`    | Frontend (Tenant)      | React 18 + Vite SPA, TanStack.                                                                                                  |
| `apps/admin`      | Frontend (Admin)       | React 18 + Vite SPA, TanStack.                                                                                                  |
| `packages/infra`  | Infrastructure         | AWS CDK (TypeScript).                                                                                                           |

## Monorepo Package Map

```
packages/
├── domain/   Pure TypeScript domain model. Zero runtime dependencies. The heart of the system.
├── api/      Hono HTTP handlers. Calls domain logic, reads/writes via Prisma.
├── web/      React SPA for tenants. Consumes the API; no direct DB imports.
├── infra/    AWS CDK stacks that provision Lambda, API Gateway, S3, CloudFront.
apps/
└── admin/    React SPA for platform administration.
```

## Turbo Pipeline & Script Execution

The monorepo uses Turborepo (`turbo.json`) and top-level npm scripts:

- `build`: Topologically sorted (`dependsOn: ["^build"]`). Outputs to `dist/**`.
- `test`: Cache disabled, runs in parallel across all packages (`dependsOn: []`).
- `lint`: Runs in parallel.
- `typecheck`: Topologically sorted (`dependsOn: ["^typecheck"]`).

## Key Commands

### Root Commands

- `npm install` — Install all workspace dependencies.
- `npm run dev` — Start all packages in development mode (parallel).
- `npm test` — Run all testing layers across all packages.
- `npm run typecheck` — Type-check all packages.
- `npm run deploy` — Runs `packages/infra/deploy.sh` to deploy the entire stack.
- `npm run create-admin-user` — Creates an admin user.

### Per-Package Commands

- `packages/api`: `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run db:studio`.
- `packages/infra`: `npm run synth` and `npm run deploy` (via AWS CDK).
- `apps/admin`: `npm run dev` explicitly starts Vite on port `5174`.

## Bounded Contexts

### Customer

Manages the people and organisations that request moves.

- **Entities:** `Customer`, `Contact`, `Account`, **Value objects:** `LeadSource`
- **Key rules:** A customer must have at least one primary contact.

### Quoting

Converts a survey into a priced proposal.

- **Entities:** `Quote`, `QuoteLineItem`, `RateTable`, `Rate`
- **Key rules:** Quotes require a line item. Accepted quotes are immutable.

### Dispatch

Owns the operational record of the move itself.

- **Entities:** `Move`, `Stop`, **Value objects:** `MoveStatus`, `StopType`
- **Key rules:** Must have crew member assigned logic. Needs two stops (origin, destination). Strict state machine transitions.

### Inventory

Tracks everything being moved, room by room.

- **Entities:** `InventoryRoom`, `InventoryItem`, **Value objects:** `ItemCondition`
- **Key rules:** Tracks condition at pack and delivery to support claims.

### Billing

Handles money in and money out.

- **Entities:** `Invoice`, `Payment`, **Value objects:** `InvoiceStatus`, `Money`
- **Key rules:** Generated from quotes. Invoices cannot be deleted once payments exist.

### Schedule

Models crew and vehicle availability.

- **Entities:** `CrewMember`, `Vehicle`, `Availability`, **Value objects:** `DateRange`
- **Key rules:** No overlap permitted. Vehicles require validation against last inspection.

## Testing Approach

- **Domain (`packages/domain`)**: Vitest (unit). Pure functions, no I/O, no mocks. Co-located with business context logic.
- **API (`packages/api`)**: Vitest (integration) requiring Docker local Postgres container.
- **Infra (`packages/infra`)**: CDK snapshot and fine-grained assertions tests.

> **Note**: For code patterns, architectural decisions, and other system rules, see the memory files below.

---

## Agent Working Rules

These rules govern how the agent executes tasks in this repository. They are **mandatory** — not suggestions.

### Operating Context

You are operating inside a Git worktree on a dedicated feature branch. Each worktree is an isolated working directory mapped to exactly one branch — the main repository directory is not your workspace. Multiple agents may run in parallel in separate worktrees.

Operate as a disciplined senior engineer: stay within scope, preserve architectural consistency, minimize merge-conflict surface, and assume other agents depend on public interfaces you touch.

### Branch Discipline

- Work ONLY within the current working directory and its branch.
- Never run `git checkout`, `git switch`, `git merge`, or `git rebase`.
- Never remove or prune worktrees. Never modify git configuration.
- Do NOT pull or push unless explicitly instructed.

**At session start**, identify the current branch (`git branch --show-current`), state it at the top of your plan file, and confirm all changes will remain on this branch.

### Mandatory Pre-Implementation Phase

**No code before plan approval.**

Before writing any code, produce a plan containing:

1. The task restated in your own words.
2. A step-by-step implementation plan.
3. Every file to be modified and every new file to be created.
4. Potential side effects or risks.

Wait for explicit developer approval before implementing anything.

### Scope Control

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

### Conflict Handling

Stop and seek clarification when:

- Task is unclear → clarify before writing a plan.
- Required files are missing → report and pause.
- Architecture appears inconsistent → ask before fixing.
- Overlapping responsibility detected with another subsystem → stop and ask.
- Change requires cross-branch coordination → stop immediately.
- Solution requires modifying shared infrastructure outside scope → stop.

### Test-Driven Development

**Tests are written before the implementation, not after.**

For every feature, endpoint, or component being built:

1. Write the test file first, covering the expected behaviour, error paths, and edge cases.
2. Run the tests and confirm they fail for the right reason (the implementation does not exist yet).
3. Write the minimum implementation needed to make the tests pass.
4. Refactor if necessary, keeping tests green throughout.

This applies at every layer:

- **Domain logic** — write the unit test before the function.
- **API handlers** — write the handler test (with mocked repositories) before the handler.
- **Repository functions** — write the integration test (skip-guarded) before the repository.
- **UI components** — write the component test before the component.

**Plans and individual checklist items must reflect this order.** Each step in a plan that introduces new behaviour must list the test file as the item to implement first, with the implementation item immediately following. Example:

```
- [ ] Write tenant-users.test.ts (handler unit tests — all cases failing)
- [ ] Implement tenant-users.ts (make tests pass)
```

Do not merge test and implementation steps into a single checklist item. They are distinct deliverables with a defined sequence.

### Task Completion Gate

**A task is not complete until the full test suite passes.**

Run `npm test` from the repo root. Every test across every package must pass. If tests fail, fix the code — do not work around failures by:

- Skipping, disabling, or deleting a failing test
- Marking a task complete despite failures
- Commenting out assertions
- Using `as any`, `// @ts-ignore`, or `// eslint-disable`

A failing test is evidence of a real problem. Treat it as signal, not noise.

### Plan File

Each agent works from a plan file in `plans/in-progress/`. Check for an existing file before creating one. Use a short, descriptive kebab-case name (e.g. `plans/in-progress/add-rbac-middleware.md`).

Every plan file must contain:

- Current branch name and one-line goal
- Ordered checklist: `[ ]` pending · `[x]` done · `[~]` in progress
- All files to be modified and created, plus identified side effects or risks
- Enough context that any agent can resume without re-reading the codebase

**Write and get the plan approved before implementing.** Update it after every completed subtask — it is the source of truth for progress.

### Non-Breaking, Independently Deployable Steps

Each increment must leave the codebase deployable:

- No partially-implemented features that break existing behaviour.
- Prefer feature flags, additive changes, and backwards-compatible interfaces.
- Database migrations must be non-destructive (no dropped columns/tables while old code still references them).

### Safety Rails

You MUST NOT:

- Delete large blocks of code without explicit justification in the plan.
- Remove configuration or environment logic.
- Modify the database schema unless explicitly in the approved plan.
- Introduce breaking API changes unless explicitly specified.

### Observability & Logging

When implementing any change, you MUST consider telemetry, tracing, and logging:

- Use structured logging (e.g., `@aws-lambda-powertools/logger` in the backend) instead of `console.log`.
- Do not leak internal stack traces or sensitive system data to the client in HTTP responses. Instead, catch exceptions, log the full details securely on the server with a `correlationId`, and return a sanitized JSON error payload to the client.
- Propagate trace IDs (`x-correlation-id`) from the frontend across network boundaries to the backend for end-to-end traceability.

### Output Format

When presenting results: show changes clearly (diffs preferred), keep diffs minimal, explain why each change is necessary, and include no unrelated commentary.

### Commits

Every commit must be focused and atomic — one logical change, no debug artifacts, no temp files. Commit messages must state what changed and why.

**Do not commit or push until the developer explicitly instructs you to.** When ready: run the full test suite, confirm it passes, summarise what changed, and wait for explicit approval.

### Archiving Completed Plans

After developer approval and commit, move the plan file from `plans/in-progress/` to `plans/completed/`:

```
plans/completed/<short-hash>-<slug>.md   # git rev-parse --short HEAD
plans/completed/<YYYY-MM-DDTHHMM>-<slug>.md  # if no commit yet
```

The archived file is a permanent record — do not edit it. An empty `plans/in-progress/` means no work is in flight.

---

## Memory File Index

- **[CLAUDE.md](./CLAUDE.md)** — Main entry point: Repo overview, package map, commands, turbo pipeline, bounded contexts, test strategy.
- **[DECISIONS.md](./DECISIONS.md)** — Architectural and technical decisions with reasoning.
- **[PATTERNS.md](./PATTERNS.md)** — Code patterns, abstractions, and conventions to follow or avoid.
- **[GOTCHAS.md](./GOTCHAS.md)** — Bugs, env issues, and non-obvious things discovered.

> **Agent Instructions:**
> After completing significant work in the repository, update the relevant memory files above. Before closing any task, confirm whether memory files accurately reflect what was learned or added so nothing is lost. This is your persistent memory system.
