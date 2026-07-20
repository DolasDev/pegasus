// ---------------------------------------------------------------------------
// Unit tests for the admin tariff handler (/api/admin/tariffs).
//
// The repository layer is mocked (vi.hoisted) so these tests cover handler
// wiring, whole-document validation, and response codes — the repository's own
// transactional/checksum/supersede behaviour is covered by
// repositories/__tests__/tariff.repository.test.ts against a real DB.
//
// The PLATFORM_ADMIN gate is applied in admin/index.ts (adminAuthMiddleware on
// '*') and covered by __tests__/admin-auth.test.ts — buildApp() here injects the
// admin identity directly, the same way admin/workflows.test.ts does.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    listTariffVersions: vi.fn(),
    getTariffVersionById: vi.fn(),
    importTariff400ng: vi.fn(),
    activateTariffVersion: vi.fn(),
    upsertTariffFuelSurcharge: vi.fn(),
    listTariffFuelSurcharges: vi.fn(),
  },
}))

vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../repositories', () => mockRepo)

import { adminTariffsRouter } from './tariffs'

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

const ADMIN_EMAIL = 'admin@platform.com'

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', ADMIN_EMAIL)
    await next()
  })
  app.route('/tariffs', adminTariffsRouter)
  return app
}

const effectiveFrom = new Date('2026-05-15T00:00:00.000Z')
const effectiveTo = new Date('2027-05-15T00:00:00.000Z')

// A TariffVersionWithCounts row as the repository would return it.
const versionRow = {
  id: 'tv-1',
  tariffCode: '400NG',
  label: '2026 400NG Baseline Rates',
  effectiveFrom,
  effectiveTo,
  status: 'STAGED',
  sourceChecksum: 'abc123',
  importedBy: ADMIN_EMAIL,
  _count: {
    zip3s: 913,
    serviceAreas: 227,
    linehaulRates: 5076,
    shorthaulRates: 6,
    packRates: 16,
    unpackRates: 4,
  },
}

// A minimal document satisfying Tariff400ngImportSchema (real numbers from the
// seed fixture / the 2026 Baseline Rates workbook).
const validDoc = {
  schemaVersion: 1,
  tariffCode: '400NG',
  label: '2026 400NG Baseline Rates',
  effectiveFrom: effectiveFrom.toISOString(),
  effectiveTo: effectiveTo.toISOString(),
  zip3s: [{ zip3: '173', serviceArea: '672' }],
  serviceAreas: [
    {
      serviceArea: '672',
      schedule: 3,
      serviceChargeCentsPerCwt: 1209,
      linehaulFactorCentsPerCwt: 288,
    },
  ],
  linehaulRates: [
    {
      milesLower: 1401,
      milesUpper: 1501,
      weightLower: 8000,
      weightUpper: 8200,
      rateCents: 1_747_500,
    },
  ],
  shorthaulRates: [{ cwtMilesLower: 16_001, cwtMilesUpper: 32_000, rateCents: 39_702 }],
  packRates: [],
  unpackRates: [],
}

