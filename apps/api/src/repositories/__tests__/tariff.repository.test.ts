/**
 * Integration tests for the tariff repository (global, non-tenant reference
 * data). Read-only tests exercise the real seeded 400NG fixture (SA 672
 * Philadelphia / SA 736 Abilene, real 2026 rates — see prisma/seed.ts and
 * packages/domain/src/rating/__tests__/tariff400ng.test.ts for the same
 * numbers). Import/activate tests use a separate `TEST_TARIFF` tariffCode so
 * they can't disturb the shared '400NG' ACTIVE fixture other tests rely on.
 *
 * Requires a live PostgreSQL database — skipped automatically when
 * DATABASE_URL is not set.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { DomainError } from '@pegasus/domain'
import { db } from '../../db'
import { main as seed } from '../../../prisma/seed'
import type { Tariff400ngImport } from '../../rating/import-schema'
import {
  findActiveTariffVersion,
  resolveTariff400ngData,
  listTariffVersions,
  getTariffVersionById,
  importTariff400ng,
  activateTariffVersion,
  checksumTariffImport,
} from '../tariff.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const SEED_400NG_VERSION_ID = 'seed-tariff-400ng-0001'
const PICKUP_DATE = new Date('2026-08-01T00:00:00.000Z')

function testImportDoc(overrides: Partial<Tariff400ngImport> = {}): Tariff400ngImport {
  return {
    schemaVersion: 1,
    tariffCode: '400NG',
    label: 'TEST_TARIFF fixture',
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: '2020-06-01T00:00:00.000Z',
    zip3s: [{ zip3: '001', serviceArea: 'TST' }],
    serviceAreas: [
      {
        serviceArea: 'TST',
        schedule: 1,
        serviceChargeCentsPerCwt: 100,
        linehaulFactorCentsPerCwt: 50,
      },
    ],
    linehaulRates: [
      { milesLower: 0, milesUpper: 5000, weightLower: 0, weightUpper: 50_000, rateCents: 100_000 },
    ],
    shorthaulRates: [{ cwtMilesLower: 0, cwtMilesUpper: 999_999, rateCents: 5000 }],
    packRates: [{ schedule: 1, weightLower: 0, weightUpper: 50_000, rateCentsPerCwt: 1000 }],
    unpackRates: [{ schedule: 1, rateMillicentsPerCwt: 100_000 }],
    ...overrides,
  }
}

const createdVersionIds: string[] = []

beforeAll(async () => {
  if (hasDb) await seed(db)
})

afterAll(async () => {
  if (hasDb) {
    await db.tariffVersion.deleteMany({ where: { id: { in: createdVersionIds } } })
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('findActiveTariffVersion', () => {
  it('finds the seeded ACTIVE 400NG version for a date within its window', async () => {
    const version = await findActiveTariffVersion(db, '400NG', PICKUP_DATE)
    expect(version.id).toBe(SEED_400NG_VERSION_ID)
    expect(version.status).toBe('ACTIVE')
  })

  it('throws NO_ACTIVE_TARIFF_VERSION for a date outside every version window', async () => {
    await expect(
      findActiveTariffVersion(db, '400NG', new Date('1999-01-01')),
    ).rejects.toMatchObject({
      code: 'NO_ACTIVE_TARIFF_VERSION',
    })
  })

  it('throws NO_ACTIVE_TARIFF_VERSION for an unknown tariffCode', async () => {
    await expect(findActiveTariffVersion(db, 'NOT_A_TARIFF', PICKUP_DATE)).rejects.toThrow(
      DomainError,
    )
  })
})

describe.skipIf(!hasDb)('resolveTariff400ngData', () => {
  it('resolves the real 2026 rates for SA 672 (origin) / SA 736 (dest)', async () => {
    const data = await resolveTariff400ngData(db, {
      tariffVersionId: SEED_400NG_VERSION_ID,
      originZip: '17325',
      destZip: '79601',
      miles: 375, // within the seeded 351-400mi band
      weightLbs: 8000,
      pickupDate: PICKUP_DATE,
      fullPack: true,
      fullUnpack: true,
    })
    expect(data.origin.serviceChargeCentsPerCwt).toBe(1209)
    expect(data.origin.linehaulFactorCentsPerCwt).toBe(288)
    expect(data.origin.packRateCentsPerCwt).toBe(9133)
    expect(data.destination.serviceChargeCentsPerCwt).toBe(747)
    expect(data.destination.unpackRateMillicentsPerCwt).toBe(791_595)
    expect(data.linehaulRateCents).toBe(1_063_700)
    expect(data.shorthaulRateCents).toBe(39_702)
    expect(data.fscPercentBps).toBe(500)
  })

  it('omits shorthaulRateCents for a > 800 mile shipment', async () => {
    const data = await resolveTariff400ngData(db, {
      tariffVersionId: SEED_400NG_VERSION_ID,
      originZip: '17325',
      destZip: '79601',
      miles: 1450, // within the seeded 1401-1500mi band
      weightLbs: 8000,
      pickupDate: PICKUP_DATE,
      fullPack: false,
      fullUnpack: false,
    })
    expect(data.linehaulRateCents).toBe(1_747_500)
    expect(data.shorthaulRateCents).toBeUndefined()
  })

  it('throws UNKNOWN_ORIGIN_ZIP for an unmapped origin ZIP3', async () => {
    await expect(
      resolveTariff400ngData(db, {
        tariffVersionId: SEED_400NG_VERSION_ID,
        originZip: '00000',
        destZip: '79601',
        miles: 1450,
        weightLbs: 8000,
        pickupDate: PICKUP_DATE,
        fullPack: false,
        fullUnpack: false,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ORIGIN_ZIP' })
  })

  it('throws UNKNOWN_DEST_ZIP for an unmapped destination ZIP3', async () => {
    await expect(
      resolveTariff400ngData(db, {
        tariffVersionId: SEED_400NG_VERSION_ID,
        originZip: '17325',
        destZip: '00000',
        miles: 1450,
        weightLbs: 8000,
        pickupDate: PICKUP_DATE,
        fullPack: false,
        fullUnpack: false,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_DEST_ZIP' })
  })

  it('throws MILEAGE_OUT_OF_RANGE when no linehaul band covers the mileage', async () => {
    await expect(
      resolveTariff400ngData(db, {
        tariffVersionId: SEED_400NG_VERSION_ID,
        originZip: '17325',
        destZip: '79601',
        miles: 999_999,
        weightLbs: 8000,
        pickupDate: PICKUP_DATE,
        fullPack: false,
        fullUnpack: false,
      }),
    ).rejects.toMatchObject({ code: 'MILEAGE_OUT_OF_RANGE' })
  })

  it('throws WEIGHT_OUT_OF_RANGE when the mileage band exists but not the weight', async () => {
    await expect(
      resolveTariff400ngData(db, {
        tariffVersionId: SEED_400NG_VERSION_ID,
        originZip: '17325',
        destZip: '79601',
        miles: 1450,
        weightLbs: 500_000,
        pickupDate: PICKUP_DATE,
        fullPack: false,
        fullUnpack: false,
      }),
    ).rejects.toMatchObject({ code: 'WEIGHT_OUT_OF_RANGE' })
  })
})

describe.skipIf(!hasDb)('listTariffVersions / getTariffVersionById', () => {
  it('lists at least the seeded 400NG version with row counts', async () => {
    const versions = await listTariffVersions(db, '400NG')
    const seeded = versions.find((v) => v.id === SEED_400NG_VERSION_ID)
    expect(seeded?._count.zip3s).toBeGreaterThanOrEqual(2)
    expect(seeded?._count.serviceAreas).toBe(2)
  })

  it('gets the seeded version by id', async () => {
    const version = await getTariffVersionById(db, SEED_400NG_VERSION_ID)
    expect(version?.tariffCode).toBe('400NG')
  })

  it('returns null for an unknown id', async () => {
    expect(await getTariffVersionById(db, 'does-not-exist')).toBeNull()
  })
})

describe.skipIf(!hasDb)('importTariff400ng / activateTariffVersion', () => {
  it('creates a new STAGED version and is idempotent on re-import', async () => {
    const doc = testImportDoc()
    const first = await importTariff400ng(db, doc, 'test-suite')
    createdVersionIds.push(first.version.id)
    expect(first.created).toBe(true)
    expect(first.version.status).toBe('STAGED')
    expect(first.version.sourceChecksum).toBe(checksumTariffImport(doc))

    const second = await importTariff400ng(db, doc, 'test-suite')
    expect(second.created).toBe(false)
    expect(second.version.id).toBe(first.version.id)
  })

  it('activates a STAGED version, superseding an overlapping ACTIVE one', async () => {
    const older = await importTariff400ng(
      db,
      testImportDoc({
        label: 'older',
        effectiveFrom: '2021-01-01T00:00:00.000Z',
        effectiveTo: '2021-06-01T00:00:00.000Z',
      }),
      'test-suite',
    )
    createdVersionIds.push(older.version.id)
    await activateTariffVersion(db, older.version.id)

    const newer = await importTariff400ng(
      db,
      testImportDoc({
        label: 'newer, overlapping',
        effectiveFrom: '2021-03-01T00:00:00.000Z',
        effectiveTo: '2021-09-01T00:00:00.000Z',
      }),
      'test-suite',
    )
    createdVersionIds.push(newer.version.id)
    const activated = await activateTariffVersion(db, newer.version.id)
    expect(activated.status).toBe('ACTIVE')

    const supersededOlder = await getTariffVersionById(db, older.version.id)
    expect(supersededOlder?.status).toBe('SUPERSEDED')
  })

  it('activating an already-ACTIVE version is an idempotent no-op', async () => {
    const version = await activateTariffVersion(db, SEED_400NG_VERSION_ID)
    expect(version.status).toBe('ACTIVE')
  })

  it('throws INVALID_STATE when re-activating a SUPERSEDED version', async () => {
    const first = await importTariff400ng(
      db,
      testImportDoc({
        label: 'a',
        effectiveFrom: '2022-01-01T00:00:00.000Z',
        effectiveTo: '2022-06-01T00:00:00.000Z',
      }),
      'test-suite',
    )
    createdVersionIds.push(first.version.id)
    await activateTariffVersion(db, first.version.id)

    const second = await importTariff400ng(
      db,
      testImportDoc({
        label: 'b',
        effectiveFrom: '2022-01-01T00:00:00.000Z',
        effectiveTo: '2022-06-01T00:00:00.000Z',
      }),
      'test-suite',
    )
    createdVersionIds.push(second.version.id)
    await activateTariffVersion(db, second.version.id) // supersedes `first`

    await expect(activateTariffVersion(db, first.version.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })

  it('throws NOT_FOUND for an unknown version id', async () => {
    await expect(activateTariffVersion(db, 'does-not-exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
