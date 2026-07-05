// ---------------------------------------------------------------------------
// Rating bounded context
//
// Rates a shipment against a published tariff (military 400NG to start;
// van-line tariffs such as Atlas/Allied/United are proprietary and out of
// scope for now — see tariff400ng.ts for why 400NG was chosen first).
//
// A tariff rater is a pure function of (RatingInput, <tariff-specific data>)
// -> RatingResult. This file holds only the tariff-agnostic shapes; each
// tariff gets its own sibling module (e.g. tariff400ng.ts) with its own data
// shape and rating function — there is deliberately no shared "Tariff"
// interface beyond these, since 400NG's weight/mileage-band model and a
// van-line's weight×distance-matrix-with-discount model don't share enough
// structure to be worth forcing into one.
// ---------------------------------------------------------------------------

import type { Brand } from '../shared/types'
import type { MileageEstimate } from './mileage'

// ---------------------------------------------------------------------------
// Branded ID / code types
// ---------------------------------------------------------------------------

/** Identifies which published tariff to rate against, e.g. '400NG'. */
export type TariffCode = Brand<string, 'TariffCode'>

/** Identifies a specific imported, dated release of a tariff's rate data. */
export type TariffVersionId = Brand<string, 'TariffVersionId'>

export const toTariffCode = (raw: string): TariffCode => raw as TariffCode
export const toTariffVersionId = (raw: string): TariffVersionId => raw as TariffVersionId

// ---------------------------------------------------------------------------
// Rating request / result shapes
// ---------------------------------------------------------------------------

/**
 * What the caller wants rated. Mileage is supplied by the caller (via a
 * `MileageEstimator`, e.g. `createZip3CentroidEstimator`) rather than looked
 * up inside the rater — keeps the rating functions pure and lets the
 * mileage source be swapped (e.g. for an official DTOD lookup) without
 * touching tariff logic.
 */
export interface RatingInput {
  readonly weightLbs: number
  readonly originZip: string
  readonly destZip: string
  readonly pickupDate: Date
  readonly mileage: MileageEstimate
  readonly options: {
    readonly fullPack: boolean
    readonly fullUnpack: boolean
  }
}

/**
 * One priced charge in a rating breakdown.
 *
 * @invariant `amountCents` must be an integer (no fractional cents) — all
 *            internal rating math is done in integer cents/millicents
 *            specifically to avoid float drift; only the API boundary
 *            converts to the dollar-denominated `Money` type.
 */
export interface RatedLineItem {
  readonly code: string
  readonly description: string
  /** Human-readable basis for the charge, e.g. "52.5 cwt @ $6.55/cwt". */
  readonly basis: string
  readonly amountCents: number
}

export type TariffSeason = 'PEAK' | 'NONPEAK'

/** The full priced result of rating a shipment against one tariff version. */
export interface RatingResult {
  readonly lineItems: readonly RatedLineItem[]
  readonly totalCents: number
  readonly meta: {
    readonly tariffCode: TariffCode
    readonly season: TariffSeason
    readonly billedWeightLbs: number
    readonly mileage: MileageEstimate
    /** Non-fatal issues, e.g. "FSC rate unavailable — omitted from total". */
    readonly warnings: readonly string[]
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { MileageEstimate, MileageEstimator } from './mileage'
export { createZip3CentroidEstimator, haversineMiles } from './mileage'

export type { Tariff400ngData, ServiceAreaRates } from './tariff400ng'
export {
  RATE_400NG,
  rateCycleFor,
  isPeakSeason,
  billedWeight,
  cwt,
  fuelSurcharge,
  fscPercentForDieselPrice,
  rate400ng,
} from './tariff400ng'
