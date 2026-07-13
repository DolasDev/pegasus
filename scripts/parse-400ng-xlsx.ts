#!/usr/bin/env node
/**
 * Converts a downloaded 400NG "Baseline Rates" workbook into the canonical
 * import JSON that POST /api/v1/rating/tariffs/import expects (shape defined
 * in apps/api/src/rating/import-schema.ts — kept in sync by hand, not
 * imported directly, since this script lives outside the apps/api workspace).
 *
 * Sheet/column layout verified against the real 2026 400NG Baseline Rates
 * workbook (effective 15 May 2026): "Base Point City", "Geographical
 * Schedule", "Linehaul", "Additional Rates" tabs. See
 * packages/domain/src/rating/tariff400ng.ts for the full calibration notes
 * this parser's shape is built from. The workbook layout is expected to
 * shift year to year (new Item numbers, reworded weight-bracket text,
 * moved columns) — this is a maintained annual tool, not a one-time build.
 * Run with --describe on a new year's file first to spot-check headers
 * before trusting the parsed output.
 *
 * Out of scope (present in the workbook, not extracted here): Alaska/
 * waterhaul sections ("Intra Alaska", "Section 7 - Intra AK" on the
 * Linehaul tab; "Section 6 AK Waterhaul" on Accessorials — this is also
 * the only Peak/NonPeak split in the entire workbook), SIT rates (185A/
 * 185B, Item 210), crating (105B), and the "Addl CWT" extrapolation
 * column on the Linehaul tab for shipments heavier than the last weight
 * bracket (Note 1/2 on that sheet).
 *
 * Usage:
 *   npx tsx scripts/parse-400ng-xlsx.ts <file.xlsx> --describe
 *   npx tsx scripts/parse-400ng-xlsx.ts <file.xlsx> \
 *     --label "2026 400NG Baseline Rates" \
 *     --effective-from 2026-05-15 --effective-to 2027-05-15 \
 *     > 400ng-2026.json
 */

import ExcelJS from 'exceljs'

const SHEET_NAMES = {
  basePointCity: 'Base Point City',
  geographicalSchedule: 'Geographical Schedule',
  linehaul: 'Linehaul',
  additionalRates: 'Additional Rates',
} as const

/** A very heavy/far shipment sentinel — see the "out of scope" note above re: the Addl CWT/Note 1-2 extrapolation this parser doesn't implement. */
const UNBOUNDED = 999_999_999

interface CliArgs {
  readonly file: string
  readonly describe: boolean
  readonly label?: string
  readonly effectiveFrom?: string
  readonly effectiveTo?: string
}

function parseArgs(argv: readonly string[]): CliArgs {
  const file = argv[0]
  if (!file || file.startsWith('--')) {
    console.error(
      'Usage: npx tsx scripts/parse-400ng-xlsx.ts <file.xlsx> [--describe] ' +
        '[--label "..."] [--effective-from YYYY-MM-DD] [--effective-to YYYY-MM-DD]',
    )
    process.exit(1)
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    file,
    describe: argv.includes('--describe'),
    label: flag('label'),
    effectiveFrom: flag('effective-from'),
    effectiveTo: flag('effective-to'),
  }
}

function getSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) {
    throw new Error(
      `Sheet "${name}" not found. Run with --describe to see this workbook's actual sheets.`,
    )
  }
  return sheet
}

/** Cell text, unwrapping ExcelJS rich-text runs (used for Notes/description cells with mixed formatting). */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((r) => r.text).join('')
  }
  return String(value).trim()
}

/** Dollars (possibly fractional-cent, e.g. 7.91595) -> integer cents/millicents-safe rounding at the given scale. */
function toScaledInt(value: ExcelJS.CellValue, scale: number, field: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n))
    throw new Error(`Expected a number for "${field}", got: ${String(value)}`)
  return Math.round(n * scale)
}

/** Left-pads a ZIP3/Service Area number to 3 digits — the workbook stores some as bare numbers, dropping the leading zero (see its own "* Note" banner). */
function pad3(value: ExcelJS.CellValue): string {
  return String(value).trim().padStart(3, '0')
}

