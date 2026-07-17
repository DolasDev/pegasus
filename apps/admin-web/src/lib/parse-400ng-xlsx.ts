// ---------------------------------------------------------------------------
// Browser-side 400NG "Baseline Rates" workbook parser.
//
// Ported from scripts/parse-400ng-xlsx.ts (the offline CLI). Same four-tab
// layout (Base Point City / Geographical Schedule / Linehaul / Additional
// Rates), same calibration — kept deliberately in sync BY HAND, exactly as the
// tenant-web DriverImport feature keeps its own local csv.ts rather than sharing
// a package. When a new tariff year's workbook layout drifts, BOTH this file and
// scripts/parse-400ng-xlsx.ts must be updated together.
//
// Differences from the CLI:
//   - reads an ArrayBuffer (browser File) via `workbook.xlsx.load`, not a path;
//   - exceljs is lazy-imported so it only enters the bundle's critical path when
//     an operator actually parses a workbook;
//   - the ambiguous-concatenated-ZIP3 cases the CLI logs to stderr are collected
//     into a `warnings[]` array surfaced in the UI rather than silently guessed.
//
// The produced arrays match Tariff400ngImportSchema on the API side; the server
// re-validates the whole document, so this parser is a convenience, never the
// authority. The page assembles the full import doc by adding label + effective
// window (operator form inputs) around these arrays.
// ---------------------------------------------------------------------------

import type ExcelJSNamespace from 'exceljs'

type CellValue = ExcelJSNamespace.CellValue
type Workbook = ExcelJSNamespace.Workbook

const SHEET_NAMES = {
  basePointCity: 'Base Point City',
  geographicalSchedule: 'Geographical Schedule',
  linehaul: 'Linehaul',
  additionalRates: 'Additional Rates',
} as const

/** A very heavy/far shipment sentinel — see the CLI's "out of scope" note re: the Addl CWT extrapolation this parser doesn't implement. */
const UNBOUNDED = 999_999_999

export interface Zip3Entry {
  zip3: string
  serviceArea: string
}
export interface ServiceAreaEntry {
  serviceArea: string
  schedule: number
  serviceChargeCentsPerCwt: number
  linehaulFactorCentsPerCwt: number
}
export interface LinehaulRateEntry {
  milesLower: number
  milesUpper: number
  weightLower: number
  weightUpper: number
  rateCents: number
}
export interface ShorthaulRateEntry {
  cwtMilesLower: number
  cwtMilesUpper: number
  rateCents: number
}
export interface PackRateEntry {
  schedule: number
  weightLower: number
  weightUpper: number
  rateCentsPerCwt: number
}
export interface UnpackRateEntry {
  schedule: number
  rateMillicentsPerCwt: number
}

export interface ParsedRates {
  zip3s: Zip3Entry[]
  serviceAreas: ServiceAreaEntry[]
  linehaulRates: LinehaulRateEntry[]
  shorthaulRates: ShorthaulRateEntry[]
  packRates: PackRateEntry[]
  unpackRates: UnpackRateEntry[]
  /** Non-fatal parse observations (e.g. ambiguous ZIP3 cells the parser had to guess). */
  warnings: string[]
}

function getSheet(workbook: Workbook, name: string): ExcelJSNamespace.Worksheet {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) {
    const sheets = workbook.worksheets.map((s) => `"${s.name}"`).join(', ')
    throw new Error(`Sheet "${name}" not found. This workbook has: ${sheets || '(none)'}.`)
  }
  return sheet
}

/** Cell text, unwrapping ExcelJS rich-text runs (used for Notes/description cells with mixed formatting). */
function cellText(value: CellValue): string {
  if (value == null) return ''
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((r) => r.text).join('')
  }
  return String(value).trim()
}

/** Dollars (possibly fractional-cent, e.g. 7.91595) -> integer cents/millicents-safe rounding at the given scale. */
function toScaledInt(value: CellValue, scale: number, field: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n))
    throw new Error(`Expected a number for "${field}", got: ${String(value)}`)
  return Math.round(n * scale)
}

/** Left-pads a ZIP3/Service Area number to 3 digits — the workbook stores some as bare numbers, dropping the leading zero. */
function pad3(value: CellValue): string {
  return String(value).trim().padStart(3, '0')
}

