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

## Memory File Index

- **[CLAUDE.md](./CLAUDE.md)** — Main entry point: Repo overview, package map, commands, turbo pipeline, bounded contexts, test strategy.
- **[DECISIONS.md](./DECISIONS.md)** — Architectural and technical decisions with reasoning.
- **[PATTERNS.md](./PATTERNS.md)** — Code patterns, abstractions, and conventions to follow or avoid.
- **[GOTCHAS.md](./GOTCHAS.md)** — Bugs, env issues, and non-obvious things discovered.

> **Agent Instructions:** 
> After completing significant work in the repository, update the relevant memory files above. Before closing any task, confirm whether memory files accurately reflect what was learned or added so nothing is lost. This is your persistent memory system.
