import React from "react";
import styles from "./Table.module.css";

interface TableColumn {
  label: string;
  property?: string;
  property2?: string;
  accessor?: (row: any) => React.ReactNode;
}

interface TableProps {
  rows: any[];
  tableConfig: TableColumn[];
}

export function Table({ rows, tableConfig }: TableProps) {
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
            <tr key={i} data-id={row["order_num"]} className={styles.tr}>
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
  );
}
