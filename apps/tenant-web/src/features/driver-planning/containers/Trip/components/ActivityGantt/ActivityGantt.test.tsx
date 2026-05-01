import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('../../../../utils/api', () => ({
  API: {
    updateActivity: vi.fn(async () => ({})),
  },
}))

import { renderWithStore } from '../../../../__test-utils__/render-with-store'
import { ActivityGantt } from './ActivityGantt'

const days = ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']

const baseActivity = (overrides: any = {}) => ({
  activityId: 1,
  TripMaster_id: 100,
  order_num: 'O1',
  state: 'TX',
  planned_start: '2024-01-01T00:00:00Z',
  planned_end: '2024-01-02T00:00:00Z',
  estimated_date: null,
  actual_date: null,
  is_committed: false,
  is_confirmed: false,
  hasDateChange: false,
  activityType: { abbreviation: 'PK', code: 'PACK', isHasETA: true },
  shipment: { total_est_wt: 5000, pegasus_shadow: null },
  ...overrides,
})

describe('ActivityGantt', () => {
  it('renders day headers for each provided day', () => {
    const { container } = renderWithStore(
      <ActivityGantt
        days={days}
        activities={[]}
        orderIdToColor={{}}
        reloadTrip={() => {}}
      />,
    )
    const headers = container.querySelectorAll('h5')
    expect(headers.length).toBe(days.length)
  })

  it('renders an "Unknown" header for null days', () => {
    renderWithStore(
      <ActivityGantt
        days={[null]}
        activities={[]}
        orderIdToColor={{}}
        reloadTrip={() => {}}
      />,
    )
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('renders each activity (abbreviation + state) in the chart', () => {
    const activities = [
      baseActivity({ activityId: 1, state: 'TX', order_num: 'O1' }),
      baseActivity({
        activityId: 2,
        state: 'CA',
        order_num: 'O2',
        activityType: { abbreviation: 'DL', code: 'DELIVERY' },
      }),
    ]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1', O2: 'c2' }}
        reloadTrip={() => {}}
      />,
    )
    expect(screen.getByText('TX')).toBeInTheDocument()
    expect(screen.getByText('CA')).toBeInTheDocument()
    // Abbreviations appear with weight
    const matches = screen.getAllByText(/PK|DL/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('opens a popover when an activity is clicked (no hasDateChange)', () => {
    const activities = [baseActivity()]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1' }}
        reloadTrip={() => {}}
      />,
    )
    // The activity row contains a div with a class that includes 'activity'.
    // Click the inner content (state text) to bubble up.
    fireEvent.click(screen.getByText('TX'))
    expect(screen.getByText('save')).toBeInTheDocument()
    expect(screen.getByText('close')).toBeInTheDocument()
  })

  it('shows "Update Itinerary Dates" when activity hasDateChange is set', () => {
    const activities = [
      baseActivity({
        hasDateChange: true,
        newStart: '2024-01-03T00:00:00Z',
        newEnd: '2024-01-04T00:00:00Z',
      }),
    ]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1' }}
        reloadTrip={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('TX'))
    expect(screen.getByText('Update Itinerary Dates')).toBeInTheDocument()
  })
})
