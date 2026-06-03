// ---------------------------------------------------------------------------
// CSV utilities for the Driver Data Import dialog.
//
// Pure functions only — no React, no I/O beyond `parseCsv` (which takes a File
// the caller already plucked from an <input type="file">) and
// `downloadTemplate` (which writes a Blob to the page). Everything else is
// synchronous and unit-testable.
// ---------------------------------------------------------------------------
import Papa from 'papaparse'

// ---------------------------------------------------------------------------
// Mapping targets
// ---------------------------------------------------------------------------

/** The editable subset of DriverPlanningRow the import understands. */
export type ImportTarget =
  | 'agentCode'
  | 'confirmedDate'
  | 'confirmedState'
  | 'confirmedCity'
  | 'notes'
  | 'canada'
  | 'california'
  | 'rating'
  | 'equipment'
  | 'homeCity'
  | 'homeState'

interface TargetDef {
  value: ImportTarget
  label: string
  kind: 'string' | 'date' | 'boolean' | 'number'
  required?: boolean
}

/** Order shown in the column-mapper dropdown and template. agentCode first
 *  because it's the only required field. */
export const TARGETS: readonly TargetDef[] = [
  { value: 'agentCode', label: 'Driver Code (Agent Code)', kind: 'string', required: true },
  { value: 'confirmedDate', label: 'Ready Date', kind: 'date' },
  { value: 'confirmedState', label: 'Ready State', kind: 'string' },
  { value: 'confirmedCity', label: 'Ready City', kind: 'string' },
  { value: 'notes', label: 'Notes', kind: 'string' },
  { value: 'canada', label: 'Canada', kind: 'boolean' },
  { value: 'california', label: 'California', kind: 'boolean' },
  { value: 'rating', label: 'Rating', kind: 'number' },
  { value: 'equipment', label: 'Equipment', kind: 'string' },
  { value: 'homeCity', label: 'Home City', kind: 'string' },
  { value: 'homeState', label: 'Home State', kind: 'string' },
] as const

const TARGETS_BY_VALUE: Record<ImportTarget, TargetDef> = Object.fromEntries(
  TARGETS.map((t) => [t.value, t]),
) as Record<ImportTarget, TargetDef>

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  /** Column display names — real header row when hasHeaders=true, else
   *  `col1`, `col2`, … matching the file's widest row. */
  columns: string[]
  /** Data rows, normalised to `columns.length` (short rows padded with ''). */
  rows: string[][]
}

/** Read a CSV File and produce a `{columns, rows}` shape suitable for the
 *  mapper UI. Throws when the file is empty. */
export async function parseCsv(file: File, hasHeaders: boolean): Promise<ParsedCsv> {
  const text = await file.text()
  return parseCsvText(text, hasHeaders)
}

/** Pure variant of parseCsv for tests — no File involved. */
export function parseCsvText(text: string, hasHeaders: boolean): ParsedCsv {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  })
  const all = result.data.filter((r) => Array.isArray(r))
  if (all.length === 0) {
    throw new Error('CSV is empty')
  }
  const width = all.reduce((w, r) => Math.max(w, r.length), 0)
  const pad = (r: string[]): string[] =>
    r.length === width
      ? r.map(cellToString)
      : [...r.map(cellToString), ...Array(width - r.length).fill('')]

  let columns: string[]
  let dataRows: string[][]
  if (hasHeaders) {
    const head = pad(all[0]!)
    columns = head.map((c, i) => c.trim() || `col${i + 1}`)
    dataRows = all.slice(1).map(pad)
  } else {
    columns = Array.from({ length: width }, (_, i) => `col${i + 1}`)
    dataRows = all.map(pad)
  }
  return { columns, rows: dataRows }
}

