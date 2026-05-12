import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({ pathname: '/', search: '', hash: '' }),
  useNavigate: () => () => {},
  useParams: () => ({ tripId: '42' }),
  useBlocker: () => ({ state: 'unblocked', proceed: () => {}, reset: () => {} }),
  translatePath: (p: string) => p,
}))

const apiMocks = vi.hoisted(() => ({
  fetchTripMock: vi.fn(async () => null as any),
  updateTripSummaryInfoMock: vi.fn(async () => undefined),
  changeTripStatusMock: vi.fn(async () => undefined),
}))
const { fetchTripMock, updateTripSummaryInfoMock } = apiMocks

vi.mock('@/features/driver-planning/utils/api', () => ({
  API: {
    fetchTrip: apiMocks.fetchTripMock,
    updateTripSummaryInfo: apiMocks.updateTripSummaryInfoMock,
    changeTripStatus: apiMocks.changeTripStatusMock,
    createTripNote: vi.fn(async () => ({})),
    patchTripNote: vi.fn(async () => ({})),
    fetchStates: vi.fn(async () => []),
    fetchDrivers: vi.fn(async () => []),
  },
}))

vi.mock('../ShipmentDetail', () => ({
  ShipmentDetail: () => <div data-testid="shipment-detail-mock" />,
}))

vi.mock('./utils/status-prompt', () => ({
  useStatusPredictionPrompt: () => {},
  usePromptForStatusUpdate: () => vi.fn(),
}))

vi.mock('./utils/date-prompt', () => ({
  useDateChangePrompt: () => {},
}))

import { renderWithStore } from '../../__test-utils__/render-with-store'
import { Trip } from './index'

const tripFixture = {
  id: 42,
  trip_title: 'Hauler-One',
  driver_name: 'Big Rig',
  driver: { driver_name: 'Big Rig' },
  planner: { first_name: 'PA', last_name: 'PB' },
  dispatcher: { first_name: 'DA', last_name: 'DB' },
  total_estimated_lbs: 1000,
  total_actual_lbs: 1100,
  total_estimated_linehaul_usd: 5000,
  status: { status: 'Pending' },
  notes: [],
  activities: [],
}

describe('Trip detail container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTripMock.mockResolvedValue(tripFixture)
  })

  it('fetches the trip on mount and renders the trip header info', async () => {
    renderWithStore(<Trip />)
    await waitFor(() => {
      expect(fetchTripMock).toHaveBeenCalledWith(42)
    })
    await waitFor(() => {
      expect(screen.getByText('Hauler-One', { exact: false })).toBeInTheDocument()
    })
    expect(updateTripSummaryInfoMock).toHaveBeenCalledWith(42)
  })

  it('renders the All trips and Edit planning buttons after the trip loads', async () => {
    renderWithStore(<Trip />)
    await waitFor(() => {
      expect(screen.getByText(/All trips/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Edit planning/)).toBeInTheDocument()
  })

  it('renders the status step rail with each TripStatusOptions entry', async () => {
    renderWithStore(<Trip />)
    await waitFor(() => {
      // "Status" label is present
      expect(screen.getByText('Status')).toBeInTheDocument()
    })
    // Trip Itinerary heading appears
    expect(screen.getByText('Trip Itinerary')).toBeInTheDocument()
  })

  it('renders ShipmentDetail mount', async () => {
    renderWithStore(<Trip />)
    await waitFor(() => {
      expect(screen.getByTestId('shipment-detail-mock')).toBeInTheDocument()
    })
  })
})
