// ---------------------------------------------------------------------------
// Tariff repository — global (non-tenant) reference data.
//
// Unlike other repositories in this directory, callers pass the *root*
// PrismaClient (or a transaction client), not a tenant-scoped one: tariff
// data has no tenantId column, and createTenantDb passes models without one
// through untouched anyway (see lib/prisma.ts) — so this is just an explicit
// reminder that these reads/writes are intentionally cross-tenant.
//
// Data-not-found conditions throw DomainError so they surface as a 422 via
// app.ts's central onError handler, matching the pattern used elsewhere
// (e.g. handlers/event-types.ts) rather than each call site building its own
// error response.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { PrismaClient, Prisma, TariffVersion } from '@prisma/client'
import { DomainError, SHORTHAUL_THRESHOLD_MILES } from '@pegasus/domain'
import type { Tariff400ngData } from '@pegasus/domain'
import type { Tariff400ngImport } from '../rating/import-schema'

type Db = PrismaClient | Prisma.TransactionClient

// ---------------------------------------------------------------------------
// Active version resolution
// ---------------------------------------------------------------------------

/**
 * Finds the ACTIVE tariff version covering `atDate` for `tariffCode`.
 * @throws {DomainError} NO_ACTIVE_TARIFF_VERSION when none covers the date.
 */
export async function findActiveTariffVersion(
  db: Db,
  tariffCode: string,
  atDate: Date,
): Promise<TariffVersion> {
  const version = await db.tariffVersion.findFirst({
    where: {
      tariffCode,
      status: 'ACTIVE',
      effectiveFrom: { lte: atDate },
      effectiveTo: { gt: atDate },
    },
    orderBy: { effectiveFrom: 'desc' },
  })
  if (!version) {
    throw new DomainError(
      `No active ${tariffCode} tariff version covers ${atDate.toISOString().slice(0, 10)}`,
      'NO_ACTIVE_TARIFF_VERSION',
    )
  }
  return version
}

// ---------------------------------------------------------------------------
// 400NG rate-cell resolution
// ---------------------------------------------------------------------------

export interface Resolve400ngParams {
  readonly tariffVersionId: string
  readonly originZip: string
  readonly destZip: string
  readonly miles: number
  readonly weightLbs: number
  readonly pickupDate: Date
  readonly fullPack: boolean
  readonly fullUnpack: boolean
}

async function resolveServiceArea(
  db: Db,
  tariffVersionId: string,
  zip: string,
  zipErrorCode: 'UNKNOWN_ORIGIN_ZIP' | 'UNKNOWN_DEST_ZIP',
): Promise<string> {
  const zip3 = zip.slice(0, 3)
  const row = await db.tariff400ngZip3.findUnique({
    where: { tariffVersionId_zip3: { tariffVersionId, zip3 } },
  })
  if (!row) {
    throw new DomainError(`No 400NG service area is mapped for ZIP3 ${zip3}`, zipErrorCode)
  }
  return row.serviceArea
}

/**
 * Assembles the `Tariff400ngData` the domain `rate400ng` function needs, by
 * looking up exactly the rows a given shipment requires (never the whole
 * tariff version). No season dimension: confirmed against the real 2026
 * Baseline Rates spreadsheet that none of these CONUS domestic rates vary
 * by peak/non-peak (see tariff400ng.ts calibration notes).
 *
 * @throws {DomainError} UNKNOWN_ORIGIN_ZIP / UNKNOWN_DEST_ZIP when a ZIP3 has
 *         no mapped service area; TARIFF_DATA_INCOMPLETE when a service area
 *         is mapped but its rate row is missing (an import defect, not a
 *         caller error); MILEAGE_OUT_OF_RANGE / WEIGHT_OUT_OF_RANGE when the
 *         shipment falls outside every published band.
 */