function postJson(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin tariffs handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /tariffs', () => {
    it('returns 200 with mapped version summaries (counts flattened)', async () => {
      mockRepo.listTariffVersions.mockResolvedValue([versionRow])
      const res = await buildApp().request('/tariffs')
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['id']).toBe('tv-1')
      expect(data[0]!['status']).toBe('STAGED')
      expect(data[0]!['counts']).toEqual(versionRow._count)
      // Raw prisma `_count` is not leaked verbatim — the summary exposes `counts`.
      expect('_count' in data[0]!).toBe(false)
    })

    it('passes the tariffCode query filter through to the repository', async () => {
      mockRepo.listTariffVersions.mockResolvedValue([])
      await buildApp().request('/tariffs?tariffCode=400NG')
      expect(mockRepo.listTariffVersions).toHaveBeenCalledWith(expect.anything(), '400NG')
    })
  })

  describe('GET /tariffs/:id', () => {
    it('returns 200 with the version when found', async () => {
      mockRepo.getTariffVersionById.mockResolvedValue(versionRow)
      const res = await buildApp().request('/tariffs/tv-1')
      expect(res.status).toBe(200)
      expect(((await json(res)).data as JsonBody)['id']).toBe('tv-1')
    })

    it('returns 404 NOT_FOUND when the version does not exist', async () => {
      mockRepo.getTariffVersionById.mockResolvedValue(null)
      const res = await buildApp().request('/tariffs/missing')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  describe('POST /tariffs/import', () => {
    it('imports a new document as STAGED and returns 201, recording the admin email', async () => {
      mockRepo.importTariff400ng.mockResolvedValue({
        version: { id: 'tv-1', status: 'STAGED' },
        created: true,
      })
      const res = await postJson(buildApp(), '/tariffs/import', validDoc)
      expect(res.status).toBe(201)
      const data = (await json(res)).data as JsonBody
      expect(data).toEqual({ id: 'tv-1', status: 'STAGED', created: true })
      expect(mockRepo.importTariff400ng).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tariffCode: '400NG' }),
        ADMIN_EMAIL,
      )
    })

    it('returns 200 (not 201) for an idempotent re-import of identical data', async () => {
      mockRepo.importTariff400ng.mockResolvedValue({
        version: { id: 'tv-1', status: 'STAGED' },
        created: false,
      })
      const res = await postJson(buildApp(), '/tariffs/import', validDoc)
      expect(res.status).toBe(200)
      expect(((await json(res)).data as JsonBody)['created']).toBe(false)
    })

    it('returns 400 VALIDATION_ERROR and never calls the repository on a malformed document', async () => {
      const res = await postJson(buildApp(), '/tariffs/import', { tariffCode: '400NG' })
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(mockRepo.importTariff400ng).not.toHaveBeenCalled()
    })

    it('rejects a non-400NG tariffCode (schema is pinned to 400NG)', async () => {
      const res = await postJson(buildApp(), '/tariffs/import', {
        ...validDoc,
        tariffCode: 'ATLAS',
      })
      expect(res.status).toBe(400)
      expect(mockRepo.importTariff400ng).not.toHaveBeenCalled()
    })
  })

  describe('POST /tariffs/:id/activate', () => {
    it('activates the version and returns its new status', async () => {
      mockRepo.activateTariffVersion.mockResolvedValue({ id: 'tv-1', status: 'ACTIVE' })
      const res = await postJson(buildApp(), '/tariffs/tv-1/activate', {})
      expect(res.status).toBe(200)
      expect((await json(res)).data).toEqual({ id: 'tv-1', status: 'ACTIVE' })
      expect(mockRepo.activateTariffVersion).toHaveBeenCalledWith(expect.anything(), 'tv-1')
    })
  })

  describe('GET /tariffs/fsc', () => {
    it('lists fuel-surcharge rows (and is not shadowed by the /:id route)', async () => {
      mockRepo.listTariffFuelSurcharges.mockResolvedValue([
        {
          id: 'fsc-1',
          tariffCode: '400NG',
          effectiveFrom: new Date('2026-05-15T00:00:00.000Z'),
          percentBps: 500,
          dieselPriceCentsPerGallon: 415,
          source: 'MANUAL',
        },
      ])
      const res = await buildApp().request('/tariffs/fsc')
      expect(res.status).toBe(200)
      const data = (await json(res)).data as JsonBody[]
      expect(data[0]!['percentBps']).toBe(500)
      // The version-by-id handler must not have handled this (fsc != an id lookup).
      expect(mockRepo.getTariffVersionById).not.toHaveBeenCalled()
      expect(mockRepo.listTariffFuelSurcharges).toHaveBeenCalledWith(expect.anything(), '400NG')
    })
  })

  describe('POST /tariffs/fsc', () => {
    it('upserts from a diesel price (percent is computed server-side) and returns the row', async () => {
      mockRepo.upsertTariffFuelSurcharge.mockResolvedValue({
        id: 'fsc-1',
        tariffCode: '400NG',
        effectiveFrom: new Date('2026-05-15T00:00:00.000Z'),
        percentBps: 500,
        dieselPriceCentsPerGallon: 415,
        source: 'MANUAL',
      })
      const res = await postJson(buildApp(), '/tariffs/fsc', {
        dieselPriceCentsPerGallon: 415,
        effectiveFrom: '2026-05-15T00:00:00.000Z',
      })
      expect(res.status).toBe(200)
      expect((await json(res)).data).toMatchObject({ percentBps: 500, source: 'MANUAL' })
      expect(mockRepo.upsertTariffFuelSurcharge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tariffCode: '400NG',
          dieselPriceCentsPerGallon: 415,
          source: 'MANUAL',
        }),
      )
      // The caller never supplies a percentage — the handler must not accept one.
      const call = mockRepo.upsertTariffFuelSurcharge.mock.calls[0]![1] as Record<string, unknown>
      expect('percentBps' in call).toBe(false)
    })

    it('rejects a missing diesel price with 400', async () => {
      const res = await postJson(buildApp(), '/tariffs/fsc', {
        effectiveFrom: '2026-05-15T00:00:00.000Z',
      })
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
      expect(mockRepo.upsertTariffFuelSurcharge).not.toHaveBeenCalled()
    })
  })
})
