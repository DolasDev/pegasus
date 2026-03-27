# Codebase Structure

**Analysis Date:** 2026-03-27

## Directory Layout

```
pegasus/
├── packages/                    # Monorepo workspaces (Turborepo)
│   ├── domain/                  # Pure domain model — entities, value objects, validation
│   │   └── src/
│   │       ├── shared/          # Cross-cutting types (Money, Address, DateRange, IDs, DomainError)
│   │       ├── customer/        # Customer, Contact, LeadSource, Account
│   │       ├── schedule/        # CrewMember, Vehicle, Availability
│   │       ├── inventory/       # InventoryRoom, InventoryItem
│   │       ├── dispatch/        # Move, Stop, MoveStatus (move operations)
│   │       ├── quoting/         # Quote, QuoteLineItem, RateTable, Rate
│   │       ├── billing/         # Invoice, Payment, InvoiceStatus
│   │       └── index.ts         # Barrel exports all bounded contexts
│   │
│   ├── api/                     # HTTP API (Hono) — handlers, repositories, Prisma
│   │   ├── src/
│   │   │   ├── app.ts           # Main Hono app: routing, middleware, error handler, OpenAPI spec
│   │   │   ├── lambda.ts        # AWS Lambda entry point
│   │   │   ├── server.ts        # Node.js HTTP server entry point (on-premises)
│   │   │   ├── types.ts         # Hono context variable types (AppEnv, AdminEnv, ApiClientEnv)
│   │   │   ├── db.ts            # Prisma client singleton
│   │   │   ├── handlers/        # HTTP route handlers (one per bounded context)
│   │   │   │   ├── customers.ts
│   │   │   │   ├── moves.ts
│   │   │   │   ├── quotes.ts
│   │   │   │   ├── inventory.ts
│   │   │   │   ├── billing.ts
│   │   │   │   ├── auth.ts      # Login/logout, token exchange
│   │   │   │   ├── sso.ts       # SSO provider config endpoints
│   │   │   │   ├── users.ts     # Tenant user roster management
│   │   │   │   ├── api-clients.ts # M2M API key CRUD
│   │   │   │   ├── admin/       # Platform admin routes (separate sub-router)
│   │   │   │   ├── pegii/       # Legacy SQL Server integration routes
│   │   │   │   ├── efwk/        # Legacy enterprise framework routes
│   │   │   │   └── __tests__/   # Handler integration tests
│   │   │   │
│   │   │   ├── repositories/    # Database access layer (one per bounded context)
│   │   │   │   ├── customer.repository.ts  # createCustomer, listCustomers, mapCustomer, etc.
│   │   │   │   ├── move.repository.ts
│   │   │   │   ├── quote.repository.ts
│   │   │   │   ├── inventory.repository.ts
│   │   │   │   ├── billing.repository.ts
│   │   │   │   ├── api-client.repository.ts
│   │   │   │   ├── users.ts     # TenantUser queries
│   │   │   │   ├── index.ts     # Barrel exports
│   │   │   │   └── __tests__/   # Integration tests (skip if DATABASE_URL not set)
│   │   │   │
│   │   │   ├── middleware/      # Cross-cutting HTTP middleware
│   │   │   │   ├── correlation.ts    # Request tracing (x-correlation-id header, logger context)
│   │   │   │   ├── tenant.ts         # Multi-tenant resolution (JWT → tenant ID → scoped DB)
│   │   │   │   ├── api-client-auth.ts # M2M API key verification
│   │   │   │   └── admin-auth.ts     # Platform admin JWT verification
│   │   │   │
│   │   │   ├── lib/             # Utilities and helpers
│   │   │   │   ├── logger.ts    # AWS Lambda Powertools logger singleton
│   │   │   │   ├── env.ts       # Environment validation
│   │   │   │   ├── prisma.ts    # Tenant-scoped Prisma extension (createTenantDb)
│   │   │   │   ├── mssql.ts     # Legacy SQL Server connection pooling
│   │   │   │   └── __tests__/   # Unit tests for middleware, logger, etc.
│   │   │   │
│   │   │   ├── cognito/         # AWS Cognito Lambda triggers (pre-token, custom-message)
│   │   │   │   ├── pre-token-generation.ts
│   │   │   │   └── ...
│   │   │   │
│   │   │   └── __tests__/       # API-level integration tests
│   │   │       ├── health.test.ts
│   │   │       ├── tenant-middleware.test.ts
│   │   │       ├── openapi.test.ts
│   │   │       └── ...
│   │   │
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # PostgreSQL schema (Tenant, Customer, Move, Quote, Invoice, etc.)
│   │   │   ├── migrations/      # Schema migration history
│   │   │   └── seed.ts          # Database seeding script
│   │   │
│   │   └── package.json         # @pegasus/api workspace
│   │
│   ├── web/                     # React tenant SPA (Vite)
│   │   ├── src/
│   │   │   ├── main.tsx         # Entry point: config loading, React tree setup
│   │   │   ├── router.tsx       # TanStack Router route definitions
│   │   │   ├── config.ts        # Config loading (/config.json via CDK)
│   │   │   ├── routes/          # Route page components
│   │   │   │   ├── __root.tsx   # Root layout (header, sidebar, outlet)
│   │   │   │   ├── landing.tsx  # Unauthenticated landing page
│   │   │   │   ├── login.tsx    # Cognito Hosted UI redirect
│   │   │   │   ├── login.callback.tsx # JWT callback handler
│   │   │   │   ├── index.tsx    # Dashboard
│   │   │   │   ├── customers.index.tsx # Customer list
│   │   │   │   ├── customers.$customerId.tsx # Customer detail
│   │   │   │   ├── moves.index.tsx
│   │   │   │   ├── moves.$moveId.tsx
│   │   │   │   ├── quotes.index.tsx
│   │   │   │   ├── quotes.$quoteId.tsx
│   │   │   │   ├── invoices.index.tsx
│   │   │   │   ├── dispatch.index.tsx
│   │   │   │   ├── sso-config.tsx      # SSO provider management
│   │   │   │   ├── users.tsx           # Tenant user roster
│   │   │   │   └── settings.developer.tsx # API client management
│   │   │   │
│   │   │   ├── api/             # API client hooks and queries
│   │   │   │   ├── queries/     # useQuery hooks for data fetching
│   │   │   │   │   ├── useCustomers.ts
│   │   │   │   │   ├── useMoves.ts
│   │   │   │   │   └── ...
│   │   │   │   └── mutations/   # useMutation hooks for mutations
│   │   │   │
│   │   │   ├── components/      # React UI components
│   │   │   │   ├── ui/          # Radix UI primitives (Button, Dialog, Form, etc.)
│   │   │   │   ├── CustomerForm.tsx
│   │   │   │   ├── MoveList.tsx
│   │   │   │   └── ...
│   │   │   │
│   │   │   ├── auth/            # Cognito auth helpers
│   │   │   │   └── cognito.ts   # loginWithRedirect, handleCallback, logout
│   │   │   │
│   │   │   ├── lib/             # Utilities
│   │   │   │   └── utils.ts
│   │   │   │
│   │   │   ├── __tests__/       # Component and hook tests
│   │   │   │
│   │   │   ├── globals.css      # Tailwind and global styles
│   │   │   └── vite-env.d.ts    # Vite types
│   │   │
│   │   └── package.json         # @pegasus/web workspace
│   │
│   ├── api-http/                # Shared HTTP client factory
│   │   └── src/
│   │       ├── index.ts         # createApiClient(baseUrl), ApiError
│   │       ├── pagination.ts    # Pagination helpers
│   │       └── ...
│   │
│   ├── infra/                   # AWS CDK infrastructure
│   │   ├── bin/
│   │   │   └── app.ts           # Entry point: instantiates all stacks
│   │   │
│   │   ├── lib/
│   │   │   ├── stacks/          # CDK Stack definitions
│   │   │   │   ├── cognito-stack.ts       # Cognito User Pool, app clients, custom domain
│   │   │   │   ├── api-stack.ts           # Lambda, HTTP API v2, secret injection
│   │   │   │   ├── frontend-stack.ts      # Tenant web app: S3 + CloudFront
│   │   │   │   ├── admin-frontend-stack.ts # Admin portal: S3 + CloudFront
│   │   │   │   ├── frontend-assets-stack.ts # Deploys tenant app assets + config.json
│   │   │   │   ├── admin-frontend-assets-stack.ts
│   │   │   │   ├── monitoring-stack.ts    # CloudWatch alarms and dashboard
│   │   │   │   └── __tests__/
│   │   │   └── constructs/      # Reusable CDK constructs (if any)
│   │   │
│   │   ├── deploy.sh            # Deployment script (runs `cdk deploy --all`)
│   │   ├── cdk.json             # CDK app config
│   │   └── package.json         # @pegasus/infra workspace
│   │
│   └── theme/                   # Shared design tokens and theme
│       └── src/
│           └── index.ts         # Color palette, typography, spacing (for mobile + web)
│
├── apps/                        # Application-level projects (not libraries)
│   ├── admin/                   # Admin platform SPA (same structure as packages/web)
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── routes/          # Admin-only pages (tenant management, users, billing)
│   │   │   ├── components/
│   │   │   └── ...
│   │   └── package.json         # @pegasus/admin workspace
│   │
│   ├── mobile/                  # React Native mobile app (Expo)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   └── ...
│   │   └── package.json         # @pegasus/mobile workspace
│   │
│   └── e2e/                     # Playwright end-to-end tests
│       ├── tests/
│       │   ├── api/             # API acceptance tests
│       │   │   ├── health.spec.ts
│       │   │   ├── customers.spec.ts
│       │   │   ├── moves.spec.ts
│       │   │   ├── quotes.spec.ts
│       │   │   └── ...
│       │   └── browser/         # Browser/UI tests
│       │       ├── landing.spec.ts
│       │       └── ...
│       ├── global-setup.ts      # Starts Docker Postgres
│       ├── playwright.config.ts # Test runner config
│       └── package.json         # @pegasus/e2e workspace
│
├── package.json                 # Monorepo root (workspaces, dev scripts)
├── turbo.json                   # Turborepo pipeline config
├── tsconfig.base.json           # Base TypeScript config for all packages
├── prettier.config.js           # Code formatter config
├── .eslintrc.json               # Linter config
├── cdk.json                     # CDK config (app: "npx tsx packages/infra/bin/app.ts")
│
├── plans/                       # GSD task planning
│   ├── in-progress/             # Active task plans
│   └── completed/               # Archived completed tasks
│
├── scripts/                     # Root-level utility scripts
│   ├── create-admin-user.ts     # Cognito admin user creation
│   ├── launch_agent.sh          # Git worktree setup for parallel agents
│   └── remove_agent.sh
│
└── .planning/                   # GSD codebase documentation
    └── codebase/
        ├── ARCHITECTURE.md      # Architecture, layers, data flow
        ├── STRUCTURE.md         # This file — directory layout and naming
        ├── CONVENTIONS.md       # Code style, naming patterns, imports
        ├── TESTING.md           # Test patterns and frameworks
        ├── STACK.md             # Technology stack
        ├── INTEGRATIONS.md      # External services and APIs
        └── CONCERNS.md          # Tech debt and known issues
```

