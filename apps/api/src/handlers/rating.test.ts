// ---------------------------------------------------------------------------
// Unit tests for the rating handler.
//
// Repository functions are mocked; the domain's rate400ng/mileage estimator
// are NOT mocked — this exercises the real 400NG math against known-good
// tariff data (the same real 2026 fixture used in
// packages/domain/src/rating/__tests__/tariff400ng.test.ts and
// prisma/seed.ts) so the handler's wiring is verified end-to-end, not just
// its plumbing. No database connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { rate400ng, createZip3CentroidEstimator } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { ratingHandler } from './rating'

vi.mock('../repositories', () => ({
  findActiveTariffVersion: vi.fn(),
  resolveTariff400ngData: vi.fn(),
  listTariffVersions: vi.fn(),
  getTariffVersionById: vi.fn(),
}))

import {
  findActiveTariffVersion,
  resolveTariff400ngData,
  listTariffVersions,
  getTariffVersionById,
} from '../repositories'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

type TestPrincipal = { sub: string; tenantId: string; roleNames: string[] }

const ADMIN_PRINCIPAL: TestPrincipal = {
  sub: 'test-sub',
  tenantId: 'test-tenant-id',
  roleNames: ['tenant_admin'],
}
const VIEWER_PRINCIPAL: TestPrincipal = {
  sub: 'viewer-sub',
  tenantId: 'test-tenant-id',
  roleNames: ['viewer'],
}

