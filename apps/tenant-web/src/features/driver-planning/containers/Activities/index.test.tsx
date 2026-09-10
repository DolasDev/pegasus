// ---------------------------------------------------------------------------
// Dispatch Activities board — render + filter-wiring tests.
//
// The API module is mocked so the debounced effect never reaches the network;
// what these assert is the board's own contract: what it renders, what the
// controls dispatch, and that the mocked Office control stays inert.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('../../utils/api', () => ({
  API: { fetchActivities: vi.fn().mockResolvedValue([]) },
}))

import { renderWithStore } from '../../__test-utils__/render-with-store'
import { ActivitiesDashboard } from './index'
import { DEFAULT_ACTIVITY_QUERY } from '../../redux/activities'

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    order_num: 5001,
    TripMaster_id: 77,
    ActivityType_code: 'PACK',
    estimated_date: '2026-09-14',
    actual_date: null,
    status: 'Scheduled',
    city: 'CHICAGO',
    state: 'IL',
    street: '1 Main St',
    activity_type_name: 'Packing',
    activity_type_abbreviation: 'PACK',
    driver_name: 'J SMITH',
    shipper_name: 'ACME CORP',
    origin_city: 'CHICAGO',
    origin_state: 'IL',
    destination_city: 'DALLAS',
    destination_state: 'TX',
    haul_mode: 'N',
    dispatcher_last_name: 'Nguyen',
    total_est_wt: 4200,
    ...overrides,
  }
}

const commonState = {
  filterOptions: { activityType: [{ label: 'Packing', value: 'PACK' }] },
  dispatcherList: [{ code: '1196', first_name: 'Ada', last_name: 'Nguyen' }],
}

describe('ActivitiesDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the lane title with a live count', () => {
    renderWithStore(<ActivitiesDashboard />, {
      activities: { activityList: [makeActivity(), makeActivity({ id: 2 })] },
      common: commonState,
    })

    expect(screen.getByText('Activities (2)')).toBeInTheDocument()
  })

  it('renders one card per activity', () => {
    renderWithStore(<ActivitiesDashboard />, {
      activities: { activityList: [makeActivity(), makeActivity({ id: 2, order_num: 5002 })] },
      common: commonState,
    })

    const cards = document.querySelectorAll('[data-target="activity-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.getAttribute('data-order-num')).toBe('5001')
  })

  it('shows the empty state, not an error, once an empty load settles', async () => {
    // The board fetches on mount (useDebounce hands back its initial value
    // immediately), so `loading` is true on first paint — the empty state is
    // only correct after that first response lands.
    renderWithStore(<ActivitiesDashboard />, {
      activities: { activityList: [], loading: false, error: null },
      common: commonState,
    })

    expect(await screen.findByText('No activities found')).toBeInTheDocument()
    expect(document.querySelector('[data-target="activities-error"]')).toBeNull()
  })

  it('renders the API error in place of the list — the row cap is actionable, not an incident', () => {
    renderWithStore(<ActivitiesDashboard />, {
      activities: {
        activityList: [],
        error: 'Too many activities — please narrow your date range or filters.',
      },
      common: commonState,
    })

    expect(screen.getByText('Could not load activities')).toBeInTheDocument()
    expect(
      screen.getByText('Too many activities — please narrow your date range or filters.'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-target="activities-empty"]')).toBeNull()
  })

  it('does not render the empty state while the first load is in flight', () => {
    renderWithStore(<ActivitiesDashboard />, {
      activities: { activityList: [], loading: true, error: null },
      common: commonState,
    })

    expect(screen.queryByText('No activities found')).not.toBeInTheDocument()
  })

  describe('column header', () => {
    it('renders a header per card column, in the card’s order', () => {
      renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })

      const labels = Array.from(
        document.querySelectorAll('[data-target="activity-sort-header"]'),
      ).map((el) => el.textContent)
      expect(labels).toEqual([
        'Date',
        'Type',
        'Order',
        'Location',
        'Driver',
        'Dispatcher',
        'Status',
      ])
    })

    it('sorts ascending on first click and flips on the second', () => {
      const { store } = renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })
      const orderHeader = document.querySelector('[data-sort="order_num"]')!

      fireEvent.click(orderHeader)
      expect(store.getState().activities.query.sortBy).toEqual({
        value: 'order_num',
        order: 'asc',
      })

      fireEvent.click(orderHeader)
      expect(store.getState().activities.query.sortBy).toEqual({
        value: 'order_num',
        order: 'desc',
      })
    })
  })

  describe('filters', () => {
    it('seeds the date inputs from the default window', () => {
      renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })

      const [from, to] = DEFAULT_ACTIVITY_QUERY.filters.date_range
      expect(screen.getByTestId('activities-filter-date-from')).toHaveValue(from)
      expect(screen.getByTestId('activities-filter-date-to')).toHaveValue(to)
    })

    it('updates only the edited end of the range', () => {
      const { store } = renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })
      const originalTo = DEFAULT_ACTIVITY_QUERY.filters.date_range[1]

      fireEvent.change(screen.getByTestId('activities-filter-date-from'), {
        target: { value: '2026-01-02' },
      })

      expect(store.getState().activities.query.filters.date_range).toEqual([
        '2026-01-02',
        originalTo,
      ])
    })

    it('renders the Office control DISABLED — there is no office dimension yet', () => {
      renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })

      const office = screen.getByTestId('activities-filter-office')
      expect(office).toBeInTheDocument()
      // react-select renders a disabled control with no focusable input. An
      // enabled-looking control that filters nothing is worse than an inert one.
      expect(office.querySelector('input:not([disabled])')).toBeNull()
    })

    it('offers the activity types the reference-data bootstrap already loaded', () => {
      renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })

      expect(screen.getByTestId('activities-filter-type')).toBeInTheDocument()
      expect(screen.getByText('All types')).toBeInTheDocument()
    })

    it('lists dispatchers by full name against their code', () => {
      renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })

      expect(screen.getByTestId('activities-filter-dispatcher')).toBeInTheDocument()
      expect(screen.getByText('All dispatchers')).toBeInTheDocument()
    })

    it('offers Clear only once a real filter is set', () => {
      const { store, rerender } = renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })

      // The date range always has a value, so an untouched board shows no Clear.
      expect(document.querySelector('[data-target="clear-activity-filters"]')).toBeNull()

      store.dispatch({
        type: 'activities/changeActivityQuery',
        payload: { filters: { short_haul: [{ label: 'Yes', value: 'Y' }] } },
      })
      rerender(<ActivitiesDashboard />)

      expect(document.querySelector('[data-target="clear-activity-filters"]')).not.toBeNull()
    })

    it('Clear empties the selection filters but keeps the date range', () => {
      const { store, rerender } = renderWithStore(<ActivitiesDashboard />, {
        activities: { activityList: [] },
        common: commonState,
      })
      store.dispatch({
        type: 'activities/changeActivityQuery',
        payload: { filters: { short_haul: [{ label: 'Yes', value: 'Y' }] } },
      })
      rerender(<ActivitiesDashboard />)

      const dates = store.getState().activities.query.filters.date_range

      fireEvent.click(document.querySelector('[data-target="clear-activity-filters"]')!)

      expect(store.getState().activities.query.filters.short_haul).toEqual([])
      expect(store.getState().activities.query.filters.date_range).toEqual(dates)
    })
  })
})