## Directory Purposes

**`packages/domain/`**

- **Purpose**: Pure TypeScript business logic — entities, value objects, validation rules, error types
- **Contains**: Six bounded contexts (customer, schedule, inventory, dispatch, quoting, billing) organized in subdirectories
- **Key files**: `shared/types.ts` (Money, Address, DateRange, ID brands), `shared/errors.ts` (DomainError), each context's `index.ts` (domain entities and helper functions)
- **No Dependencies**: This package has zero runtime dependencies — it's pure TS that can run anywhere

**`packages/api/`**

- **Purpose**: HTTP API implementation — handlers, repositories, middleware, database layer
- **Contains**: Hono route handlers, Prisma repository functions, middleware, Lambda/Node.js entry points
- **Key subdirs**:
  - `handlers/` — One handler file per bounded context (e.g., `customers.ts` contains POST/GET/PUT/DELETE customer routes)
  - `repositories/` — Database access layer; one file per context; mappers from Prisma → domain types
  - `middleware/` — Cross-cutting concerns (auth, correlation tracking, tenant resolution, request validation)
  - `lib/` — Utilities (logger, Prisma extensions, environment validation, legacy SQL Server pooling)
  - `prisma/` — PostgreSQL schema and migrations
  - Cognito Lambda triggers in `cognito/` subdirectory

