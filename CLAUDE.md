# Pegasus — Move Management Platform

## Project Overview

Pegasus is a cloud-native move management SaaS platform replacing a legacy VB.NET WinForms desktop application. It modernises the full lifecycle of a residential/commercial move: lead capture, quoting, crew scheduling, dispatch, inventory tracking, and billing — all as a multi-tenant web application backed by a serverless AWS infrastructure.

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo orchestration | [Turborepo](https://turbo.build/) |
| Language | TypeScript 5 (strict mode throughout) |
| API | [Hono](https://hono.dev/) (lightweight edge-ready HTTP framework) |
| ORM / DB | [Prisma](https://www.prisma.io/) + PostgreSQL (RDS) |
| Frontend | React 18 + Vite |
| Infrastructure | AWS CDK (TypeScript) |
| Testing | Vitest (unit + integration) |
| Package manager | npm workspaces |

## Monorepo Package Map

```
packages/
├── domain/   Pure TypeScript domain model — entities, value objects, business rules.
│             Zero runtime dependencies. This is the heart of the system.
├── api/      Hono HTTP handlers. Calls domain logic, reads/writes via Prisma.
│             Deployed as AWS Lambda behind API Gateway.
├── web/      React SPA. Consumes the API; no direct DB or domain imports.
└── infra/    AWS CDK stacks that provision RDS, Lambda, API Gateway, S3, CloudFront.
```

## Bounded Contexts

### Customer
Manages the people and organisations that request moves.

- **Entities:** `Customer`, `Contact`, `Account`
- **Value objects:** `LeadSource`
- **Key rules:** A customer must have at least one primary contact. Lead source tracks the marketing channel that generated the enquiry.

### Quoting
Converts a survey into a priced proposal.

- **Entities:** `Quote`, `QuoteLineItem`, `RateTable`, `Rate`
- **Key rules:** A quote cannot be finalised (sent to the customer) without at least one line item. Rates are looked up from the active `RateTable` at quote creation time. An accepted quote is immutable.

### Dispatch
Owns the operational record of the move itself.

- **Entities:** `Move`, `Stop`
- **Value objects:** `MoveStatus`, `StopType`
- **Key rules:** A move cannot be dispatched (`IN_PROGRESS`) without at least one crew member assigned. Status transitions follow a strict state machine: `PENDING → SCHEDULED → IN_PROGRESS → COMPLETED | CANCELLED`. A move requires at least two stops (origin and destination).

### Inventory
Tracks everything being moved, room by room.

- **Entities:** `InventoryRoom`, `InventoryItem`
- **Value objects:** `ItemCondition`
- **Key rules:** Items belong to exactly one room. Condition is recorded at pack and again at delivery to support damage claims. Valuation is calculated at the item level.

### Billing
Handles money in and money out once the move is complete.

- **Entities:** `Invoice`, `Payment`
- **Value objects:** `InvoiceStatus`, `Money`
- **Key rules:** An invoice is generated from an accepted quote. Payments reduce the outstanding balance. Invoices cannot be deleted once payments exist against them.

### Schedule
Models crew and vehicle availability for capacity planning.

- **Entities:** `CrewMember`, `Vehicle`, `Availability`
- **Value objects:** `DateRange`
- **Key rules:** Availability windows must not overlap for the same resource. A vehicle must pass its last inspection date before being assigned to a move.

## Architectural Rules

1. **Domain is pure.** `packages/domain` has **no runtime dependencies** (no Prisma, no Hono, no AWS SDK). It contains only TypeScript interfaces, value objects, and pure functions.
2. **No circular dependencies.** Dependency direction inside the domain: `shared ← customer | schedule | inventory ← dispatch ← quoting ← billing`. Use `madge` or `tsc --traceResolution` to verify.
3. **Handlers call domain, not DB directly.** API handlers in `packages/api` must invoke domain functions (validation, state transitions) before persisting. Raw Prisma queries must never contain business logic.
4. **Branded IDs everywhere.** Never accept `string` where a domain ID is expected. Use the `Brand<T, B>` pattern and the generated `to*Id` factories.
5. **Value objects are immutable.** All interfaces use `readonly` on every field. Never mutate; return new objects.
6. **No `any`.** The root `tsconfig.base.json` enforces `strict: true`. `as` casts are only permitted in the `to*Id` factory functions.

## Coding Conventions

- **Named exports only.** No default exports anywhere. This makes refactoring and barrel files reliable.
- **Barrel files per context.** Each bounded context folder (`customer/`, `dispatch/`, etc.) has an `index.ts` that re-exports the public surface of that context. Consumers import from the context barrel, not from internal files.
- **JSDoc on all aggregates.** Every aggregate root interface and every public domain function must have a JSDoc comment explaining its business purpose and any invariants.
- **Factory functions over constructors.** Prefer `createX(input): X` functions that perform validation and return a plain object. Reserve classes for cases where encapsulation is genuinely needed.
- **`type` imports.** Use `import type { ... }` for all type-only imports to keep runtime bundles clean.

## Testing Approach

| Layer | Tool | Scope |
|---|---|---|
| Domain rules | Vitest (unit) | Pure functions, no I/O, no mocks |
| API handlers | Vitest (integration) | Real Prisma client against a test Postgres DB (Docker) |
| Infrastructure | CDK assertions | Snapshot + fine-grained assertion tests |

- Domain unit tests live in `packages/domain/src/__tests__/`.
- Tests are co-located with the package they test; there is no top-level `tests/` folder.
- Each test file maps to a bounded context (e.g., `dispatch.test.ts`, `quoting.test.ts`).
- Avoid mocking within domain tests — if you need to mock, the code under test has leaked infrastructure concerns into the domain.

## How to Run

```bash
# Install all workspace dependencies
npm install

# Start all packages in development mode (parallel)
npm run dev

# Run all tests across all packages
npm test

# Type-check all packages
npm run typecheck

# Synthesise CDK CloudFormation templates (from packages/infra)
cd packages/infra && npx cdk synth
```

> **Prerequisites:** Node ≥ 18, npm ≥ 9. For integration tests, Docker must be running (spins up a local Postgres container).