export async function resolveTariff400ngData(
  db: Db,
  params: Resolve400ngParams,
): Promise<Tariff400ngData> {
  const { tariffVersionId, miles, weightLbs, pickupDate, fullPack, fullUnpack } = params

  const [originServiceArea, destServiceArea] = await Promise.all([
    resolveServiceArea(db, tariffVersionId, params.originZip, 'UNKNOWN_ORIGIN_ZIP'),
    resolveServiceArea(db, tariffVersionId, params.destZip, 'UNKNOWN_DEST_ZIP'),
  ])

  const [originRow, destRow] = await Promise.all([
    db.tariff400ngServiceArea.findUnique({
      where: { tariffVersionId_serviceArea: { tariffVersionId, serviceArea: originServiceArea } },
    }),
    db.tariff400ngServiceArea.findUnique({
      where: { tariffVersionId_serviceArea: { tariffVersionId, serviceArea: destServiceArea } },
    }),
  ])
  if (!originRow) {
    throw new DomainError(
      `No rates published for origin service area ${originServiceArea}`,
      'TARIFF_DATA_INCOMPLETE',
    )
  }
  if (!destRow) {
    throw new DomainError(
      `No rates published for destination service area ${destServiceArea}`,
      'TARIFF_DATA_INCOMPLETE',
    )
  }

  // BLHS always applies (Item 1-2, Appendix A section B).
  const linehaulMatches = await db.tariff400ngLinehaulRate.findMany({
    where: { tariffVersionId, milesLower: { lte: miles }, milesUpper: { gt: miles } },
  })
  if (linehaulMatches.length === 0) {
    throw new DomainError(`No linehaul rate band covers ${miles} miles`, 'MILEAGE_OUT_OF_RANGE')
  }
  const linehaulCell = linehaulMatches.find(
    (row) => row.weightLower <= weightLbs && weightLbs < row.weightUpper,
  )
  if (!linehaulCell) {
    throw new DomainError(
      `No linehaul rate band covers ${weightLbs} lbs at ${miles} miles`,
      'WEIGHT_OUT_OF_RANGE',
    )
  }

  // SH is additive on top of BLHS, only when mileage <= threshold (Item 4).
  const cwtMiles = (weightLbs / 100) * miles
  let shorthaulRateCents: number | undefined
  if (miles <= SHORTHAUL_THRESHOLD_MILES) {
    const shRow = await db.tariff400ngShorthaulRate.findFirst({
      where: {
        tariffVersionId,
        cwtMilesLower: { lte: cwtMiles },
        cwtMilesUpper: { gte: cwtMiles },
      },
    })
    if (!shRow) {
      throw new DomainError(
        `No shorthaul rate band covers ${cwtMiles} cwt-miles`,
        'MILEAGE_OUT_OF_RANGE',
      )
    }
    shorthaulRateCents = shRow.rateCents
  }

  let packRateCentsPerCwt: number | undefined
  if (fullPack) {
    const row = await db.tariff400ngFullPackRate.findFirst({
      where: {
        tariffVersionId,
        schedule: originRow.schedule,
        weightLower: { lte: weightLbs },
        weightUpper: { gt: weightLbs },
      },
    })
    packRateCentsPerCwt = row?.rateCentsPerCwt
  }

  let unpackRateMillicentsPerCwt: number | undefined
  if (fullUnpack) {
    const row = await db.tariff400ngFullUnpackRate.findFirst({
      where: { tariffVersionId, schedule: destRow.schedule },
    })
    unpackRateMillicentsPerCwt = row?.rateMillicentsPerCwt
  }

  const fsc = await db.tariffFuelSurcharge.findFirst({
    where: { tariffCode: '400NG', effectiveFrom: { lte: pickupDate } },
    orderBy: { effectiveFrom: 'desc' },
  })

  return {
    origin: {
      serviceChargeCentsPerCwt: originRow.serviceChargeCentsPerCwt,
      linehaulFactorCentsPerCwt: originRow.linehaulFactorCentsPerCwt,
      ...(packRateCentsPerCwt !== undefined ? { packRateCentsPerCwt } : {}),
    },
    destination: {
      serviceChargeCentsPerCwt: destRow.serviceChargeCentsPerCwt,
      linehaulFactorCentsPerCwt: destRow.linehaulFactorCentsPerCwt,
      ...(unpackRateMillicentsPerCwt !== undefined ? { unpackRateMillicentsPerCwt } : {}),
    },
    linehaulRateCents: linehaulCell.rateCents,
    ...(shorthaulRateCents !== undefined ? { shorthaulRateCents } : {}),
    ...(fsc ? { fscPercentBps: fsc.percentBps } : {}),
  }
}

// ---------------------------------------------------------------------------
// Import / activation
// ---------------------------------------------------------------------------

/** Deterministic sha256 over the canonical import document (sorted keys, stable array order). */
export function checksumTariffImport(input: Tariff400ngImport): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort())
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

const TARIFF_VERSION_COUNTS = {
  _count: {
    select: {
      zip3s: true,
      serviceAreas: true,
      linehaulRates: true,
      shorthaulRates: true,
      packRates: true,
      unpackRates: true,
    },
  },
} satisfies Prisma.TariffVersionInclude

export type TariffVersionWithCounts = Prisma.TariffVersionGetPayload<{
  include: typeof TARIFF_VERSION_COUNTS
}>

