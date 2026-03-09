# Pegii Legacy API Bridge

**Branch:** dev (movemanager repo) / TBD (pegasus repo)
**Goal:** Expose the legacy SQL Server database (currently accessed by the VB.NET WinForms app via raw ADO.NET) as REST endpoints in the pegasus API, enabling the WinForms app to migrate to an HTTP backend.

---

## Context

The legacy MoveManager WinForms app uses `Pegasus.Raw.DataAccessLayer` (~130+ entity IO classes) to talk directly to SQL Server via ADO.NET. All entities follow the same generic CRUD pattern (`AllIds`, `Read(Id)`, `Read(Code)`, `ReadList(SearchCriteria)`, `Write(Entity)`) powered by `DBSupport_Id<T>` and `QueryConstructor`.

This plan adds a `/api/v1/pegii/*` route tree to `packages/api` in the pegasus monorepo that replicates the DAL's behavior as a REST API. A metadata-driven generic router factory avoids hand-coding 130+ handler files.

---

## Architecture

```
WinForms App (Pegasus.MoveManager)
    ↓ HTTP (replaces direct ADO.NET)
Pegasus API (packages/api)
    /api/v1/pegii/:domain/:entity/*
    ↓
    Generic CRUD Factory (factory.ts)
    ↓
    Generic Repository (generic.repository.ts)
    ↓
    mssql connection pool → SQL Server (existing legacy DB)
```

### Key Decisions

| Decision        | Choice                                            | Rationale                                                                                        |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SQL driver      | `mssql` (tedious) npm package, raw SQL            | Mirrors the legacy DAL's raw ADO.NET approach; avoids Prisma introspection of 130+ legacy tables |
| Handler pattern | Generic factory from EntityConfig metadata        | All entities follow identical CRUD pattern; only ~5 have custom methods                          |
| Auth            | Same tenant JWT middleware as existing API        | Reuses existing auth chain; pegii routes mount under `/api/v1/`                                  |
| Isolation       | `src/handlers/pegii/` + `src/repositories/pegii/` | Fully separate from existing Hono handlers/repos                                                 |
| Search criteria | TypeScript port of QueryConstructor + WHEREGiven  | Preserves backward compatibility with WinForms search strings                                    |

---

## Folder Structure

```
packages/api/src/
├── lib/
│   └── mssql.ts                          # Connection pool management
├── handlers/
│   └── pegii/
│       ├── index.ts                      # Main router, mounts all domains
│       ├── factory.ts                    # Generic CRUD Hono router factory
│       ├── types.ts                      # EntityConfig, SearchKeyword interfaces
│       ├── middleware.ts                 # mssql pool injection per tenant
│       └── domains/
│           ├── account.ts                # Account, AcctMemo (2)
│           ├── billing.ts               # Invoice, InvoiceMaster, InvoiceDetail, BillingCode, Service (5)
│           ├── budget.ts                 # Budget, BudgetMaster, BudgetDetail, BudgetQMM, Quote, QuoteMemo, MasterCurrency (7)
│           ├── crew.ts                   # Crew (1)
│           ├── driver.ts                 # Driver + 21 related entities (22)
│           ├── employee.ts              # Employee + 14 related entities (15)
│           ├── flash.ts                  # 6 flash reporting entities
│           ├── lead.ts                   # Lead, LeadSource, LeadDemo (3)
│           ├── local-dispatch.ts        # 5 local dispatch entities
│           ├── masters.ts               # 13 master table entities
│           ├── menu-specs.ts            # ReportMenuSpecification (1)
│           ├── person.ts                # Person, UserLogin (2)
│           ├── portal.ts               # PortalUser, PortalDocument, MovingDocument (3)
│           ├── premium-services.ts      # 11 premium service entities
│           ├── sale.ts                  # Sale + 9 related entities (10)
│           ├── shared.ts               # State, ZipCode, Branch, PostalAddress, MoveType, BDOCode, Setting (7)
│           ├── stored-procedures.ts     # 3 stored procedure entities
│           ├── survey.ts               # 6 survey entities + Task, MasterTask
│           ├── vehicle.ts              # Vehicle, VehicleMileage, VehicleRepair, VehicleViolation (4)
│           ├── warehouse.ts            # BoxOrder + commercial + household goods (10)
│           └── unsorted.ts             # ~17 legacy entities
├── repositories/
│   └── pegii/
│       ├── generic.repository.ts        # AllIds, Read, ReadList, Write via mssql
│       ├── query-builder.ts             # TypeScript port of QueryConstructor
│       ├── search-criteria.ts           # Generic WHEREGiven framework
│       └── column-utils.ts              # INFORMATION_SCHEMA caching + row mapping
```

