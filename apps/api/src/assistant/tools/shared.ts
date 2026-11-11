// Small helpers shared by the tool projections. Tool results are most of a
// turn's tokens, so every tool returns a narrow, capped shape (plan 1b).

import { z } from 'zod'

/** Hard cap on rows any list tool hands the model. */
export const MAX_ROWS = 20

/** ISO date (YYYY-MM-DD). The model is told to send dates in this form. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

/** Keep only `keys` whose value is present; dates become YYYY-MM-DD strings. */
export function pick(row: unknown, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!row || typeof row !== 'object') return out
  const r = row as Record<string, unknown>
  for (const k of keys) {
    const v = r[k]
    if (v === undefined || v === null || v === '') continue
    out[k] = normalize(v)
  }
  return out
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') {
    // MSSQL datetimes arrive as full ISO strings; a date is all an answer needs
    // unless there is a meaningful time part.
    const m = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z?$/.exec(v)
    if (m) return m[1]
    return v.length > 300 ? `${v.slice(0, 300)}…` : v
  }
  return v
}

/** `City, ST` from two columns, or undefined when both are blank. */
export function place(city: unknown, state: unknown): string | undefined {
  const c = typeof city === 'string' ? city.trim() : ''
  const s = typeof state === 'string' ? state.trim() : ''
  if (!c && !s) return undefined
  return c && s ? `${c}, ${s}` : c || s
}

/** `[from, to]` for a filter, or undefined when neither bound is set. */
export function range(
  from: string | undefined,
  to: string | undefined,
): [string | null, string | null] | undefined {
  return from || to ? [from ?? null, to ?? null] : undefined
}

/**
 * Cap a list at MAX_ROWS and say so. `truncated` tells the model to narrow its
 * filters rather than reason over a silently partial set.
 */
export function capped<T>(
  rows: readonly T[],
  map: (row: T) => unknown,
): {
  resultCount: number
  data: { rows: unknown[]; returned: number; truncated: boolean; note?: string }
} {
  // Paged sources hand over MAX_ROWS + 1 rows, so `rows.length` is a lower
  // bound there — the note never states a total it can't know.
  const shown = rows.slice(0, MAX_ROWS).map(map)
  const truncated = rows.length > MAX_ROWS
  return {
    resultCount: shown.length,
    data: {
      rows: shown,
      returned: shown.length,
      truncated,
      ...(truncated
        ? {
            note: `More than ${MAX_ROWS} rows matched and only the first ${MAX_ROWS} are shown. Narrow the filters (or page) before drawing conclusions about the whole set.`,
          }
        : {}),
    },
  }
}

/** The `data` array of a `{ data: [...] }` envelope, or []. */
export function dataArray(body: unknown): unknown[] {
  const d = (body as { data?: unknown } | null)?.data
  return Array.isArray(d) ? d : []
}
