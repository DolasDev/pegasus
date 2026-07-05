// ---------------------------------------------------------------------------
// ⚠ These fixtures are SYNTHETIC / ILLUSTRATIVE — they exercise the rating
// engine's arithmetic and branching, not the actual published 400NG rates.
// The official tariff PDF (with Appendix A worked examples that should
// become this file's ground truth) could not be fetched programmatically
// during implementation — ustranscom.mil is bot/WAF-gated even for direct
// PDF links (verified: 403/404 from multiple UAs and mirrors). See
// plans/in-progress/rating-engine-400ng.md, "Risks" section.
//
// TODO before shipping a real quote off this engine: download the current
// 400NG tariff PDF in a browser, transcribe its Appendix A worked examples
// here in place of (or alongside) these synthetic cases, and reconcile the
// UNVERIFIED constants in ../tariff400ng.ts (min billable weight, peak
// season window, 800-mile shorthaul threshold, FSC bands, FSC base) against
// it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  rateCycleFor,
  isPeakSeason,
  billedWeight,
  cwt,
  fuelSurcharge,
  fscPercentForDieselPrice,
  rate400ng,
  MIN_BILLABLE_WEIGHT_LBS,
  SHORTHAUL_THRESHOLD_MILES,
  type Tariff400ngData,
} from '../tariff400ng'
import type { RatingInput } from '../index'
import { DomainError } from '../../shared/errors'