**`packages/web/`**

- **Purpose**: React tenant SPA — customer-facing features (moves, quotes, invoices, customers)
- **Contains**: TanStack Router routes, React components, Cognito auth integration, data fetching with TanStack Query
- **Key subdirs**:
  - `routes/` — Route components (one per TanStack Router route); named after route path (e.g., `customers.$customerId.tsx`)
  - `components/` — Reusable React components; `ui/` subdirectory for Radix UI primitives
  - `api/` — HTTP client hooks (`useQuery`, `useMutation`) for API communication
  - `auth/` — Cognito authentication helpers

**`packages/api-http/`**

- **Purpose**: Shared, typed HTTP client for all frontends
- **Contains**: `createApiClient(baseUrl)` factory, `ApiError` exception class, pagination helpers
- **Single Dependency**: Depends only on TypeScript and Vitest (for testing)

**`packages/infra/`**

- **Purpose**: Infrastructure-as-code using AWS CDK (TypeScript)
- **Contains**: CDK Stack definitions for Lambda, API Gateway, Cognito, S3, CloudFront, RDS, monitoring
- **Key file**: `bin/app.ts` orchestrates all stacks with strict dependency ordering

**`packages/theme/`**

- **Purpose**: Design system — shared colors, typography, spacing tokens
- **Used by**: Both `packages/web` and `apps/mobile`

