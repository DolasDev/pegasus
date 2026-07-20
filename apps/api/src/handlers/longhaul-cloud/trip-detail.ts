// ---------------------------------------------------------------------------
// Cloud-direct longhaul `GET /trips/:id` handler.
//
// Phase 3 of the longhaul strangler-fig migration: serves
// GET /api/v1/onprem/longhaul/trips/:id from the cloud Hono Lambda instead of
// proxying it to the tenant's on-prem server. Mounted in app.ts ahead of the
// /onprem wildcard proxy so Hono route precedence routes /trips/:id here while
// every un-migrated longhaul endpoint still falls through to the proxy.
//
// The batched, round-trip-minimizing MSSQL read lives in lib/longhaul-trip-fetch
// (fetchTripDetail) so it can be reused by the rejected-trip snapshot creator.
// This handler is now a thin wrapper: connection-string guard + id validation +
// fetchTripDetail + the `{ data: <trip> }` envelope.
//
// The response shape matches the on-prem handler exactly: `{ data: <trip> }`
// with embedded `activities`, `notes`, and `shipments` (each shipment carries
// `activities` filtered to this trip, `packing_coverage`, `extra_locations`).
// Not-found returns 404 `{ error: 'Trip not found', code: 'NOT_FOUND', ... }`.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { logger } from '../../lib/logger'
import { fetchTripDetail } from '../../lib/longhaul-trip-fetch'

export const longhaulTripDetailHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId: c.get('correlationId'),
      },
      422,
    )
  }
  const connectionString = tenant.mssqlConnectionString

  const id = parseInt(c.req.param('id') ?? '', 10)
  if (isNaN(id)) {
    return c.json(
      { error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
      400,
    )
  }

  try {
    const trip = await fetchTripDetail(connectionString, id)
    if (!trip) {
      return c.json(
        { error: 'Trip not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
        404,
      )
    }
    return c.json({ data: trip })
  } catch (err) {
    logger.error('longhaul cloud trip detail failed', { error: String(err), tripId: id })
    return c.json(
      {
        error: 'Failed to fetch trip',
        code: 'INTERNAL_ERROR',
        correlationId: c.get('correlationId'),
      },
      500,
    )
  }
}
