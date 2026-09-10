// ---------------------------------------------------------------------------
// Dispatch Activities board state.
//
// Mirrors redux/shipments in shape and naming so the two boards stay legible
// side by side, but the query it holds is deliberately different: the shipments
// board filters on day OFFSETS from today, this one on absolute dates. A
// dispatcher working "the 14th" means the 14th, not "four days out" — and the
// offsets silently shift under a board left open past midnight.
// ---------------------------------------------------------------------------

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { API } from '../../utils/api'
import type { AppDispatch } from '../store'
import { coerceListPayload } from '../lib/coerce-list-payload'
import type { SortBy } from '../../utils/sort'

/** `YYYY-MM-DD` for today plus `offsetDays`, in the browser's local zone. */
export function activityDateOffset(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * How wide the board opens.
 *
 * Not cosmetic: activities outnumber shipments several-to-one (an order yields
 * a PACK, a LOAD, a DELIVERY and any extras), and the API caps a response at
 * 1000 rows with a 400. An unbounded first load would greet the dispatcher with
 * "narrow your date range" instead of their work.
 */
export const ACTIVITIES_DEFAULT_RANGE_DAYS = 7

export interface ActivityFilters {
  /** Inclusive `[from, to]`, `YYYY-MM-DD`. */
  date_range: [string, string]
  activity_type: Array<{ label: string; value: string }>
  short_haul: Array<{ label: string; value: string }>
  operations_id: Array<{ label: string; value: string }>
  /**
   * Mocked. There is no office/branch dimension in the legacy schema, so this
   * is carried in state (the control is a real, if disabled, select) but never
   * sent — see buildActivityRequest.
   */
  office: Array<{ label: string; value: string }>
}

export interface ActivityQuery {
  filters: ActivityFilters
  /** `null` = the API's default ordering (soonest activity first). */
  sortBy: SortBy | null
}

export const DEFAULT_ACTIVITY_QUERY: ActivityQuery = {
  filters: {
    date_range: [activityDateOffset(0), activityDateOffset(ACTIVITIES_DEFAULT_RANGE_DAYS)],
    activity_type: [],
    short_haul: [],
    operations_id: [],
    office: [],
  },
  sortBy: null,
}

/**
 * Strip the client-only fields before the query goes on the wire.
 *
 * `office` is unwired: sending it would have the API silently ignore an
 * unknown key, which reads as "the filter works" right up until someone
 * believes a filtered result.
 */
export function buildActivityRequest(query: ActivityQuery): unknown {
  const { office: _office, ...filters } = query.filters
  return { filters, sortBy: query.sortBy }
}

export interface ActivitiesState {
  loading: boolean
  activityList: any[]
  query: ActivityQuery
  error: string | null
}

const activitiesSlice = createSlice({
  name: 'activities',
  initialState: {
    loading: false,
    activityList: [],
    query: structuredClone(DEFAULT_ACTIVITY_QUERY),
    error: null,
  } as ActivitiesState,
  reducers: {
    // Deep-merges `filters` so a partial payload from one control doesn't wipe
    // the others — same contract as changeShipmentQuery.
    changeActivityQuery(state, action: PayloadAction<any>) {
      const payload = action.payload ?? {}
      state.query = {
        ...state.query,
        ...payload,
        filters: {
          ...state.query.filters,
          ...(payload.filters ?? {}),
        },
      }
    },
    resetActivityQuery(state) {
      // Re-derive the range rather than replaying a range captured at module
      // load: a board open across midnight should reset to the NEW today.
      state.query = {
        ...structuredClone(DEFAULT_ACTIVITY_QUERY),
        filters: {
          ...structuredClone(DEFAULT_ACTIVITY_QUERY.filters),
          date_range: [activityDateOffset(0), activityDateOffset(ACTIVITIES_DEFAULT_RANGE_DAYS)],
        },
      }
    },
    fetchActivitiesStart(state) {
      state.loading = true
    },
    fetchActivitiesSuccess(state, action: PayloadAction<any[]>) {
      // coerceListPayload keeps activityList an array whatever the bridge
      // returns, so the board's `.map` can't error-boundary the module.
      state.activityList = coerceListPayload(action.payload)
      state.loading = false
      state.error = null
    },
    fetchActivitiesFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.activityList = []
      state.error = action.payload
    },
  },
})

export const {
  changeActivityQuery,
  resetActivityQuery,
  fetchActivitiesStart,
  fetchActivitiesSuccess,
  fetchActivitiesFailure,
} = activitiesSlice.actions

export const fetchActivities = (query: ActivityQuery) => async (dispatch: AppDispatch) => {
  try {
    dispatch(fetchActivitiesStart())
    const activities = await API.fetchActivities(buildActivityRequest(query))
    dispatch(fetchActivitiesSuccess(activities))
  } catch (e: any) {
    console.error('Error fetching activities', e)
    // The message is rendered in place of the list rather than only toasted:
    // RESULT_LIMIT_EXCEEDED ("narrow your date range") is a normal, actionable
    // outcome on this board, not an incident.
    dispatch(fetchActivitiesFailure(e?.message ?? 'Failed to fetch activities'))
  }
}

export default activitiesSlice.reducer
