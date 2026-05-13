import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithStore } from '../../__test-utils__/render-with-store'

vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({ pathname: '/', search: '', hash: '' }),
  useNavigate: () => () => {},
  useParams: () => ({}),
  translatePath: (p: string) => p,
}))

vi.mock('../../utils/api', () => ({
  API: {
    fetchShipments: vi.fn(() => Promise.resolve([])),
    fetchDrivers: vi.fn(() => Promise.resolve([])),
    fetchStates: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('./components/FilterTabs', () => ({
  FilterTabs: () => <div data-testid="filter-tabs-mock" />,
}))
vi.mock('./components/ShipmentCard', () => ({
  ShipmentCard: ({ shipment }: any) => (
    <div data-testid="shipment-card-mock" data-order={shipment.order_num} />
  ),
}))
vi.mock('../ShipmentsTable', () => ({
  ShipmentsTable: () => <div data-testid="shipments-table-mock" />,
}))

// The mount effect fires fetchShipments(query) which sets loading=true via
// fetchShipmentsStart, hiding the empty state. Make the thunk inert so tests
// can deterministically assert against the initial render state.
vi.mock('../../redux/shipments', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../redux/shipments')
  return {
    ...actual,
    fetchShipments: () => ({ type: 'NOOP_FETCH_SHIPMENTS' }),
  }
})

import { SearchDashboard } from './index'

const sampleShipments = [
  { order_num: 'A1', shipper_state: 'TX', consignee_state: 'CO' },
  { order_num: 'A2', shipper_state: 'CA', consignee_state: 'OR' },
]

describe('SearchDashboard (Shipments search) container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the lane header with the count from state.shipments.shipmentList', () => {
    renderWithStore(<SearchDashboard />, {
      shipments: { shipmentList: sampleShipments, loading: false, query: {} } as any,
    })
    expect(screen.getByText(/^Shipments \(2\)$/)).toBeInTheDocument()
  })

  it('renders all sortable headers', () => {
    renderWithStore(<SearchDashboard />, {
      shipments: { shipmentList: [], loading: false, query: {} } as any,
    })
    // The header band: Origin, Destination, Weight, Pack Date, Load Date, Del
    // Date, Mode, Account, Driver.
    for (const label of [
      'Origin',
      'Destination',
      'Weight',
      'Pack Date',
      'Load Date',
      'Del Date',
      'Mode',
      'Account',
      'Driver',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('renders the empty-state when there are no shipments and not loading', () => {
    renderWithStore(<SearchDashboard />, {
      shipments: { shipmentList: [], loading: false, query: {} } as any,
    })
    expect(screen.getByText('No shipments found')).toBeInTheDocument()
  })

  it('does NOT render the empty-state while loading (suppress the flash)', () => {
    renderWithStore(<SearchDashboard />, {
      shipments: { shipmentList: [], loading: true, query: {} } as any,
    })
    expect(screen.queryByText('No shipments found')).not.toBeInTheDocument()
  })

  it('renders one ShipmentCard per shipment when not in table mode', () => {
    renderWithStore(<SearchDashboard />, {
      shipments: { shipmentList: sampleShipments, loading: false, query: {} } as any,
    })
    expect(screen.getAllByTestId('shipment-card-mock')).toHaveLength(2)
  })

  it('dispatches a sortBy change when a sortable header is clicked', async () => {
    const { dispatched } = renderWithStore(<SearchDashboard />, {
      shipments: {
        shipmentList: sampleShipments,
        loading: false,
        query: {},
      } as any,
    })
    fireEvent.click(screen.getByText('Origin'))
    await waitFor(() => {
      const change = dispatched.find((a: any) => a?.type === 'shipments/changeShipmentQuery')
      expect(change).toBeDefined()
      expect(change.payload).toEqual({
        sortBy: { value: 'shipper_state', order: 'asc' },
      })
    })
  })

  it('flips an existing asc sort to desc when its header is clicked again', async () => {
    const { dispatched } = renderWithStore(<SearchDashboard />, {
      shipments: {
        shipmentList: sampleShipments,
        loading: false,
        query: { sortBy: { value: 'shipper_state', order: 'asc' } },
      } as any,
    })
    fireEvent.click(screen.getByText('Origin'))
    await waitFor(() => {
      const change = dispatched.find((a: any) => a?.type === 'shipments/changeShipmentQuery')
      expect(change?.payload?.sortBy).toEqual({
        value: 'shipper_state',
        order: 'desc',
      })
    })
  })

  it('handles a falsy/undefined shipmentList without crashing (sparse state)', () => {
    expect(() =>
      renderWithStore(<SearchDashboard />, {
        // shipmentList intentionally absent → reducer init = [].
        shipments: { loading: false, query: {} } as any,
      }),
    ).not.toThrow()
    expect(screen.getByText('No shipments found')).toBeInTheDocument()
  })
})
