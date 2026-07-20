// ---------------------------------------------------------------------------
// Admin tariff handler — /api/admin/tariffs
//
// Platform-admin management of GLOBAL tariff reference data (400NG). Tariff
// versions have no tenantId, so importing/activating them belongs on the
// platform-admin surface (PLATFORM_ADMIN Cognito gate, unscoped basePrisma),
// NOT the tenant-scoped /api/v1/rating path — mutating one shared table from a
// per-tenant admin grant was a cross-tenant blast radius (see the rating engine
// plan). XLSX→JSON parsing happens client-side in admin-web; this endpoint
// receives the canonical JSON and re-validates it with the same
// Tariff400ngImportSchema the tenant path used, so the server stays the
// authority regardless of who produced the document.
//
// Reachable only behind adminAuthMiddleware (applied in admin/index.ts). Uses
// basePrisma directly — admin routes never run inside the tenant extension.
// DomainError thrown by the repository (e.g. NOT_FOUND / INVALID_STATE on
// activate) surfaces as 422 via app.ts's central onError handler.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { TariffFuelSurcharge } from '@prisma/client'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { Tariff400ngImportSchema } from '../../rating/import-schema'
import { mapVersionSummary } from '../../rating/version-summary'
import {
  listTariffVersions,
  getTariffVersionById,
  importTariff400ng,
  activateTariffVersion,
  upsertTariffFuelSurcharge,
  listTariffFuelSurcharges,
} from '../../repositories'

export const adminTariffsRouter = new Hono<AdminEnv>()

// GET /api/admin/tariffs[?tariffCode=400NG] — list versions, newest first.
adminTariffsRouter.get('/', async (c) => {
  const tariffCode = c.req.query('tariffCode')
  const versions = await listTariffVersions(db, tariffCode)
  return c.json({ data: versions.map(mapVersionSummary) })
})

// ── Fuel surcharge (Item 16) — registered before /:id so "fsc" is not parsed
//    as a version id. The percentage is derived server-side from the diesel
//    price; the caller only ever supplies a price. ────────────────────────────

function mapFsc(f: TariffFuelSurcharge) {
  return {
    id: f.id,
    tariffCode: f.tariffCode,
    effectiveFrom: f.effectiveFrom,
    percentBps: f.percentBps,
    dieselPriceCentsPerGallon: f.dieselPriceCentsPerGallon,
    source: f.source,
  }
}

const FscBody = z.object({
  tariffCode: z.literal('400NG').optional().default('400NG'),
  dieselPriceCentsPerGallon: z.number().int().positive(),
  effectiveFrom: z.string().datetime(),
})

// GET /api/admin/tariffs/fsc[?tariffCode=400NG] — fuel-surcharge rows, newest first.
adminTariffsRouter.get('/fsc', async (c) => {
  const tariffCode = c.req.query('tariffCode') ?? '400NG'
  const rows = await listTariffFuelSurcharges(db, tariffCode)
  return c.json({ data: rows.map(mapFsc) })
})

// POST /api/admin/tariffs/fsc — set the fuel surcharge for an effective date from
// a diesel price. Upserts by (tariffCode, effectiveFrom); percentBps is computed.
adminTariffsRouter.post(
  '/fsc',
  validator('json', (value, c) => {
    const r = FscBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const body = c.req.valid('json')
    const row = await upsertTariffFuelSurcharge(db, {
      tariffCode: body.tariffCode,
      effectiveFrom: new Date(body.effectiveFrom),
      dieselPriceCentsPerGallon: body.dieselPriceCentsPerGallon,
      source: 'MANUAL',
    })
    return c.json({ data: mapFsc(row) })
  },
)

// GET /api/admin/tariffs/:id — a single version with its row counts.
adminTariffsRouter.get('/:id', async (c) => {
  const id = c.req.param('id') ?? ''
  const version = await getTariffVersionById(db, id)
  if (!version) return c.json({ error: 'Tariff version not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data: mapVersionSummary(version) })
})

// POST /api/admin/tariffs/import — import a canonical 400NG document as a new
// STAGED version. Idempotent by (tariffCode, checksum): re-posting identical
// data returns the existing version with 200 instead of 201.
adminTariffsRouter.post(
  '/import',
  validator('json', (value, c) => {
    const r = Tariff400ngImportSchema.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const body = c.req.valid('json')
    const { version, created } = await importTariff400ng(db, body, c.get('adminEmail'))
    return c.json(
      { data: { id: version.id, status: version.status, created } },
      created ? 201 : 200,
    )
  },
)

// POST /api/admin/tariffs/:id/activate — activate a STAGED version, superseding
// any overlapping ACTIVE version of the same tariffCode. Idempotent for an
// already-ACTIVE version.
adminTariffsRouter.post('/:id/activate', async (c) => {
  const id = c.req.param('id') ?? ''
  const version = await activateTariffVersion(db, id)
  return c.json({ data: { id: version.id, status: version.status } })
})
