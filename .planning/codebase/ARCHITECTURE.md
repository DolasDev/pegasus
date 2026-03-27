# Architecture

**Analysis Date:** 2026-03-27

## Pattern Overview

**Overall:** Layered, multi-tenant SaaS platform with a pure domain model, API handler layer, persistence layer, and decoupled frontends.

**Key Characteristics:**

- **Monorepo with Turborepo**: Isolated, independently-deployable packages sharing a single TypeScript configuration and dependency tree
- **Domain-Driven Design**: Pure domain model (`packages/domain`) drives all business logic; zero runtime dependencies in domain
- **Hono HTTP Framework**: Lightweight, flexible middleware-based routing with first-class TypeScript support
- **Tenant Scoping via Prisma Extensions**: Transparent multi-tenancy — repositories never explicitly pass `tenantId`; a Prisma client extension injects it at the query level
- **Middleware-First Auth**: Cognito JWT verification + tenant resolution in middleware; handlers receive populated context
- **Dual Deployment**: Lambda + HTTP API Gateway v2 for AWS; Node.js HTTP server for on-premises
- **Infrastructure-as-Code**: AWS CDK (TypeScript) with strict dependency ordering to manage cross-stack tokens

## Layers

**Domain Model (`packages/domain/src/`):**

- **Purpose**: Pure TypeScript business logic, entities, value objects, and validation rules — the source of truth for all system behaviour
- **Location**: `packages/domain/src/`
- **Contains**: Six bounded contexts (customer, schedule, inventory, dispatch, quoting, billing) + shared types and errors
- **Depends on**: Nothing (zero runtime dependencies)
- **Used by**: API handlers, repositories, and any integration code

**HTTP API (`packages/api/src/`):**

- **Purpose**: Handles incoming HTTP requests, validates input, calls domain logic and repositories, returns JSON responses
- **Location**: `packages/api/src/`
- **Contains**: Route handlers (one per bounded context), middleware, type definitions, Prisma repository layer
- **Depends on**: `@pegasus/domain`, Prisma, Hono, jose (JWT verification), Zod (input validation)
- **Used by**: AWS Lambda (via CDK deployment), local Node.js server, Playwright E2E tests

**Repositories (`packages/api/src/repositories/`):**

- **Purpose**: Maps domain types ↔ Prisma models; encapsulates database queries into reusable functions
- **Location**: `packages/api/src/repositories/`
- **Contains**: One file per bounded context (e.g., `customer.repository.ts`) + integration tests with `describe.skipIf(!DATABASE_URL)` guards
- **Pattern**: Each repository exports typed functions like `createCustomer(db, tenantId, input)` and `mapCustomer(rawPrismaRow)` to translate back to domain types
- **Multi-tenancy**: Tenant scoping is automatic via `createTenantDb()` extension; repositories pass explicit `tenantId` only in create operations

**Web Frontend (`packages/web/src/`):**

- **Purpose**: Tenant-facing React SPA for move management (customers, quotes, moves, invoices, etc.)
- **Location**: `packages/web/src/`
- **Contains**: TanStack Router routes, React components, TanStack Query hooks, Cognito auth handlers
- **Depends on**: `@pegasus/api-http` (typed HTTP client), `@pegasus/domain` (domain types), Tailwind CSS, Radix UI primitives
- **Built**: Vite SPA, deployed to S3 + CloudFront

**Admin Portal (`apps/admin/src/`):**

- **Purpose**: Platform administrators manage tenants, users, subscriptions, and system health
- **Location**: `apps/admin/src/`
- **Contains**: Admin-only routes, tenant management UI, user provisioning, system monitoring dashboards
- **Depends on**: `@pegasus/api-http` (for `/api/admin` routes), React, TanStack Query, Tailwind CSS
- **Built**: Vite SPA, deployed to separate S3 + CloudFront distribution

**HTTP Client (`packages/api-http/src/`):**

