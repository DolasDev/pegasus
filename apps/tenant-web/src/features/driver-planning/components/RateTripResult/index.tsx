import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../Button'
import { uncableLabel, type RateRow } from '../../utils/rate-shipment'
import styles from './RateTripResult.module.css'

interface RateTripResultProps {
  open: boolean
  onClose: () => void
  loading: boolean
  error: Error | null
  rows: RateRow[]
  total: number
}

const usd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function lane(row: RateRow): string {
  const s = row.shipment
  const from = [s.shipper_city, s.shipper_state].filter(Boolean).join(', ')
  const to = [s.consignee_city, s.consignee_state].filter(Boolean).join(', ')
  return from && to ? `${from} → ${to}` : from || to || '—'
}

function RowCell({ row }: { row: RateRow }): React.ReactElement {
  if (row.status === 'rated') {
    return (
      <span className={styles.amount} data-target="rate-row-amount">
        {usd(row.total ?? 0)}
        {row.warnings && row.warnings.length > 0 ? (
          <span className={styles.warn} title={row.warnings.join('\n')}>
            {' '}
            ⚠
          </span>
        ) : null}
      </span>
    )
  }
  const note = row.status === 'uncable' && row.reason ? uncableLabel(row.reason) : row.message
  return (
    <span className={styles.uncable} data-target="rate-row-uncable" title={note}>
      — <span className={styles.uncableNote}>{note}</span>
    </span>
  )
}

export const RateTripResult: React.FC<RateTripResultProps> = ({
  open,
  onClose,
  loading,
  error,
  rows,
  total,
}) => {
  const ratedCount = rows.filter((r) => r.status === 'rated').length
  const skipped = rows.length - ratedCount

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} data-target="rate-trip-result">
          <Dialog.Title asChild>
            <h2 className={styles.title}>400NG trip rate</h2>
          </Dialog.Title>
          <p className={styles.subtitle}>
            Published 400NG baseline (undiscounted) — for planning only; differs from the negotiated
            Linehaul figure.
          </p>

          {loading ? (
            <div className={styles.state} data-target="rate-trip-loading">
              Rating shipments…
            </div>
          ) : error ? (
            <div className={styles.error} data-target="rate-trip-error">
              Could not rate this trip: {error.message}
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.state}>No shipments on this trip.</div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Lane</th>
                      <th className={styles.num}>Est. wt</th>
                      <th className={styles.num}>400NG total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={row.shipment.order_num ?? i}
                        data-target="rate-row"
                        data-status={row.status}
                      >
                        <td>{row.shipment.order_num ?? '—'}</td>
                        <td className={styles.laneCell}>{lane(row)}</td>
                        <td className={styles.num}>
                          {Number(row.shipment.total_est_wt) > 0
                            ? `${Number(row.shipment.total_est_wt).toLocaleString()} lb`
                            : '—'}
                        </td>
                        <td className={styles.num}>
                          <RowCell row={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr data-target="rate-trip-total-row">
                      <td colSpan={3} className={styles.totalLabel}>
                        Trip total{skipped > 0 ? ` (${skipped} not rated)` : ''}
                      </td>
                      <td className={styles.num}>
                        <strong data-target="rate-trip-total">{usd(total)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          <div className={styles.actions}>
            <Button type="button" onClick={onClose} data-target="rate-trip-close">
              Close
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
