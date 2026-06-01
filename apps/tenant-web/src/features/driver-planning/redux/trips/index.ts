import { API } from '../../utils/api'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { AppDispatch } from '../store'
import { coerceListPayload } from '../lib/coerce-list-payload'
import { notifyError } from '../../components/Snackbar/notify'

export interface TripsState {
  loading: boolean
  selectedTrip: any
  tripList: any[]
  query: any
  error: string | null
}

const tripsSlice = createSlice({
  name: 'trips',
  initialState: {
    loading: false,
    selectedTrip: null,
    tripList: [],
    query: {
      searchTerm: '',
      filters: {
        TripStatus_id: [
          { value: 1, label: 'Pending' },
          { value: 2, label: 'Accepted' },
          { value: 3, label: 'Offered' },
          { value: 4, label: 'In-Progress' },
        ],
        internal_status: [{ value: 'active', label: 'yes' }],
      },
      sortBy: { value: 'planned_first_day', order: 'desc' },
    },
    error: null,
  } as TripsState,
  reducers: {
    selectTrip(state, action: PayloadAction<any>) {
      const trip = action.payload
      state.selectedTrip = trip
    },
    fetchTripsStart(state, _action: PayloadAction<void>) {
      state.loading = true
    },
    fetchTripsSuccess(state, action: PayloadAction<any[]>) {
      // Defensive: the ported on-prem bridge can hand back null / a non-array on
      // some error shapes; coerceListPayload keeps tripList an array so the
      // <Trips> grid (which does `tripList.map`) can't crash the whole module
      // into the error boundary.
      state.tripList = coerceListPayload(action.payload)
      state.loading = false
    },
    fetchTripsFailure(state, action: PayloadAction<string>) {
      state.loading = false
      state.error = action.payload
    },
    changeTripsQuery(state, action: PayloadAction<any>) {
      state.query = {
        ...state.query,
        ...action.payload,
      }
    },
    editTrip(state, action: PayloadAction<any>) {
      state.selectedTrip = {
        ...(state.selectedTrip ?? {}),
        ...action.payload,
      }
    },
  },
})

export const { selectTrip, changeTripsQuery, editTrip } = tripsSlice.actions

export default tripsSlice.reducer

export const fetchTrips = (query: any) => async (dispatch: AppDispatch) => {
  const { fetchTripsStart, fetchTripsFailure, fetchTripsSuccess } = tripsSlice.actions
  try {
    dispatch(fetchTripsStart())
    const trips = await API.fetchTrips(query)
    dispatch(fetchTripsSuccess(trips))
  } catch (e: any) {
    console.error(e)
    dispatch(fetchTripsFailure(e.message))
  }
}

export const updateActivityForTrip =
  (activityId: any, activity: any) => async (_dispatch: AppDispatch) => {
    // Surface failures to the user. The original silent console.error here was
    // hiding the (very common) `/activities/undefined` 400 caused by the
    // `id`-vs-`activityId` shape mismatch — once that was fixed at the
    // reshape, real failures still need to be visible to the dispatcher so a
    // bad save doesn't masquerade as a successful one (the caller follows up
    // with a reloadTrip() that paints the stale row back onto the screen).
    try {
      await API.saveActivity(activityId, activity)
    } catch (e: any) {
      console.error(e, 'failed to save activity')
      notifyError(e?.message ?? 'Failed to save activity')
    }
  }