**`apps/admin/`**

- **Purpose**: Admin platform SPA — platform administrators manage tenants, users, subscriptions
- **Same structure as** `packages/web` but with admin-specific routes and components

**`apps/mobile/`**

- **Purpose**: React Native mobile app using Expo
- **Technologies**: Expo, React Native, same domain model as web

**`apps/e2e/`**

- **Purpose**: End-to-end acceptance tests using Playwright
- **Subdirs**:
  - `tests/api/` — API acceptance tests (HTTP-level validation)
  - `tests/browser/` — Browser/UI tests (full user workflows)

## Key File Locations

**Entry Points:**

- `packages/api/src/lambda.ts` — AWS Lambda handler exported as `handler`
- `packages/api/src/server.ts` — Node.js HTTP server entry point
- `packages/web/src/main.tsx` — React web app entry point
- `apps/admin/src/main.tsx` — React admin portal entry point
- `packages/infra/bin/app.ts` — CDK app entry point

**Configuration:**

- `packages/web/src/config.ts` — Config loading and validation (loads `/config.json` at startup)
- `packages/api/src/lib/env.ts` — Environment variable validation
- `packages/infra/cdk.json` — CDK configuration (points app to `bin/app.ts`)
- `tsconfig.base.json` — Base TypeScript config (path aliases, compiler options)
- `turbo.json` — Turborepo task pipeline and caching

**Core Logic:**

- `packages/domain/src/` — All business logic lives here; six bounded contexts
- `packages/api/src/handlers/` — HTTP route handlers; one per context
- `packages/api/src/repositories/` — Database access; one per context
- `packages/api/src/middleware/` — Cross-cutting middleware (auth, logging, tenant resolution)

**Database:**

