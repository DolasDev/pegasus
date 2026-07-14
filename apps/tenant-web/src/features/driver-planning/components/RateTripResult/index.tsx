import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../Button'
import { uncableLabel, type RateRow } from '../../utils/rate-shipment'
import styles from './RateTripResult.module.css'

interface RateTripResultProps {
  open: boolean
  onClose: () => void
  onRate: (discountPercent: number) => void
  loading: boolean
  error: Error | null
  hasResult: boolean
  rows: RateRow[]
  total: number
  /** Discount that produced the current rows (0 = baseline). */
  appliedDiscount: number
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

/** Valid discount = whole number 0–100. */
function parseDiscount(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null
}

export const RateTripResult: React.FC<RateTripResultProps> = ({
  open,
  onClose,
  onRate,
  loading,
  error,
  hasResult,
  rows,
  total,
  appliedDiscount,
}) => {
  const [discount, setDiscount] = useState('0')
  const parsed = parseDiscount(discount)
  const invalid = parsed === null

  const ratedCount = rows.filter((r) => r.status === 'rated').length
  const skipped = rows.length - ratedCount

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (invalid || loading) return
    onRate(parsed)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} data-target="rate-trip-result">
          <Dialog.Title asChild>
            <h2 className={styles.title}>Rate trip (400NG)</h2>
          </Dialog.Title>
          <p className={styles.subtitle}>
            Enter the TSP-negotiated linehaul discount, then rate. Result is the published 400NG
            tariff with that discount applied — for planning; differs from the negotiated Linehaul
            figure.
          </p>

          <form className={styles.controls} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>Linehaul discount (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className={styles.input}
                data-target="rate-trip-discount"
                aria-invalid={invalid}
              />
            </label>
            <Button type="submit" disabled={invalid || loading} data-target="rate-trip-run">
              {hasResult ? 'Re-rate' : 'Rate'}
            </Button>
          </form>
          {invalid ? (
            <p className={styles.fieldError} data-target="rate-trip-discount-error">
              Enter a whole number between 0 and 100.
            </p>
          ) : null}

          {loading ? (
            <div className={styles.state} data-target="rate-trip-loading">
              Rating shipments…
            </div>
          ) : error ? (
            <div className={styles.error} data-target="rate-trip-error">
              Could not rate this trip: {error.message}
            </div>
          ) : !hasResult ? (
            <div className={styles.state} data-target="rate-trip-idle">
              {rows.length === 0 && total === 0 ? 'Enter a discount and rate the trip.' : null}
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.state}>No shipments on this trip.</div>
          ) : (
            <>
              <p className={styles.applied} data-target="rate-trip-applied-discount">
                {appliedDiscount > 0
                  ? `${appliedDiscount}% linehaul discount applied.`
                  : 'No discount applied (published baseline).'}
              </p>
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
            <Button type="button" inverted onClick={onClose} data-target="rate-trip-close">
              Close
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
