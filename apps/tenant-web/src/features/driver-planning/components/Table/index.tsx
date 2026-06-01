import React from 'react'
import styles from './Table.module.css'

interface TableColumn<T> {
  label: string
  property?: keyof T & string
  /** @deprecated Retained for backward-compat with existing call sites; not consumed by the component. */
  property2?: keyof T & string
  accessor?: (row: T) => React.ReactNode
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
}

export function Table<T>({ rows, tableConfig, rowTarget, onRowClick, rowId }: TableProps<T>) {
  return (
    <div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr className={styles.tr}>
            {tableConfig.map(({ label }, index) => (
              <th className={styles.th} key={`${label}-${index}`}>
                {label}
              </th>
            ))}
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