- **Purpose**: Shared, typed HTTP client factory for all frontends; handles correlation IDs, error parsing, request tracing
- **Location**: `packages/api-http/src/`
- **Contains**: `createApiClient(baseUrl)` factory, `ApiError` class, pagination helpers
- **Used by**: `packages/web`, `apps/admin`, `apps/e2e`
- **No dependencies**: Pure TypeScript; frontends inject their own fetch implementation

**Infrastructure (`packages/infra/lib/stacks/`):**

- **Purpose**: AWS CDK stacks that define the entire deployment: Lambda, API Gateway, Cognito, S3, CloudFront, RDS, monitoring
- **Location**: `packages/infra/lib/stacks/` (7 stacks)
- **Pattern**: Each stack is a CDK Construct; orchestrated in `bin/app.ts` with strict dependency ordering
- **Cross-Stack Tokens**: Stacks pass CloudFront domain names and API URLs via constructor props; CDK generates Fn::ImportValue for CloudFormation resolution

**E2E Tests (`apps/e2e/`):**

- **Purpose**: Playwright browser and API acceptance tests; validates full request flow from frontend through backend
- **Location**: `apps/e2e/tests/api/` (API specs) and `apps/e2e/tests/browser/` (browser specs)
- **Setup**: Global setup starts Docker Compose for Postgres if DATABASE_URL is unset; uses local .env.test
- **Pattern**: Tests are run in isolation; each test suite manages its own data via repositories

## Data Flow

**Tenant Request Flow (API):**

1. **Request enters API Gateway v2** → Lambda cold start (if needed) → Hono app
2. **Correlation middleware** extracts or generates `x-correlation-id` header, embeds it in logger context
3. **Tenant middleware** verifies Cognito JWT, extracts `custom:tenantId` and `custom:role`, resolves Tenant record, creates tenant-scoped Prisma client (`createTenantDb()`)
4. **Route handler** receives fully-populated context: `tenantId`, `db` (tenant-scoped), `role`, `userId`, `correlationId`
5. **Handler validates input** with Zod via Hono's `validator('json')` middleware
6. **Handler calls repository function** (e.g., `createCustomer(db, tenantId, input)`)
7. **Repository** translates input to Prisma model, creates/updates/reads DB row, maps result back to domain type
8. **Handler returns JSON** response with correlation ID in header; error handler catches and sanitizes exceptions
9. **Global error handler** logs full error server-side (stack, correlation ID), returns `{ error, code, correlationId }` to client

**Frontend Request Flow (Web):**

1. **App initializes**: `loadConfig()` fetches `/config.json` (served by S3 + CloudFront) containing API URL and Cognito credentials
2. **User lands on landing page** → unauthenticated route
3. **User clicks "Log In"** → redirected to Cognito Hosted UI via `/login`
4. **Cognito callback** → `/login/callback` extracts `code` param, exchanges for JWT, stores in sessionStorage
5. **Dashboard loads** → TanStack Router guard checks for JWT; if missing, redirects to `/login`
6. **TanStack Query hooks** call `apiClient.get('/api/v1/customers', ...)` which injects `Authorization: Bearer <jwt>` and `x-correlation-id: <uuid>` headers
7. **API response** includes `x-correlation-id` header so frontend can surface it to users on error

**State Management:**

- **Domain/Application State**: TanStack Query manages server state (caches, refetch, mutations); no Redux
- **UI State**: React local state for modals, dropdowns, form inputs
- **Auth State**: JWT stored in sessionStorage; Cognito session managed by browser
- **Tenant Scope**: Implicit in Hono context (`c.get('db')`, `c.get('tenantId')`); never passed as function parameter downstream

## Key Abstractions

**Domain Entity (Bounded Context Model):**

- **Purpose**: Represent a real-world concept (Customer, Move, Quote) with validation rules and invariants
- **Examples**: `packages/domain/src/customer/index.ts`, `packages/domain/src/dispatch/index.ts`
- **Pattern**: TypeScript `type`, exported from bounded context barrel, re-exported from `packages/domain/src/index.ts`; brand types for IDs (`CustomerId`, `MoveId`) prevent accidental mixing
- **No Methods**: Entities are data; business logic lives in handler/repository functions that accept entities as parameters

**Repository Function:**

