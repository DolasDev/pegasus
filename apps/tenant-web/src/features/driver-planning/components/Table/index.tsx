import React from 'react'
import styles from './Table.module.css'

interface TableColumn {
  label: string
  property?: string
  property2?: string
  accessor?: (row: any) => React.ReactNode
}

interface TableProps {
  rows: any[]
  tableConfig: TableColumn[]
  /** Optional `data-target` stamped on each body row, for E2E selectors. */
  rowTarget?: string
  /** When provided, body rows become clickable and call this with the row. */
  onRowClick?: (row: any) => void
}

export function Table({ rows, tableConfig, rowTarget, onRowClick }: TableProps) {
  return (
    <div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr className={styles.tr}>
            {tableConfig.map(({ label }: TableColumn) => (
              <th className={styles.th} key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {rows.map((row: any, i: number) => (
            <tr
              key={i}
              data-id={row['order_num']}
              data-target={rowTarget}
              className={styles.tr}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {tableConfig.map(({ property, accessor }: TableColumn, index: number) => (
                <td className={styles.td} key={`${i}-${index}`}>
                  {accessor ? accessor(row) : row[property as string]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