- `packages/api/prisma/schema.prisma` — PostgreSQL schema definition
- `packages/api/prisma/migrations/` — Migration files (one per schema change)
- `packages/api/src/db.ts` — Prisma client singleton
- `packages/api/src/lib/prisma.ts` — Tenant-scoped Prisma extension factory

**Testing:**

- `packages/domain/src/**/__tests__/` — Domain unit tests
- `packages/api/src/repositories/__tests__/` — Integration tests (skip if DATABASE_URL not set)
- `packages/api/src/__tests__/` — API middleware/handler tests
- `packages/web/src/__tests__/` — React component/hook tests
- `apps/e2e/tests/api/` — Playwright API acceptance tests
- `apps/e2e/tests/browser/` — Playwright browser tests

## Naming Conventions

**Files:**

- `*.ts` — TypeScript source file
- `*.tsx` — TypeScript file with JSX (React components)
- `*.test.ts` — Vitest unit/integration test
- `*.spec.ts` — Playwright acceptance test
- Handler: `<context>.ts` (e.g., `customers.ts`, `moves.ts`)
- Repository: `<context>.repository.ts` (e.g., `customer.repository.ts`, `move.repository.ts`)
- Middleware: `<concern>.ts` (e.g., `correlation.ts`, `tenant.ts`)
- Route component: `<path>.tsx` (e.g., `customers.$customerId.tsx`, `moves.index.tsx`)
- Utility: `<purpose>.ts` (e.g., `logger.ts`, `prisma.ts`, `utils.ts`)

**Directories:**

- `src/` — Source code (not compiled)
- `dist/` — Compiled output (generated, not committed)
- `__tests__/` — Test files (co-located with code or grouped at directory level)
- `contexts/` or `bounded-contexts/` — Organized by bounded context
- `handlers/`, `repositories/`, `middleware/` — Organized by layer

**Variables and Functions:**

- `camelCase` for functions and variables
- `PascalCase` for types, interfaces, classes, React components
- `UPPER_SNAKE_CASE` for constants (e.g., `TENANT_SCOPED_MODELS`, `MOVE_STATUSES`)
- ID brands: `CustomerId`, `MoveId`, `QuoteId` (PascalCase + `Id` suffix)
- Branded values: `toCustomerId(raw)`, `toMoveId(raw)` (factory functions)
- Repository functions: `createCustomer()`, `listCustomers()`, `findCustomerById()`, `updateCustomer()`, `deleteCustomer()`
- Mapper functions: `mapCustomer()`, `mapMove()` (Prisma row → domain type)

**Database:**

- Table names: `snake_case`, plurals (e.g., `customers`, `moves`, `quote_line_items`)
- Column names: `snake_case` (e.g., `created_at`, `tenant_id`, `first_name`)
- Enum values: `UPPER_SNAKE_CASE` (e.g., `MoveStatus.PENDING`, `QuoteStatus.DRAFT`)

**Routes and APIs:**

- URL path: `kebab-case` (e.g., `/api/v1/customers`, `/api/v1/api-clients`, `/settings/sso`)
- Query param: `camelCase` (e.g., `?limit=50&offset=0`)
- JSON field: `camelCase` (e.g., `{ firstName: "John", lastName: "Doe" }`)

## Where to Add New Code

**New Feature (within existing bounded context):**

- **Domain logic**: Add function to `packages/domain/src/<context>/index.ts`
- **Database schema**: Add model/relation to `packages/api/prisma/schema.prisma`, run `prisma migrate dev --name <description>`
- **Repository function**: Add to `packages/api/src/repositories/<context>.repository.ts` (with mapper functions and types)
- **Handler route**: Add to `packages/api/src/handlers/<context>.ts` (with Zod validation)
- **Integration test**: Add to `packages/api/src/repositories/__tests__/<context>.test.ts`
- **Frontend query hook**: Add to `packages/web/src/api/queries/use<Entity>.ts`
- **Frontend route**: Add to `packages/web/src/routes/<entity>.<detail>.tsx`
- **E2E test**: Add to `apps/e2e/tests/api/<entity>.spec.ts` or `apps/e2e/tests/browser/<page>.spec.ts`

