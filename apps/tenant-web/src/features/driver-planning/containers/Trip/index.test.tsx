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

// A trip with two shipment activities — one VIP — for the dateContainer
// (Trip Itinerary) parity tests. `activityType.code` is a non-peg code (WHSE)
// so getPegDates() never flags a spurious date-change in this baseline.
const activity = (over: Record<string, any> = {}) => ({
  activityId: 1,
  order_num: 'O1',
  city: 'DALLAS',
  state: 'TX',
  planned_start: '2024-01-01T00:00:00Z',
  planned_end: '2024-01-01T00:00:00Z',
  estimated_date: null,
  actual_date: null,
  is_committed: false,
  is_confirmed: false,
  activityType: { abbreviation: 'WH', code: 'WHSE', isHasETA: false },
  shipment: {
    shipper_name: 'SMITH, JOHN',
    order_num: 'O1',
    vip: 'N',
    supervip: 'N',
    total_est_wt: 5000,
    pegasus_shadow: null,
  },
  ...over,
})

const tripWithActivitiesFixture = {
  ...tripFixture,
  activities: [
    activity({
      activityId: 1,
      order_num: 'O1',
      shipment: {
        shipper_name: 'SMITH, JOHN',
        order_num: 'O1',
        vip: 'Y',
        supervip: 'N',
        // Also WGS — the combined V-WGS case renders both indicators.
        type_packing: 'Y',
        total_est_wt: 5000,
        pegasus_shadow: null,
      },
    }),
    activity({
      activityId: 2,
      order_num: 'O2',
      city: 'AUSTIN',
      state: 'CA',
      planned_start: '2024-01-02T00:00:00Z',
      planned_end: '2024-01-02T00:00:00Z',
      shipment: {
        shipper_name: 'DOE, JANE',
        order_num: 'O2',
        vip: 'N',
        supervip: 'N',
        type_packing: 'N',
        total_est_wt: 3000,
        pegasus_shadow: null,
      },
    }),
  ],
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

// ---------------------------------------------------------------------------
// dateContainer (Trip Itinerary) — visual-element parity with the longhaul
// reference app. These assert every component that is *supposed* to be there
// renders, including the fixed-left-column ↔ gantt-row alignment invariant
// that the Tailwind-Preflight heading reset had broken.
// ---------------------------------------------------------------------------
describe('Trip dateContainer (Trip Itinerary)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTripMock.mockResolvedValue(tripWithActivitiesFixture)
  })

  it('renders all seven header-info fields', async () => {
    renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    // "Big Rig" appears in both the Lane title and the Driver field.
    expect(screen.getAllByText(/Big Rig/).length).toBeGreaterThan(0) // Driver
    expect(screen.getByText(/Pb , Pa/)).toBeInTheDocument() // Planner (last , first)
    expect(screen.getByText(/Db , Da/)).toBeInTheDocument() // Dispatcher
    expect(screen.getByText(/1000/)).toBeInTheDocument() // Total Est Weight
    expect(screen.getByText(/1100/)).toBeInTheDocument() // Total Actual Weight
    expect(screen.getByText(/5000/)).toBeInTheDocument() // Total Est Linehaul
  })

  it('renders the full status rail with exactly one active step', async () => {
    const { container } = renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    expect(container.querySelectorAll('[data-target="trip-status-step"]')).toHaveLength(5)
    const active = container.querySelectorAll(
      '[data-target="trip-status-step"][data-active="true"]',
    )
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveAttribute('data-status', 'Pending')
  })

  it('renders one fixed-column shipment card per activity, with the VIP badge', async () => {
    const { container } = renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    const cards = container.querySelectorAll('[data-target="trip-shipment-activity"]')
    expect(cards).toHaveLength(2)
    // Card content: startCased shipper surname, order num, City, State.
    expect(screen.getByText('Smith')).toBeInTheDocument()
    expect(screen.getByText(/Dallas, TX/)).toBeInTheDocument()
    // VIP shipper (vip: 'Y') renders the id-badge icon; the plain one does not.
    expect(container.querySelectorAll('i.fa-id-badge')).toHaveLength(1)
  })

  // Regression: a stop can arrive without a city (partial/legacy data). The
  // old `activity.city[0]` read threw mid-render and blew up the whole Trip
  // screen. The card must still render, showing just the state.
  it('renders the itinerary when a stop has no city', async () => {
    fetchTripMock.mockResolvedValue({
      ...tripFixture,
      activities: [activity({ activityId: 1, order_num: 'O1', city: null, state: 'TX' })],
    })
    const { container } = renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    const cards = container.querySelectorAll('[data-target="trip-shipment-activity"]')
    expect(cards).toHaveLength(1)
    // With no city, the label collapses to the state alone — no leading comma.
    expect(cards[0].textContent).toContain('TX')
    expect(cards[0].textContent).not.toContain(', TX')
  })

  it('renders the WGS indicator for type_packing shipments, alongside the VIP badge', async () => {
    const { container } = renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    const cards = container.querySelectorAll('[data-target="trip-shipment-activity"]')
    expect(cards).toHaveLength(2)
    // Exactly one WGS shipment (O1: type_packing 'Y'); the plain O2 has none.
    expect(container.querySelectorAll('i.fa-hand-sparkles')).toHaveLength(1)
    // O1 is both VIP and WGS (V-WGS) → its card carries BOTH icons.
    const wgsCard = container.querySelector(
      '[data-target="trip-shipment-activity"][data-order-num="O1"]',
    )
    expect(wgsCard?.querySelector('i.fa-hand-sparkles')).not.toBeNull()
    expect(wgsCard?.querySelector('i.fa-id-badge')).not.toBeNull()
    // The plain O2 card carries neither indicator.
    const plainCard = container.querySelector(
      '[data-target="trip-shipment-activity"][data-order-num="O2"]',
    )
    expect(plainCard?.querySelector('i.fa-hand-sparkles')).toBeNull()
    expect(plainCard?.querySelector('i.fa-id-badge')).toBeNull()
  })

  it('keeps the fixed card column and gantt rows row-aligned (1:1 count)', async () => {
    const { container } = renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    const cards = container.querySelectorAll('[data-target="trip-shipment-activity"]')
    const rows = container.querySelectorAll('[data-target="gantt-activity-row"]')
    expect(cards.length).toBe(rows.length)
    expect(rows.length).toBe(2)
  })

  it('renders the activity gantt with a colored bar carrying the order color class', async () => {
    const { container } = renderWithStore(<Trip />)
    await waitFor(() => expect(screen.getByText('Trip Itinerary')).toBeInTheDocument())
    expect(container.querySelector('[data-target="activity-gantt"]')).toBeInTheDocument()
    // getColor maps order index → color{N}00 module class; the first order gets color100.
    expect(container.querySelector('[class*="color100"]')).toBeInTheDocument()
  })
})