// ---------------------------------------------------------------------------
// Base Point City — ZIP3 -> Service Area. Row 3 is the header; data from row
// 4. "Included Zip3's" sometimes concatenates multiple 3-digit codes into one
// cell (e.g. "442443" -> ZIP3s 442 and 443, both mapping to the same BPC/SA).
// ---------------------------------------------------------------------------
function parseZip3s(workbook: ExcelJS.Workbook): Array<{ zip3: string; serviceArea: string }> {
  const sheet = getSheet(workbook, SHEET_NAMES.basePointCity)
  const out: Array<{ zip3: string; serviceArea: string }> = []
  for (let r = 4; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const serviceAreaCell = row.getCell(4).value
    const zip3Cell = row.getCell(5).value
    if (serviceAreaCell == null || zip3Cell == null) continue
    const serviceArea = pad3(serviceAreaCell)
    const raw = String(zip3Cell).trim()

    if (raw.length === 0) continue

    if (raw.length % 3 === 0) {
      // Clean case: one or more concatenated 3-digit codes, no leading zero lost.
      for (let i = 0; i < raw.length; i += 3) {
        out.push({ zip3: raw.slice(i, i + 3), serviceArea })
      }
      continue
    }

    if (raw.length <= 2) {
      // A lone ZIP3 that lost its leading zero (the workbook's own "* Note").
      out.push({ zip3: raw.padStart(3, '0'), serviceArea })
      continue
    }

    // Multiple concatenated codes where exactly one lost a leading zero —
    // which code it was is genuinely ambiguous from the digit string alone
    // (e.g. "21022" could be "021"+"022" or "210"+"022"). Best-guess: the
    // dropped zero belongs to the FIRST code (left-pad the whole string to
    // the next multiple of 3), but this needs manual verification — flagged
    // rather than silently applied (no silent caps).
    const padded = raw.padStart(Math.ceil(raw.length / 3) * 3, '0')
    console.error(
      `Ambiguous "Included Zip3's" cell at row ${r}: "${raw}" -> guessed "${padded}" ` +
        `(zip3s ${padded.match(/.{3}/g)?.join(', ')}) — verify against the source workbook.`,
    )
    for (let i = 0; i < padded.length; i += 3) {
      out.push({ zip3: padded.slice(i, i + 3), serviceArea })
    }
  }

  // Some ZIP3s (all seen so far are Alaska's 995-999) are legitimately
  // associated with more than one Base Point City row, all resolving to the
  // same Service Area — dedupe rather than let the DB's unique constraint
  // reject the import. A genuine conflict (same ZIP3 -> different Service
  // Areas across rows) is NOT silently resolved here; it still throws.
  const byZip3 = new Map<string, string>()
  for (const entry of out) {
    const existing = byZip3.get(entry.zip3)
    if (existing !== undefined && existing !== entry.serviceArea) {
      throw new Error(
        `ZIP3 ${entry.zip3} maps to conflicting service areas ${existing} and ${entry.serviceArea} — cannot dedupe automatically.`,
      )
    }
    byZip3.set(entry.zip3, entry.serviceArea)
  }
  return [...byZip3.entries()].map(([zip3, serviceArea]) => ({ zip3, serviceArea }))
}

