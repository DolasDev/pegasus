export type SortOrder = 'asc' | 'desc'

export interface SortBy {
  value: string
  order: SortOrder
}

/**
 * Toggle the sort state for `value` against the current query.
 *
 * - Clicking a new column sorts it ascending.
 * - Clicking the active column flips asc ↔ desc.
 *
 * Shared by the Shipments card view and the Shipments table so both surfaces
 * drive the same server-side `query.sortBy`.
 */
export function getSortByValue(query: { sortBy?: SortBy | null }, value: string): SortBy {
  if (query.sortBy && query.sortBy.value === value) {
    return { value, order: query.sortBy.order === 'asc' ? 'desc' : 'asc' }
  }
  return { value, order: 'asc' }
}
