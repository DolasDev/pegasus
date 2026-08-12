// ---------------------------------------------------------------------------
// Reporting dataset contract.
//
// A dataset is a server-defined, tenant-scoped, parameterized query with a
// declared column list. Clients never send SQL or field paths -- they name a
// dataset id and pass validated params. That indirection is what lets the
// implementation of a dataset move (legacy MSSQL view -> Prisma/Postgres table)
// without any dashboard noticing, which matters while the strangler-fig
// migration off the legacy DB is still in flight.
//
// Two invariants carry the design:
//
//   1. `id` is a PERMANENT public identifier. Phase-2 saved dashboard
//      definitions reference it, so a rename is a data migration, not a
//      refactor. `version` bumps on any breaking column change so a stored
//      definition can detect drift against what it was authored on.
//
//   2. `requires` names an EXISTING Cedar action. Reporting can therefore never
//      widen what a role can already read: the caller must hold both
//      `ReadReportingDataset` (the surface) and the dataset's own action (the
//      data). See authz/policies/20-viewer.cedar.
// ---------------------------------------------------------------------------

import type { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import type { ActionDef } from '../lib/authz.types'

/** Rendering hint for a column. Not a storage type -- the FE formats on it. */
export type DatasetColumnType = 'string' | 'number' | 'currency' | 'date' | 'boolean'

export interface DatasetColumn {
  readonly key: string
  readonly label: string
  readonly type: DatasetColumnType
}

/** A single output row. Values are already normalized by the dataset. */
export type DatasetRow = Record<string, string | number | boolean | null>

/**
 * Where a dataset's data physically lives.
 *
 * `postgres`      -- the cloud Neon database, via the tenant-scoped Prisma client.
 * `legacy-mssql`  -- the tenant's on-prem PegII database, reachable ONLY through
 *                    the in-VPC mssql-executor Lambda over WireGuard. These do
 *                    not self-execute; see `LegacyDatasetDef.sql` below.
 */
export type DatasetSource = 'postgres' | 'legacy-mssql'

interface DatasetBase<P> {
  /** Stable, kebab-case, NEVER renamed once shipped. */
  readonly id: string
  /** Bumped on a breaking column change. Recorded by dashboard definitions. */
  readonly version: number
  readonly title: string
  readonly description: string
  readonly requires: ActionDef
  readonly params: z.ZodType<P>
  readonly columns: readonly DatasetColumn[]
}

export interface PostgresDatasetContext {
  /**
   * Tenant-scoped Prisma client from `c.get('db')`. The `createTenantDb`
   * extension injects `WHERE tenantId` for findMany/count/aggregate/groupBy on
   * every model in TENANT_SCOPED_MODELS (Move, Quote and Invoice all qualify),
   * so datasets must NOT pass tenantId themselves and must NOT reach for the
   * root client.
   *
   * Typed as PrismaClient to match `AppEnv['db']` -- the extension is applied
   * at runtime and is intentionally invisible to the type system repo-wide.
   */
  readonly db: PrismaClient
  readonly tenantId: string
}

export interface PostgresDatasetDef<P = unknown> extends DatasetBase<P> {
  readonly source: 'postgres'
  run(ctx: PostgresDatasetContext, params: P): Promise<DatasetRow[]>
}

/**
 * A legacy dataset does NOT issue its own `executeSql` call. It contributes a
 * SQL fragment that the handler concatenates with every other legacy fragment
 * in the same request into ONE multi-statement round trip, then hands back the
 * matching recordset for mapping. This is the same batching `dashboard-pegii.ts`
 * already does with v_dashboard1/2/3, and it is what keeps a dashboard's widget
 * count from multiplying tunnel calls into the Lambda concurrency cap of 10.
 *
 * SECURITY: fragments are concatenated, so caller-supplied values must never be
 * interpolated into `sql`. Until the executor's bound-parameter story is
 * verified end to end, legacy datasets take no params (or only numeric/enum
 * params validated against a closed set) -- enforced by a registry test.
 */
export interface LegacyDatasetDef<P = unknown> extends DatasetBase<P> {
  readonly source: 'legacy-mssql'
  /** One statement, no trailing semicolon -- the handler joins with ';'. */
  sql(params: P): string
  /** Maps one recordset from the batch into output rows. */
  map(rows: readonly Record<string, unknown>[]): DatasetRow[]
}

export type DatasetDef<P = unknown> = PostgresDatasetDef<P> | LegacyDatasetDef<P>

/** Narrowing helper -- `source` is the discriminant. */
export function isLegacyDataset(d: DatasetDef): d is LegacyDatasetDef {
  return d.source === 'legacy-mssql'
}

/**
 * Public catalog shape returned by GET /reporting/datasets. Deliberately does
 * NOT leak `run`/`sql` -- the catalog is a contract, not an implementation.
 * `paramsSchema` is a JSON Schema rendering so a client (or a future SDK
 * consumer) can build a valid request without reading this repo.
 */
export interface DatasetCatalogEntry {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description: string
  readonly source: DatasetSource
  readonly permission: string
  readonly columns: readonly DatasetColumn[]
  readonly paramsSchema: unknown
}
