# Pegasus — Move Management Platform

## Project Overview

Pegasus is a cloud-native move management SaaS platform replacing a legacy VB.NET WinForms desktop application. It modernises the full lifecycle of a residential/commercial move: lead capture, quoting, crew scheduling, dispatch, inventory tracking, and billing — all as a multi-tenant web application backed by a serverless AWS infrastructure.

## Tech Stack

| Package / App     | Layer                  | Technology                                                                                                                      |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| (Root)            | Monorepo orchestration | [Turborepo](https://turbo.build/) + npm workspaces + TypeScript 5 (strict mode)                                                 |
| `packages/domain` | Domain Model           | Pure TypeScript — entities, value objects, business rules. Zero runtime dependencies.                                           |
| `apps/api`        | API                    | [Hono](https://hono.dev/) on AWS Lambda. [Prisma](https://www.prisma.io/) + PostgreSQL ([Neon](https://neon.tech)). Zod & jose. |
| `apps/tenant-web` | Frontend (Tenant)      | React 18 + Vite SPA, TanStack.                                                                                                  |
| `apps/admin-web`  | Frontend (Admin)       | React 18 + Vite SPA, TanStack.                                                                                                  |
| `packages/infra`  | Infrastructure         | AWS CDK (TypeScript).                                                                                                           |

## Monorepo Package Map

```
packages/
├── domain/   Pure TypeScript domain model. Zero runtime dependencies. The heart of the system.
├── infra/    AWS CDK stacks that provision Lambda, API Gateway, S3, CloudFront.
apps/
├── api/          Hono HTTP handlers. Calls domain logic, reads/writes via Prisma.
├── tenant-web/   React SPA for tenants. Consumes the API; no direct DB imports.
└── admin-web/    React SPA for platform administration.
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

- `apps/api`: `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run db:studio`.
- `packages/infra`: `npm run synth` and `npm run deploy` (via AWS CDK).
- `apps/admin-web`: `npm run dev` explicitly starts Vite on port `5174`.

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

| Layer                      | Tool                  | Location                  | Notes                                                                 |
| -------------------------- | --------------------- | ------------------------- | --------------------------------------------------------------------- |
| Unit                       | Vitest                | `packages/domain`         | Pure functions, no I/O, no mocks. Co-located with business logic.     |
| Integration (API handlers) | Vitest                | `apps/api`                | Requires Docker local Postgres. Tests skip when `DATABASE_URL` unset. |
| Infrastructure             | CDK + Vitest          | `packages/infra`          | Snapshot and fine-grained assertion tests.                            |
| API acceptance             | Playwright            | `apps/e2e/tests/api/`     | HTTP-level tests against a running API server.                        |
| Browser / E2E              | Playwright + Chromium | `apps/e2e/tests/browser/` | Full browser tests via `@playwright/test`.                            |

### E2E Suite (`apps/e2e`)

- **Run:** `npm run e2e` from `apps/e2e/`
- **Config:** `apps/e2e/playwright.config.ts` — reads `.env.test` for `DATABASE_URL`, `TEST_TENANT_ID`, API base URL, etc.
- **Setup:** `apps/e2e/global-setup.ts` — checks for Postgres via `pg_isready`; starts Docker Compose if needed.
- **Install browsers (once):** `npm run install:browsers` from `apps/e2e/`
- API spec files: `tests/api/{health,customers,moves,quotes}.spec.ts`
- Browser spec files: `tests/browser/landing.spec.ts`

> **Note**: For code patterns, architectural decisions, and other system rules, see the agent files below.

## Dependency Management

When dependency version conflicts or resolution issues arise, **do not** attempt to make multiple versions of the same dependency coexist (nested `node_modules`, manual copies, overrides hacks, etc.). Instead, plan and execute a code migration to upgrade all usages to the latest stable version of the dependency across the entire codebase. Rewriting code to work with one consistent version is always preferable to fighting npm hoisting, lockfile quirks, or version shims.

---

## Agent Files

### Company (universal DolasDev principles)

- **[dolas/agents/company/engineering-principles.md](./dolas/agents/company/engineering-principles.md)** — Plan before code, TDD, non-breaking increments, safety rails, observability standards, output format.

### Team (DolasDev workflow)

- **[dolas/agents/team/workflow.md](./dolas/agents/team/workflow.md)** — Branch discipline, sync protocol, scope control, conflict handling, commits, plan file format, archiving.

### Project (Pegasus-specific)

- **[dolas/agents/project/context.md](./dolas/agents/project/context.md)** — Multi-agent worktree model, task completion gate, TDD layers for this repo.
- **[dolas/agents/project/DECISIONS.md](./dolas/agents/project/DECISIONS.md)** — Architectural and technical decisions with reasoning.
- **[dolas/agents/project/PATTERNS.md](./dolas/agents/project/PATTERNS.md)** — Code patterns, abstractions, and conventions to follow or avoid.
- **[dolas/agents/project/GOTCHAS.md](./dolas/agents/project/GOTCHAS.md)** — Bugs, env issues, and non-obvious things discovered.

> **Agent Instructions:**
> After completing significant work in the repository, update the relevant files above. Before closing any task, confirm whether these files accurately reflect what was learned or added so nothing is lost.
