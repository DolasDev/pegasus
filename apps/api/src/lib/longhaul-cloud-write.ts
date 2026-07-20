// ---------------------------------------------------------------------------
// Shared SQL fragment builder for cloud-direct longhaul WRITE handlers.
//
// The on-prem repositories write via knex `.update({...rest})` / `.insert({...})`,
// which only emit the keys actually PRESENT on the object — so an omitted
// optional field is left untouched, not nulled. A cloud handler that authored
// a fixed `SET a=@a, b=@b, …` would null every field the client didn't send
// (the shadow-update E2E sends only `lng_dis_comments` and expects the other
// shadow columns preserved). This helper reproduces knex's behavior: it emits
// a parameterized fragment for exactly the DEFINED keys that appear in an
// explicit allow-list. Column names come only from the caller's literal
// `allowed` list — never from request input — so there is no SQL-injection path.
// ---------------------------------------------------------------------------

import type { SqlParam } from './mssql-executor-client'

export interface ColumnFragment {
  /** The defined, allowed column names, in `allowed` order. */
  columns: string[]
  /** `request.input` params for each picked column (undefined coerced to null). */
  params: SqlParam[]
}

/**
 * Pick the defined keys of `data` that appear in `allowed`, returning their
 * column names and bound params. Use `.assignments` for an UPDATE SET clause
 * and `.columns`/`.values` for an INSERT.
 */
export function pickColumns(
  data: Record<string, unknown>,
  allowed: readonly string[],
): ColumnFragment {
  const columns: string[] = []
  const params: SqlParam[] = []
  for (const col of allowed) {
    if (data[col] !== undefined) {
      columns.push(col)
      params.push({ name: col, value: data[col] ?? null })
    }
  }
  return { columns, params }
}

/** `col1 = @col1, col2 = @col2` for an UPDATE SET clause. */
export function assignments(columns: string[]): string {
  return columns.map((c) => `${c} = @${c}`).join(', ')
}

/** `@col1, @col2` — the VALUES list matching an INSERT column list. */
export function valuePlaceholders(columns: string[]): string {
  return columns.map((c) => `@${c}`).join(', ')
}