**New Bounded Context:**

- Create `packages/domain/src/<context>/index.ts` with entities and business rules
- Create `packages/api/src/handlers/<context>.ts` with routes
- Create `packages/api/src/repositories/<context>.repository.ts` with database functions
- Add models to `packages/api/prisma/schema.prisma` with `@@schema("public")`
- Create `packages/api/src/__tests__/` test file for the handler if non-trivial
- Create `packages/api/src/repositories/__tests__/<context>.test.ts` for repository tests
- Import handler in `packages/api/src/app.ts` and mount to v1 router: `v1.route('/<contexts>', handler)`
- Export types from `packages/domain/src/index.ts` barrel

**New Shared Utility:**

- TypeScript utilities: `packages/domain/src/shared/` (no deps) or `packages/api/src/lib/` (with deps)
- HTTP client helpers: `packages/api-http/src/`
- React hooks: `packages/web/src/lib/` or `packages/web/src/api/`
- UI components: `packages/web/src/components/` (prefer Radix UI + Tailwind)

**Database Migration:**

1. Update `packages/api/prisma/schema.prisma`
2. Run `npm run db:migrate` from `packages/api/` (generates migration file)
3. Commit migration file to git
4. No manual SQL required; Prisma handles it

**New Handler Endpoint:**

1. Add Zod validation schema to handler file (e.g., `CreateCustomerBody = z.object(...)`)
2. Add route handler to handler file with `handler.post()` / `.get()` / `.put()` / `.delete()`
3. Call repository function with `db`, `tenantId`, and validated input
4. Return `c.json({ data: result }, statusCode)` or `{ error, code }` on error
5. Write integration test covering success, validation failure, and error cases

**New API Client Integration:**

- Implement client library in `packages/api/` (e.g., MSSQL, Stripe, Twilio)
- Inject credentials via environment variables (never hardcoded)
- Wrap in repository function that maps response to domain types
- Add tests with mocked client (use Vitest mocking if external service)

## Special Directories

**`packages/api/prisma/migrations/`**

- **Purpose**: PostgreSQL schema evolution history
- **Generated**: Automatically by `prisma migrate dev`
- **Committed**: Yes — necessary for `prisma migrate deploy` in production
- **Pattern**: Each migration is a `YYYYMMDDHHMMSS_<description>/migration.sql` directory
- **Never edit manually** — always use `prisma migrate dev --name <description>` to generate

**`packages/api/src/cognito/`**

- **Purpose**: AWS Cognito Lambda triggers (pre-token-generation, custom-message, etc.)
- **Deployed**: Separately as Lambda functions via CDK
- **Pattern**: Each trigger is a standalone handler with its own dependencies

**`packages/api/src/handlers/pegii/` and `packages/api/src/handlers/efwk/`**

- **Purpose**: Legacy system integration routes; bridge between Pegasus API and legacy SQL Server databases
- **Database**: Separate MSSQL connection pools per tenant
- **Isolation**: Self-contained sub-routers; don't affect core bounded contexts

**`packages/infra/lib/stacks/`**

- **Purpose**: AWS CDK Stack definitions
- **Pattern**: One Stack class per cloud service type (Cognito, Lambda, S3, etc.)
- **Orchestration**: Instantiated in `bin/app.ts` with strict dependency order
- **Cross-stack tokens**: CloudFront domain names, API URLs passed as constructor props

**`.planning/codebase/`**

- **Purpose**: GSD codebase documentation (auto-generated)
- **Contains**: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md
- **Committed**: Yes — reference for all future GSD tasks
- **Not edited manually** — regenerated by `/gsd:map-codebase` command

**`plans/in-progress/` and `plans/completed/`**

- **Purpose**: Task planning and execution tracking
- **In-progress**: Active task plans with checklists
- **Completed**: Archived task plans (moved after approval and commit)
- **Format**: Markdown files with checklist items and decision notes

---

_Structure analysis: 2026-03-27_
