// ---------------------------------------------------------------------------
// Dispatch Activities filter bar.
//
// Deliberately NOT the shipments board's collapsible 17-field panel. This board
// has five controls and they are the whole point of the screen, so they sit
// open on one row rather than behind a caret.
//
// The date pair is the one real divergence from the Planning screen: its
// FilterTabs stores day OFFSETS from today (`daysBetween`) and reconstitutes
// dates later. Here the dispatcher picks absolute dates, because "the 14th"
// must still mean the 14th on a board left open overnight.
// ---------------------------------------------------------------------------

import { useDispatch, useSelector } from 'react-redux'
import { Select } from '../../../../components/Select'
import { InputField } from '../../../../components/InputField'
import { SHAUL_LIST } from '../../../../utils/shaul-list'
import { changeActivityQuery, clearActivityFilters } from '../../../../redux/activities'
import type { RootState } from '../../../../redux/store'
import styles from './ActivityFilters.module.css'

/**
 * Placeholder office list.
 *
 * There is no office/branch dimension in the legacy schema — not on
 * `LongDistanceDispatchActivity`, not on `v_longhaul_shipments_v2`, nowhere in
 * the API. The control is rendered DISABLED so the eventual shape of the screen
 * is visible without implying a filter that works: a live-looking control that
 * silently changes nothing is worse than an obviously inert one.
 */
const OFFICE_PLACEHOLDER_OPTIONS = [
  { label: 'All offices', value: '' },
  { label: 'Chicago', value: 'chicago' },
  { label: 'Atlanta', value: 'atlanta' },
  { label: 'Dallas', value: 'dallas' },
]

const selectStyles = {
  control: (s: any) => ({ ...s, minHeight: 30, boxShadow: '0 2px 4px 0 rgba(0,0,0,0.2)' }),
  input: (s: any) => ({ ...s, minWidth: 80 }),
}

export function ActivityFilters() {
  const dispatch = useDispatch()
  const query = useSelector((state: RootState) => state.activities.query)
  const filterOptions = useSelector((state: RootState) => state.common.filterOptions)
  const dispatcherList = useSelector((state: RootState) => state.common.dispatcherList)

  const setFilters = (patch: Record<string, unknown>) =>
    dispatch(changeActivityQuery({ filters: patch }))

  const setDate = (index: 0 | 1, value: string) => {
    const [from, to] = query.filters.date_range
    setFilters({ date_range: index === 0 ? [value, to] : [from, value] })
  }

  // The same catalog the shipments board's Last Activity filter uses — the
  // reference-data bootstrap already loads it, so this costs no extra request.
  const activityTypeOptions = filterOptions?.activityType ?? []

  const dispatcherOptions = (dispatcherList ?? []).map((d: any) => ({
    label: `${d.first_name} ${d.last_name}`,
    value: d.code,
  }))

  // Counted for the Clear affordance: the date range always has a value, so it
  // is excluded — otherwise "Clear" would offer itself on an untouched board.
  const activeCount = (['activity_type', 'short_haul', 'operations_id'] as const).filter(
    (k) => query.filters[k]?.length,
  ).length

  return (
    <div className={styles.container} data-target="activity-filters">
      <div className={styles.filter} data-filter="date_range">
        <label htmlFor="activity-date-from">Dates</label>
        <div className={styles.dateRange}>
          <InputField
            id="activity-date-from"
            type="date"
            aria-label="Activity date from"
            data-testid="activities-filter-date-from"
            value={query.filters.date_range[0] ?? ''}
            onChange={(e: any) => setDate(0, e.target.value)}
          />
          <span className={styles.dateSeparator}>to</span>
          <InputField
            type="date"
            aria-label="Activity date to"
            data-testid="activities-filter-date-to"
            value={query.filters.date_range[1] ?? ''}
            onChange={(e: any) => setDate(1, e.target.value)}
          />
        </div>
      </div>

      <div className={styles.filter} data-filter="office">
        <label id="activities-filter-office-label">Office</label>
        <div className={styles.control} data-testid="activities-filter-office">
          {/* Unwired — see OFFICE_PLACEHOLDER_OPTIONS. Remove `isDisabled` and
              add `office` to buildActivityRequest once a real office dimension
              exists in the schema. */}
          <Select
            isMulti
            isDisabled
            aria-labelledby="activities-filter-office-label"
            placeholder="Coming soon"
            options={OFFICE_PLACEHOLDER_OPTIONS}
            styles={selectStyles}
            isClearable={false}
            value={[]}
            onChange={() => {}}
          />
        </div>
      </div>

      <div className={styles.filter} data-filter="activity_type">
        <label id="activities-filter-type-label">Activity Type</label>
        <div className={styles.control} data-testid="activities-filter-type">
          <Select
            isMulti
            aria-labelledby="activities-filter-type-label"
            placeholder="All types"
            options={activityTypeOptions}
            styles={selectStyles}
            isClearable={false}
            value={query.filters.activity_type}
            onChange={(value: any) => setFilters({ activity_type: value ?? [] })}
          />
        </div>
      </div>

      <div className={styles.filter} data-filter="short_haul">
        <label id="activities-filter-shorthaul-label">Short Haul</label>
        <div className={styles.control} data-testid="activities-filter-short-haul">
          <Select
            isMulti
            aria-labelledby="activities-filter-shorthaul-label"
            placeholder="Yes / No"
            options={SHAUL_LIST}
            styles={selectStyles}
            isClearable={false}
            value={query.filters.short_haul}
            onChange={(value: any) => setFilters({ short_haul: value ?? [] })}
          />
        </div>
      </div>

      <div className={styles.filter} data-filter="operations_id">
        <label id="activities-filter-dispatcher-label">Dispatcher</label>
        <div className={styles.control} data-testid="activities-filter-dispatcher">
          <Select
            isMulti
            aria-labelledby="activities-filter-dispatcher-label"
            placeholder="All dispatchers"
            options={dispatcherOptions}
            styles={selectStyles}
            isClearable={false}
            value={query.filters.operations_id}
            onChange={(value: any) => setFilters({ operations_id: value ?? [] })}
          />
        </div>
      </div>

      {activeCount > 0 && (
        <a
          className={styles.clear}
          data-target="clear-activity-filters"
          onClick={() => dispatch(clearActivityFilters())}
        >
          Clear ({activeCount})
        </a>
      )}
    </div>
  )
}
