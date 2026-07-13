// ---------------------------------------------------------------------------
// Fixtures below are REAL numbers from the 2026 400NG tariff (effective 15
// May 2026), extracted directly from the official tariff PDF's Appendix A
// ("Costing a Domestic Shipment") and the companion 2026 400NG Baseline
// Rates spreadsheet (Base Point City / Geographical Schedule / Linehaul /
// Additional Rates tabs):
//
//  - Origin ZIP3 173 -> Service Area 672 "Philadelphia, PA", Schedule 3,
//    Linehaul Factor $2.88/cwt, 135A Service Charge $12.09/cwt.
//  - Destination ZIP3 796 -> Service Area 736 "Abilene, TX", Schedule 1,
//    Linehaul Factor $1.71/cwt, 135B Service Charge $7.47/cwt.
//  - Linehaul ("Section 3") cell at 351-400 miles, 8000-8199 lbs: $10,637.
//  - Linehaul cell at 1401-1500 miles, 8000-8199 lbs: $17,475.
//  - Shorthaul ("Item 999") band 16,001-32,000 cwt-miles: $397.02 flat.
//  - Full Pack ("Item 105A"), Schedule 3, <= 16,000 lbs: $91.33/cwt.
//  - Full Unpack ("Item 105A"), Schedule 1 (flat, any weight): $7.91595/cwt.
//
// Expected totals were independently hand/Python-computed from these same
// published numbers (see the session that authored this file), not derived
// by running the code under test.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  rateCycleFor,
  billedWeight,
  cwt,
  invdLHS,
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
    originZip: '17325', // ZIP3 173 -> SA 672, Philadelphia PA
    destZip: '79601', // ZIP3 796 -> SA 736, Abilene TX
    pickupDate: new Date('2026-08-01T00:00:00.000Z'),
    mileage: { miles: 1500, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
    options: { fullPack: false, fullUnpack: false },
    ...overrides,
  }
}

/** Real 2026 rates for SA 672 (origin) / SA 736 (dest), no pack/unpack/FSC. */
const BASE_TARIFF: Tariff400ngData = {
  origin: { serviceChargeCentsPerCwt: 1209, linehaulFactorCentsPerCwt: 288 },
  destination: { serviceChargeCentsPerCwt: 747, linehaulFactorCentsPerCwt: 171 },
  linehaulRateCents: 1_747_500, // $17,475.00 — mileage band 1401-1500, weight band 8000-8199
}

/** Same SAs, with the shorthaul band, full pack (Schedule 3), and full unpack (Schedule 1) added. */
const FULL_TARIFF: Tariff400ngData = {
  origin: {
    serviceChargeCentsPerCwt: 1209,
    linehaulFactorCentsPerCwt: 288,
    packRateCentsPerCwt: 9133, // $91.33/cwt, Schedule 3, <= 16,000 lbs
  },
  destination: {
    serviceChargeCentsPerCwt: 747,
    linehaulFactorCentsPerCwt: 171,
    unpackRateMillicentsPerCwt: 791_595, // $7.91595/cwt, Schedule 1, flat
  },
  linehaulRateCents: 1_063_700, // $10,637.00 — mileage band 351-400, weight band 8000-8199
  shorthaulRateCents: 39_702, // $397.02 — cwt-miles band 16,001-32,000
  fscPercentBps: 500, // 5% (diesel $4.15/gal: (415-350)/13 = 5 exactly)
}

