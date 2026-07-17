// ---------------------------------------------------------------------------
// Rating handler — rate a shipment against a published tariff (400NG to
// start), plus read/import/activate for tariff versions.
//
// Standalone surface: does not touch quotes.ts or any existing quote-creation
// path. A future PR may let a Quote reference a rating result, but nothing
// here assumes that.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { rate400ng, createZip3CentroidEstimator, DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { mapVersionSummary } from '../rating/version-summary'
import {
  findActiveTariffVersion,
  resolveTariff400ngData,
  listTariffVersions,
  getTariffVersionById,
} from '../repositories'

const mileageEstimator = createZip3CentroidEstimator()

const RateOptions = z.object({
  fullPack: z.boolean().optional().default(false),
  fullUnpack: z.boolean().optional().default(false),
})

const RateBody = z.object({
  tariffCode: z.literal('400NG').optional().default('400NG'),
  weightLbs: z.number().positive(),
  originZip: z.string().regex(/^\d{5}$/, 'originZip must be a 5-digit ZIP code'),
  destZip: z.string().regex(/^\d{5}$/, 'destZip must be a 5-digit ZIP code'),
  pickupDate: z.string().datetime(),
  options: RateOptions.optional().default({ fullPack: false, fullUnpack: false }),
  /**
   * TSP-specific negotiated linehaul discount (0-100). Omit for the
   * published baseline/undiscounted amount — see RatingInput in
   * @pegasus/domain for why this can't be looked up from the tariff itself.
   */
  linehaulDiscountPercent: z.number().min(0).max(100).optional(),
})

export const ratingHandler = new Hono<AppEnv>()

ratingHandler.post(
  '/rate',
  requirePermission(Actions.RateShipment),
  validator('json', (value, c) => {
    const r = RateBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const body = c.req.valid('json')
    const pickupDate = new Date(body.pickupDate)

    const mileage = mileageEstimator.estimate(body.originZip, body.destZip)
    if (!mileage) {
      throw new DomainError(
        `No mileage estimate available for ${body.originZip} -> ${body.destZip}`,
        'MILEAGE_OUT_OF_RANGE',
      )
    }

    const version = await findActiveTariffVersion(db, body.tariffCode, pickupDate)
    const tariffData = await resolveTariff400ngData(db, {
      tariffVersionId: version.id,
      originZip: body.originZip,
      destZip: body.destZip,
      miles: mileage.miles,
      weightLbs: body.weightLbs,
      pickupDate,
      fullPack: body.options.fullPack,
      fullUnpack: body.options.fullUnpack,
    })

    const result = rate400ng(
      {
        weightLbs: body.weightLbs,
        originZip: body.originZip,
        destZip: body.destZip,
        pickupDate,
        mileage,
        options: body.options,
        ...(body.linehaulDiscountPercent !== undefined
          ? { linehaulDiscountPercent: body.linehaulDiscountPercent }
          : {}),
      },
      tariffData,
    )

    return c.json({
      data: {
        lineItems: result.lineItems.map((li) => ({
          code: li.code,
          description: li.description,
          basis: li.basis,
          amount: li.amountCents / 100,
          currency: 'USD',
        })),
        total: result.totalCents / 100,
        currency: 'USD',
        meta: {
          tariffVersionId: version.id,
          tariffLabel: version.label,
          billedWeightLbs: result.meta.billedWeightLbs,
          mileage: result.meta.mileage,
          warnings: result.meta.warnings,
        },
      },
    })
  },
)

ratingHandler.get('/tariffs', requirePermission(Actions.ReadTariff), async (c) => {
  const db = c.get('db')
  const tariffCode = c.req.query('tariffCode')
  const versions = await listTariffVersions(db, tariffCode)
  return c.json({ data: versions.map(mapVersionSummary) })
})

ratingHandler.get('/tariffs/:id', requirePermission(Actions.ReadTariff), async (c) => {
  const db = c.get('db')
  const id = c.req.param('id') ?? ''
  const version = await getTariffVersionById(db, id)
  if (!version) return c.json({ error: 'Tariff version not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data: mapVersionSummary(version) })
})

// Import/activate (mutating platform-global tariff data) intentionally does NOT
// live here: it moved to the PLATFORM_ADMIN surface at POST /api/admin/tariffs
// (see handlers/admin/tariffs.ts). The tenant path is read + rate only, so no
// tenant's admin can mutate the shared tariff every other tenant rates against.