// ---------------------------------------------------------------------------
// Base Point City — ZIP3 -> Service Area. Row 3 header; data from row 4.
// "Included Zip3's" sometimes concatenates multiple 3-digit codes into one cell.
// ---------------------------------------------------------------------------
function parseZip3s(workbook: Workbook, warnings: string[]): Zip3Entry[] {
  const sheet = getSheet(workbook, SHEET_NAMES.basePointCity)
  const out: Zip3Entry[] = []
  for (let r = 4; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const serviceAreaCell = row.getCell(4).value
    const zip3Cell = row.getCell(5).value
    if (serviceAreaCell == null || zip3Cell == null) continue
    const serviceArea = pad3(serviceAreaCell)
    const raw = String(zip3Cell).trim()

    if (raw.length === 0) continue

    if (raw.length % 3 === 0) {
      for (let i = 0; i < raw.length; i += 3) {
        out.push({ zip3: raw.slice(i, i + 3), serviceArea })
      }
      continue
    }

    if (raw.length <= 2) {
      out.push({ zip3: raw.padStart(3, '0'), serviceArea })
      continue
    }

    // Multiple concatenated codes where exactly one lost a leading zero — which
    // one is genuinely ambiguous. Best-guess: the dropped zero belongs to the
    // FIRST code. Flagged, not silently trusted.
    const padded = raw.padStart(Math.ceil(raw.length / 3) * 3, '0')
    warnings.push(
      `Ambiguous "Included Zip3's" at row ${r}: "${raw}" → guessed "${padded}" ` +
        `(zip3s ${padded.match(/.{3}/g)?.join(', ')}). Verify against the source workbook.`,
    )
    for (let i = 0; i < padded.length; i += 3) {
      out.push({ zip3: padded.slice(i, i + 3), serviceArea })
    }
  }

  // Dedupe ZIP3s legitimately tied to multiple Base Point City rows (all seen so
  // far are Alaska's 995-999), all resolving to the same Service Area. A genuine
  // conflict (same ZIP3 -> different Service Areas) still throws.
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
// Geographical Schedule — Services Schedule, linehaul factor (OLF/DLF), 135A&B
// service charge. Header row 2; data from row 3.
// ---------------------------------------------------------------------------
function parseServiceAreas(workbook: Workbook): ServiceAreaEntry[] {
  const sheet = getSheet(workbook, SHEET_NAMES.geographicalSchedule)
  const out: ServiceAreaEntry[] = []
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
// header: row 2 = weight-band lower bounds (col 5+), row 3 = upper bounds; col
// 2/3 = mileage band per row. Final "Addl CWT" column is an extrapolation
// formula, not a weight band — skipped.
// ---------------------------------------------------------------------------
function parseLinehaulRates(workbook: Workbook): LinehaulRateEntry[] {
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

  const out: LinehaulRateEntry[] = []
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
// Additional Rates — Item 999 (Shorthaul) + Item 105A (Full Pack / Full Unpack).
// Header row 2; data from row 3.
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

function parseShorthaulAndPackRates(workbook: Workbook): {
  shorthaulRates: ShorthaulRateEntry[]
  packRates: PackRateEntry[]
  unpackRates: UnpackRateEntry[]
} {
  const sheet = getSheet(workbook, SHEET_NAMES.additionalRates)
  const shorthaulRates: ShorthaulRateEntry[] = []
  const packRates: PackRateEntry[] = []
  const unpackRates: UnpackRateEntry[] = []

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
        // millicents = thousandths of a CENT, i.e. dollars x 100,000.
        unpackRates.push({
          schedule,
          rateMillicentsPerCwt: toScaledInt(unpack, 100_000, 'rateMillicentsPerCwt'),
        })
      }
    }
  }

  return { shorthaulRates, packRates, unpackRates }
}

/**
 * Parse a 400NG Baseline Rates workbook (browser File → ArrayBuffer) into the
 * canonical rate arrays plus any non-fatal warnings. exceljs is lazy-imported.
 * Throws on a structurally unexpected workbook (missing sheet, non-numeric cell,
 * conflicting ZIP3 mapping) — the caller surfaces the message to the operator.
 */
export async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedRates> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const warnings: string[] = []
  const zip3s = parseZip3s(workbook, warnings)
  const serviceAreas = parseServiceAreas(workbook)
  const linehaulRates = parseLinehaulRates(workbook)
  const { shorthaulRates, packRates, unpackRates } = parseShorthaulAndPackRates(workbook)

  return { zip3s, serviceAreas, linehaulRates, shorthaulRates, packRates, unpackRates, warnings }
}
