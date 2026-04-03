import React from "react";
import styles from "./Table.module.css";

export function Table({ rows, tableConfig }) {
  return (
    <div>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr className={styles.tr}>
            {tableConfig.map(({ label }) => (
              <th className={styles.th} key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {rows.map((row, i) => (
            <tr key={i} data-id={row["order_num"]} className={styles.tr}>
              {tableConfig.map(({ property, accessor }, index) => (
                <td className={styles.td} key={`${i}-${index}`}>
                  {accessor ? accessor(row) : row[property]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