// ---------------------------------------------------------------------------
// Geographical Schedule — per-Service-Area Services Schedule (drives which
// pack/unpack rates apply), linehaul factor (OLF/DLF), and 135A&B service
// charge. Header at row 2; data from row 3. Columns 6/7/8 (185A/185B SIT
// rates, SIT PD Schedule) are out of scope.
// ---------------------------------------------------------------------------
function parseServiceAreas(workbook: ExcelJS.Workbook): Array<{
  serviceArea: string
  schedule: number
  serviceChargeCentsPerCwt: number
  linehaulFactorCentsPerCwt: number
}> {
  const sheet = getSheet(workbook, SHEET_NAMES.geographicalSchedule)
  const out: ReturnType<typeof parseServiceAreas> = []
  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const saCell = row.getCell(1).value
    if (saCell == null) continue
    out.push({
      serviceArea: pad3(saCell),
      schedule: toScaledInt(row.getCell(3).value, 1, 'schedule'),
      linehaulFactorCentsPerCwt: toScaledInt(
        row.getCell(4).value,
        100,
        'linehaulFactorCentsPerCwt',
      ),
      serviceChargeCentsPerCwt: toScaledInt(row.getCell(5).value, 100, 'serviceChargeCentsPerCwt'),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Linehaul — "Section 3 - Linehaul" only (Alaska sections excluded). 2-row
// header: row 2 = weight-band lower bounds (col 5+), row 3 = mileage-column
// label / weight-band upper bounds (col 5+); col 2/3 = mileage band per row.
// The final column ("Addl CWT") is an extrapolation formula, not a normal
// weight band — skipped (see file header "out of scope" note).
// ---------------------------------------------------------------------------
function parseLinehaulRates(workbook: ExcelJS.Workbook): Array<{
  milesLower: number
  milesUpper: number
  weightLower: number
  weightUpper: number
  rateCents: number
}> {
  const sheet = getSheet(workbook, SHEET_NAMES.linehaul)
  const weightLowerRow = sheet.getRow(2)
  const weightUpperRow = sheet.getRow(3)

  const weightCols: Array<{ col: number; lower: number; upper: number }> = []
  for (let c = 5; c <= sheet.columnCount; c++) {
    const lower = weightLowerRow.getCell(c).value
    const upper = weightUpperRow.getCell(c).value
    if (typeof lower !== 'number' || typeof upper !== 'number') continue // e.g. the "Addl CWT" column
    weightCols.push({ col: c, lower, upper: upper + 1 })
  }

  const out: ReturnType<typeof parseLinehaulRates> = []
  for (let r = 4; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    if (cellText(row.getCell(1).value) !== 'Section 3 - Linehaul') continue
    const milesLower = row.getCell(2).value
    const milesUpper = row.getCell(3).value
    if (typeof milesLower !== 'number' || typeof milesUpper !== 'number') continue
    for (const wc of weightCols) {
      const rate = row.getCell(wc.col).value
      if (typeof rate !== 'number') continue
      out.push({
        milesLower,
        milesUpper: milesUpper + 1,
        weightLower: wc.lower,
        weightUpper: wc.upper,
        rateCents: Math.round(rate * 100),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Additional Rates — Item 999 (Shorthaul, banded flat dollar amount by
// cwt-miles) and Item 105A (Full Pack, banded $/cwt by Schedule + weight;
// Full Unpack, flat $/cwt by Schedule, embedded in column 8 of 105A's first
// weight-bracket row per schedule). Header at row 2; data from row 3.
// ---------------------------------------------------------------------------

const SH_LTE_RE = /less than or equal to\s*([\d,]+)/i
const SH_BETWEEN_RE = /between\s*([\d,]+)\s*and\s*([\d,]+)/i
const SH_GT_RE = /greater than\s*([\d,]+)/i

function parseNum(s: string): number {
  return Number(s.replace(/,/g, ''))
}

function parseShorthaulBand(desc: string): { cwtMilesLower: number; cwtMilesUpper: number } {
  const lte = SH_LTE_RE.exec(desc)
  if (lte?.[1]) return { cwtMilesLower: 0, cwtMilesUpper: parseNum(lte[1]) }
  const between = SH_BETWEEN_RE.exec(desc)
  if (between?.[1] && between[2]) {
    return { cwtMilesLower: parseNum(between[1]), cwtMilesUpper: parseNum(between[2]) }
  }
  const gt = SH_GT_RE.exec(desc)
  if (gt?.[1]) return { cwtMilesLower: parseNum(gt[1]) + 1, cwtMilesUpper: UNBOUNDED }
  throw new Error(`Unrecognized Item 999 (Shorthaul) description: "${desc}"`)
}

const PACK_UNDER_RE = /([\d,]+)\s*lbs and under/i
const PACK_RANGE_RE = /([\d,]+)\s*lbs to\s*([\d,]+)\s*lbs/i
const PACK_OVER_RE = /over\s*([\d,]+)\s*lbs/i

function parsePackWeightBand(desc: string): { weightLower: number; weightUpper: number } {
  const under = PACK_UNDER_RE.exec(desc)
  if (under?.[1]) return { weightLower: 0, weightUpper: parseNum(under[1]) + 1 }
  const range = PACK_RANGE_RE.exec(desc)
  if (range?.[1] && range[2]) {
    return { weightLower: parseNum(range[1]), weightUpper: parseNum(range[2]) + 1 }
  }
  const over = PACK_OVER_RE.exec(desc)
  if (over?.[1]) return { weightLower: parseNum(over[1]) + 1, weightUpper: UNBOUNDED }
  throw new Error(`Unrecognized Item 105A (Full Pack) weight bracket: "${desc}"`)
}

function parseShorthaulAndPackRates(workbook: ExcelJS.Workbook): {
  shorthaulRates: Array<{ cwtMilesLower: number; cwtMilesUpper: number; rateCents: number }>
  packRates: Array<{
    schedule: number
    weightLower: number
    weightUpper: number
    rateCentsPerCwt: number
  }>
  unpackRates: Array<{ schedule: number; rateMillicentsPerCwt: number }>
} {
  const sheet = getSheet(workbook, SHEET_NAMES.additionalRates)
  const shorthaulRates: ReturnType<typeof parseShorthaulAndPackRates>['shorthaulRates'] = []
  const packRates: ReturnType<typeof parseShorthaulAndPackRates>['packRates'] = []
  const unpackRates: ReturnType<typeof parseShorthaulAndPackRates>['unpackRates'] = []

  for (let r = 3; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const itemNumber = row.getCell(1).value
    const itemCode = cellText(row.getCell(2).value)
    const description = cellText(row.getCell(4).value)

    if (itemNumber === 999) {
      const band = parseShorthaulBand(description)
      const rate = row.getCell(5).value
      if (typeof rate !== 'number') continue
      shorthaulRates.push({ ...band, rateCents: Math.round(rate * 100) })
      continue
    }

    if (itemNumber === 105 && itemCode === '105A') {
      const schedule = toScaledInt(row.getCell(3).value, 1, 'schedule')
      const rate = row.getCell(5).value
      if (typeof rate === 'number') {
        const band = parsePackWeightBand(description)
        packRates.push({ schedule, ...band, rateCentsPerCwt: Math.round(rate * 100) })
      }
      const unpack = row.getCell(8).value
      if (typeof unpack === 'number') {
        // millicents = thousandths of a CENT, i.e. dollars x 100,000 (not x 1,000 — that
        // would be millidollars). $7.91595/cwt -> 791,595 millicents/cwt.
        unpackRates.push({
          schedule,
          rateMillicentsPerCwt: toScaledInt(unpack, 100_000, 'rateMillicentsPerCwt'),
        })
      }
    }
  }

  return { shorthaulRates, packRates, unpackRates }
}

async function describeWorkbook(workbook: ExcelJS.Workbook): Promise<void> {
  for (const sheet of workbook.worksheets) {
    console.log(
      `\n=== Sheet: "${sheet.name}" (${sheet.rowCount} rows x ${sheet.columnCount} cols) ===`,
    )
    for (let r = 1; r <= Math.min(4, sheet.rowCount); r++) {
      const row = sheet.getRow(r)
      const vals: string[] = []
      for (let c = 1; c <= Math.min(12, sheet.columnCount); c++) {
        vals.push(cellText(row.getCell(c).value) || String(row.getCell(c).value ?? ''))
      }
      console.log(`row${r}: ${vals.join(' | ')}`)
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(args.file)

  if (args.describe) {
    await describeWorkbook(workbook)
    return
  }

  if (!args.label || !args.effectiveFrom || !args.effectiveTo) {
    console.error('--label, --effective-from, and --effective-to are required (unless --describe).')
    process.exit(1)
  }

  const zip3s = parseZip3s(workbook)
  const serviceAreas = parseServiceAreas(workbook)
  const linehaulRates = parseLinehaulRates(workbook)
  const { shorthaulRates, packRates, unpackRates } = parseShorthaulAndPackRates(workbook)

  const doc = {
    schemaVersion: 1,
    tariffCode: '400NG',
    label: args.label,
    effectiveFrom: new Date(args.effectiveFrom).toISOString(),
    effectiveTo: new Date(args.effectiveTo).toISOString(),
    zip3s,
    serviceAreas,
    linehaulRates,
    shorthaulRates,
    packRates,
    unpackRates,
  }

  console.error(
    `Parsed: ${zip3s.length} zip3s, ${serviceAreas.length} service areas, ` +
      `${linehaulRates.length} linehaul cells, ${shorthaulRates.length} shorthaul bands, ` +
      `${packRates.length} pack bands, ${unpackRates.length} unpack rates.`,
  )
  console.log(JSON.stringify(doc, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