- **Purpose**: Encapsulate a database operation (create, read, update, list) and map Prisma rows ↔ domain types
- **Pattern**:
  ```typescript
  export async function createCustomer(
    db: PrismaClient,
    tenantId: string,
    input: CreateCustomerInput,
  ): Promise<Customer> {
    const row = await db.customer.create({ data: { tenantId, ...input } })
    return mapCustomer(row)
  }
  ```
- **Mapping Functions**: `mapCustomer(row: RawCustomer): Customer` extracts fields, converts Prisma types, applies optional field spread pattern
- **Tests**: Integration tests guard with `describe.skipIf(!process.env['DATABASE_URL'])` and use real Postgres

**Hono Handler:**

- **Purpose**: Receive HTTP request, validate, call repository, return response
- **Pattern**:
  ```typescript
  handler.post(
    '/',
    validator('json', (value, c) => {
      const r = ValidationSchema.safeParse(value)
      if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
      return r.data
    }),
    async (c) => {
      const db = c.get('db')
      const body = c.req.valid('json')
      const result = await createCustomer(db, c.get('tenantId'), body)
      return c.json({ data: result }, 201)
    },
  )
  ```
- **Error Handling**: Handlers do NOT throw; they return `c.json({ error, code }, statusCode)`. The global `app.onError` catches unhandled exceptions
- **Tenant Scope**: Handlers extract `tenantId` from context; repositories receive it explicitly

**Tenant-Scoped Prisma Extension:**

- **Purpose**: Automatically inject `tenantId` WHERE clause on every query without boilerplate
- **Implementation**: `createTenantDb(basePrisma, tenantId)` wraps basePrisma with a `$extends` block that intercepts all operations
- **Covered Models**: `TENANT_SCOPED_MODELS = ['Customer', 'Move', 'Quote', ...]` in `packages/api/src/lib/prisma.ts`
- **Safety**: Child models (Contact, Stop, QuoteLineItem) inherit scope through parent relations; junction tables (MoveCrewAssignment) don't need explicit scoping
- **Create Operations**: Not modified by extension; repositories pass `tenantId` in `data` payload to avoid Prisma union constraint issues

**AWS CDK Stack:**

- **Purpose**: Infrastructure-as-code definition of a cloud service (Lambda, API Gateway, S3, etc.)
- **Pattern**: Extends `cdk.Stack`, receives dependencies as constructor props, instantiates AWS Constructs
- **Cross-Stack Communication**: Frontend stack creates S3 + CloudFront; Cognito stack receives distribution domain name via `tenantDistributionDomain` prop; CDK generates Fn::ImportValue
- **Examples**:
  - `FrontendStack`: S3 bucket + CloudFront distribution for tenant web app
  - `CognitoStack`: Cognito User Pool, app clients, custom domain
  - `ApiStack`: Lambda function (Hono app), HTTP API v2, secret injection from Secrets Manager

## Entry Points

**API (`packages/api/src/lambda.ts`):**

- **Location**: `packages/api/src/lambda.ts`
- **Triggers**: AWS Lambda events (HTTP requests via API Gateway v2)
- **Responsibilities**: Validates env vars, wraps Hono app with `handle()`, returns Lambda handler function
- **Environment**: `DATABASE_URL` injected by CDK from Secrets Manager at deploy time

**API (Node.js Server) (`packages/api/src/server.ts`):**

- **Location**: `packages/api/src/server.ts`
- **Triggers**: Direct Node.js process execution (on-premises deployment or local dev)
- **Responsibilities**: Starts HTTP server on `PORT` and `HOST`, handles graceful shutdown, closes MSSQL pools
- **Environment**: `SKIP_AUTH=true` bypasses Cognito for local/internal use; `DEFAULT_TENANT_ID` for testing

**Web SPA (`packages/web/src/main.tsx`):**

- **Location**: `packages/web/src/main.tsx`
- **Triggers**: Browser loads `index.html` from S3/CloudFront
- **Responsibilities**: Loads config from `/config.json`, renders React tree with TanStack Router and Query providers, catches config errors

