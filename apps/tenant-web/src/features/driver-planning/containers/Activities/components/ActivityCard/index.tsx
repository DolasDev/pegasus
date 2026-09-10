// ---------------------------------------------------------------------------
// One row of the Dispatch Activities board.
//
// Two lines per card, mirroring ShipmentCard: line 1 is the operational answer
// ("what, when, who"), line 2 the identifying detail under it. Column order and
// count match the board's sortable header exactly — the header is what makes
// the columns readable, so a drift between the two is a real defect.
//
// Read-only in v1. No click target, no selection, no add-to-trip button.
// ---------------------------------------------------------------------------

import { Card } from '../../../../components/Card'
import { formatDate } from '../../../../utils/format-date'
import { startCase } from '../../../../utils/string'
import styles from './ActivityCard.module.css'

export interface ActivityRow {
  id: number
  order_num: number | null
  TripMaster_id: number | null
  ActivityType_code: string | null
  estimated_date: string | null
  actual_date: string | null
  status: string | null
  city: string | null
  state: string | null
  street: string | null
  activity_type_name: string | null
  activity_type_abbreviation: string | null
  driver_name: string | null
  shipper_name: string | null
  origin_city: string | null
  origin_state: string | null
  destination_city: string | null
  destination_state: string | null
  haul_mode: string | null
  dispatcher_last_name: string | null
  total_est_wt: number | string | null
}

const EMPTY = '—'

/** SCREAMING legacy city names read as shouting; `CHICAGO` -> `Chicago`. */
function titleCase(value: string): string {
  return startCase(value.toLowerCase())
}

/** Legacy nvarchar columns carry trailing spaces (#628); trim before display. */
function text(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
  return s.length ? s : EMPTY
}

/** `CITY, ST` from whichever half is present, rather than a stray comma. */
function place(city: unknown, state: unknown): string {
  const c = typeof city === 'string' ? titleCase(city.trim()) : ''
  const s = typeof state === 'string' ? state.trim() : ''
  if (c && s) return `${c}, ${s}`
  return c || s || EMPTY
}

/**
 * Whether this activity is done.
 *
 * `actual_date` is the only honest signal — `status` is free text on this table
 * and varies by tenant, so it is displayed but never interpreted.
 */
function isComplete(activity: ActivityRow): boolean {
  return Boolean(activity.actual_date)
}

export function ActivityCard({ activity }: { activity: ActivityRow }) {
  const line1 = [
    <b>{formatDate(activity.estimated_date, { defaultVal: EMPTY })}</b>,
    <span title={text(activity.activity_type_name)}>
      <b>{text(activity.activity_type_abbreviation ?? activity.ActivityType_code)}</b>
    </span>,
    text(activity.order_num),
    place(activity.city, activity.state),
    text(activity.driver_name),
    text(activity.dispatcher_last_name),
    text(activity.status),
  ]

  const line2 = [
    // The actual date sits directly under the estimated one so a dispatcher
    // reads the pair as "due / done" in a single glance down the column.
    activity.actual_date ? formatDate(activity.actual_date, { defaultVal: '' }) : EMPTY,
    text(activity.haul_mode) === 'Y' ? 'Short haul' : '',
    text(activity.shipper_name),
    `${place(activity.origin_city, activity.origin_state)} → ${place(
      activity.destination_city,
      activity.destination_state,
    )}`,
    activity.TripMaster_id ? `Trip ${activity.TripMaster_id}` : '',
    activity.total_est_wt ? `${activity.total_est_wt} lbs` : '',
    '',
  ]

  return (
    <Card
      className={`${styles.activityCard} ${isComplete(activity) ? styles.complete : ''}`}
      data-target="activity-card"
      data-activity-id={String(activity.id)}
      data-order-num={activity.order_num == null ? undefined : String(activity.order_num)}
    >
      <div className={styles.lines}>
        {[line1, line2].map((line, i) => (
          <div className={styles.row} key={i}>
            {line.map((val, idx) => (
              <div key={idx}>{val}</div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}
