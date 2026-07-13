// ---------------------------------------------------------------------------
// 400NG tariff — Defense Personal Property Program (DP3) domestic household
// goods tariff, published annually by USTRANSCOM.
//
// Chosen as the first tariff because it is the only one of the four the
// user asked about (400NG, Atlas, Allied, United) that is publicly
// published: USTRANSCOM releases the tariff PDF plus a companion "400NG
// Baseline Rates" spreadsheet every year (see
// plans/in-progress/rating-engine-400ng.md for the import pipeline). The
// van-line tariffs are proprietary — Atlas gates its tariff behind an
// access request, United's UVL1 is review-only, Allied publishes only a
// rules PDF with no rate tables — so there is nothing to rate against or
// auto-update for them today.
//
// CALIBRATION STATUS: verified against the actual 2026 400NG tariff PDF
// (Appendix A: "Costing a Domestic Shipment") and the companion 2026 400NG
// Baseline Rates spreadsheet (Base Point City / Geographical Schedule /
// Linehaul / Additional Rates tabs). Key facts confirmed directly from
// those sources, several of which corrected an earlier unverified draft:
//
//  - Minimum billing weight is 1,000 lbs (Item 25), not 500.
//  - The base linehaul charge (BLHS) ALWAYS applies, looked up from the
//    mileage x weight band matrix ("Linehaul" tab, Section 3) regardless of
//    distance. Shorthaul (SH) is an ADDITIONAL charge added on top — not an
//    alternative — only when total mileage is 800 miles or less (Item 4,
//    Appendix A section B). SH is itself a banded flat-dollar lookup keyed
//    by cwt-miles (weight-in-cwt x total miles), not a per-unit rate
//    ("Additional Rates" tab, Item 999).
//  - A TSP-specific negotiated linehaul discount (InvdLHS = 1 - dLHS) is
//    applied to the combined linehaul charge (BLHS+OLF+DLF+SH), and
//    separately to the origin/destination service charges (135A/135B) and
//    full pack/unpack (105A) — see Appendix A formulas. This discount is
//    won per-TSP through a separate bid/rate-filing process and is NOT
//    published in the tariff itself, so it is modeled here as an optional
//    caller-supplied input (`RatingInput.linehaulDiscountPercent`),
//    defaulting to 0 (i.e. the published baseline, undiscounted amount).
//  - Fuel surcharge (Item 16, "FRA") is a simple LINEAR formula, not a
//    banded table: 1% of the (already-discounted) linehaul charge for
//    every $0.13 the EIA national average diesel price exceeds a $3.50
//    baseline, floor-divided. Verified against the tariff's own worked
//    example ($5.15/gal -> 12%) and the Baseline Rates spreadsheet's Item
//    16 row, which states the same $3.50 threshold and 1%-per-13-cent step.
//  - Full pack is banded by (Service Schedule 1-4) x weight bracket, in
//    $/cwt. Full unpack is a FLAT $/cwt rate per Service Schedule,
//    regardless of weight. Both are keyed by Service Schedule, not
//    directly by Service Area (a Service Area is assigned exactly one
//    Service Schedule via the "Geographical Schedule" tab) — resolving
//    which schedule/weight-band row applies is the repository's job (see
//    tariff.repository.ts); this module only consumes the already-resolved
//    numbers.
//  - Origin/destination linehaul factors (OLF/DLF) and origin/destination
//    service charges (135A/135B) are genuinely a single per-Service-Area
//    rate, applied identically whether that Service Area is playing the
//    origin or destination role — confirmed by the "Geographical Schedule"
//    tab having exactly one "Linehaul Factor" and one "135A & B" column per
//    Service Area, not separate origin/destination columns.
//  - Peak season (May 15 - Sep 30, Item 19.c) is a real tariff concept, but
//    it does NOT bifurcate any of the rate tables this module models — the
//    2026 Baseline Rates spreadsheet's only "Peak and NonPeak" split is on
//    the Alaska Waterhaul accessorial (Section 6), which is out of scope
//    (this slice is CONUS-domestic only). An earlier draft of this module
//    incorrectly modeled a peak/non-peak split across every rate table;
//    that has been removed rather than left as unused dead weight.
//
// Out of scope for this slice (confirmed present in the tariff but not
// modeled here): SIT (Storage-in-Transit) and its own discount (dSIT),
// crating/uncrating, Alaska/waterhaul shipments, accessorial services
// beyond full pack/unpack, and Volume Move / One-Time-Only bid rates.
// ---------------------------------------------------------------------------

