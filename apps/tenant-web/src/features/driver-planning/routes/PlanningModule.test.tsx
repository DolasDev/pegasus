// ---------------------------------------------------------------------------
// PlanningModule smoke test — composition only.
// All heavy children are mocked so we just verify the module wires:
//   - SearchDashboard (left column)
//   - PendingTrips (right column)
//   - ShipmentDetail
// and dispatches the initialize action via useEffect without crashing.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'

// Router shim mocks
vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  useLocation: () => ({ pathname: '/planning', search: '', hash: '' }),
  useBlocker: () => ({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() }),
}))

// Container mocks
vi.mock('../containers/Shipments', () => ({
  SearchDashboard: () => <div data-testid="mock-search-dashboard" />,
}))
vi.mock('../containers/PendingTrips', () => ({
  PendingTrips: () => <div data-testid="mock-pending-trips" />,
}))
vi.mock('../containers/ShipmentDetail', () => ({
  ShipmentDetail: () => <div data-testid="mock-shipment-detail" />,
}))

// pending-trips slice exports `initializeTripPage` as a thunk; replace with no-op.
vi.mock('@/features/driver-planning/redux/pending-trips', async () => {
  const actual = await vi.importActual<any>('@/features/driver-planning/redux/pending-trips')
  return {
    ...actual,
    initializeTripPage: () => () => Promise.resolve(),
  }
})

import { PlanningModule } from './PlanningModule'
import { renderWithStore } from '../__test-utils__/render-with-store'

const userPreloaded = {
  user: { user: { id: 1, code: 'X', name: 'Tester' }, loading: false, errorMessage: null },
} as any

describe('PlanningModule', () => {
  it('renders the three composed containers', () => {
    renderWithStore(<PlanningModule />, { preloadedState: userPreloaded })
    expect(screen.getByTestId('mock-search-dashboard')).toBeInTheDocument()
    expect(screen.getByTestId('mock-pending-trips')).toBeInTheDocument()
    expect(screen.getByTestId('mock-shipment-detail')).toBeInTheDocument()
  })

  it('renders the PlanningModule layout container', () => {
    const { container } = renderWithStore(<PlanningModule />, { preloadedState: userPreloaded })
    expect(container.querySelector('.PlanningModule__container')).toBeTruthy()
    expect(container.querySelector('.App__left-column')).toBeTruthy()
    expect(container.querySelector('.App__right-column')).toBeTruthy()
  })
})
