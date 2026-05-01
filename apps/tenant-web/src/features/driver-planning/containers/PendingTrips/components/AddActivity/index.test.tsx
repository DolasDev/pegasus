import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

vi.mock('../../../../utils/api', () => ({
  API: {
    saveTrip: vi.fn(),
    fetchTrip: vi.fn(),
    cancelTrip: vi.fn(),
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

import { AddActivity } from './index'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

describe('AddActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseShipment = {
    order_num: 1,
    planned_start: new Date('2024-01-01'),
    planned_end: new Date('2024-01-02'),
    extraActivities: [
      {
        ActivityType_code: 'PU',
        activityType: { abbreviation: 'PU', sequencePriority: 1 },
      },
      {
        ActivityType_code: 'DEL',
        activityType: { abbreviation: 'DEL', sequencePriority: 2 },
      },
    ],
  }

  it('smoke: renders without crash with seeded state', () => {
    const { container } = renderWithStore(
      <AddActivity shipment={baseShipment as any} shipmentIndex={0} />,
    )
    expect(container).toBeTruthy()
    // The closed-state button shows '+'
    expect(screen.getByText('+')).toBeInTheDocument()
  })

  it('toggles the menu open and shows extra activities when "+" clicked', () => {
    renderWithStore(<AddActivity shipment={baseShipment as any} shipmentIndex={0} />)
    fireEvent.click(screen.getByText('+'))
    expect(screen.getByText('PU')).toBeInTheDocument()
    expect(screen.getByText('DEL')).toBeInTheDocument()
    // button now shows '-'
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('dispatches addActivity when an extra activity is clicked', () => {
    const seedShipment = {
      order_num: 1,
      stateIdx: 0,
      activities: [],
      extraActivities: [
        {
          ActivityType_code: 'PU',
          activityType: { abbreviation: 'PU', sequencePriority: 1 },
        },
      ],
    }
    const { store } = renderWithStore(
      <AddActivity shipment={seedShipment as any} shipmentIndex={0} />,
      {
        preloadedState: {
          tripPlanning: {
            trip: {
              shipments: [seedShipment],
              status: { id: 1, status_id: 1, status: 'Pending' },
            },
            unsavedTrip: null,
            shipmentToTrips: {},
          } as any,
        },
      },
    )
    fireEvent.click(screen.getByText('+'))
    fireEvent.click(screen.getByText('PU'))
    // The activity should now be in trip.shipments[0].activities
    const state: any = store.getState()
    expect(state.tripPlanning.trip.shipments[0].activities.length).toBe(1)
    expect(state.tripPlanning.trip.shipments[0].activities[0].activityType.abbreviation).toBe('PU')
  })

  it('handles missing extraActivities gracefully', () => {
    const shipmentNoExtras: any = {
      order_num: 2,
      planned_start: new Date(),
      planned_end: new Date(),
      extraActivities: undefined,
    }
    renderWithStore(<AddActivity shipment={shipmentNoExtras} shipmentIndex={0} />)
    // Button still renders
    fireEvent.click(screen.getByText('+'))
    // No menu items rendered, but no crash
    expect(screen.queryByText('PU')).toBeNull()
  })
})