import { DomainError } from '../shared/errors'
// Type-only import: index.ts re-exports this module, so a runtime (value)
// import back from here would be circular. `TariffCode`/etc. are erased at
// compile time, so this stays safe.
import type { RatingInput, RatingResult, RatedLineItem, TariffCode } from './index'

export const RATE_400NG: TariffCode = '400NG' as TariffCode

// ---------------------------------------------------------------------------
// Constants — verified against the 2026 400NG tariff PDF (Items 16, 25;
// Appendix A) and the 2026 400NG Baseline Rates spreadsheet. The fuel
// surcharge baseline/step ($3.50, $0.13, 1%) is republished with each
// tariff cycle, so it belongs here as the single source of truth for now;
// a future PR may make it version-scoped like the rest of the rate data.
// ---------------------------------------------------------------------------

/** Minimum weight (lbs) a shipment is billed at, regardless of actual weight (Item 25). */
export const MIN_BILLABLE_WEIGHT_LBS = 1000

/** Shipments moving this many miles or less also get an additional Shorthaul (SH) charge (Item 4). */
export const SHORTHAUL_THRESHOLD_MILES = 800

/** National average diesel price ($/gal, in cents) above which a fuel surcharge accrues (Item 16). */
export const FSC_BASELINE_CENTS_PER_GALLON = 350

/** Diesel-price increment (cents/gal) per 1% surcharge step (Item 16). */
export const FSC_STEP_CENTS_PER_GALLON = 13

/** Surcharge accrued per $FSC_STEP_CENTS_PER_GALLON increment, in basis points (1% = 100 bps). */
export const FSC_PERCENT_BPS_PER_STEP = 100

// ---------------------------------------------------------------------------
// Tariff data shape (assembled by the API layer from the matching rows in
// the active TariffVersion, then passed in — see tariff.repository.ts)
// ---------------------------------------------------------------------------

export interface ServiceAreaRates {
  readonly serviceChargeCentsPerCwt: number
  readonly linehaulFactorCentsPerCwt: number
  /** Full-pack rate for this area's Service Schedule and the shipment's weight bracket, if published. */
  readonly packRateCentsPerCwt?: number
  /** Full-unpack rate for this area's Service Schedule (flat, regardless of weight), in millicents/cwt. */
  readonly unpackRateMillicentsPerCwt?: number
}

export interface Tariff400ngData {
  readonly origin: ServiceAreaRates
  readonly destination: ServiceAreaRates
  /** Matched mileage-band x weight-band cell (BLHS). Always required — the base linehaul charge always applies. */
  readonly linehaulRateCents: number
  /** Matched cwt-miles band flat amount (SH). Required only when mileage <= SHORTHAUL_THRESHOLD_MILES. */
  readonly shorthaulRateCents?: number
  /** Fuel surcharge, basis points. Undefined -> FSC line omitted, warning added. */
  readonly fscPercentBps?: number
}

// ---------------------------------------------------------------------------
// Pure calculation helpers
// ---------------------------------------------------------------------------

