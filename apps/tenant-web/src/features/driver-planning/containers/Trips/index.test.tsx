import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => (
    <a
      href={typeof props.to === 'string' ? props.to : ''}
      className={props.className}
      onClick={props.onClick}
    >
      {props.children}
    </a>
  ),
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('../../utils/api', () => {
  const make = (value: any = []) => vi.fn(async () => value)
  const API = {
    fetchTrips: make([]),
    fetchStates: make([]),
    fetchDrivers: make([]),
    fetchTripStatuses: make([]),
    fetchRejectedTrips: make([]),
  }
  return { API }
})

import { renderWithStore } from '../../__test-utils__/render-with-store'
import { Trips } from './index'
import { API } from '../../utils/api'

describe('Trips container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the lane title with the trip count', () => {
    renderWithStore(<Trips />, {
      preloadedState: {
        trips: {
          tripList: [
            { id: 1, trip_title: 'A', driver: null, status: null, internal_status: 'active' },
            { id: 2, trip_title: 'B', driver: null, status: null, internal_status: 'active' },
          ],
        } as any,
      },
    })
    expect(screen.getByText(/Trips \(2\)/)).toBeInTheDocument()
  })

  it('renders the empty state when there are no trips and not loading', () => {
    renderWithStore(<Trips />, {
      preloadedState: {
        trips: { tripList: [] } as any,
        shipments: { loading: false } as any,
      },
    })
    expect(screen.getByText('No trips found')).toBeInTheDocument()
  })

  it('does NOT show the empty state when loading is true even with zero trips', () => {
    renderWithStore(<Trips />, {
      preloadedState: {
        trips: { tripList: [] } as any,
        shipments: { loading: true } as any,
      },
    })
    expect(screen.queryByText('No trips found')).not.toBeInTheDocument()
  })

  it('triggers fetchTrips on mount (debounced)', async () => {
    renderWithStore(<Trips />, {
      preloadedState: { trips: { tripList: [] } as any },
    })
    await waitFor(
      () => {
        expect(API.fetchTrips).toHaveBeenCalled()
      },
      { timeout: 2000 },
    )
  })

  it('renders a "New Trip" button as a link', () => {
    renderWithStore(<Trips />, {
      preloadedState: { trips: { tripList: [] } as any },
    })
    expect(screen.getByText('New Trip')).toBeInTheDocument()
  })
})

describe('Trips container — "Rejected" status filter', () => {
  const rejectedOption = { value: 'REJECTED', label: 'Rejected' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not load rejected snapshots when neither a driver nor "Rejected" is filtered', async () => {
    renderWithStore(<Trips />, {
      preloadedState: {
        trips: { tripList: [], query: { filters: {} } } as any,
      },
    })
    await waitFor(() => expect(API.fetchTrips).toHaveBeenCalled(), { timeout: 2000 })
    expect(API.fetchRejectedTrips).not.toHaveBeenCalled()
  })

  it('loads every tenant snapshot (no driverId) when "Rejected" is picked with no driver', async () => {
    renderWithStore(<Trips />, {
      preloadedState: {
        trips: {
          tripList: [],
          query: { filters: { TripStatus_id: [rejectedOption] } },
        } as any,
      },
    })

    await waitFor(() => expect(API.fetchRejectedTrips).toHaveBeenCalled(), { timeout: 2000 })
    expect(API.fetchRejectedTrips).toHaveBeenCalledWith({})
  })

  it('still narrows snapshots by driver when both filters are set', async () => {
    renderWithStore(<Trips />, {
      preloadedState: {
        trips: {
          tripList: [],
          query: {
            filters: {
              TripStatus_id: [rejectedOption],
              driver_id: { value: 77, label: 'Bo' },
            },
          },
        } as any,
      },
    })

    await waitFor(() => expect(API.fetchRejectedTrips).toHaveBeenCalled(), { timeout: 2000 })
    expect(API.fetchRejectedTrips).toHaveBeenCalledWith({ driverId: 77 })
  })

  it('renders snapshots beside live trips and counts both in the lane title', async () => {
    ;(API.fetchRejectedTrips as any).mockResolvedValue([
      { archivedTripId: 'arch-1', isRejected: true, trip_title: 'Snapshot A' },
    ])
    ;(API.fetchTrips as any).mockResolvedValue([
      { id: 1, trip_title: 'Live A', internal_status: 'active' },
    ])

    const { container } = renderWithStore(<Trips />, {
      preloadedState: {
        trips: {
          tripList: [],
          query: {
            filters: { TripStatus_id: [{ value: 1, label: 'Pending' }, rejectedOption] },
          },
        } as any,
      },
    })

    await waitFor(() => expect(screen.getByText(/Trips \(2\)/)).toBeInTheDocument(), {
      timeout: 2000,
    })
    expect(container.querySelector('[data-target="rejected-trip-card"]')).toBeInTheDocument()
    expect(container.querySelector('[data-target="trip-card"]')).toBeInTheDocument()
  })
})
