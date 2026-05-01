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