/** The 400NG rate cycle containing `date`: runs May 15 -> May 14 the following year. */
export function rateCycleFor(date: Date): { readonly start: Date; readonly end: Date } {
  const CYCLE_START = { month: 5, day: 15 }
  const year = date.getUTCFullYear()
  const cycleStartThisYear = Date.UTC(year, CYCLE_START.month - 1, CYCLE_START.day)
  const inCurrentCycle = date.getTime() >= cycleStartThisYear
  const startYear = inCurrentCycle ? year : year - 1
  const start = new Date(Date.UTC(startYear, CYCLE_START.month - 1, CYCLE_START.day))
  // End is May 14 the following year, end-of-day.
  const end = new Date(Date.UTC(startYear + 1, CYCLE_START.month - 1, CYCLE_START.day))
  return { start, end }
}

/** Applies the minimum-billable-weight floor (Item 25). */
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

/**
 * The TSP-specific linehaul discount inverse (InvdLHS = 1 - dLHS), applied
 * to the combined linehaul charge, service charges, and full pack/unpack.
 * `discountPercent` is 0-100; omit (or pass 0) to get the published
 * baseline/undiscounted amount — this discount is won per-TSP through a
 * separate bid/rate-filing process, not published in the tariff itself.
 */
export function invdLHS(discountPercent = 0): number {
  return 1 - discountPercent / 100
}

/**
 * Looks up the fuel surcharge percentage (basis points) for a given
 * national average diesel price (Item 16): 1% for every $0.13 the price
 * exceeds the $3.50 baseline, floor-divided. E.g. $5.15/gal -> 12% (the
 * tariff's own worked example).
 */
