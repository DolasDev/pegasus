# Pegasus — Move Management Platform

## Project Overview

Pegasus is a cloud-native move management SaaS platform replacing a legacy VB.NET WinForms desktop application. It modernises the full lifecycle of a residential/commercial move: lead capture, quoting, crew scheduling, dispatch, inventory tracking, and billing — all as a multi-tenant web application backed by a serverless AWS infrastructure.

## Tech Stack

| Package / App | Layer | Technology |
|---|---|---|
| (Root) | Monorepo orchestration | [Turborepo](https://turbo.build/) + npm workspaces + TypeScript 5 (strict mode) |
| `packages/domain` | Domain Model | Pure TypeScript — entities, value objects, business rules. Zero runtime dependencies. |
| `packages/api` | API | [Hono](https://hono.dev/) on AWS Lambda. [Prisma](https://www.prisma.io/) + PostgreSQL ([Neon](https://neon.tech)). Zod & jose. |
| `packages/web` | Frontend (Tenant) | React 18 + Vite SPA, TanStack. |
| `apps/admin` | Frontend (Admin) | React 18 + Vite SPA, TanStack. |
| `packages/infra` | Infrastructure | AWS CDK (TypeScript). |

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

### Task Completion Gate: All Tests Must Pass

**A task is not complete until the full test suite passes.**

Before marking any task or subtask as done:
1. Run `npm test` from the repo root.
2. Every test across every package must pass.
3. If tests fail, **fix the code** — do not work around the failure by:
   - Skipping, disabling, or deleting a failing test
   - Marking a task complete despite test failures
   - Commenting out assertions
   - Widening types or using `as any` to silence type errors
   - Using `// @ts-ignore` or `// eslint-disable` to suppress legitimate errors

A failing test is evidence of a real problem. Treat it as signal, not noise.

### Plan File

Each agent works from its own plan file in `plans/in-progress/`. Use a short, descriptive kebab-case name that uniquely identifies the work:

```
plans/in-progress/<short-name>.md
```

Examples: `plans/in-progress/add-rbac-middleware.md`, `plans/in-progress/cognito-sso-config.md`

**Why a named file per agent:** multiple agents may work in parallel on different features. A unique file per plan prevents conflicts and makes it obvious at a glance what work is in flight — `ls plans/in-progress/` shows every active workstream.

**Before starting work**, check `plans/in-progress/` for an existing plan file for this task. If one exists, resume from it. If not, create one.

Every plan file must contain:
- A one-line goal at the top
- An ordered checklist of tasks/subtasks with status markers: `[ ]` pending · `[x]` done · `[~]` in progress
- Enough context (key files, decisions made, blockers) that any agent can pick up mid-task without re-reading the whole codebase

After completing each task or subtask, immediately update the plan file to mark it done. The plan file is the source of truth for progress — keep it current at all times.

### Non-Breaking, Independently Deployable Steps

Complete work in increments that are safe to deploy on their own:
- Each step must leave the codebase in a working, deployable state.
- Do not introduce partially-implemented features that break existing behaviour.
- Prefer feature flags, additive changes (new files, new fields), and backwards-compatible interfaces over disruptive rewrites.
- Database migrations must be non-destructive (no dropped columns/tables while old code still references them).

### Commit and Push: Await Developer Approval

**Do not commit or push, even if all tests pass**, unless the developer explicitly instructs you to.

When work is ready:
1. Run the full test suite and confirm it passes.
2. Summarise what was done and what changed.
3. Wait for explicit developer approval before running `git commit` or `git push`.

### Archiving Completed Plans

Once a plan has been fully executed and the developer has approved the commit, archive the plan file from `plans/in-progress/` into `plans/completed/`.

**Naming convention** — use the short commit hash of the commit that completes the work, followed by a slug of the plan title:

```
plans/completed/<short-hash>-<slug>.md
```

Example: `plans/completed/a3f9c12-add-rbac-middleware.md`

If no commit has been made yet (e.g. the developer approves but asks you to commit later), fall back to an ISO-8601 datetime prefix instead:

```
plans/completed/<YYYY-MM-DDTHHMM>-<slug>.md
```

Example: `plans/completed/2026-02-25T1430-add-rbac-middleware.md`

Steps:
1. After the developer approves the commit, run `git rev-parse --short HEAD` to get the short hash.
2. Move the plan file to `plans/completed/<short-hash>-<slug>.md` (use the same slug as the in-progress name).
3. The archived file is a permanent record — do not edit it after archiving.
4. An empty `plans/in-progress/` means no work is currently in flight.

This makes it straightforward to trace any archived plan back to its place in git history with `git show <short-hash>`.

---

## Memory File Index

- **[CLAUDE.md](./CLAUDE.md)** — Main entry point: Repo overview, package map, commands, turbo pipeline, bounded contexts, test strategy.
- **[DECISIONS.md](./DECISIONS.md)** — Architectural and technical decisions with reasoning.
- **[PATTERNS.md](./PATTERNS.md)** — Code patterns, abstractions, and conventions to follow or avoid.
- **[GOTCHAS.md](./GOTCHAS.md)** — Bugs, env issues, and non-obvious things discovered.

> **Agent Instructions:** 
> After completing significant work in the repository, update the relevant memory files above. Before closing any task, confirm whether memory files accurately reflect what was learned or added so nothing is lost. This is your persistent memory system.
