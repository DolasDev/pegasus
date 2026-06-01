// ---------------------------------------------------------------------------
// PlanningModule smoke test — composition only.
// All heavy children are mocked so we just verify the module wires:
//   - SearchDashboard (left column)
//   - PendingTrips (right column)
//   - ShipmentDetail
// and dispatches the initialize action via useEffect without crashing.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

const locationMock = vi.hoisted(() => ({
  current: { pathname: '/planning', search: '', hash: '' } as {
    pathname: string
    search: string
    hash: string
  },
}))

// Router shim mocks — `useLocation` returns whatever the test set on locationMock.
vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  useLocation: () => locationMock.current,
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

// trip-planning slice exports `initializeTripPage` as a thunk; replace with a
// spy thunk-factory so we can assert on the args the module hands it.
const initializeTripPageMock = vi.hoisted(() => vi.fn(() => () => Promise.resolve()))
vi.mock('@/features/driver-planning/redux/trip-planning', async () => {
  const actual = await vi.importActual<any>('@/features/driver-planning/redux/trip-planning')
  return {
    ...actual,
    initializeTripPage: initializeTripPageMock,
  }
})

import { PlanningModule } from './PlanningModule'
import { renderWithStore } from '../__test-utils__/render-with-store'

const userPreloaded = {
  user: { user: { id: 1, code: 'X', name: 'Tester' }, loading: false, errorMessage: null },
} as any

describe('PlanningModule', () => {
  beforeEach(() => {
    initializeTripPageMock.mockClear()
    locationMock.current = { pathname: '/planning', search: '', hash: '' }
  })

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

  it('dispatches initializeTripPage with no tripId when the URL has no ?tripId= param', async () => {
    renderWithStore(<PlanningModule />, { preloadedState: userPreloaded })
    await waitFor(() => expect(initializeTripPageMock).toHaveBeenCalled())
    // First arg: tripId — undefined when the search param is absent.
    expect(initializeTripPageMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ id: 1, code: 'X' }),
    )
  })

  it('dispatches initializeTripPage with the parsed tripId when the URL has ?tripId=42', async () => {
    locationMock.current = { pathname: '/planning', search: '?tripId=42', hash: '' }
    renderWithStore(<PlanningModule />, { preloadedState: userPreloaded })
    await waitFor(() => expect(initializeTripPageMock).toHaveBeenCalled())
    // qs.parse returns a string for a single key.
    expect(initializeTripPageMock).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ id: 1, code: 'X' }),
    )
  })
})
