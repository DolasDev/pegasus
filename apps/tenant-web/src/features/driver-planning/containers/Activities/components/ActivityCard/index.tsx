// ---------------------------------------------------------------------------
// One row of the Services board (formerly "Dispatch Activities").
//
// Two lines per card, mirroring ShipmentCard: line 1 is the operational answer
// ("what, when, who"), line 2 the identifying detail under it. Column order and
// count match the board's sortable header exactly — the header is what makes
// the columns readable, so a drift between the two is a real defect.
//
// Clicking a card opens the shipment detail panel for the activity's order,
// through the same `selectShipment` thunk a Planning shipment card uses. The
// trip number links to the trip screen; a local dispatch job's row shows a
// "Local" badge there instead. Otherwise read-only: there is no add-to-trip
// button.
// ---------------------------------------------------------------------------

import { useSelector } from 'react-redux'
import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'
import { Link } from '@/features/driver-planning/utils/router-compat'
import { Card } from '../../../../components/Card'
import clickableStyles from '../../../../components/Clickable/Clickable.module.css'
import { selectShipment } from '../../../../redux/shipments'
import { useAppDispatch } from '../../../../redux/hooks'
import type { RootState } from '../../../../redux/store'
import { formatDate } from '../../../../utils/format-date'
import { startCase } from '../../../../utils/string'
import styles from './ActivityCard.module.css'

export interface ActivityRow {
  /**
   * Set on every row when the board includes local dispatch jobs
   * (`include=local`): a job id and an activity id can be the same number.
   */
  row_key?: string
  /** `local` for a local dispatch job's act; absent or `longhaul` otherwise. */
  source?: 'longhaul' | 'local'
  /** The activity id — or, for a local row, the local dispatch job id. */
  id: number
  order_num: number | null
  TripMaster_id: number | null
  ActivityType_code: string | null
  estimated_date: string | null
  /**
   * `estimated_date ?? planned_start`, computed by the API. The board's date —
   * no-ETA types (PACK, LOAD, …) never carry an estimated_date.
   */
  scheduled_date: string | null
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
  const dispatch = useAppDispatch()
  const selectedShipment = useSelector((state: RootState) => state.shipments.selectedShipment)
  const orderNum = activity.order_num
  const isSelected =
    orderNum != null && selectedShipment != null && selectedShipment.order_num === orderNum

  const line1 = [
    <b>{formatDate(activity.scheduled_date, { defaultVal: EMPTY })}</b>,
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
    // The actual date sits directly under the scheduled one so a dispatcher
    // reads the pair as "due / done" in a single glance down the column.
    activity.actual_date ? formatDate(activity.actual_date, { defaultVal: '' }) : EMPTY,
    text(activity.haul_mode) === 'Y' ? 'Short haul' : '',
    text(activity.shipper_name),
    `${place(activity.origin_city, activity.origin_state)} → ${place(
      activity.destination_city,
      activity.destination_state,
    )}`,
    activity.source === 'local' ? (
      // A local job has no trip; the badge says why there is no trip link.
      <span className={styles.localBadge} data-target="activity-local-badge">
        Local
      </span>
    ) : activity.TripMaster_id ? (
      // `/trip/:id` is the legacy path; router-compat rewrites it to
      // /driver-planning/trips/:id. stopPropagation so following the link does
      // not also open the detail panel on the way out.
      <Link
        to={`/trip/${activity.TripMaster_id}`}
        className={clickableStyles.clickable}
        data-target="activity-trip-link"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {`Trip ${activity.TripMaster_id}`}
      </Link>
    ) : (
      ''
    ),
    activity.total_est_wt ? `${activity.total_est_wt} lbs` : '',
    '',
  ]

  return (
    <Card
      active={isSelected}
      onClick={(e: React.MouseEvent) => {
        // The detail panel closes on any click outside itself; without this the
        // same click that selects would bubble up and close it again.
        e.stopPropagation()
        if (orderNum == null) return
        // The thunk needs only order_num: it fetches the full shipment row.
        dispatch(selectShipment({ order_num: orderNum } as LonghaulShipmentRow) as any)
      }}
      className={`${styles.activityCard} ${isComplete(activity) ? styles.complete : ''}`}
      data-target="activity-card"
      data-activity-id={String(activity.id)}
      data-row-key={activity.row_key}
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
