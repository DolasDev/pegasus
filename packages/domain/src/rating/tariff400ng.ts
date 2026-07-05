// ---------------------------------------------------------------------------
// 400NG tariff — Defense Personal Property Program (DP3) domestic household
// goods tariff, published annually by USTRANSCOM.
//
// Chosen as the first tariff because it is the only one of the four the
// user asked about (400NG, Atlas, Allied, United) that is publicly
// published: USTRANSCOM releases the tariff PDF plus a companion "Baseline
// Rates" spreadsheet every year (see plans/in-progress/rating-engine-400ng.md
// for the import pipeline). The van-line tariffs are proprietary — Atlas
// gates its tariff behind an access request, United's UVL1 is
// review-only, Allied publishes only a rules PDF with no rate tables — so
// there is nothing to rate against or auto-update for them today.
//
// ⚠ CALIBRATION STATUS: the constants and FSC bands below are structurally
// correct (this is the standard shape of a DP3-style tariff: weight/mileage
// -banded linehaul, sub-800-mile shorthaul, origin/destination service
// charges and linehaul factors per cwt, full pack/unpack per cwt, and a
// fuel surcharge percentage applied to the linehaul charge) but are NOT
// yet verified against the current published 400NG tariff — the
// ustranscom.mil PDF could not be fetched programmatically (confirmed
// bot/WAF-gated even for direct PDF links; see the plan doc). Before
// relying on this for a real quote, download the current tariff PDF and
// its Appendix A worked examples in a browser and reconcile every
// constant and the __tests__ fixtures against it.
// ---------------------------------------------------------------------------

import { DomainError } from '../shared/errors'
// Type-only import: index.ts re-exports this module, so a runtime (value)
// import back from here would be circular. `TariffCode`/etc. are erased at
// compile time, so this stays safe.
import type { RatingInput, RatingResult, RatedLineItem, TariffCode, TariffSeason } from './index'

export const RATE_400NG: TariffCode = '400NG' as TariffCode

// ---------------------------------------------------------------------------
// UNVERIFIED constants — see calibration-status note above.
// ---------------------------------------------------------------------------

/** Minimum weight (lbs) a shipment is billed at, regardless of actual weight. */
export const MIN_BILLABLE_WEIGHT_LBS = 500

/** Shipments under this mileage are rated by shorthaul (per cwt-mile), not the linehaul band matrix. */
export const SHORTHAUL_THRESHOLD_MILES = 800

/** 400NG peak season: May 15 through Sep 30 (inclusive), regardless of year. */
const PEAK_SEASON_START = { month: 5, day: 15 }
const PEAK_SEASON_END = { month: 9, day: 30 }

/**
 * Fuel surcharge bands: national average diesel price (cents/gallon) -> FSC
 * percentage (basis points) applied to the linehaul/shorthaul charge.
 * Illustrative placeholder table — the real bands are republished with each
 * tariff and belong in `fscPercentForDieselPrice`'s single source of truth.
 */
const FSC_BANDS: ReadonlyArray<{
  readonly maxCentsPerGallon: number
  readonly percentBps: number
}> = [
  { maxCentsPerGallon: 250, percentBps: 0 },
  { maxCentsPerGallon: 300, percentBps: 400 },
  { maxCentsPerGallon: 350, percentBps: 800 },
  { maxCentsPerGallon: 400, percentBps: 1200 },
  { maxCentsPerGallon: 450, percentBps: 1600 },
  { maxCentsPerGallon: 500, percentBps: 2000 },
]
const FSC_BAND_STEP_CENTS = 50
const FSC_BAND_STEP_BPS = 400

// ---------------------------------------------------------------------------
// Tariff data shape (assembled by the API layer from the matching rows in
// the active TariffVersion, then passed in — see tariff.repository.ts)
// ---------------------------------------------------------------------------

export interface ServiceAreaRates {
  readonly serviceChargeCentsPerCwt: number
  readonly linehaulFactorCentsPerCwt: number
  /** Full-pack rate, origin schedule. Undefined if this service area has none published. */
  readonly packRateCentsPerCwt?: number
  /** Full-unpack rate, destination schedule, in millicents/cwt (needs finer precision than whole cents). */
  readonly unpackRateMillicentsPerCwt?: number
}

export interface Tariff400ngData {
  readonly origin: ServiceAreaRates
  readonly destination: ServiceAreaRates
  /** Matched mileage-band × weight-band cell. Required when mileage >= SHORTHAUL_THRESHOLD_MILES. */
  readonly linehaulRateCents?: number
  /** Matched cwt-mile band rate. Required when mileage < SHORTHAUL_THRESHOLD_MILES. */
  readonly shorthaulRateMillicentsPerCwtMile?: number
  /** Fuel surcharge, basis points. Undefined -> FSC line omitted, warning added. */
  readonly fscPercentBps?: number
}