export async function listTariffVersions(
  db: PrismaClient,
  tariffCode?: string,
): Promise<TariffVersionWithCounts[]> {
  return db.tariffVersion.findMany({
    ...(tariffCode ? { where: { tariffCode } } : {}),
    include: TARIFF_VERSION_COUNTS,
    orderBy: { effectiveFrom: 'desc' },
  })
}

export async function getTariffVersionById(
  db: PrismaClient,
  id: string,
): Promise<TariffVersionWithCounts | null> {
  return db.tariffVersion.findUnique({ where: { id }, include: TARIFF_VERSION_COUNTS })
}

export interface ImportTariff400ngResult {
  readonly version: TariffVersion
  readonly created: boolean
}

/**
 * Imports a canonical 400NG document as a new STAGED TariffVersion. Reimporting
 * byte-identical source data (same tariffCode + checksum) is a no-op that
 * returns the existing version — see `checksumTariffImport`.
 */
export async function importTariff400ng(
  db: PrismaClient,
  input: Tariff400ngImport,
  importedBy?: string,
): Promise<ImportTariff400ngResult> {
  const sourceChecksum = checksumTariffImport(input)

  const existing = await db.tariffVersion.findUnique({
    where: { tariffCode_sourceChecksum: { tariffCode: input.tariffCode, sourceChecksum } },
  })
  if (existing) return { version: existing, created: false }

  const version = await db.$transaction(
    async (tx) => {
      const created = await tx.tariffVersion.create({
        data: {
          tariffCode: input.tariffCode,
          label: input.label,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: new Date(input.effectiveTo),
          status: 'STAGED',
          sourceChecksum,
          importedBy: importedBy ?? null,
        },
      })

      await tx.tariff400ngZip3.createMany({
        data: input.zip3s.map((z) => ({ tariffVersionId: created.id, ...z })),
      })
      await tx.tariff400ngServiceArea.createMany({
        data: input.serviceAreas.map((s) => ({ tariffVersionId: created.id, ...s })),
      })
      await tx.tariff400ngLinehaulRate.createMany({
        data: input.linehaulRates.map((r) => ({ tariffVersionId: created.id, ...r })),
      })
      await tx.tariff400ngShorthaulRate.createMany({
        data: input.shorthaulRates.map((r) => ({ tariffVersionId: created.id, ...r })),
      })
      if (input.packRates.length > 0) {
        await tx.tariff400ngFullPackRate.createMany({
          data: input.packRates.map((r) => ({ tariffVersionId: created.id, ...r })),
        })
      }
      if (input.unpackRates.length > 0) {
        await tx.tariff400ngFullUnpackRate.createMany({
          data: input.unpackRates.map((r) => ({ tariffVersionId: created.id, ...r })),
        })
      }

      return created
    },
    // A full real 400NG import is ~6k rows across six createMany calls. Against
    // Neon (serverless Postgres, per-statement network latency) that runs ~8s,
    // which blew Prisma's default 5s interactive-transaction timeout and failed
    // the whole import in prod. Give a generous budget that still sits well under
    // the API Lambda / API Gateway 29s ceiling. (The seed subset is tiny, so
    // local/dev never hit this.)
    { timeout: 20_000, maxWait: 5_000 },
  )

  return { version, created: true }
}

/**
 * Activates a STAGED tariff version, transactionally superseding any other
 * ACTIVE version of the same tariffCode whose effective window overlaps it.
 * Activating an already-ACTIVE version is an idempotent no-op.
 *
 * @throws {DomainError} NOT_FOUND if `id` doesn't exist; INVALID_STATE if the
 *         version has already been superseded.
 */
export async function activateTariffVersion(db: PrismaClient, id: string): Promise<TariffVersion> {
  return db.$transaction(async (tx) => {
    const target = await tx.tariffVersion.findUnique({ where: { id } })
    if (!target) throw new DomainError(`Tariff version ${id} not found`, 'NOT_FOUND')
    if (target.status === 'ACTIVE') return target
    if (target.status === 'SUPERSEDED') {
      throw new DomainError(
        `Tariff version ${id} has already been superseded and cannot be re-activated`,
        'INVALID_STATE',
      )
    }

    await tx.tariffVersion.updateMany({
      where: {
        tariffCode: target.tariffCode,
        status: 'ACTIVE',
        id: { not: target.id },
        effectiveFrom: { lt: target.effectiveTo },
        effectiveTo: { gt: target.effectiveFrom },
      },
      data: { status: 'SUPERSEDED' },
    })

    return tx.tariffVersion.update({ where: { id }, data: { status: 'ACTIVE' } })
  })
}