**Admin Portal (`apps/admin/src/main.tsx`):**

- **Location**: `apps/admin/src/main.tsx` (same pattern as web)
- **Triggers**: Browser loads `index.html` from separate S3/CloudFront distribution
- **Responsibilities**: Same as web but routes to admin-only pages; queries `/api/admin/*` endpoints

**Infrastructure (`packages/infra/bin/app.ts`):**

- **Location**: `packages/infra/bin/app.ts`
- **Triggers**: `npm run deploy` or `cdk deploy --all` from root
- **Responsibilities**: Instantiates all 7 stacks in dependency order, resolves cross-stack tokens, synthesizes CloudFormation templates

**E2E Tests (`apps/e2e/playwright.config.ts`):**

- **Location**: `apps/e2e/`
- **Triggers**: `npm run e2e` from project root (via Turbo) or `playwright test` from `apps/e2e/`
- **Responsibilities**: Global setup starts Docker Postgres, tests run against running API and frontend servers

## Error Handling

**Strategy:** Distinguish domain errors (business rule violations) from unexpected failures; log full details server-side with correlation ID; return sanitized JSON to client.

**Patterns:**

- **Domain Errors** (`DomainError` from `@pegasus/domain`): Thrown by repository functions when business rules are violated (e.g., "customer must have a primary contact"). Handler catches via global `app.onError`, logs at WARN level, returns 422 with `{ error: message, code: err.code, correlationId }`
- **Validation Errors**: Zod `safeParse` fails in Hono validator; returns 400 with `{ error: validation message, code: 'VALIDATION_ERROR' }`
- **Unexpected Errors**: Any other exception (DB connection, parsing, third-party API failure) caught by global error handler, logged at ERROR level with full stack, returns 500 with `{ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR', correlationId }`
- **Client-Safe Logging**: Stack traces, internal state, sensitive data (passwords, API keys) logged server-side only; client receives only `correlationId` to reference when reporting issues to support
- **Correlation Tracing**: Every error response and every server log line includes `correlationId` for end-to-end request tracking

## Cross-Cutting Concerns

**Logging:**

- **Framework**: `@aws-lambda-powertools/logger` v2 singleton at `packages/api/src/lib/logger.ts`
- **Approach**: Structured logging with `logger.info()`, `logger.warn()`, `logger.error()` calls. Correlation middleware appends `{ correlationId, method, path }` keys; cleared after each Lambda invocation to prevent key bleed across warm starts
- **Storage**: CloudWatch Logs (AWS Lambda) or stdout/stderr (on-premises)

**Validation:**

- **Input Validation**: Hono `validator('json')` middleware + Zod `safeParse` for all POST/PUT/PATCH bodies; handlers receive validated data or early return with 400
- **Domain Validation**: Business rule checks in domain functions (e.g., `hasPrimaryContact(customer)`) and called from repositories before persisting; throw `DomainError` on violation

**Authentication:**

- **Tenant Routes** (`/api/v1/*`): Cognito JWT verification in tenant middleware; extracts `custom:tenantId` and `custom:role` claims, resolves Tenant record, ensures status is ACTIVE (not SUSPENDED/OFFBOARDED)
- **Admin Routes** (`/api/admin/*`): Separate Cognito JWT verification requiring PLATFORM_ADMIN group; runs in `adminRouter.ts` before handler execution
- **API Client (M2M)** (`/api/v1/api-clients`): SHA-256 hashed API keys; middleware uses `crypto.timingSafeEqual` to prevent timing attacks
- **Public Routes** (`/health`, `/api/auth`, `/api/sso`): No auth required; available before user session exists

**Multi-Tenancy:**

- **Tenant Resolution**: Extract `custom:tenantId` from JWT, look up Tenant record, verify status
- **Query Scoping**: `createTenantDb()` Prisma extension injects `tenantId` WHERE clause; queries run only over tenant's data
- **Lifecycle**: Tenant status (ACTIVE, SUSPENDED, OFFBOARDED) controls access; suspended tenants return 403, offboarded return 404

---

_Architecture analysis: 2026-03-27_