// ---------------------------------------------------------------------------
// Pure calculation helpers
// ---------------------------------------------------------------------------

/** The 400NG rate cycle containing `date`: runs May 15 -> May 14 the following year. */
export function rateCycleFor(date: Date): { readonly start: Date; readonly end: Date } {
  const year = date.getUTCFullYear()
  const cycleStartThisYear = Date.UTC(year, PEAK_SEASON_START.month - 1, PEAK_SEASON_START.day)
  const inCurrentCycle = date.getTime() >= cycleStartThisYear
  const startYear = inCurrentCycle ? year : year - 1
  const start = new Date(Date.UTC(startYear, PEAK_SEASON_START.month - 1, PEAK_SEASON_START.day))
  // End is May 14 the following year, end-of-day.
  const end = new Date(Date.UTC(startYear + 1, PEAK_SEASON_START.month - 1, PEAK_SEASON_START.day))
  return { start, end }
}

/** True when `date` falls in peak season (May 15 - Sep 30 inclusive), any year. */
export function isPeakSeason(date: Date): boolean {
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const afterStart =
    month > PEAK_SEASON_START.month ||
    (month === PEAK_SEASON_START.month && day >= PEAK_SEASON_START.day)
  const beforeEnd =
    month < PEAK_SEASON_END.month || (month === PEAK_SEASON_END.month && day <= PEAK_SEASON_END.day)
  return afterStart && beforeEnd
}

/** Applies the minimum-billable-weight floor. */
export function billedWeight(actualLbs: number): number {
  return Math.max(actualLbs, MIN_BILLABLE_WEIGHT_LBS)
}

/** Converts pounds to hundredweight (cwt), keeping fractional precision. */
export function cwt(weightLbs: number): number {
  return weightLbs / 100
}

/** Rounds a fractional-cent amount to the nearest whole cent. */
function roundCents(amount: number): number {
  return Math.round(amount)
}

/** Looks up the FSC percentage (basis points) for a given national diesel price. */
export function fscPercentForDieselPrice(priceCentsPerGallon: number): number {
  const topBand = FSC_BANDS[FSC_BANDS.length - 1]
  if (!topBand) throw new DomainError('FSC band table is empty', 'FSC_BANDS_EMPTY')

  for (const band of FSC_BANDS) {
    if (priceCentsPerGallon <= band.maxCentsPerGallon) return band.percentBps
  }
  // Above the published table: extrapolate at the same step rate rather
  // than silently capping, so an unusually high fuel price doesn't produce
  // an implausibly low surcharge.
  const stepsOver = Math.ceil(
    (priceCentsPerGallon - topBand.maxCentsPerGallon) / FSC_BAND_STEP_CENTS,
  )
  return topBand.percentBps + stepsOver * FSC_BAND_STEP_BPS
}

