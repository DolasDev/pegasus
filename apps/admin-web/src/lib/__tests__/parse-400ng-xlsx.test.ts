// ---------------------------------------------------------------------------
// Parser tests for the browser-side 400NG workbook parser.
//
// Hermetic: builds a synthetic workbook (same four-tab layout as the real 2026
// Baseline Rates workbook) with exceljs and parses it back, exercising each
// parse path plus the edge cases the CLI handles — leading-zero ZIP3 padding,
// concatenated multi-ZIP3 cells, the ambiguous-cell warning, and the
// fractional-cent unpack scale. The real workbook's full 913/227/5076 counts
// are asserted out-of-band by a manual parse during dev (see the plan's
// Verification section), not committed as a 187KB binary fixture.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseWorkbook } from '../parse-400ng-xlsx'

function setRow(sheet: ExcelJS.Worksheet, r: number, cells: Record<number, string | number>) {
  const row = sheet.getRow(r)
  for (const [col, value] of Object.entries(cells)) {
    row.getCell(Number(col)).value = value
  }
}

async function buildFixtureWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()

  // ── Base Point City (header rows 1-3, data from row 4; col4=SA, col5=zip3) ──
  const bpc = wb.addWorksheet('Base Point City')
  setRow(bpc, 4, { 4: 672, 5: '173' }) // clean 3-digit
  setRow(bpc, 5, { 4: 736, 5: '796' })
  setRow(bpc, 6, { 4: 100, 5: '442443' }) // concatenated → 442, 443
  setRow(bpc, 7, { 4: 200, 5: '5' }) // lost leading zeros → 005
  setRow(bpc, 8, { 4: 300, 5: '21022' }) // ambiguous → guessed 021022 + warning

  // ── Geographical Schedule (header row 2, data from row 3) ──
  const geo = wb.addWorksheet('Geographical Schedule')
  setRow(geo, 3, { 1: 672, 3: 3, 4: 2.88, 5: 12.09 })
  setRow(geo, 4, { 1: 736, 3: 1, 4: 1.71, 5: 7.47 })

  // ── Linehaul (row2 = weight lower, row3 = weight upper; data from row4) ──
  const lh = wb.addWorksheet('Linehaul')
  setRow(lh, 2, { 5: 8000 })
  setRow(lh, 3, { 5: 8199 })
  setRow(lh, 4, { 1: 'Section 3 - Linehaul', 2: 1401, 3: 1500, 5: 17475.0 })
  setRow(lh, 5, { 1: 'Section 3 - Linehaul', 2: 351, 3: 400, 5: 10637.0 })
  setRow(lh, 6, { 1: 'Section 7 - Intra AK', 2: 100, 3: 200, 5: 999.0 }) // excluded (not Section 3)

  // ── Additional Rates (header row 2, data from row 3) ──
  const add = wb.addWorksheet('Additional Rates')
  setRow(add, 3, { 1: 999, 4: 'between 16,001 and 32,000', 5: 397.02 })
  setRow(add, 4, { 1: 105, 2: '105A', 3: 3, 4: '16,000 lbs and under', 5: 91.33 })
  setRow(add, 5, { 1: 105, 2: '105A', 3: 1, 4: '16,000 lbs and under', 5: 80.0, 8: 7.91595 })

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

describe('parseWorkbook (400NG)', () => {
  it('parses all four tabs into the canonical rate arrays', async () => {
    const parsed = await parseWorkbook(await buildFixtureWorkbook())

    // ZIP3s: 173, 796, 442, 443, 005, 021, 022 (concatenated + padded)
    expect(parsed.zip3s).toEqual(
      expect.arrayContaining([
        { zip3: '173', serviceArea: '672' },
        { zip3: '796', serviceArea: '736' },
        { zip3: '442', serviceArea: '100' },
        { zip3: '443', serviceArea: '100' },
        { zip3: '005', serviceArea: '200' },
        { zip3: '021', serviceArea: '300' },
        { zip3: '022', serviceArea: '300' },
      ]),
    )
    expect(parsed.zip3s).toHaveLength(7)

    // Service areas: dollar columns scaled to cents.
    expect(parsed.serviceAreas).toContainEqual({
      serviceArea: '672',
      schedule: 3,
      linehaulFactorCentsPerCwt: 288,
      serviceChargeCentsPerCwt: 1209,
    })

    // Linehaul: only Section 3 rows; bounds are half-open (upper + 1).
    expect(parsed.linehaulRates).toHaveLength(2)
    expect(parsed.linehaulRates).toContainEqual({
      milesLower: 1401,
      milesUpper: 1501,
      weightLower: 8000,
      weightUpper: 8200,
      rateCents: 1_747_500,
    })

    // Shorthaul band.
    expect(parsed.shorthaulRates).toEqual([
      { cwtMilesLower: 16_001, cwtMilesUpper: 32_000, rateCents: 39_702 },
    ])

    // Pack (per schedule + weight band).
    expect(parsed.packRates).toContainEqual({
      schedule: 3,
      weightLower: 0,
      weightUpper: 16_001,
      rateCentsPerCwt: 9133,
    })

    // Unpack: fractional-cent value scaled to millicents ($7.91595 → 791,595).
    expect(parsed.unpackRates).toEqual([{ schedule: 1, rateMillicentsPerCwt: 791_595 }])
  })

  it('emits a warning for an ambiguous concatenated ZIP3 cell, not a silent guess', async () => {
    const parsed = await parseWorkbook(await buildFixtureWorkbook())
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.warnings[0]).toMatch(/21022/)
    expect(parsed.warnings[0]).toMatch(/Verify against the source workbook/i)
  })

  it('throws a legible error when a required sheet is missing', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Base Point City')
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    await expect(parseWorkbook(buf)).rejects.toThrow(/Geographical Schedule.*not found/)
  })
})
