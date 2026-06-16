// ---------------------------------------------------------------------------
// Rejected-trip (archived trip) handlers.
//
// When a dispatcher removes/changes the driver on an offered/pending/accepted
// trip, the tenant web app can capture a durable, read-only "rejected trip"
// record so each rejecting driver still sees the offer (with a reason) in their
// trip list. Live trips + activities live in the tenant's on-prem MSSQL
// (LongDistanceDispatchActivity carries enabled AFTER triggers); we deliberately
// snapshot into Postgres rather than re-writing MSSQL so those triggers never
// re-fire. See plans + schema.prisma (ArchivedTrip / ArchivedTripDriver).
//
// Routes (mounted in app.ts ahead of the /onprem wildcard proxy):
//   POST   /onprem/longhaul/rejected-trips        — snapshot a live trip
//   GET    /onprem/longhaul/rejected-trips        — list (filter by driverId)
//   GET    /onprem/longhaul/rejected-trips/:id    — single snapshot (view-only)
//
// The snapshot is the exact `{ ...trip, activities, notes, shipments }` shape
// the trip-detail handler returns (via the shared lib/longhaul-trip-fetch), so
// the read-only trip view renders it with no MSSQL call. List cards are built
// from the snapshot header (collections stripped) so they reshape + render
// through the existing TripCard unchanged.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { db } from '../../db'
import { logger } from '../../lib/logger'
import { fetchTripDetail } from '../../lib/longhaul-trip-fetch'

type Row = Record<string, unknown>

const CreateRejectedTripBody = z.object({
  tripId: z.number().int().positive(),
  rejections: z
    .array(
      z.object({
        driverId: z.number().int(),
        driverName: z.string().optional(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .min(1),
})

// --- small coercions: the executor returns dates/numbers as JSON values ------
function toDate(v: unknown): Date | null {
  if (v == null) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}
function toInt(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
function toDecimal(v: unknown): string | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : null
}
function toStr(v: unknown): string | null {
  return v == null ? null : String(v)
}

/** Strip the heavy embedded collections from a snapshot for a list card. */
function toCardHeader(snapshot: unknown): Row {
  if (!snapshot || typeof snapshot !== 'object') return {}
  const { activities, notes, shipments, ...header } = snapshot as Row
  void activities
  void notes
  void shipments
  return header
}

// --- POST /onprem/longhaul/rejected-trips ----------------------------------

export const createRejectedTripHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')

  const parsed = CreateRejectedTripBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const { tripId, rejections } = parsed.data

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
        correlationId,
      },
      422,
    )
  }

  let trip
  try {
    trip = await fetchTripDetail(tenant.mssqlConnectionString, tripId)
  } catch (err) {
    logger.error('rejected-trip snapshot — trip fetch failed', { error: String(err), tripId })
    return c.json({ error: 'Failed to read trip', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
  if (!trip) {
    return c.json({ error: 'Trip not found', code: 'NOT_FOUND', correlationId }, 404)
  }

  const createdById = c.get('userId') ?? null

  try {
    const archived = await db.archivedTrip.create({
      data: {
        tenantId,
        kind: 'rejected',
        originalTripId: tripId,
        tripTitle: toStr(trip['trip_title']),
        originalDriverId: toInt(trip['driver_id']),
        originalDriverName: toStr(trip['driver_name']),
        plannedFirstDay: toDate(trip['planned_first_day']),
        plannedLastDay: toDate(trip['planned_last_day']),
        originStateCode: toStr(trip['origin_geo_code']),
        destStateCode: toStr(trip['destination_geo_code']),
        totalEstimatedLbs: toInt(trip['total_estimated_lbs']),
        totalEstimatedLinehaulUsd: toDecimal(trip['total_estimated_linehaul_usd']),
        // Prisma Json column — stringify-safe (Dates become ISO strings).
        snapshot: trip as object,
        createdById,
        drivers: {
          create: rejections.map((r) => ({
            driverId: r.driverId,
            driverName: r.driverName ?? null,
            reason: r.reason ?? null,
          })),
        },
      },
      select: { id: true },
    })
    return c.json({ data: { id: archived.id } }, 201)
  } catch (err) {
    logger.error('rejected-trip snapshot — persist failed', {
      error: String(err),
      tripId,
      tenantId,
    })
    return c.json(
      { error: 'Failed to save rejected trip', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}

// --- GET /onprem/longhaul/rejected-trips -----------------------------------

export const listRejectedTripsHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')

  const driverIdRaw = c.req.query('driverId')
  const originalTripIdRaw = c.req.query('originalTripId')
  const driverId = driverIdRaw != null && driverIdRaw !== '' ? Number(driverIdRaw) : undefined
  const originalTripId =
    originalTripIdRaw != null && originalTripIdRaw !== '' ? Number(originalTripIdRaw) : undefined
  if (driverId !== undefined && !Number.isFinite(driverId)) {
    return c.json({ error: 'Invalid driverId', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  if (originalTripId !== undefined && !Number.isFinite(originalTripId)) {
    return c.json({ error: 'Invalid originalTripId', code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  try {
    const rows = await db.archivedTrip.findMany({
      where: {
        tenantId,
        kind: 'rejected',
        ...(originalTripId !== undefined ? { originalTripId } : {}),
        ...(driverId !== undefined ? { drivers: { some: { driverId } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { drivers: true },
    })

    const data = rows.map((row) => ({
      // Snapshot header (flat, joined columns) so the card reshapes/renders
      // through the existing TripCard. Collections stripped to keep it light.
      ...toCardHeader(row.snapshot),
      archivedTripId: row.id,
      kind: row.kind,
      isRejected: true,
      createdAt: row.createdAt,
      rejection_drivers: row.drivers.map((d) => ({
        driverId: d.driverId,
        driverName: d.driverName,
        reason: d.reason,
      })),
    }))
    return c.json({ data, meta: { count: data.length } })
  } catch (err) {
    logger.error('rejected-trip list failed', { error: String(err), tenantId })
    return c.json(
      { error: 'Failed to list rejected trips', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}

// --- GET /onprem/longhaul/rejected-trips/:id --------------------------------

export const getRejectedTripHandler: Handler<AppEnv> = async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')
  const id = c.req.param('id')
  if (!id) {
    return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  try {
    const row = await db.archivedTrip.findFirst({
      where: { id, tenantId },
      include: { drivers: true },
    })
    if (!row) {
      return c.json({ error: 'Rejected trip not found', code: 'NOT_FOUND', correlationId }, 404)
    }
    const snapshot = (row.snapshot ?? {}) as Row
    return c.json({
      data: {
        ...snapshot,
        archivedTripId: row.id,
        kind: row.kind,
        isRejected: true,
        createdAt: row.createdAt,
        rejection: {
          drivers: row.drivers.map((d) => ({
            driverId: d.driverId,
            driverName: d.driverName,
            reason: d.reason,
          })),
        },
      },
    })
  } catch (err) {
    logger.error('rejected-trip detail failed', { error: String(err), tenantId, id })
    return c.json(
      { error: 'Failed to fetch rejected trip', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}
