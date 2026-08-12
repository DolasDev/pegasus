// ---------------------------------------------------------------------------
// Declarative transform engine (the anti-corruption layer's translation half).
//
// A TransformSpec is DATA, not code: a flat list of per-field mappings. We
// deliberately prefer this over one large opaque expression (JSONata/CEL blob)
// so a mapping is diffable line-by-line and — later — an AI can emit a single
// field delta the schema can validate. See the POC plan's engine recommendation.
//
// Each mapping reads one of a fallback chain of source paths, optionally coerces
// it, and writes it to a target path. Arrays are mapped element-wise via `each`.
// Bounded by design: no conditionals, no loops, no arithmetic — just project +
// coerce. Anything richer is a deliberate escalation, not a silent capability.
// ---------------------------------------------------------------------------

export type CoerceName =
  | 'toNumber'
  | 'toNumberOrNull'
  | 'toString'
  | 'identity'
  | 'toDateOnly'
  | 'toIsoDateTime'

export interface FieldMapping {
  /** Dot-path to write in the canonical output (e.g. 'status.id'). */
  to: string
  /** Source dot-path(s); the first that resolves to a defined value wins. */
  from: string[]
  /** Value used when no `from` path resolves (and there is no value). */
  default?: unknown
  /**
   * Value-translation lookup: when the source value (stringified) is a key here,
   * the mapped value replaces it (e.g. `{ "Active": "A" }`). A miss falls back to
   * `default` if one is declared, else passes the source value through. Applied to
   * a resolved source value only (never to `default`) and BEFORE `coerce`. A finite
   * lookup — still pure projection, no conditionals/loops.
   */
  map?: Record<string, unknown>
  /** Optional coercion applied to the resolved (or default) value. */
  coerce?: CoerceName
  /** For array targets: map each source element through this sub-spec. */
  each?: FieldMapping[]
}

export type TransformSpec = FieldMapping[]

// --- Date coercions (sdk-feedback 0039) ------------------------------------
//
// Partners document date fields in their OWN format (`YYYY-MM-DD` is the common
// one); the legacy source emits .NET-serialized datetimes (`2026-07-16T00:00:00`).
// Reformatting is close to the most common mapping need there is and was
// previously unreachable from a published config — `$map` is a finite lookup, so
// "truncate any datetime to its date part" would need one entry per representable
// date. These two coercions close that gap while keeping `coerce` a bounded
// vocabulary rather than an expression language.
//
// WALL-CLOCK TRUNCATION, NOT TIMEZONE CONVERSION. These values are calendar
// dates carrying a `T00:00:00` suffix, not instants, so the calendar fields are
// re-emitted exactly as serialized: a trailing `Z`/offset is DROPPED, never
// applied, and the day can never shift. (Parsing via `new Date(str)` would
// reintroduce exactly the local-timezone day shift the date-only trip contract
// exists to prevent.)
//
// Both are null-safe by construction: anything that is not a parseable date —
// `null`, `undefined`, `''`, a number, a non-date string — yields `null`, never
// `"Invalid Date"`, never `"1970-01-01"`, never a throw.

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

// `YYYY-MM-DD`, optionally followed by a `T`/space time, optional fractional
// seconds, and an optional `Z`/±HH:MM offset. Fully anchored, so trailing garbage
// is a parse failure rather than a silent truncation.
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Proleptic-Gregorian leap year (the calendar ISO 8601 and .NET both use). */
const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/**
 * Parse the calendar fields of an ISO-ish datetime; null when not a real date.
 *
 * Validity is computed arithmetically rather than round-tripped through `Date`
 * on purpose: `Date.UTC(1, 0, 1)` silently means 1901, so a round-trip check
 * would reject the .NET min-date sentinel `0001-01-01T00:00:00` — the one value a
 * mapping most needs to see intact so `$map` can null it explicitly.
 */
function parseDateParts(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null
  const m = ISO_DATE_RE.exec(value.trim())
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const [hour, minute, second] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)]
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!
  if (day > maxDay) return null
  return { year, month, day, hour, minute, second }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

const COERCIONS: Record<CoerceName, (v: unknown) => unknown> = {
  identity: (v) => v,
  toString: (v) => (v == null ? v : String(v)),
  toNumber: (v) => Number(v),
  toNumberOrNull: (v) => (v == null ? null : Number(v)),
  /** ISO datetime → `YYYY-MM-DD` (the calendar day as serialized). */
  toDateOnly: (v) => {
    const p = parseDateParts(v)
    return p ? `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` : null
  },
  /**
   * The inverse normalizer, for a partner wanting full ISO: `YYYY-MM-DDTHH:mm:ss`.
   * A date-only input is padded to midnight; fractional seconds and any trailing
   * `Z`/offset are dropped (truncation, not conversion — see the note above).
   */
  toIsoDateTime: (v) => {
    const p = parseDateParts(v)
    if (!p) return null
    const date = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
    return `${date}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  },
}

// Dotted access with two extensions used by real integration mappings:
//   - "."        — identity: resolves to the whole input object (e.g. mapping a
//                  single root object into a one-element array via `$each`).
//   - "a.b[0].c" — array index access on a path segment (e.g. `DocumentationDates[0]`).
function getPath(obj: unknown, path: string): unknown {
  if (path === '.' || path === '') return obj
  if (obj == null) return undefined
  let cur: unknown = obj
  for (const segment of path.split('.')) {
    const key = segment.replace(/\[\d+\]/g, '')
    if (key) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
    for (const m of segment.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(cur)) return undefined
      cur = cur[Number(m[1])]
    }
  }
  return cur
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = target
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]!] = value
}

/** Resolve the first defined value across a mapping's `from` chain. */
function resolveSource(input: unknown, m: FieldMapping): { found: boolean; value: unknown } {
  for (const path of m.from) {
    const v = getPath(input, path)
    if (v !== undefined) return { found: true, value: v }
  }
  return { found: false, value: undefined }
}

function applyOne(input: unknown, m: FieldMapping): unknown {
  const { found, value } = resolveSource(input, m)
  let resolved = found ? value : m.default

  if (m.each) {
    // An array source maps element-wise; a single object source is treated as a
    // one-element collection (the root-object-as-one-shipment pattern, used with
    // `$from: "."`); anything else yields an empty list.
    const arr = Array.isArray(resolved)
      ? resolved
      : resolved != null && typeof resolved === 'object'
        ? [resolved]
        : []
    return arr.map((el) => applyMapping(m.each!, el))
  }

  // Value translation: only on a resolved (found, non-null) source value; never
  // translates the `default`. Hit → mapped value; miss → `default` if declared,
  // else passthrough. Runs before coercion so a coerce still applies to the result.
  if (m.map && found && value != null) {
    const key = String(value)
    if (Object.prototype.hasOwnProperty.call(m.map, key)) {
      resolved = m.map[key]
    } else if ('default' in m) {
      resolved = m.default
    }
  }

  if (m.coerce) {
    const fn = COERCIONS[m.coerce]
    if (!fn) throw new Error(`Unknown coercion "${m.coerce}" in transform`)
    resolved = fn(resolved)
  }
  return resolved
}

/** Apply a transform spec, producing the canonical-shaped object. */
export function applyMapping(spec: TransformSpec, input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of spec) setPath(out, m.to, applyOne(input, m))
  return out
}
