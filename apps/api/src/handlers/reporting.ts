// ---------------------------------------------------------------------------
// Reporting endpoints -- the dataset catalog and the batched query runner.
//
//   GET  /api/v1/reporting/datasets  -- introspection: what can I ask for?
//   POST /api/v1/reporting/query     -- run up to MAX_BATCH datasets at once.
//
// Why POST for a read: a dashboard asks for N datasets, each with a nested
// params object. URL-encoding that is hostile, and batching is not optional --
// it is the mitigation for the Lambda reserved-concurrency cap of 10. One
// dashboard render must cost ONE request, and (critically) at most ONE tunnel
// round trip regardless of how many legacy widgets it carries.
//
// Authorization is two-layer:
//   1. requirePermission(ReadReportingDataset) gates the routes themselves.
//   2. Each dataset independently requires its own pre-existing action, checked
//      here against a single listAllowedPermissions() call.
// Reporting can therefore never widen what a role could already read.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { requirePermission } from '../middleware/rbac'
import { listAllowedPermissions } from '../lib/authz'
import { isReportingEnabled } from '../lib/reporting-feature'
import { executeSql } from '../lib/mssql-executor-client'
import { logger } from '../lib/logger'
import { canRunDataset, catalogFor, datasetById } from '../reporting/registry'
import {
  isLegacyDataset,
  type DatasetDef,
  type DatasetRow,
  type LegacyDatasetDef,
  type PostgresDatasetDef,
} from '../reporting/types'

/**
 * Hard cap on datasets per request. This is the backstop against widget-count
 * fan-out; a dashboard that genuinely needs more warrants a design
 * conversation, not a bigger number.
 */
export const MAX_BATCH = 12

const QueryBody = z.object({
  requests: z
    .array(
      z.object({
        datasetId: z.string().min(1),
        params: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
})

/** One result slot. Either rows, or a per-dataset error -- never both. */
interface ResultSlot {
  datasetId: string
  rows?: DatasetRow[]
  error?: { message: string; code: string }
}

/** A request whose dataset resolved and whose params passed that dataset's schema. */
interface ValidatedRequest {
  datasetId: string
  def: DatasetDef
  params: unknown
}

export const reportingHandler = new Hono<AppEnv>()

// Feature gate: the entire surface 404s when the master switch is off.
reportingHandler.use('*', async (c, next) => {
  if (!isReportingEnabled()) {
    return c.json({ error: 'Reporting is not enabled', code: 'NOT_FOUND' }, 404)
  }
  await next()
})

reportingHandler.use('*', requirePermission(Actions.ReadReportingDataset))

/** Permission strings the caller holds, as a set, in one batched AVP call. */
async function permissionSet(c: Context<AppEnv>): Promise<Set<string>> {
  const principal = c.get('principal')
  if (!principal) return new Set<string>()
  const perms = await listAllowedPermissions(principal, c.get('idToken'), c.get('policyStoreId'))
  return new Set(perms)
}

// ---------------------------------------------------------------------------
// GET /datasets -- the catalog, filtered to what the caller may actually run.
//
// An empty catalog is a correct 200, not a 403: the caller holds the reporting
// permission, they simply have no dataset-level grants yet.
// ---------------------------------------------------------------------------
reportingHandler.get('/datasets', async (c) => {
  const permissions = await permissionSet(c)
  return c.json({ data: { datasets: catalogFor(permissions) } })
})

// ---------------------------------------------------------------------------
// POST /query
// ---------------------------------------------------------------------------
reportingHandler.post('/query', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_BODY' }, 400)
  }

  const parsed = QueryBody.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: `Invalid request body (at most ${MAX_BATCH} datasets per request)`,
        code: 'INVALID_BODY',
        details: parsed.error.issues,
      },
      400,
    )
  }

  const { requests } = parsed.data

  // Resolve ids first -- an unknown id is a client bug, not a per-slot failure.
  const resolved = requests.map((r) => ({ req: r, def: datasetById(r.datasetId) }))
  const unknown = resolved.filter((r) => !r.def).map((r) => r.req.datasetId)
  if (unknown.length > 0) {
    return c.json(
      { error: `Unknown dataset(s): ${unknown.join(', ')}`, code: 'UNKNOWN_DATASET' },
      400,
    )
  }

  // Fail closed on the whole request if ANY dataset is not permitted -- a
  // partial response would leak which datasets exist and which are withheld.
  const permissions = await permissionSet(c)
  const forbidden = resolved.filter((r) => !canRunDataset(r.def!, permissions))
  if (forbidden.length > 0) {
    return c.json(
      { error: 'Forbidden: insufficient permissions for this action', code: 'FORBIDDEN' },
      403,
    )
  }

  // Validate params per dataset against its own schema.
  const validated: ValidatedRequest[] = []
  for (const { req, def } of resolved) {
    const result = def!.params.safeParse(req.params ?? undefined)
    if (!result.success) {
      return c.json(
        {
          error: `Invalid params for dataset "${req.datasetId}"`,
          code: 'INVALID_PARAMS',
          details: result.error.issues,
        },
        400,
      )
    }
    validated.push({ datasetId: req.datasetId, def: def!, params: result.data })
  }

  // Slots are pre-allocated so the response order always mirrors the request
  // order, regardless of which source resolves first.
  const slots: ResultSlot[] = validated.map((v) => ({ datasetId: v.datasetId }))

  const legacyIndexes = validated
    .map((v, i) => (isLegacyDataset(v.def) ? i : -1))
    .filter((i) => i >= 0)
  const postgresIndexes = validated
    .map((v, i) => (isLegacyDataset(v.def) ? -1 : i))
    .filter((i) => i >= 0)

  await Promise.all([
    runPostgres(c, validated, postgresIndexes, slots),
    runLegacy(c, validated, legacyIndexes, slots),
  ])

  return c.json({ data: { results: slots } })
})

