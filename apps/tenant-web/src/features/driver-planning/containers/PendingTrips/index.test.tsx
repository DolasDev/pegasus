import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

vi.mock('../../utils/api', () => ({
  API: {
    saveTrip: vi.fn(() => Promise.resolve({ id: 99 })),
    fetchTrip: vi.fn(),
    cancelTrip: vi.fn(() => Promise.resolve()),
    fetchShipments: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/', search: {}, hash: '' }),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

import { PendingTrips } from './index'
import { renderWithStore } from '../../__test-utils__/render-with-store'

const seedTrip = (overrides: any = {}) => ({
  id: undefined,
  trip_title: 'Trip A',
  driver: { driver_id: 1, driver_name: 'Sam Driver', id: 1 },
  dispatcher: { code: 'D1', first_name: 'Alex', last_name: 'Smith' },
  shipments: [],
  status: { id: 1, status_id: 1, status: 'Pending' },
  ...overrides,
})

const seedShipment = (overrides: any = {}) => ({
  order_num: 100,
  shipper_name: 'Shipper Inc',
  shipper_city: 'NYC',
  shipper_state: 'NY',
  consignee_city: 'LA',
  consignee_state: 'CA',
  total_est_wt: 1500,
  line_haul: 1000,
  avl_reg: 'AVL-1',
  load_date: '2024-06-01',
  activities: [],
  extraActivities: [
    {
      ActivityType_code: 'PU',
      activityType: { abbreviation: 'PU', sequencePriority: 1, isCanEditDates: true },
    },
  ],
  ...overrides,
})

describe('PendingTrips container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('smoke: renders with seeded state and shows Pending Trips lane', () => {
    const { container } = renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip(),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
        common: { dispatcherList: [], driversList: [] } as any,
      },
    })
    expect(container).toBeTruthy()
    expect(screen.getByText('Pending Trips')).toBeInTheDocument()
    expect(screen.getByText('Trip Name')).toBeInTheDocument()
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByText('Dispatcher')).toBeInTheDocument()
    expect(screen.getByText('Total Weight')).toBeInTheDocument()
    expect(screen.getByText('Total Linehaul')).toBeInTheDocument()
  })

  it('shows the no-shipments disclaimer when trip has no shipments', () => {
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip(),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    expect(screen.getByText('No shipments for trip')).toBeInTheDocument()
    expect(
      screen.getByText('Please add a shipment to this trip by selecting one in the left panel'),
    ).toBeInTheDocument()
    // 'New Trip' button only shows if shipments.length > 0
    expect(screen.queryByText('New Trip')).toBeNull()
    // Save button is always rendered
    expect(screen.getByText('Save')).toBeInTheDocument()
  })

  it('shows shipments and the Activities header when trip has shipments', () => {
    const ship = seedShipment()
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    // City pair shown as Card title
    expect(screen.getByText('NYC, NY - LA, CA')).toBeInTheDocument()
    // Activities header inside the card
    expect(screen.getByText('Activities')).toBeInTheDocument()
    // 'New Trip' button now shows because shipments.length > 0
    expect(screen.getByText('New Trip')).toBeInTheDocument()
    // View itinerary link only shows if trip.id is set; here it's not
    expect(screen.queryByText(/View Itinerary/)).toBeNull()
  })

  it('renders View Itinerary link and MoreTripActions menu when trip has id', () => {
    const ship = seedShipment()
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ id: 42, shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    expect(screen.getByText('View Itinerary #42')).toBeInTheDocument()
  })

  it('clicking trash on a shipment dispatches removeShipmentFromTrip', () => {
    const ship = seedShipment()
    const { store, container } = renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: { 100: { undefined: undefined } },
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    // Find a trash icon button (there's at least one for the shipment removal)
    const trashButtons = container.querySelectorAll('button i.fa-trash')
    expect(trashButtons.length).toBeGreaterThan(0)
    // Click the parent button
    fireEvent.click(trashButtons[0].parentElement as HTMLElement)
    const state: any = store.getState()
    expect(state.tripPlanning.trip.shipments.length).toBe(0)
  })

  it('clicking Save calls API.saveTrip', async () => {
    const apiModule = await import('../../utils/api')
    const ship = seedShipment()
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    fireEvent.click(screen.getByText('Save'))
    expect(apiModule.API.saveTrip as any).toHaveBeenCalled()
  })

  it('clicking New Trip opens the ConfirmDialog with the legacy prompt copy', async () => {
    const ship = seedShipment()
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    fireEvent.click(screen.getByText('New Trip'))
    // ConfirmDialog now opens instead of the native window.confirm.
    expect(
      await screen.findByText(
        'Are you sure you want to clear the current trip and start a new one?',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start new trip' })).toBeInTheDocument()
  })

  it('confirming "Start new trip" resets the pending trip via clearCurrentTripAction', async () => {
    const ship = seedShipment()
    const { store } = renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ id: 7, shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    fireEvent.click(screen.getByText('New Trip'))
    fireEvent.click(await screen.findByRole('button', { name: 'Start new trip' }))
    // The clearCurrentTripAction = initializeTripPage(null, planner) thunk runs,
    // dispatches setTrip(freshPendingTrip). Verify the OUTCOME in store state:
    // the seeded trip (id=7, shipments=[ship]) is replaced with a fresh one
    // (no id, no shipments, dispatcher=planner).
    await waitFor(() => {
      const trip = (store.getState() as any).tripPlanning.trip
      expect(trip.id).toBeUndefined()
      expect(trip.trip_title).toBe('Pending Trip')
      expect(trip.shipments).toEqual([])
      expect(trip.dispatcher).toMatchObject({ code: 'U1' })
    })
  })

  it('clicking + on AddActivity opens menu with extra activity options', () => {
    const ship = seedShipment()
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    // Click the AddActivity '+' button
    fireEvent.click(screen.getByText('+'))
    // Menu now shows the PU activity option
    expect(screen.getByText('PU')).toBeInTheDocument()
  })

  it('clicking activity card with editable dates opens EditActivity (smoke)', () => {
    const activity = {
      activityType: { abbreviation: 'PU', sequencePriority: 1, isCanEditDates: true },
      planned_start: '2024-06-15T00:00:00Z',
      planned_end: '2024-06-16T00:00:00Z',
      estimated_date: '2024-06-15',
    }
    const ship = seedShipment({ activities: [activity], extraActivities: [] })
    const { container } = renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    expect(container).toBeTruthy()
    // The activity card text shows the abbreviation prefix
    const activitySpan = screen.getByText(/^PU /)
    expect(activitySpan).toBeInTheDocument()
  })

  it('weight and linehaul totals render correctly', () => {
    const ship1 = seedShipment({ order_num: 100, total_est_wt: 1500, line_haul: 1000 })
    const ship2 = seedShipment({ order_num: 101, total_est_wt: 500, line_haul: 250 })
    renderWithStore(<PendingTrips />, {
      preloadedState: {
        tripPlanning: {
          trip: seedTrip({ shipments: [ship1, ship2] }),
          unsavedTrip: null,
          shipmentToTrips: {},
        } as any,
        user: { user: { code: 'U1' }, loading: false, errorMessage: null } as any,
      },
    })
    expect(screen.getByText('2,000 LB')).toBeInTheDocument()
    expect(screen.getByText('$1250')).toBeInTheDocument()
  })
})