function cellToString(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

// ---------------------------------------------------------------------------
// Mapping & coercion
// ---------------------------------------------------------------------------

/** Map from source-column index → ImportTarget (or null = ignore). */
export type ColumnMapping = Array<ImportTarget | null>

export interface MappingValidation {
  ok: boolean
  /** Human-readable reasons the mapping is not yet importable. */
  errors: string[]
}

export function validateMapping(mapping: ColumnMapping): MappingValidation {
  const errors: string[] = []
  const counts = new Map<ImportTarget, number>()
  for (const m of mapping) {
    if (!m) continue
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  for (const t of TARGETS) {
    const n = counts.get(t.value) ?? 0
    if (t.required && n === 0) {
      errors.push(`"${t.label}" must be mapped to a column.`)
    }
    if (n > 1) {
      errors.push(`"${t.label}" is mapped to more than one column.`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Type guard: which targets a row produces. Only `agentCode` is always
 *  present (required by validateMapping). All others optional. */
export interface CoercedRow {
  agentCode: string
  confirmedDate?: string | null
  confirmedState?: string | null
  confirmedCity?: string | null
  notes?: string | null
  canada?: boolean | null
  california?: boolean | null
  rating?: number | null
  equipment?: string | null
  homeCity?: string | null
  homeState?: string | null
}

/** Apply `mapping` to one row of cells, coercing each cell to the target's
 *  declared kind. Returns null if `agentCode` is missing/blank — those rows
 *  can't be matched and the caller should skip them. */
export function coerceRow(cells: string[], mapping: ColumnMapping): CoercedRow | null {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < mapping.length; i++) {
    const target = mapping[i]
    if (!target) continue
    const raw = (cells[i] ?? '').trim()
    out[target] = coerce(raw, TARGETS_BY_VALUE[target].kind)
  }
  const code = out['agentCode']
  if (typeof code !== 'string' || code.length === 0) return null
  return out as unknown as CoercedRow
}

function coerce(raw: string, kind: TargetDef['kind']): string | number | boolean | null {
  if (raw === '') return null
  switch (kind) {
    case 'string':
      return raw
    case 'date': {
      // Accept ISO YYYY-MM-DD as-is; otherwise try Date parse and normalise.
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
      const d = new Date(raw)
      if (isNaN(d.getTime())) return null
      return d.toISOString().slice(0, 10)
    }
    case 'boolean': {
      const low = raw.toLowerCase()
      if (['true', 'yes', 'y', '1'].includes(low)) return true
      if (['false', 'no', 'n', '0'].includes(low)) return false
      return null
    }
    case 'number': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
  }
}

// ---------------------------------------------------------------------------
// Mutation payload builder
// ---------------------------------------------------------------------------

/** Mirrors `joinLocation` in features/driver-planning/availability/AvailabilityViewA.tsx —
 *  the API stores location as "STATE, City". Duplicated here so the import
 *  path doesn't reach into a UI file. */
function joinLocation(
  state: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const s = (state ?? '').trim().toUpperCase()
  const c = (city ?? '').trim()
  if (s && c) return `${s}, ${c}`
  return s || c || null
}

export interface DriverUpdatePayload {
  driverId: number
  confirmedDate: string | null
  confirmedLocation: string | null
  notes: string | null
  canada?: boolean | null
  california?: boolean | null
  rating?: number | null
  equipment?: string | null
  homeCity?: string | null
  homeState?: string | null
}

/** Convert a coerced row + matched driverId into a mutation input. Only
 *  emits keys the row actually set so partial CSVs don't blank fields. */
export function toUpdatePayload(row: CoercedRow, driverId: number): DriverUpdatePayload {
  const payload: DriverUpdatePayload = {
    driverId,
    confirmedDate: row.confirmedDate ?? null,
    confirmedLocation: joinLocation(row.confirmedState, row.confirmedCity),
    notes: row.notes ?? null,
  }
  if ('canada' in row) payload.canada = row.canada ?? null
  if ('california' in row) payload.california = row.california ?? null
  if ('rating' in row) payload.rating = row.rating ?? null
  if ('equipment' in row) payload.equipment = row.equipment ?? null
  if ('homeCity' in row) payload.homeCity = row.homeCity ?? null
  if ('homeState' in row) payload.homeState = row.homeState ?? null
  return payload
}

// ---------------------------------------------------------------------------
// Template download
// ---------------------------------------------------------------------------

/** Canonical header names for the example CSV — match `TARGETS[*].label`. */
export const TEMPLATE_HEADERS = TARGETS.map((t) => t.label)

const TEMPLATE_SAMPLE_ROW = [
  'AB123', // Driver Code
  '2026-06-15', // Ready Date
  'TX', // Ready State
  'Houston', // Ready City
  'Prefers Texas loads', // Notes
  'no', // Canada
  'yes', // California
  '4', // Rating
  'Van', // Equipment
  'Dallas', // Home City
  'TX', // Home State
]

export function buildTemplateCsv(): string {
  return Papa.unparse([TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROW])
}

/** Trigger a browser download of the example CSV. Browser-only. */
export function downloadTemplate(filename = 'pegasus-driver-import-template.csv'): void {
  const csv = buildTemplateCsv()
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