// ---------------------------------------------------------------------------
// Postgres datasets -- run through the tenant-scoped client. A failure degrades
// its own slot; one bad dataset must not blank a dashboard.
// ---------------------------------------------------------------------------
async function runPostgres(
  c: Context<AppEnv>,
  validated: ValidatedRequest[],
  indexes: number[],
  slots: ResultSlot[],
): Promise<void> {
  if (indexes.length === 0) return
  const ctx = { db: c.get('db'), tenantId: c.get('tenantId') }

  await Promise.all(
    indexes.map(async (i) => {
      const v = validated[i]!
      try {
        // `def` is narrowed to the Postgres variant by construction of
        // `indexes`; params were already validated through `def.params`.
        const def = v.def as PostgresDatasetDef<unknown>
        slots[i]!.rows = await def.run(ctx, v.params)
      } catch (err) {
        logger.error('reporting dataset failed', {
          datasetId: v.datasetId,
          source: 'postgres',
          error: String(err),
        })
        slots[i]!.error = { message: 'Dataset query failed', code: 'DATASET_ERROR' }
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Legacy datasets -- ONE multi-statement round trip for the whole request,
// mirroring handlers/dashboard-pegii.ts. recordsets come back positionally, so
// fragment order is the contract between the batch and the mappers.
//
// A tenant with no legacy DB configured is a normal state, not an error: every
// legacy slot degrades with MSSQL_NOT_CONFIGURED while the Postgres widgets on
// the same dashboard render fine. Phase-2 forked dashboards depend on this.
// ---------------------------------------------------------------------------
async function runLegacy(
  c: Context<AppEnv>,
  validated: ValidatedRequest[],
  indexes: number[],
  slots: ResultSlot[],
): Promise<void> {
  if (indexes.length === 0) return

  const tenantId = c.get('tenantId')
  // Read the connection string through the request-scoped client, not the base
  // one (db-access-guard enforces this). `Tenant` is not in
  // TENANT_SCOPED_MODELS, so the extension passes the query through untouched
  // and the explicit `where: { id: tenantId }` is what scopes it — the same
  // lookup handlers/me.ts does for its longhaul capability flag.
  const tenant = await c.get('db').tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })

  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    for (const i of indexes) {
      slots[i]!.error = {
        message: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
      }
    }
    return
  }

  const defs = indexes.map((i) => validated[i]!.def as LegacyDatasetDef<unknown>)
  const batch = defs.map((def, position) => def.sql(validated[indexes[position]!]!.params))

  try {
    const { recordsets } = await executeSql(tenant.mssqlConnectionString, batch.join(';'))
    indexes.forEach((slotIndex, position) => {
      const rows = (recordsets[position] ?? []) as Record<string, unknown>[]
      slots[slotIndex]!.rows = defs[position]!.map(rows)
    })
  } catch (err) {
    logger.error('reporting legacy batch failed', { tenantId, error: String(err) })
    for (const i of indexes) {
      slots[i]!.error = { message: 'Legacy query failed', code: 'DATASET_ERROR' }
    }
  }
}
