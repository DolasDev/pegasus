import React from 'react'
import styles from './Table.module.css'

export interface TableColumn<T> {
  label: string
  property?: keyof T & string
  /** @deprecated Retained for backward-compat with existing call sites; not consumed by the component. */
  property2?: keyof T & string
  accessor?: (row: T) => React.ReactNode
  /**
   * Field this column sorts by. Defaults to `property` when omitted. Set
   * explicitly for accessor-based columns (e.g. a date-range column that
   * should sort by its end date). A column with neither `sortKey` nor
   * `property` is not sortable.
   */
  sortKey?: string
}

interface SortState {
  value: string
  order: 'asc' | 'desc'
}

interface TableProps<T> {
  rows: T[]
  tableConfig: TableColumn<T>[]
  /** Optional `data-target` stamped on each body row, for E2E selectors. */
  rowTarget?: string
  /** When provided, body rows become clickable and call this with the row. */
  onRowClick?: (row: T) => void
  /** Optional accessor for the row's `data-id` attribute. If omitted, no `data-id` is stamped. */
  rowId?: (row: T) => string | number | undefined
  /** Current sort state. Drives the active-column indicator. */
  sortBy?: SortState | null
  /**
   * When provided, sortable column headers become clickable and call this with
   * the column's sort key. Sorting is the caller's responsibility (this
   * component does not reorder `rows`).
   */
  onSort?: (sortKey: string) => void
}

export function Table<T>({
  rows,
  tableConfig,
  rowTarget,
  onRowClick,
  rowId,
  sortBy,
  onSort,
}: TableProps<T>) {
  return (
    <div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr className={styles.tr}>
            {tableConfig.map(({ label, property, sortKey }, index) => {
              const key = sortKey ?? property
              const sortable = !!onSort && !!key
              const active = !!key && sortBy?.value === key
              return (
                <th
                  className={`${styles.th} ${sortable ? styles.sortable : ''}`}
                  key={`${label}-${index}`}
                  data-target={sortable ? 'shipment-table-sort-header' : undefined}
                  data-sort={sortable ? key : undefined}
                  aria-sort={
                    active ? (sortBy?.order === 'desc' ? 'descending' : 'ascending') : undefined
                  }
                  onClick={sortable ? () => onSort!(key as string) : undefined}
                >
                  {label}
                  {active && (
                    <i
                      className={`fas fa-caret-up ${sortBy?.order === 'desc' ? styles.down : ''}`}
                    ></i>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {rows.map((row, i) => {
            const id = rowId?.(row)
            return (
              <tr
                key={i}
                {...(id !== undefined ? { 'data-id': String(id) } : {})}
                data-target={rowTarget}
                className={styles.tr}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {tableConfig.map(({ property, accessor }, index) => (
                  <td className={styles.td} key={`${i}-${index}`}>
                    {accessor
                      ? accessor(row)
                      : property
                        ? (row[property] as React.ReactNode)
                        : null}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