describe('rateCycleFor', () => {
  it('returns the current cycle (May 15 - May 14) for a date in the middle of the cycle', () => {
    const { start, end } = rateCycleFor(new Date('2026-08-01T00:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-05-15T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-05-15T00:00:00.000Z')
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

describe('billedWeight', () => {
  it('returns the actual weight when above the minimum', () => {
    expect(billedWeight(8000)).toBe(8000)
  })

  it('floors to 1,000 lbs (Item 25) when actual weight is lower', () => {
    expect(billedWeight(200)).toBe(MIN_BILLABLE_WEIGHT_LBS)
    expect(MIN_BILLABLE_WEIGHT_LBS).toBe(1000)
  })

  it('returns exactly the minimum at the boundary', () => {
    expect(billedWeight(1000)).toBe(1000)
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

describe('invdLHS', () => {
  it('returns 1.0 (no discount) when omitted', () => {
    expect(invdLHS()).toBe(1)
  })

  it('returns 1.0 for an explicit 0% discount', () => {
    expect(invdLHS(0)).toBe(1)
  })

  it('matches the tariff worked-example inverse for a 57% discount', () => {
    expect(invdLHS(57)).toBeCloseTo(0.43, 10)
  })

  it('returns 0 for a 100% discount', () => {
    expect(invdLHS(100)).toBe(0)
  })
})

describe('fscPercentForDieselPrice', () => {
  it('returns 0 at or below the $3.50 baseline', () => {
    expect(fscPercentForDieselPrice(350)).toBe(0)
    expect(fscPercentForDieselPrice(300)).toBe(0)
  })

  it('returns 1% for exactly one $0.13 step above baseline', () => {
    expect(fscPercentForDieselPrice(363)).toBe(100)
  })

  it('floor-divides partial steps', () => {
    // (375 - 350) / 13 = 1.92 -> floor 1 -> 1%
    expect(fscPercentForDieselPrice(375)).toBe(100)
  })

  it('matches the tariff’s own worked example: $5.15/gal -> 12%', () => {
    expect(fscPercentForDieselPrice(515)).toBe(1200)
  })
})

describe('fuelSurcharge', () => {
  it('applies a basis-point percentage to a cents amount', () => {
    expect(fuelSurcharge(100_000, 1200)).toBe(12_000) // 12% of $1000.00
  })

  it('returns 0 for a 0% surcharge', () => {
    expect(fuelSurcharge(100_000, 0)).toBe(0)
  })
})

describe('rate400ng — linehaul (BLHS always applies)', () => {
  it('produces a single LINEHAUL line item = (BLHS + OLF + DLF) with no discount, > 800 miles', () => {
    const result = rate400ng(makeInput(), BASE_TARIFF)
    const linehaul = result.lineItems.find((li) => li.code === 'LINEHAUL')
    // BLHS 1,747,500 + OLF round(80*288)=23,040 + DLF round(80*171)=13,680 = 1,784,220
    expect(linehaul?.amountCents).toBe(1_784_220)
  })

  it('adds SH on top of BLHS (not instead of) for shipments <= 800 miles', () => {
    const shortInput = makeInput({
      mileage: { miles: 375, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
    })
    const result = rate400ng(shortInput, FULL_TARIFF)
    const linehaul = result.lineItems.find((li) => li.code === 'LINEHAUL')
    // BLHS 1,063,700 + OLF 23,040 + DLF 13,680 + SH 39,702 = 1,140,122
    expect(linehaul?.amountCents).toBe(1_140_122)
  })

  it('is SH-eligible exactly at the 800-mile boundary (inclusive)', () => {
    const boundaryInput = makeInput({
      mileage: {
        miles: SHORTHAUL_THRESHOLD_MILES,
        method: 'ZIP3_CENTROID_HAVERSINE',
        approximate: true,
      },
    })
    // FULL_TARIFF provides a shorthaulRateCents; if 800mi were treated as
    // "long haul" this would ignore it and still succeed, so assert the SH
    // amount is actually included in the total instead.
    const result = rate400ng(boundaryInput, FULL_TARIFF)
    const linehaul = result.lineItems.find((li) => li.code === 'LINEHAUL')
    expect(linehaul?.amountCents).toBe(1_140_122)
  })

  it('is NOT SH-eligible at 801 miles', () => {
    const justOverInput = makeInput({
      mileage: { miles: 801, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
    })
    const { shorthaulRateCents, ...withoutShorthaul } = FULL_TARIFF
    // Should not throw even though shorthaulRateCents is absent, because SH doesn't apply.
    expect(() => rate400ng(justOverInput, withoutShorthaul)).not.toThrow()
  })

  it('throws DomainError when a shipment is SH-eligible but no shorthaul rate is provided', () => {
    const shortInput = makeInput({
      mileage: { miles: 375, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
    })
    const { shorthaulRateCents, ...withoutShorthaul } = FULL_TARIFF
    expect(() => rate400ng(shortInput, withoutShorthaul)).toThrow(DomainError)
  })
})

describe('rate400ng — origin/destination service charges (135A/135B)', () => {
  it('computes 135A and 135B using each service area’s own rate, undiscounted', () => {
    const result = rate400ng(makeInput(), BASE_TARIFF) // 80 cwt
    expect(result.lineItems.find((li) => li.code === 'ORIGIN_SERVICE')?.amountCents).toBe(
      Math.round(80 * 1209),
    )
    expect(result.lineItems.find((li) => li.code === 'DEST_SERVICE')?.amountCents).toBe(
      Math.round(80 * 747),
    )
  })
})

describe('rate400ng — TSP linehaul discount (InvdLHS)', () => {
  it('applies no discount by default', () => {
    const result = rate400ng(
      makeInput({ mileage: { miles: 375, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true } }),
      FULL_TARIFF,
    )
    expect(result.lineItems.find((li) => li.code === 'LINEHAUL')?.amountCents).toBe(1_140_122)
    // LINEHAUL 1,140,122 + ORIGIN_SERVICE 96,720 + DEST_SERVICE 59,760 + FSC (5% of LINEHAUL) 57,006
    // — no pack/unpack, since makeInput() defaults both options to false.
    expect(result.totalCents).toBe(1_353_608)
  })

  it('matches the full hand-computed total for a 57% TSP discount', () => {
    const shortInput = makeInput({
      mileage: { miles: 375, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true },
      linehaulDiscountPercent: 57,
      options: { fullPack: true, fullUnpack: true },
    })
    const result = rate400ng(shortInput, FULL_TARIFF)
    expect(result.lineItems.find((li) => li.code === 'LINEHAUL')?.amountCents).toBe(490_252)
    expect(result.lineItems.find((li) => li.code === 'ORIGIN_SERVICE')?.amountCents).toBe(41_590)
    expect(result.lineItems.find((li) => li.code === 'DEST_SERVICE')?.amountCents).toBe(25_697)
    expect(result.lineItems.find((li) => li.code === 'FULL_PACK')?.amountCents).toBe(314_175)
    expect(result.lineItems.find((li) => li.code === 'FULL_UNPACK')?.amountCents).toBe(27_231)
    expect(result.lineItems.find((li) => li.code === 'FUEL_SURCHARGE')?.amountCents).toBe(24_513)
    expect(result.totalCents).toBe(923_458)
  })
})

describe('rate400ng — full pack/unpack (Item 105A)', () => {
  it('adds FULL_PACK using the origin Schedule + weight-bracket rate when requested', () => {
    const result = rate400ng(
      makeInput({ options: { fullPack: true, fullUnpack: false } }),
      FULL_TARIFF,
    )
    expect(result.lineItems.find((li) => li.code === 'FULL_PACK')?.amountCents).toBe(
      Math.round(80 * 9133),
    )
    expect(result.meta.warnings).toHaveLength(0)
  })

  it('adds FULL_UNPACK using the destination Schedule’s flat rate when requested', () => {
    const result = rate400ng(
      makeInput({ options: { fullPack: false, fullUnpack: true } }),
      FULL_TARIFF,
    )
    // 80 cwt * 791595 millicents/cwt / 1000 = 63,327.6 -> 63,328 cents
    expect(result.lineItems.find((li) => li.code === 'FULL_UNPACK')?.amountCents).toBe(63_328)
    expect(result.meta.warnings).toHaveLength(0)
  })

  it('warns instead of throwing when full pack is requested but unavailable', () => {
    const result = rate400ng(
      makeInput({ options: { fullPack: true, fullUnpack: false } }),
      BASE_TARIFF,
    )
    expect(result.lineItems.find((li) => li.code === 'FULL_PACK')).toBeUndefined()
    expect(result.meta.warnings).toContain(
      'Full pack requested but no pack rate is published for the origin service schedule/weight bracket — omitted',
    )
  })

  it('warns instead of throwing when full unpack is requested but unavailable', () => {
    const result = rate400ng(
      makeInput({ options: { fullPack: false, fullUnpack: true } }),
      BASE_TARIFF,
    )
    expect(result.lineItems.find((li) => li.code === 'FULL_UNPACK')).toBeUndefined()
    expect(result.meta.warnings).toContain(
      'Full unpack requested but no unpack rate is published for the destination service schedule — omitted',
    )
  })
})

describe('rate400ng — fuel surcharge (Item 16A)', () => {
  it('applies FSC to the already-discounted linehaul charge', () => {
    const result = rate400ng(
      makeInput({ mileage: { miles: 375, method: 'ZIP3_CENTROID_HAVERSINE', approximate: true } }),
      FULL_TARIFF,
    )
    const linehaul = result.lineItems.find((li) => li.code === 'LINEHAUL')!.amountCents
    const fsc = result.lineItems.find((li) => li.code === 'FUEL_SURCHARGE')
    expect(fsc?.amountCents).toBe(Math.round((linehaul * 500) / 10_000))
  })

  it('omits the FSC line and warns when no FSC rate is available', () => {
    const result = rate400ng(makeInput(), BASE_TARIFF)
    expect(result.lineItems.find((li) => li.code === 'FUEL_SURCHARGE')).toBeUndefined()
    expect(result.meta.warnings).toContain(
      'Fuel surcharge rate unavailable for the pickup date — omitted from total',
    )
  })
})

describe('rate400ng — weight floor', () => {
  it('bills at 1,000 lbs minimum for a very light shipment', () => {
    const result = rate400ng(makeInput({ weightLbs: 100 }), BASE_TARIFF)
    expect(result.meta.billedWeightLbs).toBe(1000)
  })
})

describe('rate400ng — total', () => {
  it('sums all line items into totalCents', () => {
    const result = rate400ng(makeInput(), BASE_TARIFF)
    const sum = result.lineItems.reduce((acc, li) => acc + li.amountCents, 0)
    expect(result.totalCents).toBe(sum)
  })

  it('carries the mileage estimate through to meta', () => {
    const mileage = {
      miles: 1500,
      method: 'ZIP3_CENTROID_HAVERSINE' as const,
      approximate: true as const,
    }
    const result = rate400ng(makeInput({ mileage }), BASE_TARIFF)
    expect(result.meta.mileage).toEqual(mileage)
  })
})