function makeInput(overrides: Partial<RatingInput> = {}): RatingInput {
  return {
    weightLbs: 8000,
    originZip: '10001',
    destZip: '90001',
    pickupDate: new Date('2026-03-01T00:00:00.000Z'), // non-peak
    mileage: { miles: 2800, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
    options: { fullPack: false, fullUnpack: false },
    ...overrides,
  }
}

const SYNTHETIC_TARIFF: Tariff400ngData = {
  origin: {
    serviceChargeCentsPerCwt: 850, // $8.50/cwt
    linehaulFactorCentsPerCwt: 210, // $2.10/cwt
    packRateCentsPerCwt: 1200, // $12.00/cwt
  },
  destination: {
    serviceChargeCentsPerCwt: 900, // $9.00/cwt
    linehaulFactorCentsPerCwt: 225, // $2.25/cwt
    unpackRateMillicentsPerCwt: 3500, // $3.50/cwt (3500 millicents)
  },
  linehaulRateCents: 420_000, // $4,200.00 band rate for the matched mileage/weight cell
  shorthaulRateMillicentsPerCwtMile: 950, // 0.95¢/cwt-mile
  fscPercentBps: 1690, // 16.90%
}

describe('rateCycleFor', () => {
  it('returns the current cycle (May 15 - May 14) for a date in the middle of the cycle', () => {
    const { start, end } = rateCycleFor(new Date('2026-03-01T00:00:00.000Z'))
    expect(start.toISOString()).toBe('2025-05-15T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-05-15T00:00:00.000Z')
  })

  it('rolls over to the next cycle exactly on May 15', () => {
    const { start, end } = rateCycleFor(new Date('2026-05-15T00:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-05-15T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-05-15T00:00:00.000Z')
  })

  it('treats May 14 as the last day of the prior cycle', () => {
    const { start, end } = rateCycleFor(new Date('2026-05-14T23:59:59.999Z'))
    expect(start.toISOString()).toBe('2025-05-15T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-05-15T00:00:00.000Z')
  })
})

describe('isPeakSeason', () => {
  it('is true on the peak season start boundary (May 15)', () => {
    expect(isPeakSeason(new Date('2026-05-15T00:00:00.000Z'))).toBe(true)
  })

  it('is true on the peak season end boundary (Sep 30)', () => {
    expect(isPeakSeason(new Date('2026-09-30T23:59:59.999Z'))).toBe(true)
  })

  it('is false the day before peak season starts (May 14)', () => {
    expect(isPeakSeason(new Date('2026-05-14T23:59:59.999Z'))).toBe(false)
  })

  it('is false the day after peak season ends (Oct 1)', () => {
    expect(isPeakSeason(new Date('2026-10-01T00:00:00.000Z'))).toBe(false)
  })

  it('is false in the middle of winter', () => {
    expect(isPeakSeason(new Date('2026-01-15T00:00:00.000Z'))).toBe(false)
  })

  it('is true in the middle of summer', () => {
    expect(isPeakSeason(new Date('2026-07-04T00:00:00.000Z'))).toBe(true)
  })
})

describe('billedWeight', () => {
  it('returns the actual weight when above the minimum', () => {
    expect(billedWeight(8000)).toBe(8000)
  })

  it('floors to MIN_BILLABLE_WEIGHT_LBS when actual weight is lower', () => {
    expect(billedWeight(200)).toBe(MIN_BILLABLE_WEIGHT_LBS)
  })

  it('returns exactly the minimum at the boundary', () => {
    expect(billedWeight(MIN_BILLABLE_WEIGHT_LBS)).toBe(MIN_BILLABLE_WEIGHT_LBS)
  })
})

describe('cwt', () => {
  it('converts pounds to hundredweight', () => {
    expect(cwt(8000)).toBe(80)
  })

  it('keeps fractional precision', () => {
    expect(cwt(8050)).toBeCloseTo(80.5, 5)
  })
})

describe('fscPercentForDieselPrice', () => {
  it('returns 0 bps below the lowest band', () => {
    expect(fscPercentForDieselPrice(200)).toBe(0)
  })

  it('returns the matching band at an exact boundary', () => {
    expect(fscPercentForDieselPrice(300)).toBe(400)
  })

  it('returns the matching band between boundaries', () => {
    expect(fscPercentForDieselPrice(320)).toBe(800)
  })

  it('extrapolates above the top published band instead of capping', () => {
    const topBand = fscPercentForDieselPrice(500)
    const aboveTop = fscPercentForDieselPrice(600)
    expect(aboveTop).toBeGreaterThan(topBand)
  })
})

describe('fuelSurcharge', () => {
  it('applies a basis-point percentage to a cents amount', () => {
    expect(fuelSurcharge(100_000, 1690)).toBe(16_900) // 16.90% of $1000.00
  })

  it('rounds to the nearest cent', () => {
    expect(fuelSurcharge(333, 3333)).toBe(111) // 333 * 0.3333 = 110.9989 -> 111
  })

  it('returns 0 for a 0% surcharge', () => {
    expect(fuelSurcharge(100_000, 0)).toBe(0)
  })
})

describe('rate400ng — linehaul (>= 800 miles)', () => {
  it('produces a LINEHAUL line item using the provided band rate', () => {
    const result = rate400ng(
      makeInput({ mileage: { miles: 2800, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true } }),
      SYNTHETIC_TARIFF,
    )
    const linehaul = result.lineItems.find((li) => li.code === 'LINEHAUL')
    expect(linehaul?.amountCents).toBe(420_000)
    expect(result.lineItems.find((li) => li.code === 'SHORTHAUL')).toBeUndefined()
  })

  it('throws DomainError when no linehaul rate is provided for a >= 800 mile shipment', () => {
    const { linehaulRateCents, ...withoutLinehaul } = SYNTHETIC_TARIFF
    expect(() => rate400ng(makeInput(), withoutLinehaul)).toThrow(DomainError)
  })

  it('includes origin/destination service charges and linehaul factors, cwt-scaled', () => {
    const result = rate400ng(makeInput({ weightLbs: 8000 }), SYNTHETIC_TARIFF) // 80 cwt
    expect(result.lineItems.find((li) => li.code === 'ORIGIN_SERVICE')?.amountCents).toBe(80 * 850)
    expect(result.lineItems.find((li) => li.code === 'DEST_SERVICE')?.amountCents).toBe(80 * 900)
    expect(result.lineItems.find((li) => li.code === 'ORIGIN_LH_FACTOR')?.amountCents).toBe(
      80 * 210,
    )
    expect(result.lineItems.find((li) => li.code === 'DEST_LH_FACTOR')?.amountCents).toBe(80 * 225)
  })

  it('applies the fuel surcharge to the linehaul charge only', () => {
    const result = rate400ng(makeInput(), SYNTHETIC_TARIFF)
    const fsc = result.lineItems.find((li) => li.code === 'FUEL_SURCHARGE')
    expect(fsc?.amountCents).toBe(fuelSurcharge(420_000, 1690))
  })
})

describe('rate400ng — shorthaul (< 800 miles)', () => {
  const shortInput = makeInput({
    mileage: { miles: 400, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
  })

  it('produces a SHORTHAUL line item instead of LINEHAUL', () => {
    const result = rate400ng(shortInput, SYNTHETIC_TARIFF)
    expect(result.lineItems.find((li) => li.code === 'LINEHAUL')).toBeUndefined()
    const shorthaul = result.lineItems.find((li) => li.code === 'SHORTHAUL')
    expect(shorthaul).toBeDefined()
    // 80 cwt * 400 mi * $0.0095/cwt-mi (950 millicents) = $304.00 = 30400 cents
    expect(shorthaul?.amountCents).toBe(30_400)
  })

  it('throws DomainError when no shorthaul rate is provided for a < 800 mile shipment', () => {
    const { shorthaulRateMillicentsPerCwtMile, ...withoutShorthaul } = SYNTHETIC_TARIFF
    expect(() => rate400ng(shortInput, withoutShorthaul)).toThrow(DomainError)
  })

  it('rates exactly at the shorthaul/linehaul boundary as linehaul', () => {
    const boundaryInput = makeInput({
      mileage: {
        miles: SHORTHAUL_THRESHOLD_MILES,
        method: 'ZIP3_CENTROID_HAVERSINE',
        approximate: true,
      },
    })
    const result = rate400ng(boundaryInput, SYNTHETIC_TARIFF)
    expect(result.lineItems.find((li) => li.code === 'LINEHAUL')).toBeDefined()
  })
})

describe('rate400ng — options', () => {
  it('adds a FULL_PACK line item when requested and a rate is available', () => {
    const result = rate400ng(
      makeInput({ options: { fullPack: true, fullUnpack: false } }),
      SYNTHETIC_TARIFF,
    )
    expect(result.lineItems.find((li) => li.code === 'FULL_PACK')?.amountCents).toBe(80 * 1200)
    expect(result.meta.warnings).toHaveLength(0)
  })

  it('adds a FULL_UNPACK line item when requested and a rate is available', () => {
    const result = rate400ng(
      makeInput({ options: { fullPack: false, fullUnpack: true } }),
      SYNTHETIC_TARIFF,
    )
    // 80 cwt * 3500 millicents/cwt / 1000 = 280 cents ($2.80)
    expect(result.lineItems.find((li) => li.code === 'FULL_UNPACK')?.amountCents).toBe(
      Math.round((80 * 3500) / 1000),
    )
    expect(result.meta.warnings).toHaveLength(0)
  })

  it('warns instead of throwing when full pack is requested but unavailable', () => {
    const { packRateCentsPerCwt, ...originWithoutPack } = SYNTHETIC_TARIFF.origin
    const tariffWithoutPack: Tariff400ngData = { ...SYNTHETIC_TARIFF, origin: originWithoutPack }
    const result = rate400ng(
      makeInput({ options: { fullPack: true, fullUnpack: false } }),
      tariffWithoutPack,
    )
    expect(result.lineItems.find((li) => li.code === 'FULL_PACK')).toBeUndefined()
    expect(result.meta.warnings).toContain(
      'Full pack requested but no pack rate is published for the origin service area — omitted',
    )
  })

  it('warns instead of throwing when full unpack is requested but unavailable', () => {
    const { unpackRateMillicentsPerCwt, ...destinationWithoutUnpack } = SYNTHETIC_TARIFF.destination
    const tariffWithoutUnpack: Tariff400ngData = {
      ...SYNTHETIC_TARIFF,
      destination: destinationWithoutUnpack,
    }
    const result = rate400ng(
      makeInput({ options: { fullPack: false, fullUnpack: true } }),
      tariffWithoutUnpack,
    )
    expect(result.lineItems.find((li) => li.code === 'FULL_UNPACK')).toBeUndefined()
    expect(result.meta.warnings).toContain(
      'Full unpack requested but no unpack rate is published for the destination service area — omitted',
    )
  })
})

describe('rate400ng — fuel surcharge availability', () => {
  it('omits the FSC line and warns when no FSC rate is available', () => {
    const { fscPercentBps, ...withoutFsc } = SYNTHETIC_TARIFF
    const result = rate400ng(makeInput(), withoutFsc)
    expect(result.lineItems.find((li) => li.code === 'FUEL_SURCHARGE')).toBeUndefined()
    expect(result.meta.warnings).toContain(
      'Fuel surcharge rate unavailable for the pickup date — omitted from total',
    )
  })
})

describe('rate400ng — weight floor', () => {
  it('bills at the minimum weight for a very light shipment', () => {
    const result = rate400ng(makeInput({ weightLbs: 100 }), SYNTHETIC_TARIFF)
    expect(result.meta.billedWeightLbs).toBe(MIN_BILLABLE_WEIGHT_LBS)
  })
})

describe('rate400ng — season metadata', () => {
  it('reports PEAK for a pickup date in peak season', () => {
    const result = rate400ng(
      makeInput({ pickupDate: new Date('2026-07-04T00:00:00.000Z') }),
      SYNTHETIC_TARIFF,
    )
    expect(result.meta.season).toBe('PEAK')
  })

  it('reports NONPEAK for a pickup date outside peak season', () => {
    const result = rate400ng(
      makeInput({ pickupDate: new Date('2026-01-15T00:00:00.000Z') }),
      SYNTHETIC_TARIFF,
    )
    expect(result.meta.season).toBe('NONPEAK')
  })
})

describe('rate400ng — total', () => {
  it('sums all line items into totalCents', () => {
    const result = rate400ng(makeInput(), SYNTHETIC_TARIFF)
    const sum = result.lineItems.reduce((acc, li) => acc + li.amountCents, 0)
    expect(result.totalCents).toBe(sum)
  })

  it('carries the mileage estimate through to meta', () => {
    const mileage = {
      miles: 2800,
      method: 'ZIP3_CENTROID_HAVERSINE' as const,
      approximate: true as const,
    }
    const result = rate400ng(makeInput({ mileage }), SYNTHETIC_TARIFF)
    expect(result.meta.mileage).toEqual(mileage)
  })
})