function buildApp(principal: TestPrincipal = ADMIN_PRINCIPAL) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', {} as unknown as PrismaClient)
    c.set('principal', principal)
    await next()
  })
  app.route('/', ratingHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures — real 2026 400NG rates (SA 672 Philadelphia / SA 736 Abilene),
// same numbers as tariff400ng.test.ts and the seed fixture.
// ---------------------------------------------------------------------------

const REAL_TARIFF_DATA = {
  origin: {
    serviceChargeCentsPerCwt: 1209,
    linehaulFactorCentsPerCwt: 288,
    packRateCentsPerCwt: 9133,
  },
  destination: {
    serviceChargeCentsPerCwt: 747,
    linehaulFactorCentsPerCwt: 171,
    unpackRateMillicentsPerCwt: 791_595,
  },
  linehaulRateCents: 1_063_700,
  shorthaulRateCents: 39_702,
  fscPercentBps: 500,
}

const MOCK_VERSION = {
  id: 'tv-1',
  tariffCode: '400NG',
  label: '2026 400NG (seed subset)',
  status: 'ACTIVE',
}

const RATE_BODY = {
  weightLbs: 8000,
  originZip: '17325', // ZIP3 173 -> real centroid
  destZip: '79601', // ZIP3 796 -> real centroid
  pickupDate: '2026-08-01T00:00:00.000Z',
  options: { fullPack: true, fullUnpack: true },
}

beforeEach(() => {
  vi.clearAllMocks()
})

// The exact 400NG math against fully hand-verified real numbers is already
// proven in packages/domain/src/rating/__tests__/tariff400ng.test.ts with a
// controlled mileage input. Here, `resolveTariff400ngData` is mocked but the
// mileage estimator is NOT — so the "expected" total is computed via the
// same real `rate400ng` + real estimator, independent of the handler's own
// call, to verify the handler wires params/response correctly rather than
// re-deriving the financial proof.
const mileageEstimator = createZip3CentroidEstimator()

function expectedResult(overrides: Partial<{ linehaulDiscountPercent: number }> = {}) {
  const mileage = mileageEstimator.estimate(RATE_BODY.originZip, RATE_BODY.destZip)!
  return rate400ng(
    {
      weightLbs: RATE_BODY.weightLbs,
      originZip: RATE_BODY.originZip,
      destZip: RATE_BODY.destZip,
      pickupDate: new Date(RATE_BODY.pickupDate),
      mileage,
      options: RATE_BODY.options,
      ...overrides,
    },
    REAL_TARIFF_DATA,
  )
}

describe('POST /rate', () => {
  it('computes the real 400NG total for a known-good shipment', async () => {
    vi.mocked(findActiveTariffVersion).mockResolvedValue(MOCK_VERSION as never)
    vi.mocked(resolveTariff400ngData).mockResolvedValue(REAL_TARIFF_DATA as never)

    const res = await buildApp().request('/rate', post(RATE_BODY))
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as JsonBody
    const expected = expectedResult()
    expect(data['total']).toBeCloseTo(expected.totalCents / 100, 2)
    const lineItems = data['lineItems'] as JsonBody[]
    expect(lineItems.map((li) => li['code'])).toEqual(expected.lineItems.map((li) => li.code))
    const meta = data['meta'] as JsonBody
    expect(meta['tariffVersionId']).toBe('tv-1')
    expect(meta['warnings']).toEqual([])
  })

  it('passes an explicit linehaulDiscountPercent through to the domain calculation', async () => {
    vi.mocked(findActiveTariffVersion).mockResolvedValue(MOCK_VERSION as never)
    vi.mocked(resolveTariff400ngData).mockResolvedValue(REAL_TARIFF_DATA as never)

    const res = await buildApp().request(
      '/rate',
      post({ ...RATE_BODY, linehaulDiscountPercent: 57 }),
    )
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as JsonBody
    const expected = expectedResult({ linehaulDiscountPercent: 57 })
    const undiscounted = expectedResult()
    expect(data['total']).toBeCloseTo(expected.totalCents / 100, 2)
    // Sanity: the discount actually changed the total versus the baseline case.
    expect(expected.totalCents).toBeLessThan(undiscounted.totalCents)
  })

  it('returns 400 VALIDATION_ERROR for a malformed ZIP', async () => {
    const res = await buildApp().request('/rate', post({ ...RATE_BODY, originZip: '123' }))
    expect(res.status).toBe(400)
    expect((await json(res))['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 422 MILEAGE_OUT_OF_RANGE when the ZIP3 has no centroid', async () => {
    const res = await buildApp().request('/rate', post({ ...RATE_BODY, originZip: '00000' }))
    expect(res.status).toBe(422)
    expect((await json(res))['code']).toBe('MILEAGE_OUT_OF_RANGE')
    expect(findActiveTariffVersion).not.toHaveBeenCalled()
  })

  it('returns 422 NO_ACTIVE_TARIFF_VERSION when none covers the pickup date', async () => {
    const { DomainError } = await import('@pegasus/domain')
    vi.mocked(findActiveTariffVersion).mockRejectedValue(
      new DomainError(
        'No active 400NG tariff version covers 2026-08-01',
        'NO_ACTIVE_TARIFF_VERSION',
      ),
    )
    const res = await buildApp().request('/rate', post(RATE_BODY))
    expect(res.status).toBe(422)
    expect((await json(res))['code']).toBe('NO_ACTIVE_TARIFF_VERSION')
  })

  it('is forbidden for a principal with no roles (no RateShipment)', async () => {
    const res = await buildApp({ sub: 'x', tenantId: 't', roleNames: [] }).request(
      '/rate',
      post(RATE_BODY),
    )
    expect(res.status).toBe(403)
  })

  it('allows a viewer to rate a shipment', async () => {
    vi.mocked(findActiveTariffVersion).mockResolvedValue(MOCK_VERSION as never)
    vi.mocked(resolveTariff400ngData).mockResolvedValue(REAL_TARIFF_DATA as never)
    const res = await buildApp(VIEWER_PRINCIPAL).request('/rate', post(RATE_BODY))
    expect(res.status).toBe(200)
  })
})

describe('GET /tariffs', () => {
  it('lists tariff versions', async () => {
    vi.mocked(listTariffVersions).mockResolvedValue([MOCK_VERSION] as never)
    const res = await buildApp().request('/tariffs')
    expect(res.status).toBe(200)
    expect(((await json(res))['data'] as unknown[]).length).toBe(1)
  })

  it('is forbidden for a principal with no roles (no ReadTariff)', async () => {
    const res = await buildApp({ sub: 'x', tenantId: 't', roleNames: [] }).request('/tariffs')
    expect(res.status).toBe(403)
  })
})

describe('GET /tariffs/:id', () => {
  it('returns the tariff version when found', async () => {
    vi.mocked(getTariffVersionById).mockResolvedValue(MOCK_VERSION as never)
    const res = await buildApp().request('/tariffs/tv-1')
    expect(res.status).toBe(200)
  })

  it('returns 404 when not found', async () => {
    vi.mocked(getTariffVersionById).mockResolvedValue(null)
    const res = await buildApp().request('/tariffs/missing')
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
  })
})

// Import/activate moved to the PLATFORM_ADMIN surface (POST /api/admin/tariffs)
// — covered by handlers/admin/tariffs.test.ts. The tenant rating handler is now
// read + rate only; there is no tenant-facing tariff mutation route to test here.