export function fscPercentForDieselPrice(priceCentsPerGallon: number): number {
  if (priceCentsPerGallon <= FSC_BASELINE_CENTS_PER_GALLON) return 0
  const steps = Math.floor(
    (priceCentsPerGallon - FSC_BASELINE_CENTS_PER_GALLON) / FSC_STEP_CENTS_PER_GALLON,
  )
  return steps * FSC_PERCENT_BPS_PER_STEP
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
 * `data` must already reflect the correct active TariffVersion for
 * `input.pickupDate` — resolving *which* TariffVersion applies, and which
 * Service Area/Schedule rows match the shipment's ZIP3s and weight, is the
 * API layer's job (see repositories/tariff.repository.ts); this function
 * only does the arithmetic once the right rates are in hand.
 *
 * @throws {DomainError} if the mileage requires a shorthaul rate that
 *         `data` doesn't provide — this indicates the caller matched the
 *         wrong band or an incomplete tariff version, not a normal
 *         end-user input error (those are rejected before this is called).
 */
export function rate400ng(input: RatingInput, data: Tariff400ngData): RatingResult {
  const weightLbs = billedWeight(input.weightLbs)
  const weightCwt = cwt(weightLbs)
  const discount = invdLHS(input.linehaulDiscountPercent)
  const warnings: string[] = []
  const lineItems: RatedLineItem[] = []

  // ---- Linehaul charge: LHS = (BLHS + OLF + DLF + SH) x InvdLHS ----------
  const isShorthaulEligible = input.mileage.miles <= SHORTHAUL_THRESHOLD_MILES
  let shorthaulCents = 0
  if (isShorthaulEligible) {
    if (data.shorthaulRateCents === undefined) {
      throw new DomainError(
        `No shorthaul rate provided for a ${input.mileage.miles}-mile shipment`,
        'SHORTHAUL_RATE_UNAVAILABLE',
      )
    }
    shorthaulCents = data.shorthaulRateCents
  }

  const linehaulSubtotalCents =
    data.linehaulRateCents +
    roundCents(weightCwt * data.origin.linehaulFactorCentsPerCwt) +
    roundCents(weightCwt * data.destination.linehaulFactorCentsPerCwt) +
    shorthaulCents
  const linehaulCents = roundCents(linehaulSubtotalCents * discount)

  const shBasis = isShorthaulEligible
    ? ` + SH $${(shorthaulCents / 100).toFixed(2)} (<= ${SHORTHAUL_THRESHOLD_MILES} mi)`
    : ''
  lineItems.push({
    code: 'LINEHAUL',
    description: 'Linehaul charge (BLHS + OLF + DLF' + (isShorthaulEligible ? ' + SH' : '') + ')',
    basis:
      `BLHS $${(data.linehaulRateCents / 100).toFixed(2)}` +
      ` + OLF $${((weightCwt * data.origin.linehaulFactorCentsPerCwt) / 100).toFixed(2)}` +
      ` + DLF $${((weightCwt * data.destination.linehaulFactorCentsPerCwt) / 100).toFixed(2)}` +
      shBasis +
      ` @ ${(discount * 100).toFixed(2)}% InvdLHS`,
    amountCents: linehaulCents,
  })

  // ---- Origin/destination service charges (Items 135A/135B) -------------
  lineItems.push({
    code: 'ORIGIN_SERVICE',
    description: 'Origin service charge (135A)',
    basis: `${weightCwt.toFixed(2)} cwt @ $${(data.origin.serviceChargeCentsPerCwt / 100).toFixed(2)}/cwt @ ${(discount * 100).toFixed(2)}% InvdLHS`,
    amountCents: roundCents(weightCwt * data.origin.serviceChargeCentsPerCwt * discount),
  })
  lineItems.push({
    code: 'DEST_SERVICE',
    description: 'Destination service charge (135B)',
    basis: `${weightCwt.toFixed(2)} cwt @ $${(data.destination.serviceChargeCentsPerCwt / 100).toFixed(2)}/cwt @ ${(discount * 100).toFixed(2)}% InvdLHS`,
    amountCents: roundCents(weightCwt * data.destination.serviceChargeCentsPerCwt * discount),
  })

  // ---- Full pack / unpack (Item 105A) ------------------------------------
  if (input.options.fullPack) {
    if (data.origin.packRateCentsPerCwt === undefined) {
      warnings.push(
        'Full pack requested but no pack rate is published for the origin service schedule/weight bracket — omitted',
      )
    } else {
      lineItems.push({
        code: 'FULL_PACK',
        description: 'Full pack (origin, 105A)',
        basis: `${weightCwt.toFixed(2)} cwt @ $${(data.origin.packRateCentsPerCwt / 100).toFixed(2)}/cwt @ ${(discount * 100).toFixed(2)}% InvdLHS`,
        amountCents: roundCents(weightCwt * data.origin.packRateCentsPerCwt * discount),
      })
    }
  }

  if (input.options.fullUnpack) {
    if (data.destination.unpackRateMillicentsPerCwt === undefined) {
      warnings.push(
        'Full unpack requested but no unpack rate is published for the destination service schedule — omitted',
      )
    } else {
      lineItems.push({
        code: 'FULL_UNPACK',
        description: 'Full unpack (destination, 105A)',
        basis: `${weightCwt.toFixed(2)} cwt @ ${(data.destination.unpackRateMillicentsPerCwt / 1000).toFixed(3)}¢/cwt @ ${(discount * 100).toFixed(2)}% InvdLHS`,
        amountCents: roundCents(
          ((weightCwt * data.destination.unpackRateMillicentsPerCwt) / 1000) * discount,
        ),
      })
    }
  }

  // ---- Fuel surcharge (Item 16A) — applied to the discounted linehaul ----
  if (data.fscPercentBps === undefined) {
    warnings.push('Fuel surcharge rate unavailable for the pickup date — omitted from total')
  } else {
    lineItems.push({
      code: 'FUEL_SURCHARGE',
      description: 'Fuel surcharge (16A)',
      basis: `${(data.fscPercentBps / 100).toFixed(2)}% of linehaul charge`,
      amountCents: fuelSurcharge(linehaulCents, data.fscPercentBps),
    })
  }

  const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0)

  return {
    lineItems,
    totalCents,
    meta: {
      tariffCode: RATE_400NG,
      billedWeightLbs: weightLbs,
      mileage: input.mileage,
      warnings,
    },
  }
}