---

## EntityConfig Metadata Format

```typescript
interface EntityConfig {
  slug: string // URL segment, e.g., "accounts"
  tableName: string // SQL table name
  idField: string // PK column, usually "id"
  codeField: string // Natural key column, e.g., "agent_id"
  idType: 'integer' | 'string'
  orderBy: string // Default ORDER BY
  listFields?: string // SELECT fields (defaults to "*")
  searchKeywords: SearchKeyword[]
  freeTextColumns?: string[]
  customRoutes?: (router: Hono) => void
}
```

Each domain file exports an array of `EntityConfig` objects. The factory generates a Hono sub-router for each.

---

## Route Mapping (VB.NET DAL → REST)

| VB.NET Method        | HTTP Route                                         | Query Params                      |
| -------------------- | -------------------------------------------------- | --------------------------------- |
| `AllIds(criteria)`   | `GET /api/v1/pegii/{domain}/{entity}/ids`          | `?q=criteria`                     |
| `Read(id)`           | `GET /api/v1/pegii/{domain}/{entity}/:id`          | —                                 |
| `Read(code)`         | `GET /api/v1/pegii/{domain}/{entity}/code/:code`   | —                                 |
| `ReadList(criteria)` | `GET /api/v1/pegii/{domain}/{entity}`              | `?q=criteria&limit=1000&offset=0` |
| `Write(entity)`      | `POST /api/v1/pegii/{domain}/{entity}` (create)    | body: JSON                        |
| `Write(entity)`      | `PUT /api/v1/pegii/{domain}/{entity}/:id` (update) | body: JSON                        |
| `ExecuteTable(sql)`  | `POST /api/v1/pegii/query`                         | body: `{ sql }` (admin only)      |

---

## Implementation Checklist

### Phase 1: Infrastructure

- [x] Add `mssql` + `@types/mssql` to `packages/api/package.json`
- [x] Add Prisma migration — nullable `mssqlConnectionString` column on `Tenant` (migration `20260308000000_add_tenant_mssql_connection`)
- [x] Create `src/lib/mssql.ts` — connection pool map with `getPool()` helper
- [x] Create `src/handlers/pegii/types.ts` — EntityConfig, SearchKeyword, ColumnDef interfaces
- [x] Create `src/repositories/pegii/column-utils.ts` — INFORMATION_SCHEMA cache + row mapping
- [x] Create `src/repositories/pegii/search-criteria.ts` — generic WHEREGiven parser
- [x] Create `src/repositories/pegii/query-builder.ts` — QueryConstructor port (SELECT TOP N with WHERE/ORDER BY)
- [x] Create `src/repositories/pegii/generic.repository.ts` — allIds, readById, readByCode, readList, write
- [x] Create `src/handlers/pegii/factory.ts` — generic CRUD Hono router factory
- [x] Create `src/handlers/pegii/middleware.ts` — mssql pool injection from tenant context
- [x] Write unit tests for query-builder (verify SQL output matches VB.NET for known inputs)
- [x] Write unit tests for search-criteria parser
- [x] Write unit tests for generic.repository (mock mssql)
- [x] Write unit tests for factory (mock repository, verify routes)

### Phase 2: First Domain (prove the pattern)

