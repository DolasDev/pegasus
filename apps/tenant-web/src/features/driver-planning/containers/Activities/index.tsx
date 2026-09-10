// ---------------------------------------------------------------------------
// Dispatch Activities board — the activity-level counterpart to the Planning
// screen's shipment board.
//
// Same anatomy as `containers/Shipments` (a `Lane` scroll box under a sticky
// title + filters + sortable column header), one column wide: this screen asks
// "what has to happen on these dates?", and there is nothing to drag work into
// yet. Pending Trips and the detail drawer are deliberately absent — see the
// module.
// ---------------------------------------------------------------------------

import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'
import { Lane } from '../../components/Lane'
import { useDebounce } from '../../utils/hooks/use-debounce'
import { useAppDispatch } from '../../redux/hooks'
import { getSortByValue } from '../../utils/sort'
import { fetchActivities, changeActivityQuery } from '../../redux/activities'
import type { RootState } from '../../redux/store'
import { ActivityFilters } from './components/ActivityFilters'
import { ActivityCard, type ActivityRow } from './components/ActivityCard'
import styles from './Activities.module.css'

/**
 * Column headers. `value` is the sort key the API whitelists — a key absent
 * from that whitelist silently falls back to the default ordering, so the two
 * lists have to agree.
 *
 * The order here IS the order ActivityCard renders its line-1 cells in.
 */
const HEADERS = [
  { label: 'Date', value: 'estimated_date' },
  { label: 'Type', value: 'activity_type' },
  { label: 'Order', value: 'order_num' },
  { label: 'Location', value: 'city' },
  { label: 'Driver', value: 'driver_name' },
  { label: 'Dispatcher', value: 'dispatcher' },
  { label: 'Status', value: 'status' },
]

const MemoizedActivityCards = React.memo(({ activities }: { activities: ActivityRow[] }) => (
  <>
    {activities.map((activity) => (
      <ActivityCard key={activity.id} activity={activity} />
    ))}
  </>
))

export const ActivitiesDashboard = () => {
  const dispatch = useAppDispatch()
  const activities = useSelector((state: RootState) => state.activities.activityList)
  const query = useSelector((state: RootState) => state.activities.query)
  const loading = useSelector((state: RootState) => state.activities.loading)
  const error = useSelector((state: RootState) => state.activities.error)

  // Debounced so dragging through a month in the date picker fires one query,
  // not thirty. Same 1s window the shipments board uses.
  const debouncedQuery = useDebounce(query, 1000)

  useEffect(() => {
    if (debouncedQuery) dispatch(fetchActivities(debouncedQuery) as any)
  }, [debouncedQuery, dispatch])

  const changeSortBy = (value: string) => {
    dispatch(changeActivityQuery({ sortBy: getSortByValue(query, value) }))
  }

  return (
    <div className={styles.container} data-target="activities-dashboard">
      <Lane key="Activities" className={styles.activitiesLane}>
        <div className={styles.stickyHeader}>
          <h5 className={styles.laneTitle}>{`Activities (${activities.length})`}</h5>
          <ActivityFilters />
          <div className={styles.flexContainer}>
            {HEADERS.map(({ label, value }) => (
              <b
                className={styles.header}
                data-target="activity-sort-header"
                data-sort={value}
                onClick={() => changeSortBy(value)}
                key={value}
              >
                {label}
                {query.sortBy?.value === value && (
                  <i
                    className={`fas fa-caret-up ${query.sortBy.order === 'desc' ? styles.down : ''}`}
                  />
                )}
              </b>
            ))}
          </div>
        </div>
        {error ? (
          // Rendered in place of the list, not toasted: the most likely error
          // here is RESULT_LIMIT_EXCEEDED, which is an instruction to the
          // dispatcher ("narrow your date range") rather than a failure.
          <div className={styles.emptyDisclaimer} data-target="activities-error">
            <h3>Could not load activities</h3>
            {error}
          </div>
        ) : activities.length || loading ? (
          <MemoizedActivityCards activities={activities as ActivityRow[]} />
        ) : (
          <div className={styles.emptyDisclaimer} data-target="activities-empty">
            <h3>No activities found</h3>
            Try widening the date range or clearing a filter.
          </div>
        )}
      </Lane>
    </div>
  )
}