/** Applies a fuel surcharge percentage (basis points) to a base charge, in cents. */
export function fuelSurcharge(baseCents: number, fscPercentBps: number): number {
  return roundCents((baseCents * fscPercentBps) / 10_000)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Rates a shipment against the 400NG tariff.
 *
 * `data` must already reflect the correct rate-cycle version and season for
 * `input.pickupDate` — resolving *which* TariffVersion/season row applies is
 * the API layer's job (see repositories/tariff.repository.ts); this
 * function only does the arithmetic once the right rates are in hand.
 *
 * @throws {DomainError} if the mileage requires a linehaul or shorthaul rate
 *         that `data` doesn't provide — this indicates the caller matched
 *         the wrong band or an incomplete tariff version, not a normal
 *         end-user input error (those are rejected before this is called).
 */
export function rate400ng(input: RatingInput, data: Tariff400ngData): RatingResult {
  const season: TariffSeason = isPeakSeason(input.pickupDate) ? 'PEAK' : 'NONPEAK'
  const weightLbs = billedWeight(input.weightLbs)
  const weightCwt = cwt(weightLbs)
  const warnings: string[] = []
  const lineItems: RatedLineItem[] = []

  const isShorthaul = input.mileage.miles < SHORTHAUL_THRESHOLD_MILES
  let baseHaulCents: number

  if (isShorthaul) {
    if (data.shorthaulRateMillicentsPerCwtMile === undefined) {
      throw new DomainError(
        `No shorthaul rate provided for a ${input.mileage.miles}-mile shipment`,
        'SHORTHAUL_RATE_UNAVAILABLE',
      )
    }
    const amountCents = roundCents(
      (weightCwt * input.mileage.miles * data.shorthaulRateMillicentsPerCwtMile) / 1000,
    )
    baseHaulCents = amountCents
    lineItems.push({
      code: 'SHORTHAUL',
      description: 'Shorthaul charge (< 800 miles)',
      basis: `${weightCwt.toFixed(2)} cwt × ${input.mileage.miles.toFixed(1)} mi @ ${(data.shorthaulRateMillicentsPerCwtMile / 1000).toFixed(3)}¢/cwt-mi`,
      amountCents,
    })
  } else {
    if (data.linehaulRateCents === undefined) {
      throw new DomainError(
        `No linehaul rate provided for a ${input.mileage.miles}-mile, ${weightLbs}-lb shipment`,
        'LINEHAUL_RATE_UNAVAILABLE',
      )
    }
    baseHaulCents = data.linehaulRateCents
    lineItems.push({
      code: 'LINEHAUL',
      description: 'Base linehaul charge',
      basis: `${weightCwt.toFixed(2)} cwt @ mileage/weight band rate`,
      amountCents: data.linehaulRateCents,
    })
  }

  lineItems.push({
    code: 'ORIGIN_LH_FACTOR',
    description: 'Origin linehaul factor',
    basis: `${weightCwt.toFixed(2)} cwt @ $${(data.origin.linehaulFactorCentsPerCwt / 100).toFixed(2)}/cwt`,
    amountCents: roundCents(weightCwt * data.origin.linehaulFactorCentsPerCwt),
  })
  lineItems.push({
    code: 'DEST_LH_FACTOR',
    description: 'Destination linehaul factor',
    basis: `${weightCwt.toFixed(2)} cwt @ $${(data.destination.linehaulFactorCentsPerCwt / 100).toFixed(2)}/cwt`,
    amountCents: roundCents(weightCwt * data.destination.linehaulFactorCentsPerCwt),
  })
  lineItems.push({
    code: 'ORIGIN_SERVICE',
    description: 'Origin service charge',
    basis: `${weightCwt.toFixed(2)} cwt @ $${(data.origin.serviceChargeCentsPerCwt / 100).toFixed(2)}/cwt`,
    amountCents: roundCents(weightCwt * data.origin.serviceChargeCentsPerCwt),
  })
  lineItems.push({
    code: 'DEST_SERVICE',
    description: 'Destination service charge',
    basis: `${weightCwt.toFixed(2)} cwt @ $${(data.destination.serviceChargeCentsPerCwt / 100).toFixed(2)}/cwt`,
    amountCents: roundCents(weightCwt * data.destination.serviceChargeCentsPerCwt),
  })

  if (input.options.fullPack) {
    if (data.origin.packRateCentsPerCwt === undefined) {
      warnings.push(
        'Full pack requested but no pack rate is published for the origin service area — omitted',
      )
    } else {
      lineItems.push({
        code: 'FULL_PACK',
        description: 'Full pack (origin)',
        basis: `${weightCwt.toFixed(2)} cwt @ $${(data.origin.packRateCentsPerCwt / 100).toFixed(2)}/cwt`,
        amountCents: roundCents(weightCwt * data.origin.packRateCentsPerCwt),
      })
    }
  }

  if (input.options.fullUnpack) {
    if (data.destination.unpackRateMillicentsPerCwt === undefined) {
      warnings.push(
        'Full unpack requested but no unpack rate is published for the destination service area — omitted',
      )
    } else {
      lineItems.push({
        code: 'FULL_UNPACK',
        description: 'Full unpack (destination)',
        basis: `${weightCwt.toFixed(2)} cwt @ ${(data.destination.unpackRateMillicentsPerCwt / 1000).toFixed(3)}¢/cwt`,
        amountCents: roundCents((weightCwt * data.destination.unpackRateMillicentsPerCwt) / 1000),
      })
    }
  }

  if (data.fscPercentBps === undefined) {
    warnings.push('Fuel surcharge rate unavailable for the pickup date — omitted from total')
  } else {
    // Applied to the linehaul/shorthaul charge only, per standard DP3
    // convention — NOT re-verified against the current tariff's Appendix A
    // (see calibration-status note at the top of this file).
    lineItems.push({
      code: 'FUEL_SURCHARGE',
      description: 'Fuel surcharge',
      basis: `${(data.fscPercentBps / 100).toFixed(2)}% of linehaul/shorthaul charge`,
      amountCents: fuelSurcharge(baseHaulCents, data.fscPercentBps),
    })
  }

  const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0)

  return {
    lineItems,
    totalCents,
    meta: {
      tariffCode: RATE_400NG,
      season,
      billedWeightLbs: weightLbs,
      mileage: input.mileage,
      warnings,
    },
  }
}