- [x] Create `src/handlers/pegii/domains/shared.ts` — Setting, Branch, State, ZipCode, MoveType, BDOCode, PostalAddress configs
- [x] Create `src/handlers/pegii/index.ts` — mount shared domain router
- [x] Modify `src/app.ts` — mount pegiiRouter under v1
- [x] Add `mssqlPool` to AppVariables in `src/types.ts`
- [~] Integration test with real SQL Server connection (out of scope — requires live SQL Server)

### Phase 3: Core Domains

- [x] `domains/account.ts` — Account (with UpdateSalesCounts custom route), AcctMemo
- [x] `domains/sale.ts` — Sale (complex WHEREGiven with role-based fields), Sale_Document, Sale_Invoice, Sale_InternationalInformation, Sale_StorageInformation, Sale_AtlasRegistrationInformation, SaleServiceAuthorization, QoS audit (2), Memo
- [x] `domains/billing.ts` — Invoice, InvoiceMaster, InvoiceDetail, BillingCode, Service
- [x] `domains/budget.ts` — Budget, BudgetMaster, BudgetDetail, BudgetQMM, Quote, QuoteMemo, MasterCurrency
- [x] `domains/employee.ts` — Employee, timesheets, benefits, salesman commission (15 entities)
- [x] `domains/driver.ts` — Driver, settlements, debits, retainers, balances, logs, comdata (22 entities)

### Phase 4: Remaining Domains

- [x] `domains/crew.ts`
- [x] `domains/lead.ts`
- [x] `domains/flash.ts`
- [x] `domains/local-dispatch.ts`
- [x] `domains/masters.ts`
- [x] `domains/menu-specs.ts`
- [x] `domains/person.ts`
- [x] `domains/portal.ts`
- [x] `domains/premium-services.ts`
- [x] `domains/survey.ts`
- [x] `domains/vehicle.ts`
- [x] `domains/warehouse.ts`
- [x] `domains/stored-procedures.ts`
- [x] `domains/unsorted.ts`

### Phase 5: Hardening

- [x] SQL injection audit — ensure all user values are parameterized
- [x] Error handling alignment with existing API patterns (correlationId, error codes)
- [x] Structured logging via Lambda Powertools
- [x] Performance validation with large tables (SELECT TOP 1000)
- [x] Full test suite passes (`npm test` from repo root)

---

## Files Modified (Existing)

| File                                | Change                                        |
| ----------------------------------- | --------------------------------------------- |
| `packages/api/package.json`         | Add `mssql`, `@types/mssql` dependencies      |
| `packages/api/src/app.ts`           | Import and mount `pegiiRouter` under v1       |
| `packages/api/src/types.ts`         | Add `mssqlPool` to `AppVariables`             |
| `packages/api/prisma/schema.prisma` | Add `mssqlConnectionString` to `Tenant` model |

## Files Created (New)

~30 new files total (see folder structure above).

---

## Risks & Side Effects

| Risk                                    | Mitigation                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| SQL injection in search criteria parser | Use parameterized queries via mssql's `request.input()`; escape free-text values                        |
| Connection pool exhaustion              | Limit pool size per tenant; reuse pools across Lambda warm invocations                                  |
| Legacy table schema inconsistencies     | Column metadata from INFORMATION_SCHEMA cached at startup; graceful errors for missing tables           |
| Large payloads (100+ column entities)   | Respect existing SELECT TOP 1000 limit; optional field filtering via query params                       |
| Cross-repo coordination                 | Pegii endpoints are additive (no changes to existing routes or repos); WinForms client work is separate |
| Tenant-to-SQL-Server mapping            | Resolved: `mssqlConnectionString` column on `Tenant` table (Prisma migration required)                  |

---

## Resolved Decisions

1. **Tenant-to-connection-string mapping**: Add an `mssqlConnectionString` column to the PostgreSQL `Tenant` table. This requires a Prisma migration (`0004_tenant_mssql_connection`). The pegii middleware reads this column via the existing Prisma client, then opens/reuses an mssql pool for that connection string. This supports multi-tenant SQL Server in the future.

2. **Prisma migration**: Phase 1 includes adding the migration for the new `Tenant.mssqlConnectionString` nullable String column.
