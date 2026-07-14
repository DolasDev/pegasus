import { describe, it, expect, vi } from 'vitest'
import {
  normalizeZip,
  buildRatePayload,
  rateTripShipments,
  tripRateTotal,
  uncableLabel,
  type RateShipmentInput,
  type RatePayload,
} from './rate-shipment'

describe('normalizeZip', () => {
  it('passes a clean 5-digit zip through', () => {
    expect(normalizeZip('90210')).toBe('90210')
  })

  it('takes the first 5 digits of a ZIP+4 (hyphenated or not)', () => {
    expect(normalizeZip('07016-1234')).toBe('07016')
    expect(normalizeZip('070161234')).toBe('07016')
  })

  it('left-pads a 4-digit numeric zip (leading zero stripped in legacy storage)', () => {
    expect(normalizeZip(7016)).toBe('07016')
    expect(normalizeZip('7016')).toBe('07016')
  })

  it('rejects empty, null, or too-short values', () => {
    expect(normalizeZip(null)).toBeNull()
    expect(normalizeZip('')).toBeNull()
    expect(normalizeZip('ABC')).toBeNull()
    expect(normalizeZip('12')).toBeNull()
  })
})

describe('buildRatePayload', () => {
  const good: RateShipmentInput = {
    order_num: 1,
    total_est_wt: 5200,
    shipper_zip: '30301',
    consignee_zip: '20001',
    plan_load: '2026-08-01',
  }

  it('builds a payload from a complete shipment', () => {
    const r = buildRatePayload(good)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload).toEqual<RatePayload>({
        weightLbs: 5200,
        originZip: '30301',
        destZip: '20001',
        pickupDate: new Date('2026-08-01').toISOString(),
      })
    }
  })

  it('falls back through the date fields in order', () => {
    const r = buildRatePayload({
      ...good,
      plan_load: null,
      plan_pack: null,
      load_date2: '2026-09-09',
    })
    expect(r.ok && r.payload.pickupDate).toBe(new Date('2026-09-09').toISOString())
  })

  it('flags missing/zero weight first', () => {
    expect(buildRatePayload({ ...good, total_est_wt: 0 })).toEqual({
      ok: false,
      reason: 'no-weight',
    })
    expect(buildRatePayload({ ...good, total_est_wt: null })).toEqual({
      ok: false,
      reason: 'no-weight',
    })
  })

  it('flags a bad origin zip', () => {
    expect(buildRatePayload({ ...good, shipper_zip: null })).toEqual({
      ok: false,
      reason: 'bad-origin-zip',
    })
  })

  it('flags a bad destination zip', () => {
    expect(buildRatePayload({ ...good, consignee_zip: 'N/A' })).toEqual({
      ok: false,
      reason: 'bad-dest-zip',
    })
  })

  it('flags a missing date when no load/pack field parses', () => {
    expect(
      buildRatePayload({
        ...good,
        plan_load: null,
        plan_pack: '',
        load_date2: null,
        pack_date2: 'nope',
      }),
    ).toEqual({ ok: false, reason: 'no-date' })
  })
})

describe('rateTripShipments', () => {
  const rated: RateShipmentInput = {
    order_num: 1,
    total_est_wt: 5200,
    shipper_zip: '30301',
    consignee_zip: '20001',
    plan_load: '2026-08-01',
  }
  const badZip: RateShipmentInput = { ...rated, order_num: 2, shipper_zip: null }
  const willError: RateShipmentInput = { ...rated, order_num: 3, consignee_zip: '99999' }

  it('rates rateable shipments, skips uncable ones, and isolates API errors — preserving order', async () => {
    const rateFn = vi.fn(async (p: RatePayload) => {
      if (p.destZip === '99999') throw new Error('No mileage estimate available for 30301 -> 99999')
      return { total: 1234, meta: { billedWeightLbs: 5200, warnings: [] } }
    })

    const rows = await rateTripShipments([rated, badZip, willError], rateFn)

    expect(rows.map((r) => r.status)).toEqual(['rated', 'uncable', 'error'])
    expect(rows[0].total).toBe(1234)
    expect(rows[1].reason).toBe('bad-origin-zip')
    expect(rows[2].message).toContain('No mileage estimate')
    // Both shipments with usable fields hit the API (one succeeds, one throws);
    // only the bad-zip shipment was skipped without a call.
    expect(rateFn).toHaveBeenCalledTimes(2)
    expect(tripRateTotal(rows)).toBe(1234)
  })

  it('respects the concurrency cap', async () => {
    let active = 0
    let peak = 0
    const many = Array.from({ length: 10 }, (_, i) => ({ ...rated, order_num: i }))
    const rateFn = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return { total: 100 }
    })

    await rateTripShipments(many, rateFn, { concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('returns an empty array for no shipments', async () => {
    const rows = await rateTripShipments([], vi.fn())
    expect(rows).toEqual([])
  })

  it('threads a positive linehaul discount into every payload', async () => {
    const rateFn = vi.fn(async () => ({ total: 1000 }))
    await rateTripShipments([rated], rateFn, { linehaulDiscountPercent: 12 })
    expect(rateFn).toHaveBeenCalledWith(expect.objectContaining({ linehaulDiscountPercent: 12 }))
  })

  it('omits a zero/undefined discount (0 == published baseline)', async () => {
    const rateFn = vi.fn(async () => ({ total: 1000 }))
    await rateTripShipments([rated], rateFn, { linehaulDiscountPercent: 0 })
    expect(rateFn).toHaveBeenCalledWith(
      expect.not.objectContaining({ linehaulDiscountPercent: expect.anything() }),
    )
  })
})

describe('uncableLabel', () => {
  it('has readable text for every reason', () => {
    expect(uncableLabel('bad-origin-zip')).toMatch(/origin/i)
    expect(uncableLabel('bad-dest-zip')).toMatch(/destination/i)
    expect(uncableLabel('no-weight')).toMatch(/weight/i)
    expect(uncableLabel('no-date')).toMatch(/date/i)
  })
})
